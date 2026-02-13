// @ts-check

import BaseResource from "./base-resource.js"

/** @typedef {Record<string, any> | string | ((query: import("../database/query/model-class-query.js").default<any>, args: {ability: VelociousAuthorizationAbility, action: string, modelClass: typeof import("../database/record/index.js").default}) => void | import("../database/query/model-class-query.js").default<any>)} AbilityConditionsType */

/**
 * @typedef {object} AbilityRuleType
 * @property {string[]} actions - Actions covered by rule.
 * @property {typeof import("../database/record/index.js").default} modelClass - Model class.
 * @property {AbilityConditionsType | undefined} conditions - Conditions.
 * @property {"allow" | "deny"} effect - Rule effect.
 */

/** CanCan-style ability object for query-level access control. */
export default class VelociousAuthorizationAbility {
  /** @type {string[]} */
  static CREATE = ["create"]

  /** @type {string[]} */
  static READ = ["read"]

  /** @type {string[]} */
  static UPDATE = ["update"]

  /** @type {string[]} */
  static DESTROY = ["destroy"]

  /** @type {string[]} */
  static CRUD = ["create", "read", "update", "destroy"]

  /**
   * @param {object} args - Ability args.
   * @param {Record<string, any>} [args.context] - Ability context.
   * @param {Record<string, any>} [args.locals] - Ability locals.
   * @param {Array<typeof BaseResource>} [args.resources] - Resource classes.
   */
  constructor({context = {}, locals = {}, resources = []} = {}) {
    this.context = context
    this.locals = locals
    this.resources = resources

    /** @type {AbilityRuleType[]} */
    this.rules = []

    /** @type {Record<string, boolean>} */
    this.loadedModelClassAbilities = {}
  }

  /** @returns {Record<string, any>} - Context. */
  getContext() {
    return this.context
  }

  /** @returns {Record<string, any>} - Locals. */
  getLocals() {
    return this.locals
  }

  /** @returns {any} - Current user from context. */
  currentUser() {
    return this.context.currentUser
  }

  /**
   * @param {string | string[]} actions - Action(s).
   * @param {typeof import("../database/record/index.js").default} modelClass - Model class.
   * @param {AbilityConditionsType} [conditions] - Conditions.
   * @returns {void} - No return value.
   */
  can(actions, modelClass, conditions) {
    this.addRule({actions, conditions, effect: "allow", modelClass})
  }

  /**
   * @param {string | string[]} actions - Action(s).
   * @param {typeof import("../database/record/index.js").default} modelClass - Model class.
   * @param {AbilityConditionsType} [conditions] - Conditions.
   * @returns {void} - No return value.
   */
  cannot(actions, modelClass, conditions) {
    this.addRule({actions, conditions, effect: "deny", modelClass})
  }

  /**
   * @param {object} args - Rule args.
   * @param {string | string[]} args.actions - Action(s).
   * @param {AbilityConditionsType} [args.conditions] - Conditions.
   * @param {"allow" | "deny"} args.effect - Effect.
   * @param {typeof import("../database/record/index.js").default} args.modelClass - Model class.
   * @returns {void} - No return value.
   */
  addRule({actions, conditions, effect, modelClass}) {
    const normalizedActions = Array.isArray(actions) ? actions : [actions]

    this.rules.push({actions: normalizedActions, conditions, effect, modelClass})
  }

  /**
   * @param {typeof import("../database/record/index.js").default} modelClass - Model class.
   * @returns {void} - No return value.
   */
  loadAbilitiesForModelClass(modelClass) {
    const key = modelClass.name

    if (this.loadedModelClassAbilities[key]) return

    this.loadedModelClassAbilities[key] = true

    for (const ResourceClass of this.resources) {
      const resourceModelClass = ResourceClass.modelClass()

      if (!resourceModelClass) continue
      if (resourceModelClass !== modelClass) continue

      const resourceInstance = new ResourceClass({
        ability: this,
        context: this.context,
        locals: this.locals
      })

      resourceInstance.abilities()
    }
  }

  /**
   * @param {object} args - Query args.
   * @param {string} args.action - Requested action.
   * @param {typeof import("../database/record/index.js").default} args.modelClass - Model class.
   * @param {import("../database/query/model-class-query.js").default<any>} args.query - Query.
   * @returns {import("../database/query/model-class-query.js").default<any>} - Authorized query.
   */
  applyToQuery({action, modelClass, query}) {
    this.loadAbilitiesForModelClass(modelClass)

    const applicableRules = this.rulesFor({action, modelClass})
    const allowRules = applicableRules.filter((rule) => rule.effect === "allow")
    const denyRules = applicableRules.filter((rule) => rule.effect === "deny")

    if (allowRules.length === 0) {
      return query.where("1=0")
    }

    if (allowRules.some((rule) => !rule.conditions)) {
      this.applyDenyRules({action, denyRules, modelClass, query})
      return query
    }

    const allowSqlParts = this.conditionSqlParts({action, modelClass, query, rules: allowRules})

    if (allowSqlParts.length === 0) {
      return query.where("1=0")
    }

    query.where(`(${allowSqlParts.join(" OR ")})`)
    this.applyDenyRules({action, denyRules, modelClass, query})

    return query
  }

  /**
   * @param {object} args - Rule lookup args.
   * @param {string} args.action - Action.
   * @param {typeof import("../database/record/index.js").default} args.modelClass - Model class.
   * @returns {AbilityRuleType[]} - Matching rules.
   */
  rulesFor({action, modelClass}) {
    return this.rules.filter((rule) => {
      if (rule.modelClass !== modelClass) return false

      return rule.actions.includes(action) || rule.actions.includes("manage")
    })
  }

  /**
   * @param {object} args - SQL args.
   * @param {string} args.action - Action.
   * @param {typeof import("../database/record/index.js").default} args.modelClass - Model class.
   * @param {import("../database/query/model-class-query.js").default<any>} args.query - Base query.
   * @param {AbilityRuleType[]} args.rules - Rules.
   * @returns {string[]} - SQL condition parts.
   */
  conditionSqlParts({action, modelClass, query, rules}) {
    const pk = modelClass.primaryKey()
    const quotedBaseTable = query.driver.quoteTable(modelClass.tableName())
    const quotedPk = query.driver.quoteColumn(pk)
    const sqlParts = []

    for (const rule of rules) {
      if (!rule.conditions) continue

      const scopedQuery = modelClass._newQuery()
      const resultQuery = this.applyRuleCondition({
        action,
        conditions: rule.conditions,
        modelClass,
        query: scopedQuery
      })
      const finalQuery = resultQuery || scopedQuery
      const selectedPkSql = `${quotedBaseTable}.${quotedPk}`

      finalQuery.select(selectedPkSql)

      sqlParts.push(`${quotedBaseTable}.${quotedPk} IN (${finalQuery.toSql()})`)
    }

    return sqlParts
  }

  /**
   * @param {object} args - Deny args.
   * @param {string} args.action - Action.
   * @param {AbilityRuleType[]} args.denyRules - Deny rules.
   * @param {typeof import("../database/record/index.js").default} args.modelClass - Model class.
   * @param {import("../database/query/model-class-query.js").default<any>} args.query - Query.
   * @returns {void} - No return value.
   */
  applyDenyRules({action, denyRules, modelClass, query}) {
    if (denyRules.length === 0) return

    if (denyRules.some((rule) => !rule.conditions)) {
      query.where("1=0")
      return
    }

    const denySqlParts = this.conditionSqlParts({action, modelClass, query, rules: denyRules})

    if (denySqlParts.length > 0) {
      query.where(`NOT (${denySqlParts.join(" OR ")})`)
    }
  }

  /**
   * @param {object} args - Condition args.
   * @param {string} args.action - Action.
   * @param {AbilityConditionsType} args.conditions - Rule conditions.
   * @param {typeof import("../database/record/index.js").default} args.modelClass - Model class.
   * @param {import("../database/query/model-class-query.js").default<any>} args.query - Query.
   * @returns {void | import("../database/query/model-class-query.js").default<any>} - Optional replacement query.
   */
  applyRuleCondition({action, conditions, modelClass, query}) {
    if (typeof conditions === "string") {
      query.where(conditions)
      return
    }

    if (typeof conditions === "function") {
      return conditions(query, {
        ability: this,
        action,
        modelClass
      })
    }

    query.where(conditions)
  }
}
