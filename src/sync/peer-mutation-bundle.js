// @ts-check

import {createSignedMutation, mutationIdempotencyKey, verifySignedMutation} from "./device-identity.js"

const PEER_MUTATION_BUNDLE_FORMAT = "velocious.sync.peer-mutation-bundle.v1"
const EXPORTABLE_STATUSES = new Set(["pending", "applied-locally", "peer-applied", "conflict"])

/**
 * Peer mutation bundle exported by a device for offline/P2P transfer.
 * @typedef {object} PeerMutationBundle
 * @property {string} exportedAt - ISO timestamp when the bundle was exported.
 * @property {"velocious.sync.peer-mutation-bundle.v1"} format - Bundle format identifier.
 * @property {PeerMutationBundleEntry[]} mutations - Signed mutations in local sequence order.
 */

/**
 * One peer mutation bundle entry.
 * @typedef {object} PeerMutationBundleEntry
 * @property {string} [localRecordId] - Exporting device's local mutation record id.
 * @property {number} [localSequence] - Exporting device's local mutation sequence.
 * @property {import("./device-identity.js").SignedSyncMutation} signedMutation - Device-signed mutation envelope.
 */

/**
 * Exports local non-terminal mutations as a signed peer-transfer bundle.
 * @param {object} args - Arguments.
 * @param {import("./device-identity.js").DeviceCertificate} args.deviceCertificate - Device certificate for signing records.
 * @param {import("./device-identity.js").SyncJsonWebKey} args.devicePrivateKey - Device private key for signing records.
 * @param {import("./local-mutation-log.js").default} args.mutationLog - Local mutation log.
 * @param {() => Date} [args.now] - Export clock.
 * @param {import("./local-mutation-log.js").LocalMutationStatus[]} [args.statuses] - Statuses to export.
 * @returns {Promise<PeerMutationBundle>} - Signed peer mutation bundle.
 */
export async function exportPeerMutationBundle({deviceCertificate, devicePrivateKey, mutationLog, now = () => new Date(), statuses}) {
  const selectedStatuses = normalizeExportStatuses(statuses)
  const timestamp = isoTimestamp(now(), "exportedAt")
  const records = (await mutationLog.records())
    .filter((record) => selectedStatuses.has(record.status))
    .sort((left, right) => left.sequence - right.sequence)
  const mutations = []

  for (const record of records) {
    mutations.push({
      localRecordId: record.id,
      localSequence: record.sequence,
      signedMutation: await createSignedMutation({
        deviceCertificate,
        devicePrivateKey,
        mutation: record.mutation
      })
    })
  }

  return {
    exportedAt: timestamp,
    format: PEER_MUTATION_BUNDLE_FORMAT,
    mutations
  }
}

/**
 * Imports verified peer mutations into the local mutation log.
 * @param {object} args - Arguments.
 * @param {import("./device-identity.js").SyncJsonWebKey} args.backendPublicKey - Backend public key for verifying peer certificates.
 * @param {PeerMutationBundle} args.bundle - Peer bundle to import.
 * @param {import("./local-mutation-log.js").default} args.mutationLog - Local mutation log.
 * @param {Date} [args.now] - Verification time.
 * @returns {Promise<{imported: {clientMutationId: string, idempotencyKey: string, localRecordId: string}[], rejected: {errorMessage: string, index: number}[], skipped: {clientMutationId: string, idempotencyKey: string, localRecordId: string, reason: "duplicate"}[]}>} - Import result.
 */
export async function importPeerMutationBundle({backendPublicKey, bundle, mutationLog, now = new Date()}) {
  const normalizedBundle = normalizePeerMutationBundle(bundle)
  const existingRecords = await mutationLog.records()
  const existingByIdempotencyKey = new Map(existingRecords.map((record) => [mutationIdempotencyKey({mutation: record.mutation}), record]))
  /** @type {{clientMutationId: string, idempotencyKey: string, localRecordId: string}[]} */
  const imported = []
  /** @type {{errorMessage: string, index: number}[]} */
  const rejected = []
  /** @type {{clientMutationId: string, idempotencyKey: string, localRecordId: string, reason: "duplicate"}[]} */
  const skipped = []

  for (const [index, entry] of normalizedBundle.mutations.entries()) {
    try {
      const mutation = await verifySignedMutation({backendPublicKey, now, signedMutation: entry.signedMutation})
      const idempotencyKey = mutationIdempotencyKey(entry.signedMutation)
      const duplicateRecord = existingByIdempotencyKey.get(idempotencyKey)

      if (duplicateRecord) {
        skipped.push({
          clientMutationId: mutation.clientMutationId,
          idempotencyKey,
          localRecordId: duplicateRecord.id,
          reason: /** @type {"duplicate"} */ ("duplicate")
        })
        continue
      }

      const record = await mutationLog.append({mutation})
      const updated = await mutationLog.updateStatus({id: record.id, status: "peer-applied"})
      existingByIdempotencyKey.set(idempotencyKey, updated)
      imported.push({clientMutationId: mutation.clientMutationId, idempotencyKey, localRecordId: updated.id})
    } catch (error) {
      rejected.push({errorMessage: errorMessage(error), index})
    }
  }

  return {imported, rejected, skipped}
}

/**
 * Normalizes export status filters.
 * @param {import("./local-mutation-log.js").LocalMutationStatus[] | undefined} statuses - Optional statuses.
 * @returns {Set<import("./local-mutation-log.js").LocalMutationStatus>} - Status set.
 */
function normalizeExportStatuses(statuses) {
  if (statuses === undefined) return /** @type {Set<import("./local-mutation-log.js").LocalMutationStatus>} */ (new Set(EXPORTABLE_STATUSES))
  if (!Array.isArray(statuses)) throw new Error("Expected peer mutation export statuses array")

  const normalized = new Set()

  for (const status of statuses) {
    if (!EXPORTABLE_STATUSES.has(status)) throw new Error(`Unsupported peer mutation export status '${String(status)}'`)
    normalized.add(status)
  }

  return /** @type {Set<import("./local-mutation-log.js").LocalMutationStatus>} */ (normalized)
}

/**
 * Normalizes a peer mutation bundle.
 * @param {PeerMutationBundle} bundle - Bundle value.
 * @returns {PeerMutationBundle} - Normalized bundle.
 */
function normalizePeerMutationBundle(bundle) {
  if (!bundle || typeof bundle !== "object" || Array.isArray(bundle)) throw new Error("Expected peer mutation bundle object")
  if (bundle.format !== PEER_MUTATION_BUNDLE_FORMAT) throw new Error(`Unsupported peer mutation bundle format '${String(bundle.format)}'`)
  isoTimestamp(new Date(requiredString(bundle.exportedAt, "exportedAt")), "exportedAt")
  if (!Array.isArray(bundle.mutations)) throw new Error("Expected peer mutation bundle mutations array")

  return {
    exportedAt: bundle.exportedAt,
    format: bundle.format,
    mutations: bundle.mutations.map((entry, index) => normalizePeerMutationBundleEntry(entry, index))
  }
}

/**
 * Normalizes one peer mutation bundle entry.
 * @param {PeerMutationBundleEntry} entry - Bundle entry.
 * @param {number} index - Entry index.
 * @returns {PeerMutationBundleEntry} - Normalized entry.
 */
function normalizePeerMutationBundleEntry(entry, index) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error(`Expected peer mutation bundle entry ${index} object`)
  if (!entry.signedMutation || typeof entry.signedMutation !== "object" || Array.isArray(entry.signedMutation)) throw new Error(`Expected peer mutation bundle entry ${index} signedMutation object`)

  /** @type {PeerMutationBundleEntry} */
  const normalized = {
    signedMutation: entry.signedMutation
  }

  if (entry.localRecordId !== undefined) normalized.localRecordId = requiredString(entry.localRecordId, `entry ${index} localRecordId`)
  if (entry.localSequence !== undefined) normalized.localSequence = positiveInteger(entry.localSequence, `entry ${index} localSequence`)

  return normalized
}

/**
 * Requires a non-empty string.
 * @param {unknown} value - Value.
 * @param {string} label - Label.
 * @returns {string} - String.
 */
function requiredString(value, label) {
  if (typeof value !== "string" || value.length < 1) throw new Error(`Expected peer mutation bundle ${label}`)

  return value
}

/**
 * Requires a positive integer.
 * @param {unknown} value - Value.
 * @param {string} label - Label.
 * @returns {number} - Integer.
 */
function positiveInteger(value, label) {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) throw new Error(`Expected peer mutation bundle ${label} positive integer`)

  return value
}

/**
 * Returns an ISO timestamp from a valid Date.
 * @param {Date} date - Date.
 * @param {string} label - Label.
 * @returns {string} - ISO timestamp.
 */
function isoTimestamp(date, label) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) throw new Error(`Invalid peer mutation bundle ${label}`)

  return date.toISOString()
}

/**
 * Returns a safe error message.
 * @param {unknown} error - Error.
 * @returns {string} - Message.
 */
function errorMessage(error) {
  if (error instanceof Error) return error.message

  return String(error)
}
