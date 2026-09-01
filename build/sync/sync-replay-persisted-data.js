// @ts-check

const METADATA_KEY = "$velociousReplay"
const PAYLOAD_KEY = "payload"

/**
 * Wraps change-feed data with replay acknowledgement metadata in the existing
 * durable sync-row data column.
 * @param {{acknowledgementVersion: string | number | null, clientMutationId: string, payload: ReturnType<typeof JSON.parse>, payloadFingerprint: string}} args - Durable replay metadata and public payload.
 * @returns {string} Serialized durable value.
 */
export function serializeReplayPersistedData({acknowledgementVersion, clientMutationId, payload, payloadFingerprint}) {
  return JSON.stringify({
    [METADATA_KEY]: {acknowledgementVersion, clientMutationId, payloadFingerprint},
    [PAYLOAD_KEY]: payload
  })
}

/**
 * Decodes framework-owned replay metadata while leaving ordinary sync data unchanged.
 * @param {ReturnType<typeof JSON.parse>} value - Parsed or serialized sync-row data.
 * @returns {{metadata: {acknowledgementVersion: string | number | null, clientMutationId: string, payloadFingerprint: string} | null, payload: ReturnType<typeof JSON.parse>}} Decoded metadata and public payload.
 */
export function decodeReplayPersistedData(value) {
  const parsed = typeof value === "string" ? JSON.parse(value) : value

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {metadata: null, payload: parsed}

  const record = /** @type {Record<string, ReturnType<typeof JSON.parse>>} */ (parsed)
  const metadata = record[METADATA_KEY]

  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata) || !Object.hasOwn(record, PAYLOAD_KEY)) {
    return {metadata: null, payload: parsed}
  }

  const metadataRecord = /** @type {Record<string, ReturnType<typeof JSON.parse>>} */ (metadata)

  if (typeof metadataRecord.clientMutationId !== "string" || typeof metadataRecord.payloadFingerprint !== "string") {
    return {metadata: null, payload: parsed}
  }

  return {
    metadata: {
      acknowledgementVersion: metadataRecord.acknowledgementVersion,
      clientMutationId: metadataRecord.clientMutationId,
      payloadFingerprint: metadataRecord.payloadFingerprint
    },
    payload: record[PAYLOAD_KEY]
  }
}
