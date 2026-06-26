// @ts-check

/**
 * Replays client sync envelopes through project supplied authentication,
 * authorization, application, and persistence hooks.
 *
 * This is intentionally transport/model agnostic: Velocious owns the generic
 * replay loop, normalization, stale-client comparison, and per-sync result
 * shape while each app owns its token lookup, model handlers, and
 * domain authorization rules.
 */
export default class SyncEnvelopeReplayService {
  /**
   * Creates a sync envelope replay service.
   * @param {object} [args] - Constructor arguments.
   * @param {{debug?: (...args: Array<unknown>) => void, warn?: (...args: Array<unknown>) => void}} [args.logger] - Logger used for normalization warnings.
   */
  constructor(args = {}) {
    this.logger = args.logger || console
  }

  /**
   * Replays a sync batch.
   * @param {Record<string, ?>} params - Request params carrying authentication and syncs.
   * @returns {Promise<{syncs: Array<Record<string, ?>>, status?: string, errorCode?: string, errorMessage?: string}>} Replay response.
   */
  async replay(params) {
    const actorResult = await this.authenticateReplay(params)

    if (!actorResult.authenticated) {
      return {
        syncs: [],
        status: "error",
        errorCode: actorResult.errorCode,
        errorMessage: actorResult.errorMessage
      }
    }

    const syncResponses = []
    const context = await this.buildReplayContext({actor: actorResult.actor, params})

    for (const rawSync of this.replaySyncs(params)) {
      const normalizedResult = this.normalizeReplaySync(rawSync)

      if (!normalizedResult.ok) {
        syncResponses.push(normalizedResult.response)
        continue
      }

      const mutation = normalizedResult.mutation
      const accessResult = await this.authorizeReplayMutation({actor: actorResult.actor, context, mutation})

      if (!accessResult.allowed) {
        syncResponses.push({
          id: mutation.id,
          syncState: "failed",
          reason: accessResult.reason || "access-denied"
        })
        continue
      }

      const existingSync = await this.findExistingReplaySync({actor: actorResult.actor, context, mutation})
      const shouldApply = await this.shouldApplyReplayMutation({actor: actorResult.actor, context, existingSync, mutation})
      const applyResult = shouldApply
        ? await this.applyReplayMutation({actor: actorResult.actor, context, existingSync, mutation})
        : await this.skippedReplayMutation({actor: actorResult.actor, context, existingSync, mutation})

      await this.persistReplayMutation({actor: actorResult.actor, context, existingSync, applyResult, mutation, shouldApply})
      await this.afterReplayMutation({actor: actorResult.actor, context, existingSync, applyResult, mutation, shouldApply})

      syncResponses.push({id: mutation.id, syncState: "successful"})
    }

    return {syncs: syncResponses}
  }

  /**
   * Authenticates the sync batch actor.
   * @param {Record<string, ?>} _params - Request params.
   * @returns {Promise<{authenticated: true, actor: ?} | {authenticated: false, errorCode: string, errorMessage: string}>} Auth result.
   */
  async authenticateReplay(_params) {
    throw new Error("SyncEnvelopeReplayService.authenticateReplay must be implemented")
  }

  /**
   * Builds per-batch mutable context for caches shared across sync items.
   * @param {{actor: ?, params: Record<string, ?>}} _args - Actor and request params.
   * @returns {Promise<Record<string, ?>>} Replay context.
   */
  async buildReplayContext(_args) {
    return {}
  }

  /**
   * Returns raw sync entries from request params.
   * @param {Record<string, ?>} params - Request params.
   * @returns {Array<?>} Raw sync entries.
   */
  replaySyncs(params) {
    return Array.isArray(params.syncs) ? params.syncs : []
  }

  /**
   * Normalizes one sync entry.
   * @param {?} rawSync - Raw sync entry.
   * @returns {{ok: true, mutation: import("./sync-envelope-replay-service.js").SyncReplayMutation} | {ok: false, response: Record<string, ?>}} Normalized mutation or failed response.
   */
  normalizeReplaySync(rawSync) {
    if (!rawSync || typeof rawSync !== "object" || Array.isArray(rawSync)) {
      return {ok: false, response: {id: undefined, syncState: "failed", reason: "invalid-sync"}}
    }

    const sync = /** @type {Record<string, ?>} */ (rawSync)
    const {clientUpdatedAt, data, id, resourceId, resourceType, syncType} = sync

    if (typeof resourceType !== "string" || resourceType.length < 1 || resourceId === undefined || resourceId === null || typeof syncType !== "string" || syncType.length < 1) {
      return {ok: false, response: {id, syncState: "failed", reason: "invalid-resource-id"}}
    }

    const resourceIdString = String(resourceId)
    let clientUpdatedAtDate = typeof clientUpdatedAt === "string" || clientUpdatedAt instanceof Date ? new Date(clientUpdatedAt) : new Date()

    if (Number.isNaN(clientUpdatedAtDate.getTime())) clientUpdatedAtDate = new Date()

    const normalizedDataResult = this.normalizeReplaySyncData({data, id, resourceId: resourceIdString, resourceType})

    if (!normalizedDataResult.ok) return normalizedDataResult

    return {
      ok: true,
      mutation: {
        clientUpdatedAt: clientUpdatedAtDate,
        data: normalizedDataResult.data,
        id,
        resourceId: resourceIdString,
        resourceType,
        serializedData: JSON.stringify(normalizedDataResult.data),
        syncType
      }
    }
  }

  /**
   * Normalizes one sync data payload.
   * @param {{data: ?, id: ?, resourceId: string, resourceType: string}} args - Sync payload normalization arguments.
   * @returns {{ok: true, data: Record<string, ?>} | {ok: false, response: Record<string, ?>}} Normalized payload or failed response.
   */
  normalizeReplaySyncData({data, id, resourceId, resourceType}) {
    if (data === undefined || data === null) return {ok: true, data: {}}

    if (typeof data === "string") {
      try {
        const parsedData = JSON.parse(data)

        if (!parsedData || typeof parsedData !== "object" || Array.isArray(parsedData)) return {ok: true, data: {}}

        return {ok: true, data: /** @type {Record<string, ?>} */ (parsedData)}
      } catch (error) {
        this.logger.warn?.("Invalid sync data JSON", {error, id, resourceId, resourceType})
        return {ok: false, response: {id, syncState: "failed", reason: "invalid-data"}}
      }
    }

    if (typeof data !== "object" || Array.isArray(data)) return {ok: true, data: {}}

    return {ok: true, data: JSON.parse(JSON.stringify(data))}
  }

  /**
   * Authorizes one normalized mutation.
   * @param {{actor: ?, context: Record<string, ?>, mutation: import("./sync-envelope-replay-service.js").SyncReplayMutation}} _args - Actor, batch context, and mutation.
   * @returns {Promise<{allowed: boolean, reason?: string}>} Access result.
   */
  async authorizeReplayMutation(_args) {
    return {allowed: true}
  }

  /**
   * Loads the previously stored sync/change row for stale-client comparison.
   * @param {{actor: ?, context: Record<string, ?>, mutation: import("./sync-envelope-replay-service.js").SyncReplayMutation}} _args - Actor, batch context, and mutation.
   * @returns {Promise<?>} Existing sync row.
   */
  async findExistingReplaySync(_args) {
    return null
  }

  /**
   * Returns whether a normalized mutation should be applied to domain models.
   * @param {{actor: ?, context: Record<string, ?>, existingSync: ?, mutation: import("./sync-envelope-replay-service.js").SyncReplayMutation}} args - Actor, batch context, existing sync row, and mutation.
   * @returns {Promise<boolean>} Whether to apply the mutation.
   */
  async shouldApplyReplayMutation({existingSync, mutation}) {
    const existingClientUpdatedAt = this.existingReplaySyncClientUpdatedAt(existingSync)

    return !existingClientUpdatedAt || mutation.clientUpdatedAt > existingClientUpdatedAt
  }

  /**
   * Resolves the client timestamp from an existing sync row.
   * @param {?} existingSync - Existing sync row.
   * @returns {Date | null} Existing client timestamp.
   */
  existingReplaySyncClientUpdatedAt(existingSync) {
    if (!existingSync || typeof existingSync !== "object") return null

    const syncRecord = /** @type {Record<string, ?>} */ (existingSync)
    const value = typeof syncRecord.clientUpdatedAt === "function"
      ? syncRecord.clientUpdatedAt()
      : syncRecord.clientUpdatedAt

    return value instanceof Date ? value : null
  }

  /**
   * Applies one normalized mutation to domain models.
   * @param {{actor: ?, context: Record<string, ?>, existingSync: ?, mutation: import("./sync-envelope-replay-service.js").SyncReplayMutation}} _args - Actor, batch context, existing sync row, and mutation.
   * @returns {Promise<?>} Project-specific apply result.
   */
  async applyReplayMutation(_args) {
    return null
  }

  /**
   * Resolves an apply result for stale mutations that should not touch domain models.
   * @param {{actor: ?, context: Record<string, ?>, existingSync: ?, mutation: import("./sync-envelope-replay-service.js").SyncReplayMutation}} _args - Actor, batch context, existing sync row, and mutation.
   * @returns {Promise<?>} Project-specific apply result.
   */
  async skippedReplayMutation(_args) {
    return null
  }

  /**
   * Persists one normalized mutation into the app sync/change store.
   * @param {{actor: ?, context: Record<string, ?>, existingSync: ?, applyResult: ?, mutation: import("./sync-envelope-replay-service.js").SyncReplayMutation, shouldApply: boolean}} _args - Replay persistence arguments.
   * @returns {Promise<void>}
   */
  async persistReplayMutation(_args) {}

  /**
   * Runs side effects after a successful mutation replay and persistence.
   * @param {{actor: ?, context: Record<string, ?>, existingSync: ?, applyResult: ?, mutation: import("./sync-envelope-replay-service.js").SyncReplayMutation, shouldApply: boolean}} _args - Replay side-effect arguments.
   * @returns {Promise<void>}
   */
  async afterReplayMutation(_args) {}
}

/**
 * @typedef {object} SyncReplayMutation
 * @property {Date} clientUpdatedAt - Client-side mutation timestamp.
 * @property {Record<string, ?>} data - Parsed mutation payload.
 * @property {?} id - Client sync row id for per-sync responses.
 * @property {string} resourceId - Resource id as a string.
 * @property {string} resourceType - Resource/model name.
 * @property {string} serializedData - JSON serialized mutation payload.
 * @property {string} syncType - Sync operation type.
 */
