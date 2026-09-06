// @ts-check

import Configuration from "../../src/configuration.js"
import DatabaseDriverBase from "../../src/database/drivers/base.js"
import FrontendModelBaseResource from "../../src/frontend-model-resource/base-resource.js"
import Record from "../../src/database/record/index.js"
import {ensureFrontendModelWebsocketPublishersRegistered} from "../../src/frontend-models/websocket-publishers.js"
import {EventEmitter} from "events"

class CounterCacheParentTransactionDriver extends DatabaseDriverBase {
  /** @returns {string} - Driver type used by retry diagnostics. */
  getType() { return "counter-cache-parent-test" }

  /** @returns {string} - Deterministic savepoint name. */
  generateSavePointName() { return "counter_cache_parent_savepoint" }

  /** @returns {Promise<void>} */
  async _startTransactionAction() {}

  /** @returns {Promise<void>} */
  async _commitTransactionAction() {}

  /** @returns {Promise<void>} */
  async _rollbackTransactionAction() {}

  /** @returns {Promise<void>} */
  async _startSavePointAction() {}

  /** @returns {Promise<void>} */
  async _releaseSavePointAction() {}

  /** @returns {Promise<void>} */
  async _rollbackSavePointAction() {}

  /** @returns {Promise<void>} */
  async _waitMs() {}

  /**
   * Classifies the focused retry marker as an outer-transaction retry.
   * @param {Error} error - Candidate transaction error.
   * @returns {import("../../src/database/drivers/base.js").RetryableDatabaseErrorResult} - Retry classification.
   */
  retryableDatabaseError(error) {
    if (error.message == "COUNTER_CACHE_PARENT_RETRY") {
      return {contentionKind: "deadlock", deadlock: true, reconnect: false, retry: false, waitMs: 1}
    }

    return super.retryableDatabaseError(error)
  }
}

/**
 * Creates an ordinary counter-cache callback harness with optional frontend-model delivery.
 * @param {object} [options] - Harness options.
 * @param {Error} [options.broadcastError] - Error raised by the publisher boundary.
 * @param {Error} [options.findError] - Error raised while reloading the parent.
 * @param {boolean} [options.missingParent] - Whether the parent reload returns no record.
 * @param {Record<string, ReturnType<typeof JSON.parse>>} [options.parentAttributes] - Reloaded parent attributes.
 * @param {string | string[]} [options.primaryKey] - Frontend resource identity.
 * @param {boolean} [options.registerPublisher] - Whether to register a parent delivery listener.
 * @returns {Promise<{
 *   broadcasts: Array<{body: Record<string, ReturnType<typeof JSON.parse>>, broadcastParams: Record<string, ReturnType<typeof JSON.parse>>, channel: string}>,
 *   errorEvents: EventEmitter,
 *   frameworkErrors: ReturnType<typeof JSON.parse>[],
 *   allErrors: ReturnType<typeof JSON.parse>[],
 *   invokeCounterUpdate: () => Promise<void>,
 *   parentFindConditions: Record<string, ReturnType<typeof JSON.parse>>[],
 *   sourceConnection: CounterCacheParentTransactionDriver
 * }>} - Focused callback harness.
 */
export async function counterCacheParentUpdateHarness({
  broadcastError,
  findError,
  missingParent = false,
  parentAttributes = {counterCacheChildrenCount: 1, id: 7, name: "Committed parent"},
  primaryKey = "id",
  registerPublisher = true
} = {}) {
  /** @type {import("../../src/configuration.js").default} */
  let configuration

  class CounterCacheParent extends Record {
    /** @returns {string} - Counter parent table name. */
    static tableName() { return "counter_cache_parents" }

    /** @returns {import("../../src/configuration.js").default} - Harness configuration. */
    static _getConfiguration() { return configuration }
  }

  class CounterCacheParentResource extends FrontendModelBaseResource {
    static ModelClass = CounterCacheParent

    static primaryKey = primaryKey
  }

  class CounterCacheChild extends Record {
    /** @returns {string} - Counter child table name. */
    static tableName() { return "counter_cache_children" }

    /** @returns {{getForeignKey: () => string, getPrimaryKey: () => string, getTargetModelClass: () => typeof CounterCacheParent}} - Counter parent relationship. */
    static getRelationshipByName() {
      return {
        getForeignKey: () => "counter_cache_parent_id",
        getPrimaryKey: () => "id",
        getTargetModelClass: () => CounterCacheParent
      }
    }
  }

  CounterCacheChild._registerCounterCacheCallbacks("counterCacheParent")

  /** @type {Array<{body: Record<string, ReturnType<typeof JSON.parse>>, broadcastParams: Record<string, ReturnType<typeof JSON.parse>>, channel: string}>} */
  const broadcasts = []
  const errorEvents = new EventEmitter()
  /** @type {ReturnType<typeof JSON.parse>[]} */
  const frameworkErrors = []
  /** @type {ReturnType<typeof JSON.parse>[]} */
  const allErrors = []

  errorEvents.on("framework-error", (payload) => frameworkErrors.push(payload))
  errorEvents.on("all-error", (payload) => allErrors.push(payload))

  configuration = /** @type {import("../../src/configuration.js").default} */ ({
    broadcastToChannel: (/** @type {string} */ channel, /** @type {Record<string, ReturnType<typeof JSON.parse>>} */ broadcastParams, /** @type {Record<string, ReturnType<typeof JSON.parse>>} */ body) => {
      if (broadcastError) throw broadcastError
      broadcasts.push({body, broadcastParams, channel})
    },
    getAbilityResources: () => [CounterCacheParentResource],
    getBackendProjects: () => [],
    getEnvironmentHandler: () => ({getTimeZone: () => "UTC"}),
    getErrorEvents: () => errorEvents,
    registerWebsocketChannel: () => {}
  })

  const parent = /** @type {InstanceType<typeof CounterCacheParent>} */ ({
    _getConfiguration: () => configuration,
    attributes: () => parentAttributes,
    changes: () => ({}),
    getModelClass: () => CounterCacheParent
  })
  /** @type {Record<string, ReturnType<typeof JSON.parse>>[]} */
  const parentFindConditions = []
  const parentQuery = {
    driver: {
      query: async () => {},
      quote: (/** @type {number | string} */ value) => `${value}`,
      quoteColumn: (/** @type {string} */ column) => `"${column}"`,
      quoteTable: (/** @type {string} */ table) => `"${table}"`
    },
    findBy: async (/** @type {Record<string, ReturnType<typeof JSON.parse>>} */ conditions) => {
      parentFindConditions.push(conditions)
      if (findError) throw findError

      return missingParent ? undefined : parent
    }
  }
  const sourceConnection = new CounterCacheParentTransactionDriver({deadlockMaxRetries: 2}, Configuration.current())
  const child = /** @type {InstanceType<typeof CounterCacheChild>} */ ({
    connection: () => sourceConnection,
    queryForModel: () => parentQuery,
    readAttribute: () => 7
  })

  if (registerPublisher) await ensureFrontendModelWebsocketPublishersRegistered(configuration)

  const afterCreate = CounterCacheChild.getLifecycleCallbacksMap().afterCreate?.[0]

  if (!afterCreate || typeof afterCreate === "string") throw new Error("Expected ordinary counter-cache afterCreate callback")

  return {
    allErrors,
    broadcasts,
    errorEvents,
    frameworkErrors,
    invokeCounterUpdate: async () => await afterCreate(child),
    parentFindConditions,
    sourceConnection
  }
}
