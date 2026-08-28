// @ts-check

import net from "node:net"
import { EventEmitter } from "node:events"
import JsonSocket from "../../src/background-jobs/json-socket.js"
import BackgroundJobsMain from "../../src/background-jobs/main.js"
import SqlBackgroundJobsAdapter from "../../src/background-jobs/sql-adapter.js"
import dummyConfiguration from "../dummy/src/config/configuration.js"
import { waitForEvent } from "../../src/testing/test.js"

/**
 * @typedef {object} GenerationPeer
 * @property {() => Promise<void>} close - Closes the peer.
 * @property {JsonSocket} jsonSocket - JSON socket.
 * @property {() => Promise<import("../../src/background-jobs/types.js").BackgroundJobSocketMessage>} nextMessage - Waits for one message.
 */

/**
 * Starts a real SQL-backed generation main without mutating endpoint identity in
 * the shared dummy configuration, allowing multiple mains in one process.
 * @param {object} args - Main options.
 * @param {string} args.generationId - Generation identity.
 * @param {import("../../src/background-jobs/types.js").BackgroundJobsGenerationInitialState} args.initialGenerationState - Boot state.
 * @param {import("../../src/background-jobs/store.js").default} [args.store] - Shared real SQL store.
 * @param {number} [args.workerReconnectGraceMs] - Reconnect grace.
 * @param {string} [args.lifecycleSocketPath] - Release-local lifecycle socket.
 * @param {ConstructorParameters<typeof BackgroundJobsMain>[0]["afterHandoffClaim"]} [args.afterHandoffClaim] - Handoff hook.
 * @param {ConstructorParameters<typeof BackgroundJobsMain>[0]["onWorkerReady"]} [args.onWorkerReady] - Readiness hook.
 * @param {ConstructorParameters<typeof BackgroundJobsMain>[0]["onWorkerDisconnected"]} [args.onWorkerDisconnected] - Disconnect hook.
 * @param {ConstructorParameters<typeof BackgroundJobsMain>[0]["onWorkerHandoffsReleased"]} [args.onWorkerHandoffsReleased] - Grace-expiry hook.
 * @param {ConstructorParameters<typeof BackgroundJobsMain>[0]["onStartupHandoffsReclaimed"]} [args.onStartupHandoffsReclaimed] - Startup reclaim hook.
 * @param {ConstructorParameters<typeof BackgroundJobsMain>[0]["onJobUpdated"]} [args.onJobUpdated] - Durable report hook.
 * @param {ConstructorParameters<typeof BackgroundJobsMain>[0]["clock"]} [args.clock] - Main clock.
 * @returns {Promise<{main: BackgroundJobsMain, store: import("../../src/background-jobs/store.js").default}>} - Started main and store.
 */
export async function startGenerationMain({generationId, initialGenerationState, store, workerReconnectGraceMs, lifecycleSocketPath, afterHandoffClaim, onWorkerReady, onWorkerDisconnected, onWorkerHandoffsReleased, onStartupHandoffsReclaimed, onJobUpdated, clock}) {
  dummyConfiguration.setBackgroundJobsConfig({
    generationId: undefined,
    initialGenerationState: undefined,
    lifecycleSocketPath: undefined
  })
  const resolvedStore = store || new SqlBackgroundJobsAdapter({configuration: dummyConfiguration})
  if (!store) await resolvedStore.clearAll()
  const main = new BackgroundJobsMain({
    afterHandoffClaim,
    closeDatabaseConnectionsOnStop: false,
    clock,
    configuration: dummyConfiguration,
    generationId,
    host: "127.0.0.1",
    initialGenerationState,
    lifecycleSocketPath,
    onWorkerReady,
    onWorkerDisconnected,
    onWorkerHandoffsReleased,
    onStartupHandoffsReclaimed,
    onJobUpdated,
    port: 0,
    workerReconnectGraceMs
  })
  main.store = resolvedStore
  await main.start()

  return {main, store: resolvedStore}
}

/** @returns {Promise<SqlBackgroundJobsAdapter>} - Empty real SQL adapter. */
export async function emptyGenerationStore() {
  dummyConfiguration.setBackgroundJobsConfig({generationId: undefined, initialGenerationState: undefined, lifecycleSocketPath: undefined})
  const store = new SqlBackgroundJobsAdapter({configuration: dummyConfiguration})
  await store.clearAll()

  return store
}

/**
 * Connects an owned raw generation protocol peer.
 * @param {number} port - Main TCP port.
 * @returns {Promise<GenerationPeer>} - Connected peer.
 */
export async function connectGenerationPeer(port) {
  const socket = net.createConnection({host: "127.0.0.1", port})
  await waitForEvent(socket, "connect", {timeoutMs: 1000})
  const jsonSocket = new JsonSocket(socket)
  /** @type {import("../../src/background-jobs/types.js").BackgroundJobSocketMessage[]} */
  const messages = []
  const messageEvents = new EventEmitter()
  jsonSocket.on("message", (message) => {
    messages.push(message)
    messageEvents.emit("available")
  })

  return {
    close: async () => {
      if (socket.destroyed) return
      const closed = waitForEvent(socket, "close", {timeoutMs: 1000})
      jsonSocket.close()
      await closed
    },
    jsonSocket,
    nextMessage: async () => {
      if (messages.length === 0) await waitForEvent(messageEvents, "available", {timeoutMs: 1000})
      const message = messages.shift()
      if (!message) throw new Error("Generation peer message queue was empty")

      return message
    }
  }
}

/**
 * Registers a raw generation worker.
 * @param {GenerationPeer} peer - Worker peer.
 * @param {string} generationId - Generation id.
 * @param {string} workerId - Qualified worker id.
 * @param {boolean} [ready] - Whether to advertise inline capacity.
 * @returns {Promise<import("../../src/background-jobs/types.js").BackgroundJobSocketMessage>} - Hello acknowledgement.
 */
export async function registerGenerationWorker(peer, generationId, workerId, ready = false) {
  peer.jsonSocket.send({
    type: "hello",
    role: "worker",
    generationId,
    workerId,
    supportsHandoffIdReporting: true,
    supportsHeartbeat: true
  })
  const acknowledgement = await peer.nextMessage()
  if (ready) peer.jsonSocket.send({type: "ready", acceptsInline: true, acceptsForked: false, acceptsPooled: false, acceptsSpawned: false})

  return acknowledgement
}
