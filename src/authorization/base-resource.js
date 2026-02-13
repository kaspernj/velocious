// @ts-check

/** Base class for authorization resources defining abilities for a model. */
export default class AuthorizationBaseResource {
  /** @type {typeof import("../database/record/index.js").default | undefined} */
  static ModelClass = undefined

  /**
   * @param {object} args - Resource args.
   * @param {import("./ability.js").default} args.ability - Ability instance.
   * @param {Record<string, any>} [args.context] - Ability context.
   * @param {Record<string, any>} [args.locals] - Ability locals.
   */
  constructor({ability, context = {}, locals = {}}) {
    this.ability = ability
    this.context = context
    this.locals = locals
  }

  /**
   * @returns {typeof import("../database/record/index.js").default | undefined} - Model class handled by this resource.
   */
  static modelClass() {
    return this.ModelClass
  }

  /**
   * @param {string | string[]} actions - Ability action(s).
   * @param {typeof import("../database/record/index.js").default} modelClass - Model class.
   * @param {Record<string, any> | string | ((query: import("../database/query/model-class-query.js").default<any>, args: {ability: import("./ability.js").default, action: string, modelClass: typeof import("../database/record/index.js").default}) => void | import("../database/query/model-class-query.js").default<any>)} [conditions] - Conditions.
   * @returns {void} - No return value.
   */
  can(actions, modelClass, conditions) {
    this.ability.can(actions, modelClass, conditions)
  }

  /**
   * @param {string | string[]} actions - Ability action(s).
   * @param {typeof import("../database/record/index.js").default} modelClass - Model class.
   * @param {Record<string, any> | string | ((query: import("../database/query/model-class-query.js").default<any>, args: {ability: import("./ability.js").default, action: string, modelClass: typeof import("../database/record/index.js").default}) => void | import("../database/query/model-class-query.js").default<any>)} [conditions] - Conditions.
   * @returns {void} - No return value.
   */
  cannot(actions, modelClass, conditions) {
    this.ability.cannot(actions, modelClass, conditions)
  }

  /** @returns {Record<string, any>} - Ability context. */
  getContext() {
    return this.context
  }

  /** @returns {Record<string, any>} - Ability locals. */
  getLocals() {
    return this.locals
  }

  /** @returns {any} - Current user from context. */
  currentUser() {
    return this.context.currentUser
  }

  /** @returns {import("../http-server/client/request.js").default | import("../http-server/client/websocket-request.js").default | undefined} - Request from context. */
  request() {
    return this.context.request
  }

  /** @returns {Record<string, any> | undefined} - Params from context. */
  params() {
    return this.context.params
  }

  /** @returns {void} - Implement in subclasses to define abilities. */
  abilities() {
    // No-op by default.
  }
}
