// @ts-check

import net from "net"
import {TimeoutError} from "awaitery/build/timeout.js"

import BackgroundJobsClient from "../../src/background-jobs/client.js"
import BackgroundJobEnqueueAcknowledgementTimeoutError from "../../src/background-jobs/enqueue-acknowledgement-timeout-error.js"
import JsonSocket from "../../src/background-jobs/json-socket.js"
import Configuration from "../../src/configuration.js"
import EnvironmentHandlerNode from "../../src/environment-handlers/node.js"
import { describe, expect, it } from "../../src/testing/test.js"

const STAGE_DELAY_MS = 300

/**
 * Starts a generation-aware peer that delays each independent protocol stage.
 * @param {object} [args] - Server behavior.
 * @param {boolean} [args.acknowledgeEnqueue] - Whether to acknowledge enqueue requests.
 * @param {string} [args.generationId] - Generation identity returned to a fenced client.
 * @param {number} [args.stageDelayMs] - Delay before each enabled response.
 * @returns {Promise<{close: () => Promise<void>, enqueueMessages: Array<import("../../src/background-jobs/types.js").BackgroundJobEnqueueMessage>, port: number}>} - Server handle.
 */
async function startStagedAcknowledgementServer({acknowledgeEnqueue = true, generationId = "acknowledgement-deadline", stageDelayMs = STAGE_DELAY_MS} = {}) {
  /** @type {Set<net.Socket>} */
  const sockets = new Set()
  /** @type {Set<ReturnType<typeof setTimeout>>} */
  const timers = new Set()
  /** @type {Array<import("../../src/background-jobs/types.js").BackgroundJobEnqueueMessage>} */
  const enqueueMessages = []
  const server = net.createServer((socket) => {
    const jsonSocket = new JsonSocket(socket)

    sockets.add(socket)
    socket.once("close", () => sockets.delete(socket))
    jsonSocket.on("message", (message) => {
      if (message?.type === "hello") {
        const timer = setTimeout(() => {
          timers.delete(timer)
          jsonSocket.send({
            type: "generation-accepted",
            generationId,
            lifecycleState: "active"
          })
        }, stageDelayMs)

        timers.add(timer)
        return
      }

      if (message?.type === "enqueue") {
        enqueueMessages.push(message)
        if (!acknowledgeEnqueue) return

        const timer = setTimeout(() => {
          timers.delete(timer)
          jsonSocket.send({type: "enqueued", jobId: "staged-job"})
        }, stageDelayMs)

        timers.add(timer)
      }
    })
  })

  await new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => resolve(undefined))
  })
  const address = server.address()

  if (!address || typeof address === "string") throw new Error("Expected staged acknowledgement server address")

  return {
    close: async () => {
      for (const timer of timers) clearTimeout(timer)
      for (const socket of sockets) socket.destroy()
      await new Promise((resolve) => server.close(() => resolve(undefined)))
    },
    enqueueMessages,
    port: address.port
  }
}

/**
 * Builds an isolated generation client configuration.
 * @param {{port: number}} args - Server endpoint.
 * @returns {Configuration} - Client configuration.
 */
function clientConfiguration({port}) {
  return new Configuration({
    backgroundJobs: {host: "127.0.0.1", port},
    directory: process.cwd(),
    environment: "test",
    environmentHandler: new EnvironmentHandlerNode(),
    initializeModels: async () => {},
    locale: "en",
    localeFallbacks: {en: ["en"]}
  })
}

describe("BackgroundJobsClient acknowledgement deadline", {databaseCleaning: {transaction: false, truncate: false}}, () => {
  it("starts the enqueue deadline after the generation handshake sends the request", {timeoutMs: 2000}, async () => {
    const server = await startStagedAcknowledgementServer()

    try {
      const client = new BackgroundJobsClient({
        configuration: clientConfiguration({port: server.port}),
        enqueueTimeoutMs: 500,
        generationHandshakeTimeoutMs: 1000,
        generationId: "acknowledgement-deadline"
      })

      expect(await client.enqueue({args: [], jobName: "StagedAcknowledgementJob"})).toEqual("staged-job")
    } finally {
      await server.close()
    }
  })

  it("raises a safe typed error when a sent enqueue acknowledgement stalls", {timeoutMs: 2000}, async () => {
    const server = await startStagedAcknowledgementServer({acknowledgeEnqueue: false, stageDelayMs: 0})

    try {
      const client = new BackgroundJobsClient({
        configuration: clientConfiguration({port: server.port}),
        enqueueTimeoutMs: 40
      })
      /** @type {unknown} */
      let caughtError

      try {
        await client.enqueue({args: [{secret: "must-not-leak"}], jobName: "TimedOutAfterSendJob"})
      } catch (error) {
        caughtError = error
      }

      if (!(caughtError instanceof BackgroundJobEnqueueAcknowledgementTimeoutError)) {
        throw caughtError || new Error("Expected a post-send acknowledgement timeout")
      }

      expect(caughtError).toBeInstanceOf(TimeoutError)
      expect(caughtError).toMatchObject({
        acknowledgementTimeoutMs: 40,
        attemptHistory: [{
          attemptKind: "initial",
          attemptNumber: 1,
          explicitlyRejected: false,
          generationFenced: false,
          requestSent: true
        }],
        code: "BACKGROUND_JOB_ENQUEUE_ACKNOWLEDGEMENT_TIMEOUT",
        jobName: "TimedOutAfterSendJob",
        name: "BackgroundJobEnqueueAcknowledgementTimeoutError",
        producerProofPresent: false
      })
      const initialAttempt = caughtError.attemptHistory[0]

      if (!initialAttempt) throw new Error("Expected the initial timeout attempt")

      expect(Object.isFrozen(caughtError.attemptHistory)).toEqual(true)
      expect(Object.isFrozen(initialAttempt)).toEqual(true)
      expect(initialAttempt.acknowledgementWaitElapsedMs >= 40).toEqual(true)
      expect(initialAttempt.attemptElapsedMs >= initialAttempt.acknowledgementWaitElapsedMs).toEqual(true)
      expect(JSON.stringify(caughtError)).not.toMatch(/must-not-leak/)
    } finally {
      await server.close()
    }
  })

  it("includes both timed-out attempts after the one eligible owned replay", {timeoutMs: 2000}, async () => {
    const generationId = "acknowledgement-timeout-history"
    const server = await startStagedAcknowledgementServer({acknowledgeEnqueue: false, generationId, stageDelayMs: 0})

    try {
      const client = new BackgroundJobsClient({
        configuration: clientConfiguration({port: server.port}),
        enqueueTimeoutMs: 40,
        generationHandshakeTimeoutMs: 200,
        generationId
      })
      /** @type {unknown} */
      let caughtError

      try {
        await client.enqueue({
          args: [{secret: "owned-must-not-leak"}],
          jobName: "OwnedTimedOutAfterSendJob",
          producerInvocationId: "owned-timeout-invocation",
          producerProof: {
            handedOffAtMs: 123,
            handoffId: "private-handoff-id",
            jobId: "private-producer-job-id",
            workerId: `${generationId}:private-worker-id`
          }
        })
      } catch (error) {
        caughtError = error
      }

      if (!(caughtError instanceof BackgroundJobEnqueueAcknowledgementTimeoutError)) {
        throw caughtError || new Error("Expected an owned replay acknowledgement timeout")
      }

      expect(caughtError).toMatchObject({
        acknowledgementTimeoutMs: 40,
        attemptHistory: [
          {attemptKind: "initial", attemptNumber: 1, explicitlyRejected: false, generationFenced: true, requestSent: true},
          {attemptKind: "owned_replay", attemptNumber: 2, explicitlyRejected: false, generationFenced: true, requestSent: true}
        ],
        code: "BACKGROUND_JOB_ENQUEUE_ACKNOWLEDGEMENT_TIMEOUT",
        generationId,
        jobName: "OwnedTimedOutAfterSendJob",
        producerInvocationId: "owned-timeout-invocation",
        producerProofPresent: true
      })
      expect(server.enqueueMessages).toHaveLength(2)
      expect(server.enqueueMessages[1]).toEqual(server.enqueueMessages[0])
      expect(Object.isFrozen(caughtError.attemptHistory)).toEqual(true)
      for (const attempt of caughtError.attemptHistory) {
        expect(Object.isFrozen(attempt)).toEqual(true)
        expect(attempt.acknowledgementWaitElapsedMs >= 40).toEqual(true)
        expect(attempt.attemptElapsedMs >= attempt.acknowledgementWaitElapsedMs).toEqual(true)
      }
      expect(JSON.stringify(caughtError)).not.toMatch(/owned-must-not-leak|private-handoff-id|private-producer-job-id|private-worker-id/)
    } finally {
      await server.close()
    }
  })
})
