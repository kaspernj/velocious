// @ts-check

/**
 * Generic client-side helper for replaying pending sync envelopes through the
 * framework-owned `/velocious/sync/replay` endpoint. Apps provide only local
 * persistence/auth hooks.
 */
export default class SyncApiClient {
  /**
   * Drains pending sync records in stable order and marks acknowledged rows.
   * @param {object} args - Replay args.
   * @param {string} args.authenticationToken - Auth token to send with replay requests.
   * @param {number} [args.batchSize] - Max syncs per request. Defaults to 100.
   * @param {() => Promise<Array<unknown>>} args.pendingSyncs - Loads pending local sync rows in replay order.
   * @param {(sync: unknown) => string | number | null | undefined} args.syncId - Returns the local sync id.
   * @param {(sync: unknown) => Record<string, ?>} args.syncPayload - Builds the API sync envelope.
   * @param {(payload: {authenticationToken: string, syncs: Array<Record<string, ?>>}) => Promise<SyncReplayResponse>} args.postReplay - Posts one replay request.
   * @param {(sync: unknown, response: SyncReplayItem) => Promise<void>} args.markSuccessful - Marks one sync as successful locally.
   * @returns {Promise<void>} Resolves after all batches are replayed.
   */
  static async replayPending(args) {
    const pendingSyncs = await args.pendingSyncs()
    const batchSize = this.normalizedBatchSize(args.batchSize)

    for (let offset = 0; offset < pendingSyncs.length; offset += batchSize) {
      await this.replayBatch({...args, pendingSyncs: pendingSyncs.slice(offset, offset + batchSize)})
    }
  }

  /**
   * Replays one batch of syncs.
   * @param {object} args - Replay args.
   * @param {string} args.authenticationToken - Auth token.
   * @param {Array<unknown>} args.pendingSyncs - Batch syncs.
   * @param {(sync: unknown) => string | number | null | undefined} args.syncId - Sync id getter.
   * @param {(sync: unknown) => Record<string, ?>} args.syncPayload - Payload builder.
   * @param {(payload: {authenticationToken: string, syncs: Array<Record<string, ?>>}) => Promise<SyncReplayResponse>} args.postReplay - Replay poster.
   * @param {(sync: unknown, response: SyncReplayItem) => Promise<void>} args.markSuccessful - Success hook.
   * @returns {Promise<void>} Resolves after the batch is acknowledged.
   */
  static async replayBatch(args) {
    const {authenticationToken, markSuccessful, pendingSyncs, postReplay, syncId, syncPayload} = args

    if (pendingSyncs.length === 0) return

    const syncsById = new Map()

    for (const sync of pendingSyncs) {
      const id = syncId(sync)

      if (id !== undefined && id !== null) syncsById.set(String(id), sync)
    }

    const response = await postReplay({
      authenticationToken,
      syncs: pendingSyncs.map((sync) => syncPayload(sync))
    })

    this.ensureSuccessfulResponse(response)

    for (const syncResponse of response.syncs || []) {
      const sync = syncsById.get(String(syncResponse.id))

      if (!sync) continue
      if (syncResponse.syncState !== "successful") {
        throw new Error(`Invalid sync state returned for sync ${String(syncResponse.id)}: ${String(syncResponse.syncState)}`)
      }

      await markSuccessful(sync, syncResponse)
    }
  }

  /**
   * Checks API response status and shape.
   * @param {SyncReplayResponse} response - Replay response.
   * @returns {void}
   */
  static ensureSuccessfulResponse(response) {
    if (response.status === "error") throw new Error(response.errorMessage || "Sync failed")
    if (!Array.isArray(response.syncs)) throw new Error("Sync response missing syncs")
  }

  /**
   * Normalizes a positive batch size.
   * @param {number | undefined} batchSize - Batch size.
   * @returns {number} Positive batch size.
   */
  static normalizedBatchSize(batchSize) {
    if (typeof batchSize !== "number" || !Number.isFinite(batchSize) || batchSize < 1) return 100

    return Math.floor(batchSize)
  }
}

/**
 * @typedef {object} SyncReplayItem
 * @property {string | number} id - Sync id.
 * @property {string} syncState - Replay state.
 */

/**
 * @typedef {object} SyncReplayResponse
 * @property {string} [errorMessage] - Error message.
 * @property {string} [status] - Response status.
 * @property {Array<SyncReplayItem>} [syncs] - Replay results.
 */
