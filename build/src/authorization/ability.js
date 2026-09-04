// @ts-check
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
    /**
     * Create.
     * @type {string[]} */
    static CREATE = ["create"];
    /**
     * Read.
     * @type {string[]} */
    static READ = ["read"];
    /**
     * Update.
     * @type {string[]} */
    static UPDATE = ["update"];
    /**
     * Destroy.
     * @type {string[]} */
    static DESTROY = ["destroy"];
    /**
     * Crud.
     * @type {string[]} */
    static CRUD = ["create", "read", "update", "destroy"];
    /**
     * Runs constructor.
     * @param {object} args - Ability args.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} [args.context] - Ability context.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} [args.locals] - Ability locals.
     * @param {Array<typeof import("./base-resource.js").default>} [args.resources] - Resource classes.
     */
    constructor({ context = {}, locals = {}, resources } = {}) {
        this.context = context;
        this.locals = locals;
        this.resources = resources || this._resolveResourcesFromConfiguration();
        /**
         * Narrows the runtime value to the documented type.
         * @type {AbilityRuleType[]} */
        this.rules = [];
        /**
         * Narrows the runtime value to the documented type.
         * @type {Record<string, boolean>} */
        this.loadedModelClassAbilities = {};
    }
    /**
     * Auto-resolves resource classes from the configuration's backendProjects when no explicit resources are provided.
     * @returns {Array<typeof import("./base-resource.js").default>} Resolved resource classes.
     */
    _resolveResourcesFromConfiguration() {
        const configuration = this.context?.configuration;
        if (!configuration) {
            return [];
        }
        /**
         * Resolved.
         * @type {Array<typeof import("./base-resource.js").default>} */
        const resolved = [];
        const backendProjects = configuration.getBackendProjects();
        for (const backendProject of backendProjects) {
            const frontendModels = backendProject.frontendModels;
            if (!frontendModels)
                continue;
            for (const resourceDefinition of Object.values(frontendModels)) {
                resolved.push(resourceDefinition);
            }
        }
        return resolved;
    }
    /**
     * Runs get context.
     * @returns {Record<string, ReturnType<typeof JSON.parse>>} - Context.
     */
    getContext() {
        return this.context;
    }
    /**
     * Runs get locals.
     * @returns {Record<string, ReturnType<typeof JSON.parse>>} - Locals.
     */
    getLocals() {
        return this.locals;
    }
    /**
     * Runs current user.
     * @returns {ReturnType<typeof JSON.parse>} - Current user from context.
     */
    currentUser() {
        return this.context.currentUser;
    }
    /**
     * Runs can.
     * @param {string | string[]} actions - Action(s).
     * @param {typeof import("../database/record/index.js").default} modelClass - Model class.
     * @param {AbilityConditionsType} [conditions] - Conditions.
     * @returns {void} - No return value.
     */
    can(actions, modelClass, conditions) {
        this.addRule({ actions, conditions, effect: "allow", modelClass });
    }
    /**
     * Runs cannot.
     * @param {string | string[]} actions - Action(s).
     * @param {typeof import("../database/record/index.js").default} modelClass - Model class.
     * @param {AbilityConditionsType} [conditions] - Conditions.
     * @returns {void} - No return value.
     */
    cannot(actions, modelClass, conditions) {
        this.addRule({ actions, conditions, effect: "deny", modelClass });
    }
    /**
     * Runs add rule.
     * @param {object} args - Rule args.
     * @param {string | string[]} args.actions - Action(s).
     * @param {AbilityConditionsType} [args.conditions] - Conditions.
     * @param {"allow" | "deny"} args.effect - Effect.
     * @param {typeof import("../database/record/index.js").default} args.modelClass - Model class.
     * @returns {void} - No return value.
     */
    addRule({ actions, conditions, effect, modelClass }) {
        const normalizedActions = Array.isArray(actions) ? actions : [actions];
        this.rules.push({ actions: normalizedActions, conditions, effect, modelClass });
    }
    /**
     * Runs load abilities for model class.
     * @param {typeof import("../database/record/index.js").default} modelClass - Model class.
     * @returns {void} - No return value.
     */
    loadAbilitiesForModelClass(modelClass) {
        const key = modelClass.getModelName();
        if (this.loadedModelClassAbilities[key])
            return;
        this.loadedModelClassAbilities[key] = true;
        for (const ResourceClass of this.resources) {
            const resourceModelClass = ResourceClass.modelClass();
            if (resourceModelClass !== modelClass)
                continue;
            const resourceInstance = new ResourceClass({
                ability: this,
                context: this.context,
                locals: this.locals
            });
            resourceInstance.abilities();
        }
    }
    /**
     * Runs apply to query.
     * @param {object} args - Query args.
     * @param {string} args.action - Requested action.
     * @param {typeof import("../database/record/index.js").default} args.modelClass - Model class.
     * @param {import("../database/query/model-class-query.js").default<typeof import("../database/record/index.js").default>} args.query - Query.
     * @param {() => import("../database/query/model-class-query.js").default<typeof import("../database/record/index.js").default>} [args.ruleQueryFactory] - Optional factory for the queries that evaluate individual conditional rules.
     * @returns {import("../database/query/model-class-query.js").default<typeof import("../database/record/index.js").default>} - Authorized query.
     */
    applyToQuery({ action, modelClass, query, ruleQueryFactory }) {
        this.loadAbilitiesForModelClass(modelClass);
        const applicableRules = this.rulesFor({ action, modelClass });
        const allowRules = applicableRules.filter((rule) => rule.effect === "allow");
        const denyRules = applicableRules.filter((rule) => rule.effect === "deny");
        if (allowRules.length === 0) {
            return query.where("1=0");
        }
        if (allowRules.some((rule) => !rule.conditions)) {
            this.applyDenyRules({ action, denyRules, modelClass, query, ruleQueryFactory });
            return query;
        }
        const allowSqlParts = this.conditionSqlParts({ action, modelClass, query, ruleQueryFactory, rules: allowRules });
        if (allowSqlParts.length === 0) {
            return query.where("1=0");
        }
        query.where(`(${allowSqlParts.join(" OR ")})`);
        this.applyDenyRules({ action, denyRules, modelClass, query, ruleQueryFactory });
        return query;
    }
    /**
     * Runs rules for.
     * @param {object} args - Rule lookup args.
     * @param {string} args.action - Action.
     * @param {typeof import("../database/record/index.js").default} args.modelClass - Model class.
     * @returns {AbilityRuleType[]} - Matching rules.
     */
    rulesFor({ action, modelClass }) {
        return this.rules.filter((rule) => {
            if (rule.modelClass !== modelClass)
                return false;
            return rule.actions.includes(action) || rule.actions.includes("manage");
        });
    }
    /**
     * Runs condition sql parts.
     * @param {object} args - SQL args.
     * @param {string} args.action - Action.
     * @param {typeof import("../database/record/index.js").default} args.modelClass - Model class.
     * @param {import("../database/query/model-class-query.js").default<typeof import("../database/record/index.js").default>} args.query - Base query.
     * @param {() => import("../database/query/model-class-query.js").default<typeof import("../database/record/index.js").default>} [args.ruleQueryFactory] - Optional conditional-rule query factory.
     * @param {AbilityRuleType[]} args.rules - Rules.
     * @returns {string[]} - SQL condition parts.
     */
    conditionSqlParts({ action, modelClass, query, ruleQueryFactory, rules }) {
        const primaryKey = modelClass.primaryKey();
        const primaryKeyAttributes = Array.isArray(primaryKey) ? primaryKey : [primaryKey];
        const quotedBaseTable = query.driver.quoteTable(query.getTableReferenceForJoin());
        const sqlParts = [];
        for (const rule of rules) {
            if (!rule.conditions)
                continue;
            const scopedQuery = ruleQueryFactory ? ruleQueryFactory() : modelClass._newQuery();
            const resultQuery = this.applyRuleCondition({
                action,
                conditions: rule.conditions,
                modelClass,
                query: scopedQuery
            });
            const finalQuery = resultQuery || scopedQuery;
            if (ruleQueryFactory && finalQuery !== scopedQuery) {
                const finalFroms = finalQuery.getFroms();
                finalFroms.splice(0, finalFroms.length, ...scopedQuery.getFroms());
            }
            const quotedScopedTable = query.driver.quoteTable(finalQuery.getTableReferenceForJoin());
            const primaryKeyColumns = primaryKeyAttributes.map((attributeName) => modelClass.getColumnNameForAttributeName(attributeName));
            const selectedPkSql = primaryKeyColumns.map((columnName) => `${quotedScopedTable}.${query.driver.quoteColumn(columnName)}`);
            if (finalQuery._distinct) {
                query.distinct(true);
            }
            finalQuery.select(selectedPkSql);
            if (Array.isArray(primaryKey)) {
                const authorizedRowsAlias = query.driver.quoteTable("velocious_authorized_rows");
                const identitySql = primaryKeyColumns.map((columnName) => {
                    const quotedColumn = query.driver.quoteColumn(columnName);
                    return `${authorizedRowsAlias}.${quotedColumn} = ${quotedBaseTable}.${quotedColumn}`;
                }).join(" AND ");
                sqlParts.push(`EXISTS (SELECT 1 FROM (${finalQuery.toSql()}) AS ${authorizedRowsAlias} WHERE ${identitySql})`);
            }
            else {
                sqlParts.push(`${quotedBaseTable}.${query.driver.quoteColumn(primaryKeyColumns[0])} IN (${finalQuery.toSql()})`);
            }
        }
        return sqlParts;
    }
    /**
     * Runs apply deny rules.
     * @param {object} args - Deny args.
     * @param {string} args.action - Action.
     * @param {AbilityRuleType[]} args.denyRules - Deny rules.
     * @param {typeof import("../database/record/index.js").default} args.modelClass - Model class.
     * @param {import("../database/query/model-class-query.js").default<typeof import("../database/record/index.js").default>} args.query - Query.
     * @param {() => import("../database/query/model-class-query.js").default<typeof import("../database/record/index.js").default>} [args.ruleQueryFactory] - Optional conditional-rule query factory.
     * @returns {void} - No return value.
     */
    applyDenyRules({ action, denyRules, modelClass, query, ruleQueryFactory }) {
        if (denyRules.length === 0)
            return;
        if (denyRules.some((rule) => !rule.conditions)) {
            query.where("1=0");
            return;
        }
        const denySqlParts = this.conditionSqlParts({ action, modelClass, query, ruleQueryFactory, rules: denyRules });
        if (denySqlParts.length > 0) {
            query.where(`NOT (${denySqlParts.join(" OR ")})`);
        }
    }
    /**
     * Runs apply rule condition.
     * @param {object} args - Condition args.
     * @param {string} args.action - Action.
     * @param {AbilityConditionsType} args.conditions - Rule conditions.
     * @param {typeof import("../database/record/index.js").default} args.modelClass - Model class.
     * @param {import("../database/query/model-class-query.js").default<typeof import("../database/record/index.js").default>} args.query - Query.
     * @returns {void | import("../database/query/model-class-query.js").default<typeof import("../database/record/index.js").default>} - Optional replacement query.
     */
    applyRuleCondition({ action, conditions, modelClass, query }) {
        if (typeof conditions === "string") {
            query.where(conditions);
            return;
        }
        if (typeof conditions === "function") {
            return conditions(query, {
                ability: this,
                action,
                modelClass
            });
        }
        query.where(conditions);
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYWJpbGl0eS5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9hdXRob3JpemF0aW9uL2FiaWxpdHkuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaOzs7O0dBSUc7QUFFSDs7Ozs7OztHQU9HO0FBRUgsa0VBQWtFO0FBQ2xFLE1BQU0sQ0FBQyxPQUFPLE9BQU8sNkJBQTZCO0lBQ2hEOzswQkFFc0I7SUFDdEIsTUFBTSxDQUFDLE1BQU0sR0FBRyxDQUFDLFFBQVEsQ0FBQyxDQUFBO0lBRTFCOzswQkFFc0I7SUFDdEIsTUFBTSxDQUFDLElBQUksR0FBRyxDQUFDLE1BQU0sQ0FBQyxDQUFBO0lBRXRCOzswQkFFc0I7SUFDdEIsTUFBTSxDQUFDLE1BQU0sR0FBRyxDQUFDLFFBQVEsQ0FBQyxDQUFBO0lBRTFCOzswQkFFc0I7SUFDdEIsTUFBTSxDQUFDLE9BQU8sR0FBRyxDQUFDLFNBQVMsQ0FBQyxDQUFBO0lBRTVCOzswQkFFc0I7SUFDdEIsTUFBTSxDQUFDLElBQUksR0FBRyxDQUFDLFFBQVEsRUFBRSxNQUFNLEVBQUUsUUFBUSxFQUFFLFNBQVMsQ0FBQyxDQUFBO0lBRXJEOzs7Ozs7T0FNRztJQUNILFlBQVksRUFBQyxPQUFPLEdBQUcsRUFBRSxFQUFFLE1BQU0sR0FBRyxFQUFFLEVBQUUsU0FBUyxFQUFDLEdBQUcsRUFBRTtRQUNyRCxJQUFJLENBQUMsT0FBTyxHQUFHLE9BQU8sQ0FBQTtRQUN0QixJQUFJLENBQUMsTUFBTSxHQUFHLE1BQU0sQ0FBQTtRQUNwQixJQUFJLENBQUMsU0FBUyxHQUFHLFNBQVMsSUFBSSxJQUFJLENBQUMsa0NBQWtDLEVBQUUsQ0FBQTtRQUV2RTs7dUNBRStCO1FBQy9CLElBQUksQ0FBQyxLQUFLLEdBQUcsRUFBRSxDQUFBO1FBRWY7OzZDQUVxQztRQUNyQyxJQUFJLENBQUMseUJBQXlCLEdBQUcsRUFBRSxDQUFBO0lBQ3JDLENBQUM7SUFFRDs7O09BR0c7SUFDSCxrQ0FBa0M7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QUFTLENBQUMsTUFBTSxLQUFLLENBQUM7WUFBRSxPQUFNO1FBRWxDLElBQUksU0FBUyxDQUFDLElBQUksQ0FBQyxDQUFDLElBQUksRUFBRSxFQUFFLENBQUMsQ0FBQyxJQUFJLENBQUMsVUFBVSxDQUFDLEVBQUUsQ0FBQztZQUMvQyxLQUFLLENBQUMsS0FBSyxDQUFDLEtBQUssQ0FBQyxDQUFBO1lBQ2xCLE9BQU07UUFDUixDQUFDO1FBRUQsTUFBTSxZQUFZLEdBQUcsSUFBSSxDQUFDLGlCQUFpQixDQUFDLEVBQUMsTUFBTSxFQUFFLFVBQVUsRUFBRSxLQUFLLEVBQUUsZ0JBQWdCLEVBQUUsS0FBSyxFQUFFLFNBQVMsRUFBQyxDQUFDLENBQUE7UUFFNUcsSUFBSSxZQUFZLENBQUMsTUFBTSxHQUFHLENBQUMsRUFBRSxDQUFDO1lBQzVCLEtBQUssQ0FBQyxLQUFLLENBQUMsUUFBUSxZQUFZLENBQUMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxHQUFHLENBQUMsQ0FBQTtRQUNuRCxDQUFDO0lBQ0gsQ0FBQztJQUVEOzs7Ozs7OztPQVFHO0lBQ0gsa0JBQWtCLENBQUMsRUFBQyxNQUFNLEVBQUUsVUFBVSxFQUFFLFVBQVUsRUFBRSxLQUFLLEVBQUM7UUFDeEQsSUFBSSxPQUFPLFVBQVUsS0FBSyxRQUFRLEVBQUUsQ0FBQztZQUNuQyxLQUFLLENBQUMsS0FBSyxDQUFDLFVBQVUsQ0FBQyxDQUFBO1lBQ3ZCLE9BQU07UUFDUixDQUFDO1FBRUQsSUFBSSxPQUFPLFVBQVUsS0FBSyxVQUFVLEVBQUUsQ0FBQztZQUNyQyxPQUFPLFVBQVUsQ0FBQyxLQUFLLEVBQUU7Z0JBQ3ZCLE9BQU8sRUFBRSxJQUFJO2dCQUNiLE1BQU07Z0JBQ04sVUFBVTthQUNYLENBQUMsQ0FBQTtRQUNKLENBQUM7UUFFRCxLQUFLLENBQUMsS0FBSyxDQUFDLFVBQVUsQ0FBQyxDQUFBO0lBQ3pCLENBQUM7Q0FDRiIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG4vKipcbiAqIERlZmluZXMgdGhpcyB0eXBlZGVmLlxuICogQHRlbXBsYXRlIHt0eXBlb2YgaW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IFtNQz10eXBlb2YgaW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHRdXG4gKiBAdHlwZWRlZiB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+IHwgc3RyaW5nIHwgKChxdWVyeTogaW1wb3J0KFwiLi4vZGF0YWJhc2UvcXVlcnkvbW9kZWwtY2xhc3MtcXVlcnkuanNcIikuZGVmYXVsdDxNQz4sIGFyZ3M6IHthYmlsaXR5OiBWZWxvY2lvdXNBdXRob3JpemF0aW9uQWJpbGl0eSwgYWN0aW9uOiBzdHJpbmcsIG1vZGVsQ2xhc3M6IE1DfSkgPT4gdm9pZCB8IGltcG9ydChcIi4uL2RhdGFiYXNlL3F1ZXJ5L21vZGVsLWNsYXNzLXF1ZXJ5LmpzXCIpLmRlZmF1bHQ8TUM+KX0gQWJpbGl0eUNvbmRpdGlvbnNUeXBlXG4gKi9cblxuLyoqXG4gKiBBYmlsaXR5UnVsZVR5cGUgdHlwZS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IEFiaWxpdHlSdWxlVHlwZVxuICogQHByb3BlcnR5IHtzdHJpbmdbXX0gYWN0aW9ucyAtIEFjdGlvbnMgY292ZXJlZCBieSBydWxlLlxuICogQHByb3BlcnR5IHt0eXBlb2YgaW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IG1vZGVsQ2xhc3MgLSBNb2RlbCBjbGFzcy5cbiAqIEBwcm9wZXJ0eSB7QWJpbGl0eUNvbmRpdGlvbnNUeXBlIHwgdW5kZWZpbmVkfSBjb25kaXRpb25zIC0gQ29uZGl0aW9ucy5cbiAqIEBwcm9wZXJ0eSB7XCJhbGxvd1wiIHwgXCJkZW55XCJ9IGVmZmVjdCAtIFJ1bGUgZWZmZWN0LlxuICovXG5cbi8qKiBDYW5DYW4tc3R5bGUgYWJpbGl0eSBvYmplY3QgZm9yIHF1ZXJ5LWxldmVsIGFjY2VzcyBjb250cm9sLiAqL1xuZXhwb3J0IGRlZmF1bHQgY2xhc3MgVmVsb2Npb3VzQXV0aG9yaXphdGlvbkFiaWxpdHkge1xuICAvKipcbiAgICogQ3JlYXRlLlxuICAgKiBAdHlwZSB7c3RyaW5nW119ICovXG4gIHN0YXRpYyBDUkVBVEUgPSBbXCJjcmVhdGVcIl1cblxuICAvKipcbiAgICogUmVhZC5cbiAgICogQHR5cGUge3N0cmluZ1tdfSAqL1xuICBzdGF0aWMgUkVBRCA9IFtcInJlYWRcIl1cblxuICAvKipcbiAgICogVXBkYXRlLlxuICAgKiBAdHlwZSB7c3RyaW5nW119ICovXG4gIHN0YXRpYyBVUERBVEUgPSBbXCJ1cGRhdGVcIl1cblxuICAvKipcbiAgICogRGVzdHJveS5cbiAgICogQHR5cGUge3N0cmluZ1tdfSAqL1xuICBzdGF0aWMgREVTVFJPWSA9IFtcImRlc3Ryb3lcIl1cblxuICAvKipcbiAgICogQ3J1ZC5cbiAgICogQHR5cGUge3N0cmluZ1tdfSAqL1xuICBzdGF0aWMgQ1JVRCA9IFtcImNyZWF0ZVwiLCBcInJlYWRcIiwgXCJ1cGRhdGVcIiwgXCJkZXN0cm95XCJdXG5cbiAgLyoqXG4gICAqIFJ1bnMgY29uc3RydWN0b3IuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gQWJpbGl0eSBhcmdzLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gW2FyZ3MuY29udGV4dF0gLSBBYmlsaXR5IGNvbnRleHQuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBbYXJncy5sb2NhbHNdIC0gQWJpbGl0eSBsb2NhbHMuXG4gICAqIEBwYXJhbSB7QXJyYXk8dHlwZW9mIGltcG9ydChcIi4vYmFzZS1yZXNvdXJjZS5qc1wiKS5kZWZhdWx0Pn0gW2FyZ3MucmVzb3VyY2VzXSAtIFJlc291cmNlIGNsYXNzZXMuXG4gICAqL1xuICBjb25zdHJ1Y3Rvcih7Y29udGV4dCA9IHt9LCBsb2NhbHMgPSB7fSwgcmVzb3VyY2VzfSA9IHt9KSB7XG4gICAgdGhpcy5jb250ZXh0ID0gY29udGV4dFxuICAgIHRoaXMubG9jYWxzID0gbG9jYWxzXG4gICAgdGhpcy5yZXNvdXJjZXMgPSByZXNvdXJjZXMgfHwgdGhpcy5fcmVzb2x2ZVJlc291cmNlc0Zyb21Db25maWd1cmF0aW9uKClcblxuICAgIC8qKlxuICAgICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICAgKiBAdHlwZSB7QWJpbGl0eVJ1bGVUeXBlW119ICovXG4gICAgdGhpcy5ydWxlcyA9IFtdXG5cbiAgICAvKipcbiAgICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIGJvb2xlYW4+fSAqL1xuICAgIHRoaXMubG9hZGVkTW9kZWxDbGFzc0FiaWxpdGllcyA9IHt9XG4gIH1cblxuICAvKipcbiAgICogQXV0by1yZXNvbHZlcyByZXNvdXJjZSBjbGFzc2VzIGZyb20gdGhlIGNvbmZpZ3VyYXRpb24ncyBiYWNrZW5kUHJvamVjdHMgd2hlbiBubyBleHBsaWNpdCByZXNvdXJjZXMgYXJlIHByb3ZpZGVkLlxuICAgKiBAcmV0dXJucyB7QXJyYXk8dHlwZW9mIGltcG9ydChcIi4vYmFzZS1yZXNvdXJjZS5qc1wiKS5kZWZhdWx0Pn0gUmVzb2x2ZWQgcmVzb3VyY2UgY2xhc3Nlcy5cbiAgICovXG4gIF9yZXNvbHZlUmVzb3VyY2VzRnJvbUNvbmZpZ3VyYXRpb24oKSB7XG4gICAgY29uc3QgY29uZmlndXJhdGlvbiA9IHRoaXMuY29udGV4dD8uY29uZmlndXJhdGlvblxuXG4gICAgaWYgKCFjb25maWd1cmF0aW9uKSB7XG4gICAgICByZXR1cm4gW11cbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBSZXNvbHZlZC5cbiAgICAgKiBAdHlwZSB7QXJyYXk8dHlwZW9mIGltcG9ydChcIi4vYmFzZS1yZXNvdXJjZS5qc1wiKS5kZWZhdWx0Pn0gKi9cbiAgICBjb25zdCByZXNvbHZlZCA9IFtdXG4gICAgY29uc3QgYmFja2VuZFByb2plY3RzID0gY29uZmlndXJhdGlvbi5nZXRCYWNrZW5kUHJvamVjdHMoKVxuXG4gICAgZm9yIChjb25zdCBiYWNrZW5kUHJvamVjdCBvZiBiYWNrZW5kUHJvamVjdHMpIHtcbiAgICAgIGNvbnN0IGZyb250ZW5kTW9kZWxzID0gYmFja2VuZFByb2plY3QuZnJvbnRlbmRNb2RlbHNcblxuICAgICAgaWYgKCFmcm9udGVuZE1vZGVscykgY29udGludWVcblxuICAgICAgZm9yIChjb25zdCByZXNvdXJjZURlZmluaXRpb24gb2YgT2JqZWN0LnZhbHVlcyhmcm9udGVuZE1vZGVscykpIHtcbiAgICAgICAgcmVzb2x2ZWQucHVzaChyZXNvdXJjZURlZmluaXRpb24pXG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIHJlc29sdmVkXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgY29udGV4dC5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBDb250ZXh0LlxuICAgKi9cbiAgZ2V0Q29udGV4dCgpIHtcbiAgICByZXR1cm4gdGhpcy5jb250ZXh0XG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgbG9jYWxzLlxuICAgKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIExvY2Fscy5cbiAgICovXG4gIGdldExvY2FscygpIHtcbiAgICByZXR1cm4gdGhpcy5sb2NhbHNcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGN1cnJlbnQgdXNlci5cbiAgICogQHJldHVybnMge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAtIEN1cnJlbnQgdXNlciBmcm9tIGNvbnRleHQuXG4gICAqL1xuICBjdXJyZW50VXNlcigpIHtcbiAgICByZXR1cm4gdGhpcy5jb250ZXh0LmN1cnJlbnRVc2VyXG4gIH1cblxuICAvKipcbiAgICogUnVucyBjYW4uXG4gICAqIEBwYXJhbSB7c3RyaW5nIHwgc3RyaW5nW119IGFjdGlvbnMgLSBBY3Rpb24ocykuXG4gICAqIEBwYXJhbSB7dHlwZW9mIGltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBtb2RlbENsYXNzIC0gTW9kZWwgY2xhc3MuXG4gICAqIEBwYXJhbSB7QWJpbGl0eUNvbmRpdGlvbnNUeXBlfSBbY29uZGl0aW9uc10gLSBDb25kaXRpb25zLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBjYW4oYWN0aW9ucywgbW9kZWxDbGFzcywgY29uZGl0aW9ucykge1xuICAgIHRoaXMuYWRkUnVsZSh7YWN0aW9ucywgY29uZGl0aW9ucywgZWZmZWN0OiBcImFsbG93XCIsIG1vZGVsQ2xhc3N9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY2Fubm90LlxuICAgKiBAcGFyYW0ge3N0cmluZyB8IHN0cmluZ1tdfSBhY3Rpb25zIC0gQWN0aW9uKHMpLlxuICAgKiBAcGFyYW0ge3R5cGVvZiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gbW9kZWxDbGFzcyAtIE1vZGVsIGNsYXNzLlxuICAgKiBAcGFyYW0ge0FiaWxpdHlDb25kaXRpb25zVHlwZX0gW2NvbmRpdGlvbnNdIC0gQ29uZGl0aW9ucy5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgY2Fubm90KGFjdGlvbnMsIG1vZGVsQ2xhc3MsIGNvbmRpdGlvbnMpIHtcbiAgICB0aGlzLmFkZFJ1bGUoe2FjdGlvbnMsIGNvbmRpdGlvbnMsIGVmZmVjdDogXCJkZW55XCIsIG1vZGVsQ2xhc3N9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYWRkIHJ1bGUuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gUnVsZSBhcmdzLlxuICAgKiBAcGFyYW0ge3N0cmluZyB8IHN0cmluZ1tdfSBhcmdzLmFjdGlvbnMgLSBBY3Rpb24ocykuXG4gICAqIEBwYXJhbSB7QWJpbGl0eUNvbmRpdGlvbnNUeXBlfSBbYXJncy5jb25kaXRpb25zXSAtIENvbmRpdGlvbnMuXG4gICAqIEBwYXJhbSB7XCJhbGxvd1wiIHwgXCJkZW55XCJ9IGFyZ3MuZWZmZWN0IC0gRWZmZWN0LlxuICAgKiBAcGFyYW0ge3R5cGVvZiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gYXJncy5tb2RlbENsYXNzIC0gTW9kZWwgY2xhc3MuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIGFkZFJ1bGUoe2FjdGlvbnMsIGNvbmRpdGlvbnMsIGVmZmVjdCwgbW9kZWxDbGFzc30pIHtcbiAgICBjb25zdCBub3JtYWxpemVkQWN0aW9ucyA9IEFycmF5LmlzQXJyYXkoYWN0aW9ucykgPyBhY3Rpb25zIDogW2FjdGlvbnNdXG5cbiAgICB0aGlzLnJ1bGVzLnB1c2goe2FjdGlvbnM6IG5vcm1hbGl6ZWRBY3Rpb25zLCBjb25kaXRpb25zLCBlZmZlY3QsIG1vZGVsQ2xhc3N9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbG9hZCBhYmlsaXRpZXMgZm9yIG1vZGVsIGNsYXNzLlxuICAgKiBAcGFyYW0ge3R5cGVvZiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gbW9kZWxDbGFzcyAtIE1vZGVsIGNsYXNzLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBsb2FkQWJpbGl0aWVzRm9yTW9kZWxDbGFzcyhtb2RlbENsYXNzKSB7XG4gICAgY29uc3Qga2V5ID0gbW9kZWxDbGFzcy5nZXRNb2RlbE5hbWUoKVxuXG4gICAgaWYgKHRoaXMubG9hZGVkTW9kZWxDbGFzc0FiaWxpdGllc1trZXldKSByZXR1cm5cblxuICAgIHRoaXMubG9hZGVkTW9kZWxDbGFzc0FiaWxpdGllc1trZXldID0gdHJ1ZVxuXG4gICAgZm9yIChjb25zdCBSZXNvdXJjZUNsYXNzIG9mIHRoaXMucmVzb3VyY2VzKSB7XG4gICAgICBjb25zdCByZXNvdXJjZU1vZGVsQ2xhc3MgPSBSZXNvdXJjZUNsYXNzLm1vZGVsQ2xhc3MoKVxuXG4gICAgICBpZiAocmVzb3VyY2VNb2RlbENsYXNzICE9PSBtb2RlbENsYXNzKSBjb250aW51ZVxuXG4gICAgICBjb25zdCByZXNvdXJjZUluc3RhbmNlID0gbmV3IFJlc291cmNlQ2xhc3Moe1xuICAgICAgICBhYmlsaXR5OiB0aGlzLFxuICAgICAgICBjb250ZXh0OiB0aGlzLmNvbnRleHQsXG4gICAgICAgIGxvY2FsczogdGhpcy5sb2NhbHNcbiAgICAgIH0pXG5cbiAgICAgIHJlc291cmNlSW5zdGFuY2UuYWJpbGl0aWVzKClcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBhcHBseSB0byBxdWVyeS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBRdWVyeSBhcmdzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5hY3Rpb24gLSBSZXF1ZXN0ZWQgYWN0aW9uLlxuICAgKiBAcGFyYW0ge3R5cGVvZiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gYXJncy5tb2RlbENsYXNzIC0gTW9kZWwgY2xhc3MuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvcXVlcnkvbW9kZWwtY2xhc3MtcXVlcnkuanNcIikuZGVmYXVsdDx0eXBlb2YgaW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHQ+fSBhcmdzLnF1ZXJ5IC0gUXVlcnkuXG4gICAqIEBwYXJhbSB7KCkgPT4gaW1wb3J0KFwiLi4vZGF0YWJhc2UvcXVlcnkvbW9kZWwtY2xhc3MtcXVlcnkuanNcIikuZGVmYXVsdDx0eXBlb2YgaW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHQ+fSBbYXJncy5ydWxlUXVlcnlGYWN0b3J5XSAtIE9wdGlvbmFsIGZhY3RvcnkgZm9yIHRoZSBxdWVyaWVzIHRoYXQgZXZhbHVhdGUgaW5kaXZpZHVhbCBjb25kaXRpb25hbCBydWxlcy5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4uL2RhdGFiYXNlL3F1ZXJ5L21vZGVsLWNsYXNzLXF1ZXJ5LmpzXCIpLmRlZmF1bHQ8dHlwZW9mIGltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0Pn0gLSBBdXRob3JpemVkIHF1ZXJ5LlxuICAgKi9cbiAgYXBwbHlUb1F1ZXJ5KHthY3Rpb24sIG1vZGVsQ2xhc3MsIHF1ZXJ5LCBydWxlUXVlcnlGYWN0b3J5fSkge1xuICAgIHRoaXMubG9hZEFiaWxpdGllc0Zvck1vZGVsQ2xhc3MobW9kZWxDbGFzcylcblxuICAgIGNvbnN0IGFwcGxpY2FibGVSdWxlcyA9IHRoaXMucnVsZXNGb3Ioe2FjdGlvbiwgbW9kZWxDbGFzc30pXG4gICAgY29uc3QgYWxsb3dSdWxlcyA9IGFwcGxpY2FibGVSdWxlcy5maWx0ZXIoKHJ1bGUpID0+IHJ1bGUuZWZmZWN0ID09PSBcImFsbG93XCIpXG4gICAgY29uc3QgZGVueVJ1bGVzID0gYXBwbGljYWJsZVJ1bGVzLmZpbHRlcigocnVsZSkgPT4gcnVsZS5lZmZlY3QgPT09IFwiZGVueVwiKVxuXG4gICAgaWYgKGFsbG93UnVsZXMubGVuZ3RoID09PSAwKSB7XG4gICAgICByZXR1cm4gcXVlcnkud2hlcmUoXCIxPTBcIilcbiAgICB9XG5cbiAgICBpZiAoYWxsb3dSdWxlcy5zb21lKChydWxlKSA9PiAhcnVsZS5jb25kaXRpb25zKSkge1xuICAgICAgdGhpcy5hcHBseURlbnlSdWxlcyh7YWN0aW9uLCBkZW55UnVsZXMsIG1vZGVsQ2xhc3MsIHF1ZXJ5LCBydWxlUXVlcnlGYWN0b3J5fSlcbiAgICAgIHJldHVybiBxdWVyeVxuICAgIH1cblxuICAgIGNvbnN0IGFsbG93U3FsUGFydHMgPSB0aGlzLmNvbmRpdGlvblNxbFBhcnRzKHthY3Rpb24sIG1vZGVsQ2xhc3MsIHF1ZXJ5LCBydWxlUXVlcnlGYWN0b3J5LCBydWxlczogYWxsb3dSdWxlc30pXG5cbiAgICBpZiAoYWxsb3dTcWxQYXJ0cy5sZW5ndGggPT09IDApIHtcbiAgICAgIHJldHVybiBxdWVyeS53aGVyZShcIjE9MFwiKVxuICAgIH1cblxuICAgIHF1ZXJ5LndoZXJlKGAoJHthbGxvd1NxbFBhcnRzLmpvaW4oXCIgT1IgXCIpfSlgKVxuICAgIHRoaXMuYXBwbHlEZW55UnVsZXMoe2FjdGlvbiwgZGVueVJ1bGVzLCBtb2RlbENsYXNzLCBxdWVyeSwgcnVsZVF1ZXJ5RmFjdG9yeX0pXG5cbiAgICByZXR1cm4gcXVlcnlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJ1bGVzIGZvci5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBSdWxlIGxvb2t1cCBhcmdzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5hY3Rpb24gLSBBY3Rpb24uXG4gICAqIEBwYXJhbSB7dHlwZW9mIGltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBhcmdzLm1vZGVsQ2xhc3MgLSBNb2RlbCBjbGFzcy5cbiAgICogQHJldHVybnMge0FiaWxpdHlSdWxlVHlwZVtdfSAtIE1hdGNoaW5nIHJ1bGVzLlxuICAgKi9cbiAgcnVsZXNGb3Ioe2FjdGlvbiwgbW9kZWxDbGFzc30pIHtcbiAgICByZXR1cm4gdGhpcy5ydWxlcy5maWx0ZXIoKHJ1bGUpID0+IHtcbiAgICAgIGlmIChydWxlLm1vZGVsQ2xhc3MgIT09IG1vZGVsQ2xhc3MpIHJldHVybiBmYWxzZVxuXG4gICAgICByZXR1cm4gcnVsZS5hY3Rpb25zLmluY2x1ZGVzKGFjdGlvbikgfHwgcnVsZS5hY3Rpb25zLmluY2x1ZGVzKFwibWFuYWdlXCIpXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNvbmRpdGlvbiBzcWwgcGFydHMuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gU1FMIGFyZ3MuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmFjdGlvbiAtIEFjdGlvbi5cbiAgICogQHBhcmFtIHt0eXBlb2YgaW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IGFyZ3MubW9kZWxDbGFzcyAtIE1vZGVsIGNsYXNzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL3F1ZXJ5L21vZGVsLWNsYXNzLXF1ZXJ5LmpzXCIpLmRlZmF1bHQ8dHlwZW9mIGltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0Pn0gYXJncy5xdWVyeSAtIEJhc2UgcXVlcnkuXG4gICAqIEBwYXJhbSB7KCkgPT4gaW1wb3J0KFwiLi4vZGF0YWJhc2UvcXVlcnkvbW9kZWwtY2xhc3MtcXVlcnkuanNcIikuZGVmYXVsdDx0eXBlb2YgaW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHQ+fSBbYXJncy5ydWxlUXVlcnlGYWN0b3J5XSAtIE9wdGlvbmFsIGNvbmRpdGlvbmFsLXJ1bGUgcXVlcnkgZmFjdG9yeS5cbiAgICogQHBhcmFtIHtBYmlsaXR5UnVsZVR5cGVbXX0gYXJncy5ydWxlcyAtIFJ1bGVzLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nW119IC0gU1FMIGNvbmRpdGlvbiBwYXJ0cy5cbiAgICovXG4gIGNvbmRpdGlvblNxbFBhcnRzKHthY3Rpb24sIG1vZGVsQ2xhc3MsIHF1ZXJ5LCBydWxlUXVlcnlGYWN0b3J5LCBydWxlc30pIHtcbiAgICBjb25zdCBwcmltYXJ5S2V5ID0gbW9kZWxDbGFzcy5wcmltYXJ5S2V5KClcbiAgICBjb25zdCBwcmltYXJ5S2V5QXR0cmlidXRlcyA9IEFycmF5LmlzQXJyYXkocHJpbWFyeUtleSkgPyBwcmltYXJ5S2V5IDogW3ByaW1hcnlLZXldXG4gICAgY29uc3QgcXVvdGVkQmFzZVRhYmxlID0gcXVlcnkuZHJpdmVyLnF1b3RlVGFibGUocXVlcnkuZ2V0VGFibGVSZWZlcmVuY2VGb3JKb2luKCkpXG4gICAgY29uc3Qgc3FsUGFydHMgPSBbXVxuXG4gICAgZm9yIChjb25zdCBydWxlIG9mIHJ1bGVzKSB7XG4gICAgICBpZiAoIXJ1bGUuY29uZGl0aW9ucykgY29udGludWVcblxuICAgICAgY29uc3Qgc2NvcGVkUXVlcnkgPSBydWxlUXVlcnlGYWN0b3J5ID8gcnVsZVF1ZXJ5RmFjdG9yeSgpIDogbW9kZWxDbGFzcy5fbmV3UXVlcnkoKVxuICAgICAgY29uc3QgcmVzdWx0UXVlcnkgPSB0aGlzLmFwcGx5UnVsZUNvbmRpdGlvbih7XG4gICAgICAgIGFjdGlvbixcbiAgICAgICAgY29uZGl0aW9uczogcnVsZS5jb25kaXRpb25zLFxuICAgICAgICBtb2RlbENsYXNzLFxuICAgICAgICBxdWVyeTogc2NvcGVkUXVlcnlcbiAgICAgIH0pXG4gICAgICBjb25zdCBmaW5hbFF1ZXJ5ID0gcmVzdWx0UXVlcnkgfHwgc2NvcGVkUXVlcnlcblxuICAgICAgaWYgKHJ1bGVRdWVyeUZhY3RvcnkgJiYgZmluYWxRdWVyeSAhPT0gc2NvcGVkUXVlcnkpIHtcbiAgICAgICAgY29uc3QgZmluYWxGcm9tcyA9IGZpbmFsUXVlcnkuZ2V0RnJvbXMoKVxuXG4gICAgICAgIGZpbmFsRnJvbXMuc3BsaWNlKDAsIGZpbmFsRnJvbXMubGVuZ3RoLCAuLi5zY29wZWRRdWVyeS5nZXRGcm9tcygpKVxuICAgICAgfVxuXG4gICAgICBjb25zdCBxdW90ZWRTY29wZWRUYWJsZSA9IHF1ZXJ5LmRyaXZlci5xdW90ZVRhYmxlKGZpbmFsUXVlcnkuZ2V0VGFibGVSZWZlcmVuY2VGb3JKb2luKCkpXG4gICAgICBjb25zdCBwcmltYXJ5S2V5Q29sdW1ucyA9IHByaW1hcnlLZXlBdHRyaWJ1dGVzLm1hcCgoYXR0cmlidXRlTmFtZSkgPT4gbW9kZWxDbGFzcy5nZXRDb2x1bW5OYW1lRm9yQXR0cmlidXRlTmFtZShhdHRyaWJ1dGVOYW1lKSlcbiAgICAgIGNvbnN0IHNlbGVjdGVkUGtTcWwgPSBwcmltYXJ5S2V5Q29sdW1ucy5tYXAoKGNvbHVtbk5hbWUpID0+IGAke3F1b3RlZFNjb3BlZFRhYmxlfS4ke3F1ZXJ5LmRyaXZlci5xdW90ZUNvbHVtbihjb2x1bW5OYW1lKX1gKVxuXG4gICAgICBpZiAoZmluYWxRdWVyeS5fZGlzdGluY3QpIHtcbiAgICAgICAgcXVlcnkuZGlzdGluY3QodHJ1ZSlcbiAgICAgIH1cblxuICAgICAgZmluYWxRdWVyeS5zZWxlY3Qoc2VsZWN0ZWRQa1NxbClcblxuICAgICAgaWYgKEFycmF5LmlzQXJyYXkocHJpbWFyeUtleSkpIHtcbiAgICAgICAgY29uc3QgYXV0aG9yaXplZFJvd3NBbGlhcyA9IHF1ZXJ5LmRyaXZlci5xdW90ZVRhYmxlKFwidmVsb2Npb3VzX2F1dGhvcml6ZWRfcm93c1wiKVxuICAgICAgICBjb25zdCBpZGVudGl0eVNxbCA9IHByaW1hcnlLZXlDb2x1bW5zLm1hcCgoY29sdW1uTmFtZSkgPT4ge1xuICAgICAgICAgIGNvbnN0IHF1b3RlZENvbHVtbiA9IHF1ZXJ5LmRyaXZlci5xdW90ZUNvbHVtbihjb2x1bW5OYW1lKVxuXG4gICAgICAgICAgcmV0dXJuIGAke2F1dGhvcml6ZWRSb3dzQWxpYXN9LiR7cXVvdGVkQ29sdW1ufSA9ICR7cXVvdGVkQmFzZVRhYmxlfS4ke3F1b3RlZENvbHVtbn1gXG4gICAgICAgIH0pLmpvaW4oXCIgQU5EIFwiKVxuXG4gICAgICAgIHNxbFBhcnRzLnB1c2goYEVYSVNUUyAoU0VMRUNUIDEgRlJPTSAoJHtmaW5hbFF1ZXJ5LnRvU3FsKCl9KSBBUyAke2F1dGhvcml6ZWRSb3dzQWxpYXN9IFdIRVJFICR7aWRlbnRpdHlTcWx9KWApXG4gICAgICB9IGVsc2Uge1xuICAgICAgICBzcWxQYXJ0cy5wdXNoKGAke3F1b3RlZEJhc2VUYWJsZX0uJHtxdWVyeS5kcml2ZXIucXVvdGVDb2x1bW4ocHJpbWFyeUtleUNvbHVtbnNbMF0pfSBJTiAoJHtmaW5hbFF1ZXJ5LnRvU3FsKCl9KWApXG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIHNxbFBhcnRzXG4gIH1cblxuICAvKipcbiAgICogUnVucyBhcHBseSBkZW55IHJ1bGVzLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIERlbnkgYXJncy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MuYWN0aW9uIC0gQWN0aW9uLlxuICAgKiBAcGFyYW0ge0FiaWxpdHlSdWxlVHlwZVtdfSBhcmdzLmRlbnlSdWxlcyAtIERlbnkgcnVsZXMuXG4gICAqIEBwYXJhbSB7dHlwZW9mIGltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBhcmdzLm1vZGVsQ2xhc3MgLSBNb2RlbCBjbGFzcy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9xdWVyeS9tb2RlbC1jbGFzcy1xdWVyeS5qc1wiKS5kZWZhdWx0PHR5cGVvZiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdD59IGFyZ3MucXVlcnkgLSBRdWVyeS5cbiAgICogQHBhcmFtIHsoKSA9PiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9xdWVyeS9tb2RlbC1jbGFzcy1xdWVyeS5qc1wiKS5kZWZhdWx0PHR5cGVvZiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdD59IFthcmdzLnJ1bGVRdWVyeUZhY3RvcnldIC0gT3B0aW9uYWwgY29uZGl0aW9uYWwtcnVsZSBxdWVyeSBmYWN0b3J5LlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBhcHBseURlbnlSdWxlcyh7YWN0aW9uLCBkZW55UnVsZXMsIG1vZGVsQ2xhc3MsIHF1ZXJ5LCBydWxlUXVlcnlGYWN0b3J5fSkge1xuICAgIGlmIChkZW55UnVsZXMubGVuZ3RoID09PSAwKSByZXR1cm5cblxuICAgIGlmIChkZW55UnVsZXMuc29tZSgocnVsZSkgPT4gIXJ1bGUuY29uZGl0aW9ucykpIHtcbiAgICAgIHF1ZXJ5LndoZXJlKFwiMT0wXCIpXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBjb25zdCBkZW55U3FsUGFydHMgPSB0aGlzLmNvbmRpdGlvblNxbFBhcnRzKHthY3Rpb24sIG1vZGVsQ2xhc3MsIHF1ZXJ5LCBydWxlUXVlcnlGYWN0b3J5LCBydWxlczogZGVueVJ1bGVzfSlcblxuICAgIGlmIChkZW55U3FsUGFydHMubGVuZ3RoID4gMCkge1xuICAgICAgcXVlcnkud2hlcmUoYE5PVCAoJHtkZW55U3FsUGFydHMuam9pbihcIiBPUiBcIil9KWApXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYXBwbHkgcnVsZSBjb25kaXRpb24uXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gQ29uZGl0aW9uIGFyZ3MuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmFjdGlvbiAtIEFjdGlvbi5cbiAgICogQHBhcmFtIHtBYmlsaXR5Q29uZGl0aW9uc1R5cGV9IGFyZ3MuY29uZGl0aW9ucyAtIFJ1bGUgY29uZGl0aW9ucy5cbiAgICogQHBhcmFtIHt0eXBlb2YgaW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IGFyZ3MubW9kZWxDbGFzcyAtIE1vZGVsIGNsYXNzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL3F1ZXJ5L21vZGVsLWNsYXNzLXF1ZXJ5LmpzXCIpLmRlZmF1bHQ8dHlwZW9mIGltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0Pn0gYXJncy5xdWVyeSAtIFF1ZXJ5LlxuICAgKiBAcmV0dXJucyB7dm9pZCB8IGltcG9ydChcIi4uL2RhdGFiYXNlL3F1ZXJ5L21vZGVsLWNsYXNzLXF1ZXJ5LmpzXCIpLmRlZmF1bHQ8dHlwZW9mIGltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0Pn0gLSBPcHRpb25hbCByZXBsYWNlbWVudCBxdWVyeS5cbiAgICovXG4gIGFwcGx5UnVsZUNvbmRpdGlvbih7YWN0aW9uLCBjb25kaXRpb25zLCBtb2RlbENsYXNzLCBxdWVyeX0pIHtcbiAgICBpZiAodHlwZW9mIGNvbmRpdGlvbnMgPT09IFwic3RyaW5nXCIpIHtcbiAgICAgIHF1ZXJ5LndoZXJlKGNvbmRpdGlvbnMpXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBpZiAodHlwZW9mIGNvbmRpdGlvbnMgPT09IFwiZnVuY3Rpb25cIikge1xuICAgICAgcmV0dXJuIGNvbmRpdGlvbnMocXVlcnksIHtcbiAgICAgICAgYWJpbGl0eTogdGhpcyxcbiAgICAgICAgYWN0aW9uLFxuICAgICAgICBtb2RlbENsYXNzXG4gICAgICB9KVxuICAgIH1cblxuICAgIHF1ZXJ5LndoZXJlKGNvbmRpdGlvbnMpXG4gIH1cbn1cbiJdfQ==