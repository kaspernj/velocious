// @ts-check

import timeout from "awaitery/build/timeout.js"
import BackgroundJobsClient from "../../src/background-jobs/client.js"
import BackgroundJobsStatusReporter from "../../src/background-jobs/status-reporter.js"
import BackgroundJobsWorker from "../../src/background-jobs/worker.js"
import Configuration from "../../src/configuration.js"
import EnvironmentHandlerNode from "../../src/environment-handlers/node.js"
import { startBackgroundJobsMain } from "../helpers/background-jobs-helper.js"
import { connectGenerationPeer } from "../helpers/background-jobs-generation-harness.js"
import stalledSocketServer from "../helpers/stalled-socket-server.js"
import dummyConfiguration from "../dummy/src/config/configuration.js"
import { describe, expect, it } from "../../src/testing/test.js"

/**
 * Captures an expected request failure within a test-only deadlock guard.
 * @param {() => Promise<void>} callback - Request expected to reject.
 * @returns {Promise<Error>} - Captured failure.
 */
async function requestError(callback) {
  try {
    await timeout({errorMessage: "Test guard expired before generation handshake failure", timeout: 250}, callback)
  } catch (error) {
    if (error instanceof Error) return error
    throw error
  }

  throw new Error("Expected generation handshake to fail")
}

/**
 * Builds an isolated socket-only configuration.
 * @param {{host: string, port: number}} endpoint - Stalled peer endpoint.
 * @returns {Configuration} - Isolated configuration.
 */
function socketConfiguration(endpoint) {
  return new Configuration({
    backgroundJobs: endpoint,
    directory: process.cwd(),
    environment: "test",
    environmentHandler: new EnvironmentHandlerNode(),
    initializeModels: async () => {},
    locale: "en",
    localeFallbacks: {en: ["en"]}
  })
}

describe("Background jobs generation handshake", () => {
  it("bounds worker acknowledgement and closes a stalled real socket before readiness", async () => {
    const stalled = await stalledSocketServer()
    const worker = new BackgroundJobsWorker({
      closeDatabaseConnectionsOnStop: false,
      configuration: dummyConfiguration,
      generationHandshakeTimeoutMs: 25,
      generationId: "release-stalled-worker",
      host: stalled.host,
      port: stalled.port
    })

    try {
      const error = await requestError(async () => await worker.start())

      expect(error.name).toEqual("BackgroundJobsGenerationHandshakeTimeoutError")
      expect(error.message).toMatch(/worker.*release-stalled-worker.*25ms.*127\.0\.0\.1/)
      await stalled.requestReceived
      await timeout({errorMessage: "Timed-out worker socket stayed open", timeout: 250}, async () => await stalled.connectionClosed)
      expect(stalled.requestCount()).toEqual(1)
      expect(stalled.requests()[0]).toMatchObject({type: "hello", role: "worker", generationId: "release-stalled-worker"})
      expect(worker._generationAccepted).toEqual(false)
    } finally {
      await worker.stop()
      await stalled.close()
    }
  })

  it("bounds client and reporter handshakes before either sends a mutation", async () => {
    for (const role of ["client", "reporter"]) {
      const stalled = await stalledSocketServer()

      try {
        let error
        if (role === "client") {
          const client = new BackgroundJobsClient({
            configuration: socketConfiguration({host: stalled.host, port: stalled.port}),
            generationHandshakeTimeoutMs: 25,
            generationId: "release-stalled-request"
          })
          error = await requestError(async () => { await client.replaceScheduled({scheduleKey: "stalled", jobName: "NeverSent", args: []}) })
        } else {
          const reporter = new BackgroundJobsStatusReporter({
            attemptTimeoutMs: 200,
            configuration: dummyConfiguration,
            generationHandshakeTimeoutMs: 25,
            generationId: "release-stalled-request",
            host: stalled.host,
            port: stalled.port
          })
          error = await requestError(async () => { await reporter.report({jobId: "never-mutated", status: "completed"}) })
        }

        expect(error.name).toEqual("BackgroundJobsGenerationHandshakeTimeoutError")
        expect(error.message).toMatch(new RegExp(`${role}.*release-stalled-request.*25ms`))
        await stalled.requestReceived
        await timeout({errorMessage: `Timed-out ${role} socket stayed open`, timeout: 250}, async () => await stalled.connectionClosed)
        expect(stalled.requestCount()).toEqual(1)
        expect(stalled.requests()[0]).toMatchObject({type: "hello", role, generationId: "release-stalled-request"})
      } finally {
        await stalled.close()
      }
    }
  })

  it("acknowledges same-generation worker, client, and reporter peers", async () => {
    const {main} = await startBackgroundJobsMain({
      backgroundJobsConfig: {generationId: "release-a", initialGenerationState: "active"}
    })
    /** @type {Awaited<ReturnType<typeof connectGenerationPeer>>[]} */
    const peers = []

    try {
      for (const role of ["worker", "client", "reporter"]) {
        const peer = await connectGenerationPeer(main.getPort())
        peers.push(peer)
        const messagePromise = peer.nextMessage()
        peer.jsonSocket.send({
          type: "hello",
          role,
          generationId: "release-a",
          ...(role === "worker" ? {workerId: "release-a:7e725e43-1887-4f19-a711-4731fe6caab2", supportsHandoffIdReporting: true} : {})
        })

        expect(await messagePromise).toEqual({
          type: "generation-accepted",
          generationId: "release-a",
          lifecycleState: "active"
        })
      }
    } finally {
      for (const peer of peers) await peer.close()
      await main.stop()
    }
  })

  it("rejects missing, malformed, unexpected, and mismatched generations without disclosure", async () => {
    const {main} = await startBackgroundJobsMain({
      backgroundJobsConfig: {generationId: "release-a", initialGenerationState: "active"}
    })
    /** @type {Awaited<ReturnType<typeof connectGenerationPeer>>[]} */
    const peers = []

    try {
      const cases = [
        {hello: {type: "hello", role: "client"}, reason: "missing-generation"},
        {hello: {type: "hello", role: "client", generationId: "bad:value"}, reason: "malformed-generation"},
        {hello: {type: "hello", role: "client", generationId: "release-b"}, reason: "generation-mismatch"}
      ]

      for (const testCase of cases) {
        const peer = await connectGenerationPeer(main.getPort())
        peers.push(peer)
        const messagePromise = peer.nextMessage()
        peer.jsonSocket.send(testCase.hello)
        const message = await messagePromise

        expect(message).toEqual({type: "generation-rejected", reason: testCase.reason})
        expect(JSON.stringify(message)).not.toMatch(/release-a/)
      }

      await main.stop()
      const legacyMain = (await startBackgroundJobsMain()).main
      const peer = await connectGenerationPeer(legacyMain.getPort())
      peers.push(peer)
      const messagePromise = peer.nextMessage()
      peer.jsonSocket.send({type: "hello", role: "client", generationId: "release-a"})
      expect(await messagePromise).toEqual({type: "generation-rejected", reason: "unexpected-generation"})
      await legacyMain.stop()
    } finally {
      for (const peer of peers) await peer.close()
      await main.stop()
    }
  })

  it("does not mutate through a client or reporter before generation acknowledgement", async () => {
    const {main, store} = await startBackgroundJobsMain({
      backgroundJobsConfig: {generationId: "release-a", initialGenerationState: "active"}
    })
    const peer = await connectGenerationPeer(main.getPort())
    const reporter = await connectGenerationPeer(main.getPort())

    try {
      peer.jsonSocket.send({type: "hello", role: "client", generationId: "release-b"})
      peer.jsonSocket.send({type: "enqueue", jobName: "GenerationHandshakeJob", args: []})
      expect(await peer.nextMessage()).toEqual({type: "generation-rejected", reason: "generation-mismatch"})

      await timeout({errorMessage: "Rejected peer mutated the durable queue", timeout: 1000}, async () => {
        expect(await store.nextAvailableJob()).toEqual(null)
      })

      const jobId = await store.enqueue({jobName: "GenerationHandshakeJob", args: [], options: {executionMode: "inline"}})
      const handoff = await store.markHandedOff({
        jobId,
        workerId: "release-a:7e725e43-1887-4f19-a711-4731fe6caab2"
      })
      if (!handoff) throw new Error("Expected a real handoff")
      const reporterAccepted = reporter.nextMessage()
      reporter.jsonSocket.send({type: "hello", role: "reporter", generationId: "release-a"})
      await reporterAccepted
      const rejectedReport = reporter.nextMessage()
      reporter.jsonSocket.send({type: "job-complete", jobId, workerId: "release-a:7e725e43-1887-4f19-a711-4731fe6caab2"})

      expect(await rejectedReport).toEqual({type: "job-update-error", jobId, error: "Generation ownership rejected"})
      expect((await store.getJob(jobId))?.status).toEqual("handed_off")
    } finally {
      await reporter.close()
      await peer.close()
      await main.stop()
    }
  })
})
