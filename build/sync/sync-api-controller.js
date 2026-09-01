// @ts-check

import Controller from "../controller.js"
import FrontendModelBaseResource from "../frontend-model-resource/base-resource.js"

/** Configurations whose sync.api routes have already been mounted. */
const mountedConfigurations = new WeakSet()

/**
 * Generic `/velocious/sync` transport controller.
 *
 * Apps provide a sync resource class; Velocious owns endpoint shape and
 * rendering. The app resource owns auth, scoping, and domain-specific
 * replay/change hooks.
 */
export default class SyncApiController extends Controller {
  /**
   * Renders a replay response from the configured sync resource.
   * @returns {Promise<void>}
   */
  async replay() {
    const resource = /** @type {FrontendModelBaseResource & {replay: () => Promise<unknown>}} */ (this.syncResource(this.params()))

    await this.render({json: /** @type {object} */ (await resource.replay())})
  }

  /**
   * Renders a change-feed response from the configured sync resource.
   * @returns {Promise<void>}
   */
  async changes() {
    const resource = /** @type {FrontendModelBaseResource & {changes: () => Promise<unknown>}} */ (this.syncResource(this.params()))

    await this.render({json: /** @type {object} */ (await resource.changes())})
  }

  /**
   * Builds the sync resource that backs the transport endpoint.
   * @param {Record<string, unknown>} params - Request params/body.
   * @returns {FrontendModelBaseResource} Sync resource instance.
   */
  syncResource(params) {
    const ResourceClass = this.syncResourceClass()
    const ability = this.currentAbility()

    return new ResourceClass({
      ability,
      controller: /** @type {import("../frontend-model-resource/base-resource.js").FrontendModelResourceController} */ (/** @type {unknown} */ (this)),
      context: {
        ...(ability?.getContext() || {}),
        params: this.params(),
        request: this.request()
      },
      locals: ability?.getLocals() || {},
      modelClass: this.syncModelClass(),
      modelName: this.syncModelName(),
      params: /** @type {import("../configuration-types.js").VelociousParams} */ (/** @type {unknown} */ (params)),
      resourceConfiguration: this.syncResourceConfiguration(ResourceClass)
    })
  }

  /**
   * Returns the app-provided sync resource class.
   * @returns {import("../configuration-types.js").FrontendModelResourceClassType} Sync resource class.
   */
  syncResourceClass() {
    return this.missingSyncResourceClass()
  }

  /**
   * Builds a sync API controller class bound to the given resource.
   * @param {import("../configuration-types.js").FrontendModelResourceClassType} ResourceClass - Sync resource class.
   * @returns {typeof SyncApiController} Controller class for the resource.
   */
  static withSyncResourceClass(ResourceClass) {
    return class ConfiguredSyncApiController extends this {
      /**
       * Returns the configured sync resource class.
       * @returns {import("../configuration-types.js").FrontendModelResourceClassType} Sync resource class.
       */
      syncResourceClass() {
        return ResourceClass
      }
    }
  }

  /**
   * Mounts the standard Velocious sync endpoints into a route configuration.
   * @param {{configuration?: import("../configuration.js").default, at?: string, syncResourceClass?: import("../configuration-types.js").FrontendModelResourceClassType}} args - Mount args.
   * @returns {void}
   */
  static mountInto(args) {
    const {configuration, syncResourceClass} = args
    const ControllerClass = syncResourceClass ? this.withSyncResourceClass(syncResourceClass) : this
    const at = this.normalizedMountPath(args.at || "/velocious/sync")

    if (!configuration) throw new Error("SyncApiController.mountInto requires configuration")

    configuration.routes((routes) => {
      routes.post(`${at}/changes`, {to: [ControllerClass, "changes"]})
      routes.post(`${at}/replay`, {to: [ControllerClass, "replay"]})
    })
  }

  /**
   * Auto-mounts the sync endpoints configured through `sync.api` on a configuration.
   * No-op when `sync.api` is absent; guarded so repeated server boots with the
   * same configuration register the routes only once.
   * @param {import("../configuration.js").default} configuration - Configuration instance.
   * @returns {void}
   */
  static mountFromConfiguration(configuration) {
    const api = configuration.getSyncConfiguration().api

    if (!api || mountedConfigurations.has(configuration)) return

    mountedConfigurations.add(configuration)

    this.mountInto({at: api.mountPath, configuration, syncResourceClass: api.resourceClass})
  }

  /**
   * Normalizes a sync mount path.
   * @param {string} at - Mount path.
   * @returns {string} Normalized mount path without trailing slash.
   */
  static normalizedMountPath(at) {
    if (typeof at !== "string" || !at.startsWith("/")) {
      throw new Error(`SyncApiController mount path must start with '/', got: ${String(at)}`)
    }

    return at.replace(/\/+$/u, "") || "/"
  }

  /**
   * Raises a configuration error for subclasses that do not provide a resource.
   * @returns {import("../configuration-types.js").FrontendModelResourceClassType} Sync resource class.
   */
  missingSyncResourceClass() {
    return /** @type {typeof FrontendModelBaseResource} */ (/** @type {unknown} */ (this.raiseMissingSyncResourceClass()))
  }

  /** Raises a configuration error for subclasses that do not provide a resource. */
  raiseMissingSyncResourceClass() {
    throw new Error("SyncApiController.syncResourceClass must be implemented")
  }

  /**
   * Returns the model class exposed by the sync resource.
   * @returns {typeof import("../database/record/index.js").default} Sync model class.
   */
  syncModelClass() {
    const ResourceClass = this.syncResourceClass()
    const modelClass = ResourceClass.ModelClass

    if (!modelClass) throw new Error("Sync resource class must define static ModelClass")

    return modelClass
  }

  /**
   * Returns the model name used to initialize the resource.
   * @returns {string} Sync model name.
   */
  syncModelName() {
    return this.syncModelClass().name
  }

  /**
   * Builds the minimal resource configuration needed by the sync resource.
   * @param {import("../configuration-types.js").FrontendModelResourceClassType} ResourceClass - Sync resource class.
   * @returns {import("../configuration-types.js").FrontendModelResourceConfiguration} Resource configuration.
   */
  syncResourceConfiguration(ResourceClass) {
    return /** @type {import("../configuration-types.js").FrontendModelResourceConfiguration} */ ({
      attributes: ResourceClass.attributes || {},
      sync: {enabled: true}
    })
  }
}

