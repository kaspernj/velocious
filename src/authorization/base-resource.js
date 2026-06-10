// @ts-check

/** Base class for authorization resources defining abilities for a model. */
export default class AuthorizationBaseResource {
  /**
   * Model class.
    @type {typeof import("../database/record/index.js").default | undefined} */
  static ModelClass = undefined

  /**
   * Runs constructor.
   * @param {object} args - Resource args.
   * @param {import("./ability.js").default} [args.ability] - Ability instance.
   * @param {Record<string, ?>} [args.context] - Ability context.
   * @param {Record<string, ?>} [args.locals] - Ability locals.
   */
  constructor({ability, context = {}, locals = {}}) {
    this.ability = ability
    this.context = context
    this.locals = locals
  }

  /**
   * Runs model class.
   * @returns {typeof import("../database/record/index.js").default | undefined} - Model class handled by this resource.
   */
  static modelClass() {
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
    this.requiredAbility().can(actions, this.requiredModelClass(), /** Narrows conditions to the runtime resource model class. @type {import("./ability.js").AbilityConditionsType<typeof import("../database/record/index.js").default> | undefined} */ (conditions))
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
    this.requiredAbility().cannot(actions, this.requiredModelClass(), /** Narrows conditions to the runtime resource model class. @type {import("./ability.js").AbilityConditionsType<typeof import("../database/record/index.js").default> | undefined} */ (conditions))
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
    const modelClass = /**
                        * Narrows the runtime value to the documented type.
                         @type {typeof AuthorizationBaseResource} */ (this.constructor).modelClass()

    if (!modelClass) {
      throw new Error(`${this.constructor.name} must define static ModelClass before calling ability helpers.`)
    }

    return modelClass
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
   * @returns {Record<string, ?>} - Ability context.
   */
  getContext() {
    return this.context
  }

  /**
   * Runs get locals.
   * @returns {Record<string, ?>} - Ability locals.
   */
  getLocals() {
    return this.locals
  }

  /**
   * Runs current user.
   * @returns {?} - Current user from context.
   */
  currentUser() {
    return this.context.currentUser
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
   * @returns {Record<string, ?> | undefined} - Params from context.
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
