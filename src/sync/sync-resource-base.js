// @ts-check

import {forcedNonBlankString} from "typanic"

import FrontendModelBaseResource from "../frontend-model-resource/base-resource.js"
import SyncEnvelopeReplayService from "./sync-envelope-replay-service.js"
import SyncModelChangeFeedService from "./sync-model-change-feed-service.js"
import VelociousError from "../velocious-error.js"

const QUICK_SEARCH_COLUMN = "quickSearch"

/**
 * Optional client-declared sync scope carried on a changes request.
 * @typedef {object} SerializedChangesScope
 * @property {Record<string, ?>} conditions - Plain attribute conditions from the client query.
 * @property {string | null} resourceType - Client resource/model name the scope was declared for, or null for the all-types (user) scope: one scope covering every resource type this resource authorizes for the caller, so a sync authorizes once however many types it serves.
 */

/**
 * Base resource for Velocious sync endpoints.
 *
 * Velocious owns the changes/replay orchestration (scope parsing, feed paging,
 * replay delegation, response shape) while apps subclass and only declare
 * authorization, feed scoping, and their replay service.
 * @template {typeof import("../database/record/index.js").default} [TModelClass=typeof import("../database/record/index.js").default]
 * @augments {FrontendModelBaseResource<TModelClass>}
 */
export default class SyncResourceBase extends FrontendModelBaseResource {
  /**
   * Replay service class handling replay mutations for this resource,
   * declared instead of overriding {@link SyncResourceBase#replayServiceClass}.
   * @type {typeof import("./sync-envelope-replay-service.js").default | undefined}
   */
  static ReplayServiceClass = undefined

  /**
   * Declarative quick-search text columns. When declared, an index search on
   * the pseudo-column `quickSearch` expands to an OR of LIKE conditions over
   * these root-table columns instead of hitting the controller default.
   * @type {string[] | null} */
  static quickSearchColumns = null

  /**
   * Applies frontend-model index searches, expanding declared quick searches.
   * @param {object} args - Search args.
   * @param {import("../frontend-model-resource/base-resource.js").FrontendModelResourceController} args.controller - Controller handling the query.
   * @param {import("../frontend-model-resource/base-resource.js").FrontendModelResourceAnyQuery} args.query - Query instance.
   * @param {import("../frontend-model-resource/base-resource.js").FrontendModelResourceSearch} args.search - Search params.
   * @returns {void}
   */
  applyFrontendModelIndexSearch({controller, query, search}) {
    if (this.applyQuickSearch({query, search})) return

    super.applyFrontendModelIndexSearch({controller, query, search})
  }

  /**
   * Expands a `quickSearch` pseudo-column search into an OR of LIKE conditions
   * over the declared {@link SyncResourceBase.quickSearchColumns}.
   * @param {object} args - Search args.
   * @param {import("../frontend-model-resource/base-resource.js").FrontendModelResourceAnyQuery} args.query - Query to filter.
   * @param {import("../frontend-model-resource/base-resource.js").FrontendModelResourceSearch} args.search - Search payload.
   * @returns {boolean} Whether the search was handled as a quick search.
   */
  applyQuickSearch({query, search}) {
    const quickSearchColumns = /** @type {typeof SyncResourceBase} */ (this.constructor).quickSearchColumns

    if (!quickSearchColumns || quickSearchColumns.length === 0) return false
    if (search.path.length > 0 || search.column !== QUICK_SEARCH_COLUMN) return false

    if (search.operator !== "like") {
      throw VelociousError.safe("Sync quick search must use the like operator.", {code: "sync-invalid-quick-search"})
    }

    if (typeof search.value !== "string") {
      throw VelociousError.safe("Sync quick search must be a string.", {code: "sync-invalid-quick-search"})
    }

    const trimmedValue = search.value.trim()

    if (!trimmedValue) return true

    const tableSql = query.driver.quoteTable(query.getTableReferenceForJoin())
    const likeValue = `%${trimmedValue}%`
    const conditions = quickSearchColumns.map((columnName) => (
      `${tableSql}.${query.driver.quoteColumn(columnName)} LIKE ${query.driver.quote(likeValue)}`
    ))

    query.where(`(${conditions.join(" OR ")})`)

    return true
  }

  // The declarative `static writableAttributes` permit list lives on
  // FrontendModelBaseResource so every frontend-model resource can declare
  // one; sync resources inherit it unchanged.

  /**
   * Returns a stable change-feed page after app authorization.
   * @returns {Promise<Record<string, ?>>} Change-feed page result.
   */
  async changes() {
    const params = this.params()
    const scope = this.changesScope(params)

    await this.authorizeChanges({params, scope})

    return await this.changeFeedService({params, scope}).changes()
  }

  /**
   * Replays client sync envelopes through the app replay service.
   * @returns {Promise<Record<string, ?>>} Replay result with per-sync states.
   */
  async replay() {
    const result = await this.buildReplayService().replay(this.params())

    if (result.status === "error") return result

    return {status: "success", syncs: result.syncs}
  }

  /**
   * Parses the optional client-declared scope from request params.
   * @param {Record<string, ?>} params - Request params.
   * @returns {SerializedChangesScope | null} Parsed scope, or null when the client sent none.
   */
  changesScope(params) {
    const scope = params.scope

    if (scope === undefined || scope === null) return null

    if (typeof scope !== "object" || Array.isArray(scope)) {
      throw new Error(`Sync changes scope must be an object, got: ${String(scope)}`)
    }

    const scopeParams = /** @type {Record<string, ?>} */ (scope)
    const resourceType = scopeParams.resourceType === null || scopeParams.resourceType === undefined
      ? null
      : forcedNonBlankString(scopeParams.resourceType, "resourceType")
    const conditions = scopeParams.conditions

    if (!conditions || typeof conditions !== "object" || Array.isArray(conditions)) {
      throw new Error(`Sync changes scope.conditions must be an object, got: ${String(conditions)}`)
    }

    return {conditions: /** @type {Record<string, ?>} */ (conditions), resourceType}
  }

  /**
   * Builds the change-feed service serving this changes request.
   * @param {{params: Record<string, ?>, scope: SerializedChangesScope | null}} args - Request params and parsed scope.
   * @returns {{changes: () => Promise<Record<string, ?>>}} Change-feed service.
   */
  changeFeedService({params, scope}) {
    return new SyncModelChangeFeedService({
      modelClass: this.syncModelClass(),
      params,
      scopeQuery: ({query}) => this.scopeChangesQuery({params, query, scope})
    })
  }

  /**
   * Builds the app replay service handling this replay request. The resource
   * ability, context, configuration, and locals are plumbed in under the
   * app-declared {@link SyncResourceBase#replayServiceArgs} (app args win) so
   * the default resource-routed replay works without wiring.
   * @returns {import("./sync-envelope-replay-service.js").default} Replay service instance.
   */
  buildReplayService() {
    const ReplayServiceClass = this.replayServiceClass()

    return new ReplayServiceClass({
      ability: this.ability,
      abilityContext: this.getContext(),
      configuration: this.controller ? this.controllerInstance().getConfiguration() : undefined,
      locals: this.getLocals(),
      ...this.replayServiceArgs()
    })
  }

  /**
   * Returns constructor args for the app replay service.
   * @returns {Record<string, ?>} Replay service constructor args.
   */
  replayServiceArgs() {
    return {}
  }

  /**
   * Returns the sync model class backing the change feed.
   * @returns {typeof import("../database/record/index.js").default} Sync model class.
   */
  syncModelClass() {
    const modelClass = /** @type {typeof SyncResourceBase} */ (this.constructor).ModelClass

    if (!modelClass) throw new Error(`${this.constructor.name} must define static ModelClass`)

    return modelClass
  }

  /**
   * Authorizes the current context for reading the requested changes.
   * @param {{params: Record<string, ?>, scope: SerializedChangesScope | null}} _args - Request params and parsed scope.
   * @returns {Promise<void>} Resolves when access is allowed; throws otherwise.
   */
  async authorizeChanges(_args) {
    throw new Error("SyncResourceBase#authorizeChanges must be implemented")
  }

  /**
   * Applies app visibility scoping onto the change-feed query.
   * @param {{params: Record<string, ?>, query: import("../database/query/model-class-query.js").default, scope: SerializedChangesScope | null}} _args - Request params, feed query, and parsed scope.
   * @returns {void}
   */
  scopeChangesQuery(_args) {
    throw new Error("SyncResourceBase#scopeChangesQuery must be implemented")
  }

  /**
   * Decides whether one published change is deliverable to a user-scope
   * subscription (the framework sync channel's per-delivery access re-check).
   * The default reuses the app's ability scoping: it applies
   * {@link SyncResourceBase#scopeChangesQuery} to the change-feed model — which
   * for an empty-conditions user scope falls back to ability scoping — and
   * checks whether the published change's feed row is visible within that
   * scope. Apps get this for free from the scoping they already declared;
   * override only for custom per-delivery rules.
   * @param {{params: Record<string, ?>, scope: SerializedChangesScope | null, sync: {resourceId: string, resourceType: string}}} args - Request params, subscription scope, and the published change's identity.
   * @returns {Promise<boolean>} Whether the change may be delivered to this subscription.
   */
  async changeDeliverable({params, scope, sync}) {
    const query = this.syncModelClass().where({})

    this.scopeChangesQuery({params, query, scope})
    query.where({resource_id: String(sync.resourceId), resource_type: String(sync.resourceType)})

    return Boolean(await query.first())
  }

  /**
   * Resolves the replay service class handling replay mutations: the
   * declarative {@link SyncResourceBase.ReplayServiceClass} static (shared
   * resources included) when declared, otherwise
   * {@link SyncEnvelopeReplayService}, which resource-routes mutations through
   * the plumbed configuration registry. Apps declare the static instead of
   * overriding this method.
   * @returns {typeof import("./sync-envelope-replay-service.js").default} Replay service class.
   */
  replayServiceClass() {
    const ResourceClass = /** @type {typeof SyncResourceBase} */ (this.constructor)
    const SharedResource = /** @type {typeof SyncResourceBase | null} */ (ResourceClass.sharedResourceClass() ?? null)

    return ResourceClass.ReplayServiceClass ?? SharedResource?.ReplayServiceClass ?? SyncEnvelopeReplayService
  }
}
