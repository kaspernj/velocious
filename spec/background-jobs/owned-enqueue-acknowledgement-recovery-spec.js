// @ts-check

import fs from "fs/promises"
import net from "net"
import BackgroundJobsClient from "../../src/background-jobs/client.js"
import JsonSocket from "../../src/background-jobs/json-socket.js"
import BackgroundJobsMain from "../../src/background-jobs/main.js"
import SqlBackgroundJobsAdapter from "../../src/background-jobs/sql-adapter.js"
import BackgroundJobsWorker from "../../src/background-jobs/worker.js"
import { createGenerationWorkerId } from "../../src/background-jobs/generation-identity.js"
import { createBackgroundJobUpdateObserver, outputPathFor } from "../helpers/background-jobs-helper.js"
import { startGenerationMain } from "../helpers/background-jobs-generation-harness.js"
import promiseBarrier from "../helpers/promise-barrier.js"
import dummyConfiguration from "../dummy/src/config/configuration.js"
import { describe, expect, it } from "../../src/testing/test.js"

/**
 * @typedef {object} AcknowledgementProxy
 * @property {() => Promise<void>} close - Closes the proxy and its connections.
 * @property {number} connectionCount - Number of accepted client connections.
 * @property {Array<import("../../src/background-jobs/types.js").BackgroundJobEnqueueMessage>} enqueueMessages - Forwarded enqueue messages.
 * @property {string | undefined} withheldJobId - Durable id from the dropped acknowledgement.
 * @property {number} port - Bound proxy port.
 */

/**
 * Forwards the generation protocol but drops the first successful enqueue
 * acknowledgement after the real main has durably committed it, closing that
 * connection so the client observes the loss only after the commit boundary.
 * @param {number} mainPort - Real generation main port.
 * @returns {Promise<AcknowledgementProxy>} - Started proxy.
 */
async function startAcknowledgementProxy(mainPort) {
  /** @type {Set<net.Socket>} */
  const sockets = new Set()
  /** @type {Array<import("../../src/background-jobs/types.js").BackgroundJobEnqueueMessage>} */
  const enqueueMessages = []
  let connectionCount = 0
  let withheldJobId
  const server = net.createServer((downstreamSocket) => {
    connectionCount += 1
    const withholdAcknowledgement = connectionCount === 1
    const upstreamSocket = net.createConnection({host: "127.0.0.1", port: mainPort})
    const downstream = new JsonSocket(downstreamSocket)
    const upstream = new JsonSocket(upstreamSocket)

    sockets.add(downstreamSocket)
    sockets.add(upstreamSocket)
    downstreamSocket.once("close", () => {
      sockets.delete(downstreamSocket)
      upstreamSocket.destroy()
    })
    upstreamSocket.once("close", () => {
      sockets.delete(upstreamSocket)
      if (!withholdAcknowledgement) downstreamSocket.end()
    })
    downstream.on("error", () => upstreamSocket.destroy())
    upstream.on("error", () => downstreamSocket.destroy())
    downstream.on("message", (message) => {
      if (message?.type === "enqueue") enqueueMessages.push(message)
      upstream.send(message)
    })
    upstream.on("message", (message) => {
      if (withholdAcknowledgement && message?.type === "enqueued") {
        withheldJobId = message.jobId
        downstreamSocket.end()
        upstreamSocket.destroy()
        return
      }

      downstream.send(message)
    })
  })

  await new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => resolve(undefined))
  })
  const address = server.address()

  if (!address || typeof address === "string") throw new Error("Expected acknowledgement proxy TCP address")

  return {
    close: async () => {
      for (const socket of sockets) socket.destroy()
      await new Promise((resolve) => server.close(() => resolve(undefined)))
    },
    get connectionCount() {
      return connectionCount
    },
    enqueueMessages,
    get withheldJobId() {
      return withheldJobId
    },
    port: address.port
  }
}

/**
 * Creates one generation-owned producer handoff in the real SQL store.
 * @param {object} args - Producer inputs.
 * @param {string} args.generationId - Producer generation.
 * @param {string} args.jobName - Parent job name.
 * @param {SqlBackgroundJobsAdapter} args.store - Real durable store.
 * @returns {Promise<{jobId: string, proof: import("../../src/background-jobs/types.js").BackgroundJobProducerProof}>} - Owned producer.
 */
async function createOwnedProducer({generationId, jobName, store}) {
  const jobId = await store.enqueue({args: [], jobName, options: {executionMode: "pooled"}})
  const workerId = createGenerationWorkerId({
    generationId,
    workerInstanceId: "e1299a73-0f24-4d3b-a60f-6656900c2df4"
  })
  const handoff = await store.markHandedOff({jobId, workerId})

  if (!handoff) throw new Error("Expected owned producer handoff")

  return {
    jobId,
    proof: {
      handedOffAtMs: handoff.handedOffAtMs,
      handoffId: handoff.handoffId,
      jobId,
      workerId
    }
  }
}

describe("BackgroundJobsClient owned enqueue acknowledgement recovery", {databaseCleaning: {transaction: true}}, () => {
  it("recovers the exact durable enqueue after its post-commit acknowledgement is lost", async () => {
    const generationId = "owned-ack-recovery"
    const store = new SqlBackgroundJobsAdapter({configuration: dummyConfiguration})
    const workerReady = promiseBarrier()
    /** @type {ReturnType<typeof createBackgroundJobUpdateObserver> | null} */
    let updates = null
    const {main} = await startGenerationMain({
      generationId,
      initialGenerationState: "active",
      onJobUpdated: (update) => updates?.onJobUpdated(update),
      onWorkerReady: workerReady.entered,
      store
    })
    updates = createBackgroundJobUpdateObserver({store})
    const proxy = await startAcknowledgementProxy(main.getPort())
    const outputPath = await outputPathFor("owned-enqueue-ack-recovery")
    /** @type {BackgroundJobsWorker | undefined} */
    let worker

    try {
      const producer = await createOwnedProducer({generationId, jobName: "OwnedAckProducerJob", store})
      dummyConfiguration.setBackgroundJobsConfig({generationId, host: "127.0.0.1", port: proxy.port})
      const client = new BackgroundJobsClient({configuration: dummyConfiguration, generationId})
      const jobId = await client.enqueue({
        args: ["once", outputPath],
        jobName: "AppendJob",
        options: {executionMode: "inline"},
        producerInvocationId: "owned-ack-invocation",
        producerProof: producer.proof
      })

      expect(jobId).toEqual(proxy.withheldJobId)
      expect(proxy.connectionCount).toEqual(2)
      expect(proxy.enqueueMessages).toHaveLength(2)
      expect(proxy.enqueueMessages[1]).toEqual(proxy.enqueueMessages[0])
      expect(await store.countJobs({jobName: "AppendJob"})).toEqual(1)

      worker = new BackgroundJobsWorker({
        closeDatabaseConnectionsOnStop: false,
        configuration: dummyConfiguration,
        generationId,
        host: "127.0.0.1",
        maxConcurrentInlineJobs: 1,
        pooledRunnerCount: 1,
        port: main.getPort(),
        workerInstanceId: "a3582ca8-e4c4-4aa3-b741-927724619317"
      })
      await worker.start()
      await workerReady.waiting
      await updates.waitForUpdate(jobId)

      expect(JSON.parse(await fs.readFile(outputPath, "utf8"))).toEqual(["once"])
      expect(await store.countJobs({jobName: "AppendJob"})).toEqual(1)
    } finally {
      await worker?.stop()
      await proxy.close()
      await main.stop()
      await fs.rm(outputPath, {force: true})
    }
  })

  it("does not replay an explicit stale-ownership rejection", async () => {
    const generationId = "owned-ack-stale"
    const store = new SqlBackgroundJobsAdapter({configuration: dummyConfiguration})
    const {main} = await startGenerationMain({generationId, initialGenerationState: "active", store})
    const proxy = await startAcknowledgementProxy(main.getPort())

    try {
      const producer = await createOwnedProducer({generationId, jobName: "StaleOwnedAckProducerJob", store})
      expect(await store.markCompleted({jobId: producer.jobId, ...producer.proof})).toEqual(true)
      dummyConfiguration.setBackgroundJobsConfig({generationId, host: "127.0.0.1", port: proxy.port})
      const client = new BackgroundJobsClient({configuration: dummyConfiguration, generationId})

      await expect(async () => await client.enqueue({
        args: [],
        jobName: "RejectedOwnedAckChildJob",
        producerInvocationId: "stale-owned-ack-invocation",
        producerProof: producer.proof
      })).toThrow(/producer handoff is no longer owned/i)
      expect(proxy.connectionCount).toEqual(1)
      expect(proxy.enqueueMessages).toHaveLength(1)
      expect(await store.countJobs({jobName: "RejectedOwnedAckChildJob"})).toEqual(0)
    } finally {
      await proxy.close()
      await main.stop()
    }
  })

  it("preserves ordinary idempotency-key enqueue acknowledgement behavior", async () => {
    const generationId = "ordinary-ack-loss"
    const store = new SqlBackgroundJobsAdapter({configuration: dummyConfiguration})
    const {main} = await startGenerationMain({generationId, initialGenerationState: "active", store})
    const proxy = await startAcknowledgementProxy(main.getPort())

    try {
      dummyConfiguration.setBackgroundJobsConfig({generationId, host: "127.0.0.1", port: proxy.port})
      const client = new BackgroundJobsClient({configuration: dummyConfiguration, generationId})

      await expect(async () => await client.enqueue({
        args: ["ordinary"],
        jobName: "OrdinaryAckChildJob",
        options: {idempotencyKey: "ordinary-ack-child"}
      })).toThrow(/closed before.*acknowledged/i)
      expect(proxy.connectionCount).toEqual(1)
      expect(proxy.enqueueMessages).toHaveLength(1)
      expect(proxy.withheldJobId).toBeDefined()
      expect(await store.countJobs({jobName: "OrdinaryAckChildJob"})).toEqual(1)
    } finally {
      await proxy.close()
      await main.stop()
    }
  })

  it("does not replay a legacy enqueue carrying producer metadata", async () => {
    const generationId = "legacy-owned-ack-loss"
    const store = new SqlBackgroundJobsAdapter({configuration: dummyConfiguration})
    dummyConfiguration.setBackgroundJobsConfig({generationId: undefined, initialGenerationState: undefined, lifecycleSocketPath: undefined})
    const main = new BackgroundJobsMain({closeDatabaseConnectionsOnStop: false, configuration: dummyConfiguration, host: "127.0.0.1", port: 0})
    main.store = store
    await main.start()
    const proxy = await startAcknowledgementProxy(main.getPort())

    try {
      const producer = await createOwnedProducer({generationId, jobName: "LegacyOwnedAckProducerJob", store})
      dummyConfiguration.setBackgroundJobsConfig({generationId: undefined, host: "127.0.0.1", port: proxy.port})
      const client = new BackgroundJobsClient({configuration: dummyConfiguration})

      await expect(async () => await client.enqueue({
        args: [],
        jobName: "LegacyOwnedAckChildJob",
        producerInvocationId: "legacy-owned-ack-invocation",
        producerProof: producer.proof
      })).toThrow(/closed before.*acknowledged/i)
      expect(proxy.connectionCount).toEqual(1)
      expect(proxy.enqueueMessages).toHaveLength(1)
      expect(proxy.withheldJobId).toBeDefined()
      expect(await store.countJobs({jobName: "LegacyOwnedAckChildJob"})).toEqual(1)
    } finally {
      await proxy.close()
      await main.stop()
    }
  })

  it("does not replay when generation fencing rejects before enqueue is sent", async () => {
    const generationId = "owned-ack-fenced"
    const store = new SqlBackgroundJobsAdapter({configuration: dummyConfiguration})
    const {main} = await startGenerationMain({generationId, initialGenerationState: "active", store})
    const proxy = await startAcknowledgementProxy(main.getPort())

    try {
      const producer = await createOwnedProducer({generationId, jobName: "FencedOwnedAckProducerJob", store})
      dummyConfiguration.setBackgroundJobsConfig({generationId: undefined, host: "127.0.0.1", port: proxy.port})
      const client = new BackgroundJobsClient({
        configuration: dummyConfiguration,
        generationId: "different-owned-ack-generation"
      })

      await expect(async () => await client.enqueue({
        args: [],
        jobName: "FencedOwnedAckChildJob",
        producerInvocationId: "fenced-owned-ack-invocation",
        producerProof: producer.proof
      })).toThrow(/generation rejected: generation-mismatch/i)
      expect(proxy.connectionCount).toEqual(1)
      expect(proxy.enqueueMessages).toHaveLength(0)
      expect(await store.countJobs({jobName: "FencedOwnedAckChildJob"})).toEqual(0)
    } finally {
      await proxy.close()
      await main.stop()
    }
  })
})
