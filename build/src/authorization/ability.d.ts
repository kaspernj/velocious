export type AbilityConditionsType<MC extends typeof import("../database/record/index.js").default = typeof import("../database/record/index.js").default> = Record<string, ReturnType<typeof JSON.parse>> | string | ((query: import("../database/query/model-class-query.js").default<MC>, args: {
    ability: VelociousAuthorizationAbility;
    action: string;
    modelClass: MC;
}) => void | import("../database/query/model-class-query.js").default<MC>);
export type AbilityRuleType = {
    /**
     * - Actions covered by rule.
     */
    actions: string[];
    /**
     * - Model class.
     */
    modelClass: typeof import("../database/record/index.js").default;
    /**
     * - Conditions.
     */
    conditions: AbilityConditionsType | undefined;
    /**
     * - Rule effect.
     */
    effect: "allow" | "deny";
};
/**
 * Defines this typedef.
 * @template {typeof import("../database/record/index.js").default} [MC=typeof import("../database/record/index.js").default]
 * @typedef {Record<string, ReturnType<typeof JSON.parse>> | string | ((query: import("../database/query/model-class-query.js").default<MC>, args: {ability: VelociousAuthorizationAbility, action: string, modelClass: MC}) => void | import("../database/query/model-class-query.js").default<MC>)} AbilityConditionsType
 */
/**
 * AbilityRuleType type.
 * @typedef {object} AbilityRuleType
 * @property {string[]} actions - Actions covered by rule.
 * @property {typeof import("../database/record/index.js").default} modelClass - Model class.
 * @property {AbilityConditionsType | undefined} conditions - Conditions.
 * @property {"allow" | "deny"} effect - Rule effect.
 */
/** CanCan-style ability object for query-level access control. */
export default class VelociousAuthorizationAbility {
    context: Record<string, any>;
    locals: Record<string, any>;
    resources: typeof import("./base-resource.js").default[];
    /**
     * Narrows the runtime value to the documented type.
     * @type {AbilityRuleType[]} */
    rules: AbilityRuleType[];
    /**
     * Narrows the runtime value to the documented type.
     * @type {Record<string, boolean>} */
    loadedModelClassAbilities: Record<string, boolean>;
    /**
     * Create.
     * @type {string[]} */
    static CREATE: string[];
    /**
     * Read.
     * @type {string[]} */
    static READ: string[];
    /**
     * Update.
     * @type {string[]} */
    static UPDATE: string[];
    /**
     * Destroy.
     * @type {string[]} */
    static DESTROY: string[];
    /**
     * Crud.
     * @type {string[]} */
    static CRUD: string[];
    /**
     * Runs constructor.
     * @param {object} args - Ability args.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} [args.context] - Ability context.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} [args.locals] - Ability locals.
     * @param {Array<typeof import("./base-resource.js").default>} [args.resources] - Resource classes.
     */
    constructor({ context, locals, resources }?: {
        context?: Record<string, ReturnType<typeof JSON.parse>>;
        locals?: Record<string, ReturnType<typeof JSON.parse>>;
        resources?: Array<typeof import("./base-resource.js").default>;
    });
    /**
     * Auto-resolves resource classes from the configuration's backendProjects when no explicit resources are provided.
     * @returns {Array<typeof import("./base-resource.js").default>} Resolved resource classes.
     */
    _resolveResourcesFromConfiguration(): Array<typeof import("./base-resource.js").default>;
    /**
     * Runs get context.
     * @returns {Record<string, ReturnType<typeof JSON.parse>>} - Context.
     */
    getContext(): Record<string, ReturnType<typeof JSON.parse>>;
    /**
     * Runs get locals.
     * @returns {Record<string, ReturnType<typeof JSON.parse>>} - Locals.
     */
    getLocals(): Record<string, ReturnType<typeof JSON.parse>>;
    /**
     * Runs current user.
     * @returns {ReturnType<typeof JSON.parse>} - Current user from context.
     */
    currentUser(): ReturnType<typeof JSON.parse>;
    /**
     * Runs can.
     * @param {string | string[]} actions - Action(s).
     * @param {typeof import("../database/record/index.js").default} modelClass - Model class.
     * @param {AbilityConditionsType} [conditions] - Conditions.
     * @returns {void} - No return value.
     */
    can(actions: string | string[], modelClass: typeof import("../database/record/index.js").default, conditions?: AbilityConditionsType): void;
    /**
     * Runs cannot.
     * @param {string | string[]} actions - Action(s).
     * @param {typeof import("../database/record/index.js").default} modelClass - Model class.
     * @param {AbilityConditionsType} [conditions] - Conditions.
     * @returns {void} - No return value.
     */
    cannot(actions: string | string[], modelClass: typeof import("../database/record/index.js").default, conditions?: AbilityConditionsType): void;
    /**
     * Runs add rule.
     * @param {object} args - Rule args.
     * @param {string | string[]} args.actions - Action(s).
     * @param {AbilityConditionsType} [args.conditions] - Conditions.
     * @param {"allow" | "deny"} args.effect - Effect.
     * @param {typeof import("../database/record/index.js").default} args.modelClass - Model class.
     * @returns {void} - No return value.
     */
    addRule({ actions, conditions, effect, modelClass }: {
        actions: string | string[];
        conditions?: AbilityConditionsType;
        effect: "allow" | "deny";
        modelClass: typeof import("../database/record/index.js").default;
    }): void;
    /**
     * Runs load abilities for model class.
     * @param {typeof import("../database/record/index.js").default} modelClass - Model class.
     * @returns {void} - No return value.
     */
    loadAbilitiesForModelClass(modelClass: typeof import("../database/record/index.js").default): void;
    /**
     * Runs apply to query.
     * @param {object} args - Query args.
     * @param {string} args.action - Requested action.
     * @param {typeof import("../database/record/index.js").default} args.modelClass - Model class.
     * @param {import("../database/query/model-class-query.js").default<typeof import("../database/record/index.js").default>} args.query - Query.
     * @returns {import("../database/query/model-class-query.js").default<typeof import("../database/record/index.js").default>} - Authorized query.
     */
    applyToQuery({ action, modelClass, query }: {
        action: string;
        modelClass: typeof import("../database/record/index.js").default;
        query: import("../database/query/model-class-query.js").default<typeof import("../database/record/index.js").default>;
    }): import("../database/query/model-class-query.js").default<typeof import("../database/record/index.js").default>;
    /**
     * Runs rules for.
     * @param {object} args - Rule lookup args.
     * @param {string} args.action - Action.
     * @param {typeof import("../database/record/index.js").default} args.modelClass - Model class.
     * @returns {AbilityRuleType[]} - Matching rules.
     */
    rulesFor({ action, modelClass }: {
        action: string;
        modelClass: typeof import("../database/record/index.js").default;
    }): AbilityRuleType[];
    /**
     * Runs condition sql parts.
     * @param {object} args - SQL args.
     * @param {string} args.action - Action.
     * @param {typeof import("../database/record/index.js").default} args.modelClass - Model class.
     * @param {import("../database/query/model-class-query.js").default<typeof import("../database/record/index.js").default>} args.query - Base query.
     * @param {AbilityRuleType[]} args.rules - Rules.
     * @returns {string[]} - SQL condition parts.
     */
    conditionSqlParts({ action, modelClass, query, rules }: {
        action: string;
        modelClass: typeof import("../database/record/index.js").default;
        query: import("../database/query/model-class-query.js").default<typeof import("../database/record/index.js").default>;
        rules: AbilityRuleType[];
    }): string[];
    /**
     * Runs apply deny rules.
     * @param {object} args - Deny args.
     * @param {string} args.action - Action.
     * @param {AbilityRuleType[]} args.denyRules - Deny rules.
     * @param {typeof import("../database/record/index.js").default} args.modelClass - Model class.
     * @param {import("../database/query/model-class-query.js").default<typeof import("../database/record/index.js").default>} args.query - Query.
     * @returns {void} - No return value.
     */
    applyDenyRules({ action, denyRules, modelClass, query }: {
        action: string;
        denyRules: AbilityRuleType[];
        modelClass: typeof import("../database/record/index.js").default;
        query: import("../database/query/model-class-query.js").default<typeof import("../database/record/index.js").default>;
    }): void;
    /**
     * Runs apply rule condition.
     * @param {object} args - Condition args.
     * @param {string} args.action - Action.
     * @param {AbilityConditionsType} args.conditions - Rule conditions.
     * @param {typeof import("../database/record/index.js").default} args.modelClass - Model class.
     * @param {import("../database/query/model-class-query.js").default<typeof import("../database/record/index.js").default>} args.query - Query.
     * @returns {void | import("../database/query/model-class-query.js").default<typeof import("../database/record/index.js").default>} - Optional replacement query.
     */
    applyRuleCondition({ action, conditions, modelClass, query }: {
        action: string;
        conditions: AbilityConditionsType;
        modelClass: typeof import("../database/record/index.js").default;
        query: import("../database/query/model-class-query.js").default<typeof import("../database/record/index.js").default>;
    }): void | import("../database/query/model-class-query.js").default<typeof import("../database/record/index.js").default>;
}
//# sourceMappingURL=ability.d.ts.map