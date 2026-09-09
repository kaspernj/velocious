// @ts-check

import { AsyncLocalStorage } from "node:async_hooks"

/** @type {AsyncLocalStorage<import("./types.js").BackgroundJobProducerProof>} */
const producerProofStorage = new AsyncLocalStorage()

/**
 * Returns the exact producer handoff for the current asynchronous job chain.
 * @returns {import("./types.js").BackgroundJobProducerProof | undefined} - Current producer proof.
 */
export function currentBackgroundJobProducerProof() {
  return producerProofStorage.getStore()
}

/**
 * Runs one job-owned asynchronous chain with an immutable producer proof.
 * @template T
 * @param {import("./types.js").BackgroundJobProducerProof} producerProof - Exact producer handoff.
 * @param {() => T} callback - Job-owned work.
 * @returns {T} - Callback result.
 */
export function runWithBackgroundJobProducerProof(producerProof, callback) {
  return producerProofStorage.run(Object.freeze({...producerProof}), callback)
}

/**
 * Runs under a payload's exact lease when all fencing fields are present.
 * Legacy payloads without a complete lease retain their existing behavior.
 * @template T
 * @param {import("./types.js").BackgroundJobPayload} payload - Persisted runner payload.
 * @param {() => T} callback - Job-owned work.
 * @returns {T} - Callback result.
 */
export function runWithBackgroundJobPayload(payload, callback) {
  const handedOffAtMs = payload.handedOffAtMs
  if (!payload.id || !payload.handoffId || !payload.workerId || handedOffAtMs === undefined || !Number.isSafeInteger(handedOffAtMs)) {
    return callback()
  }

  return runWithBackgroundJobProducerProof({
    handedOffAtMs,
    handoffId: payload.handoffId,
    jobId: payload.id,
    workerId: payload.workerId
  }, callback)
}
