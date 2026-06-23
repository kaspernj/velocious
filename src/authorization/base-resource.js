// @ts-check

/** Base class for authorization resources defining abilities for a model. */
export default class AuthorizationBaseResource {
  /**
   * Model class.
   * @type {typeof import("../database/record/index.js").default | undefined} */
  static ModelClass = undefined

  /**
   * Runs constructor.
   * @param {object} args - Resource args.
   * @param {import("./ability.js").default} [args.ability] - Ability instance.
   * @param {import("../configuration-types.js").VelociousLooseObject} [args.context] - Ability context.
   * @param {import("../configuration-types.js").VelociousLooseObject} [args.locals] - Ability locals.
   */
  constructor({ability, context = {}, locals = {}}) {
    this.ability = ability
    this.context = context
    this.locals = locals
  }

  /**
   * Runs model class.
   * @returns {typeof import("../database/record/index.js").default} - Model class handled by this resource.
   */
  static modelClass() {
    if (!this.ModelClass) {
      throw new Error(`${this.name} must define static ModelClass before calling ability helpers.`)
    }

    return this.ModelClass
  }

  /**
   * Runs can.
   * @template {typeof import("../database/record/index.js").default} MC
   * @param {string | string[]} actions - Ability action(s).
   * @param {import("./ability.js").AbilityConditionsType<MC>} [conditions] - Conditions.
   * @returns {void} - No return value.
   */
  can(actions, conditions) {
    this.assertResourceConditionsSignature({conditions, methodName: "can"})
    this.requiredAbility().can(actions, this.requiredModelClass(), /** @type {import("./ability.js").AbilityConditionsType<typeof import("../database/record/index.js").default> | undefined} */ (conditions))
  }

  /**
   * Runs cannot.
   * @template {typeof import("../database/record/index.js").default} MC
   * @param {string | string[]} actions - Ability action(s).
   * @param {import("./ability.js").AbilityConditionsType<MC>} [conditions] - Conditions.
   * @returns {void} - No return value.
   */
  cannot(actions, conditions) {
    this.assertResourceConditionsSignature({conditions, methodName: "cannot"})
    this.requiredAbility().cannot(actions, this.requiredModelClass(), /** @type {import("./ability.js").AbilityConditionsType<typeof import("../database/record/index.js").default> | undefined} */ (conditions))
  }

  /**
   * Runs required ability.
   * @returns {import("./ability.js").default} - Ability instance.
   */
  requiredAbility() {
    if (!this.ability) {
      throw new Error(`${this.constructor.name} requires an ability instance before defining abilities.`)
    }

    return this.ability
  }

  /**
   * Runs required model class.
   * @returns {typeof import("../database/record/index.js").default} - Model class handled by this resource.
   */
  requiredModelClass() {
    const ResourceClass = /** @type {typeof AuthorizationBaseResource} */ (this.constructor)

    return ResourceClass.modelClass()
  }

  /**
   * Runs assert resource conditions signature.
   * @param {object} args - Signature args.
   * @param {?} args.conditions - Conditions value.
   * @param {"can" | "cannot"} args.methodName - Method name.
   * @returns {void}
   */
  assertResourceConditionsSignature({conditions, methodName}) {
    if (typeof conditions === "function" && "primaryKey" in conditions && "_newQuery" in conditions) {
      throw new Error(`${this.constructor.name}.${methodName}(...) no longer accepts a model class. Define static ModelClass and pass only conditions.`)
    }
  }

  /**
   * Runs get context.
   * @returns {import("../configuration-types.js").VelociousLooseObject} - Ability context.
   */
  getContext() {
    return this.context
  }

  /**
   * Runs get locals.
   * @returns {import("../configuration-types.js").VelociousLooseObject} - Ability locals.
   */
  getLocals() {
    return this.locals
  }

  /**
   * Runs current user.
   * @returns {unknown} - Current user from context.
   */
  currentUser() {
    return this.context.currentUser
  }

  /**
   * Runs current device.
   * @returns {unknown} - Current device from context.
   */
  currentDevice() {
    return this.context.currentDevice
  }

  /**
   * Runs offline grant.
   * @returns {unknown} - Offline grant from context.
   */
  offlineGrant() {
    return this.context.offlineGrant
  }

  /**
   * Runs now.
   * @returns {Date} - Current time from context or the system clock.
   */
  now() {
    if (typeof this.context.now === "function") return this.context.now()
    if (this.context.now instanceof Date) return this.context.now

    return new Date()
  }

  /**
   * Runs resource runtime.
   * @returns {"backend" | "frontend" | "offline"} - Resource runtime context.
   */
  resourceRuntime() {
    if (this.context.resourceRuntime === "frontend") return "frontend"
    if (this.context.resourceRuntime === "offline") return "offline"

    return "backend"
  }

  /**
   * Runs is backend.
   * @returns {boolean} - Whether the resource is running in the backend runtime.
   */
  isBackend() {
    return this.resourceRuntime() === "backend"
  }

  /**
   * Runs is frontend.
   * @returns {boolean} - Whether the resource is running in the frontend runtime.
   */
  isFrontend() {
    return this.resourceRuntime() === "frontend"
  }

  /**
   * Runs is offline.
   * @returns {boolean} - Whether the resource is running with offline context.
   */
  isOffline() {
    return this.resourceRuntime() === "offline" || this.context.offlineGrant !== undefined
  }

  /**
   * Resolves a model class from the portable resource context.
   * @param {string} name - Model name.
   * @returns {unknown} - Model class from registry.
   */
  model(name) {
    const registry = this.context.modelRegistry

    if (registry && typeof registry === "object") {
      if ("model" in registry && typeof registry.model === "function") {
        const modelClass = registry.model(name)

        if (modelClass) return modelClass
      }

      if (name in registry) return /** @type {Record<string, unknown>} */ (registry)[name]
    }

    const contextModel = this.context.model

    if (typeof contextModel === "function") {
      const modelClass = contextModel(name)

      if (modelClass) return modelClass
    }

    const configuration = this.context.configuration

    if (configuration) {
      const modelClasses = configuration.getModelClasses()

      if (name in modelClasses) return modelClasses[name]
    }

    throw new Error(`${this.constructor.name} could not resolve model '${name}' from the resource context model registry.`)
  }

  /**
   * Runs request.
   * @returns {import("../http-server/client/request.js").default | import("../http-server/client/websocket-request.js").default | undefined} - Request from context.
   */
  request() {
    return this.context.request
  }

  /**
   * Runs params.
   * @returns {import("../configuration-types.js").VelociousParams | undefined} - Params from context.
   */
  params() {
    return this.context.params
  }

  /**
   * Runs abilities.
   * @returns {void} - Implement in subclasses to define abilities.
   */
  abilities() {
    // No-op by default.
  }
}
