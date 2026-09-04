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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYWJpbGl0eS5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9hdXRob3JpemF0aW9uL2FiaWxpdHkuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaOzs7O0dBSUc7QUFFSDs7Ozs7OztHQU9HO0FBRUgsa0VBQWtFO0FBQ2xFLE1BQU0sQ0FBQyxPQUFPLE9BQU8sNkJBQTZCO0lBQ2hEOzswQkFFc0I7SUFDdEIsTUFBTSxDQUFDLE1BQU0sR0FBRyxDQUFDLFFBQVEsQ0FBQyxDQUFBO0lBRTFCOzswQkFFc0I7SUFDdEIsTUFBTSxDQUFDLElBQUksR0FBRyxDQUFDLE1BQU0sQ0FBQyxDQUFBO0lBRXRCOzswQkFFc0I7SUFDdEIsTUFBTSxDQUFDLE1BQU0sR0FBRyxDQUFDLFFBQVEsQ0FBQyxDQUFBO0lBRTFCOzswQkFFc0I7SUFDdEIsTUFBTSxDQUFDLE9BQU8sR0FBRyxDQUFDLFNBQVMsQ0FBQyxDQUFBO0lBRTVCOzswQkFFc0I7SUFDdEIsTUFBTSxDQUFDLElBQUksR0FBRyxDQUFDLFFBQVEsRUFBRSxNQUFNLEVBQUUsUUFBUSxFQUFFLFNBQVMsQ0FBQyxDQUFBO0lBRXJEOzs7Ozs7T0FNRztJQUNILFlBQVksRUFBQyxPQUFPLEdBQUcsRUFBRSxFQUFFLE1BQU0sR0FBRyxFQUFFLEVBQUUsU0FBUyxFQUFDLEdBQUcsRUFBRTtRQUNyRCxJQUFJLENBQUMsT0FBTyxHQUFHLE9BQU8sQ0FBQTtRQUN0QixJQUFJLENBQUMsTUFBTSxHQUFHLE1BQU0sQ0FBQTtRQUNwQixJQUFJLENBQUMsU0FBUyxHQUFHLFNBQVMsSUFBSSxJQUFJLENBQUMsa0NBQWtDLEVBQUUsQ0FBQTtRQUV2RTs7dUNBRStCO1FBQy9CLElBQUksQ0FBQyxLQUFLLEdBQUcsRUFBRSxDQUFBO1FBRWY7OzZDQUVxQztRQUNyQyxJQUFJLENBQUMseUJBQXlCLEdBQUcsRUFBRSxDQUFBO0lBQ3JDLENBQUM7SUFFRDs7O09BR0c7SUFDSCxrQ0FBa0M7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WUFBWSxHQUFHLElBQUksQ0FBQyxpQkFBaUIsQ0FBQyxFQUFDLE1BQU0sRUFBRSxVQUFVLEVBQUUsS0FBSyxFQUFFLGdCQUFnQixFQUFFLEtBQUssRUFBRSxTQUFTLEVBQUMsQ0FBQyxDQUFBO1FBRTVHLElBQUksWUFBWSxDQUFDLE1BQU0sR0FBRyxDQUFDLEVBQUUsQ0FBQztZQUM1QixLQUFLLENBQUMsS0FBSyxDQUFDLFFBQVEsWUFBWSxDQUFDLElBQUksQ0FBQyxNQUFNLENBQUMsR0FBRyxDQUFDLENBQUE7UUFDbkQsQ0FBQztJQUNILENBQUM7SUFFRDs7Ozs7Ozs7T0FRRztJQUNILGtCQUFrQixDQUFDLEVBQUMsTUFBTSxFQUFFLFVBQVUsRUFBRSxVQUFVLEVBQUUsS0FBSyxFQUFDO1FBQ3hELElBQUksT0FBTyxVQUFVLEtBQUssUUFBUSxFQUFFLENBQUM7WUFDbkMsS0FBSyxDQUFDLEtBQUssQ0FBQyxVQUFVLENBQUMsQ0FBQTtZQUN2QixPQUFNO1FBQ1IsQ0FBQztRQUVELElBQUksT0FBTyxVQUFVLEtBQUssVUFBVSxFQUFFLENBQUM7WUFDckMsT0FBTyxVQUFVLENBQUMsS0FBSyxFQUFFO2dCQUN2QixPQUFPLEVBQUUsSUFBSTtnQkFDYixNQUFNO2dCQUNOLFVBQVU7YUFDWCxDQUFDLENBQUE7UUFDSixDQUFDO1FBRUQsS0FBSyxDQUFDLEtBQUssQ0FBQyxVQUFVLENBQUMsQ0FBQTtJQUN6QixDQUFDO0NBQ0YiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuLyoqXG4gKiBEZWZpbmVzIHRoaXMgdHlwZWRlZi5cbiAqIEB0ZW1wbGF0ZSB7dHlwZW9mIGltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBbTUM9dHlwZW9mIGltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0XVxuICogQHR5cGVkZWYge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiB8IHN0cmluZyB8ICgocXVlcnk6IGltcG9ydChcIi4uL2RhdGFiYXNlL3F1ZXJ5L21vZGVsLWNsYXNzLXF1ZXJ5LmpzXCIpLmRlZmF1bHQ8TUM+LCBhcmdzOiB7YWJpbGl0eTogVmVsb2Npb3VzQXV0aG9yaXphdGlvbkFiaWxpdHksIGFjdGlvbjogc3RyaW5nLCBtb2RlbENsYXNzOiBNQ30pID0+IHZvaWQgfCBpbXBvcnQoXCIuLi9kYXRhYmFzZS9xdWVyeS9tb2RlbC1jbGFzcy1xdWVyeS5qc1wiKS5kZWZhdWx0PE1DPil9IEFiaWxpdHlDb25kaXRpb25zVHlwZVxuICovXG5cbi8qKlxuICogQWJpbGl0eVJ1bGVUeXBlIHR5cGUuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBBYmlsaXR5UnVsZVR5cGVcbiAqIEBwcm9wZXJ0eSB7c3RyaW5nW119IGFjdGlvbnMgLSBBY3Rpb25zIGNvdmVyZWQgYnkgcnVsZS5cbiAqIEBwcm9wZXJ0eSB7dHlwZW9mIGltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBtb2RlbENsYXNzIC0gTW9kZWwgY2xhc3MuXG4gKiBAcHJvcGVydHkge0FiaWxpdHlDb25kaXRpb25zVHlwZSB8IHVuZGVmaW5lZH0gY29uZGl0aW9ucyAtIENvbmRpdGlvbnMuXG4gKiBAcHJvcGVydHkge1wiYWxsb3dcIiB8IFwiZGVueVwifSBlZmZlY3QgLSBSdWxlIGVmZmVjdC5cbiAqL1xuXG4vKiogQ2FuQ2FuLXN0eWxlIGFiaWxpdHkgb2JqZWN0IGZvciBxdWVyeS1sZXZlbCBhY2Nlc3MgY29udHJvbC4gKi9cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIFZlbG9jaW91c0F1dGhvcml6YXRpb25BYmlsaXR5IHtcbiAgLyoqXG4gICAqIENyZWF0ZS5cbiAgICogQHR5cGUge3N0cmluZ1tdfSAqL1xuICBzdGF0aWMgQ1JFQVRFID0gW1wiY3JlYXRlXCJdXG5cbiAgLyoqXG4gICAqIFJlYWQuXG4gICAqIEB0eXBlIHtzdHJpbmdbXX0gKi9cbiAgc3RhdGljIFJFQUQgPSBbXCJyZWFkXCJdXG5cbiAgLyoqXG4gICAqIFVwZGF0ZS5cbiAgICogQHR5cGUge3N0cmluZ1tdfSAqL1xuICBzdGF0aWMgVVBEQVRFID0gW1widXBkYXRlXCJdXG5cbiAgLyoqXG4gICAqIERlc3Ryb3kuXG4gICAqIEB0eXBlIHtzdHJpbmdbXX0gKi9cbiAgc3RhdGljIERFU1RST1kgPSBbXCJkZXN0cm95XCJdXG5cbiAgLyoqXG4gICAqIENydWQuXG4gICAqIEB0eXBlIHtzdHJpbmdbXX0gKi9cbiAgc3RhdGljIENSVUQgPSBbXCJjcmVhdGVcIiwgXCJyZWFkXCIsIFwidXBkYXRlXCIsIFwiZGVzdHJveVwiXVxuXG4gIC8qKlxuICAgKiBSdW5zIGNvbnN0cnVjdG9yLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEFiaWxpdHkgYXJncy5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IFthcmdzLmNvbnRleHRdIC0gQWJpbGl0eSBjb250ZXh0LlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gW2FyZ3MubG9jYWxzXSAtIEFiaWxpdHkgbG9jYWxzLlxuICAgKiBAcGFyYW0ge0FycmF5PHR5cGVvZiBpbXBvcnQoXCIuL2Jhc2UtcmVzb3VyY2UuanNcIikuZGVmYXVsdD59IFthcmdzLnJlc291cmNlc10gLSBSZXNvdXJjZSBjbGFzc2VzLlxuICAgKi9cbiAgY29uc3RydWN0b3Ioe2NvbnRleHQgPSB7fSwgbG9jYWxzID0ge30sIHJlc291cmNlc30gPSB7fSkge1xuICAgIHRoaXMuY29udGV4dCA9IGNvbnRleHRcbiAgICB0aGlzLmxvY2FscyA9IGxvY2Fsc1xuICAgIHRoaXMucmVzb3VyY2VzID0gcmVzb3VyY2VzIHx8IHRoaXMuX3Jlc29sdmVSZXNvdXJjZXNGcm9tQ29uZmlndXJhdGlvbigpXG5cbiAgICAvKipcbiAgICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAgICogQHR5cGUge0FiaWxpdHlSdWxlVHlwZVtdfSAqL1xuICAgIHRoaXMucnVsZXMgPSBbXVxuXG4gICAgLyoqXG4gICAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBib29sZWFuPn0gKi9cbiAgICB0aGlzLmxvYWRlZE1vZGVsQ2xhc3NBYmlsaXRpZXMgPSB7fVxuICB9XG5cbiAgLyoqXG4gICAqIEF1dG8tcmVzb2x2ZXMgcmVzb3VyY2UgY2xhc3NlcyBmcm9tIHRoZSBjb25maWd1cmF0aW9uJ3MgYmFja2VuZFByb2plY3RzIHdoZW4gbm8gZXhwbGljaXQgcmVzb3VyY2VzIGFyZSBwcm92aWRlZC5cbiAgICogQHJldHVybnMge0FycmF5PHR5cGVvZiBpbXBvcnQoXCIuL2Jhc2UtcmVzb3VyY2UuanNcIikuZGVmYXVsdD59IFJlc29sdmVkIHJlc291cmNlIGNsYXNzZXMuXG4gICAqL1xuICBfcmVzb2x2ZVJlc291cmNlc0Zyb21Db25maWd1cmF0aW9uKCkge1xuICAgIGNvbnN0IGNvbmZpZ3VyYXRpb24gPSB0aGlzLmNvbnRleHQ/LmNvbmZpZ3VyYXRpb25cblxuICAgIGlmICghY29uZmlndXJhdGlvbikge1xuICAgICAgcmV0dXJuIFtdXG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogUmVzb2x2ZWQuXG4gICAgICogQHR5cGUge0FycmF5PHR5cGVvZiBpbXBvcnQoXCIuL2Jhc2UtcmVzb3VyY2UuanNcIikuZGVmYXVsdD59ICovXG4gICAgY29uc3QgcmVzb2x2ZWQgPSBbXVxuICAgIGNvbnN0IGJhY2tlbmRQcm9qZWN0cyA9IGNvbmZpZ3VyYXRpb24uZ2V0QmFja2VuZFByb2plY3RzKClcblxuICAgIGZvciAoY29uc3QgYmFja2VuZFByb2plY3Qgb2YgYmFja2VuZFByb2plY3RzKSB7XG4gICAgICBjb25zdCBmcm9udGVuZE1vZGVscyA9IGJhY2tlbmRQcm9qZWN0LmZyb250ZW5kTW9kZWxzXG5cbiAgICAgIGlmICghZnJvbnRlbmRNb2RlbHMpIGNvbnRpbnVlXG5cbiAgICAgIGZvciAoY29uc3QgcmVzb3VyY2VEZWZpbml0aW9uIG9mIE9iamVjdC52YWx1ZXMoZnJvbnRlbmRNb2RlbHMpKSB7XG4gICAgICAgIHJlc29sdmVkLnB1c2gocmVzb3VyY2VEZWZpbml0aW9uKVxuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiByZXNvbHZlZFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGNvbnRleHQuXG4gICAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gQ29udGV4dC5cbiAgICovXG4gIGdldENvbnRleHQoKSB7XG4gICAgcmV0dXJuIHRoaXMuY29udGV4dFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGxvY2Fscy5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBMb2NhbHMuXG4gICAqL1xuICBnZXRMb2NhbHMoKSB7XG4gICAgcmV0dXJuIHRoaXMubG9jYWxzXG4gIH1cblxuICAvKipcbiAgICogUnVucyBjdXJyZW50IHVzZXIuXG4gICAqIEByZXR1cm5zIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gLSBDdXJyZW50IHVzZXIgZnJvbSBjb250ZXh0LlxuICAgKi9cbiAgY3VycmVudFVzZXIoKSB7XG4gICAgcmV0dXJuIHRoaXMuY29udGV4dC5jdXJyZW50VXNlclxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY2FuLlxuICAgKiBAcGFyYW0ge3N0cmluZyB8IHN0cmluZ1tdfSBhY3Rpb25zIC0gQWN0aW9uKHMpLlxuICAgKiBAcGFyYW0ge3R5cGVvZiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gbW9kZWxDbGFzcyAtIE1vZGVsIGNsYXNzLlxuICAgKiBAcGFyYW0ge0FiaWxpdHlDb25kaXRpb25zVHlwZX0gW2NvbmRpdGlvbnNdIC0gQ29uZGl0aW9ucy5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgY2FuKGFjdGlvbnMsIG1vZGVsQ2xhc3MsIGNvbmRpdGlvbnMpIHtcbiAgICB0aGlzLmFkZFJ1bGUoe2FjdGlvbnMsIGNvbmRpdGlvbnMsIGVmZmVjdDogXCJhbGxvd1wiLCBtb2RlbENsYXNzfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNhbm5vdC5cbiAgICogQHBhcmFtIHtzdHJpbmcgfCBzdHJpbmdbXX0gYWN0aW9ucyAtIEFjdGlvbihzKS5cbiAgICogQHBhcmFtIHt0eXBlb2YgaW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IG1vZGVsQ2xhc3MgLSBNb2RlbCBjbGFzcy5cbiAgICogQHBhcmFtIHtBYmlsaXR5Q29uZGl0aW9uc1R5cGV9IFtjb25kaXRpb25zXSAtIENvbmRpdGlvbnMuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIGNhbm5vdChhY3Rpb25zLCBtb2RlbENsYXNzLCBjb25kaXRpb25zKSB7XG4gICAgdGhpcy5hZGRSdWxlKHthY3Rpb25zLCBjb25kaXRpb25zLCBlZmZlY3Q6IFwiZGVueVwiLCBtb2RlbENsYXNzfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGFkZCBydWxlLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIFJ1bGUgYXJncy5cbiAgICogQHBhcmFtIHtzdHJpbmcgfCBzdHJpbmdbXX0gYXJncy5hY3Rpb25zIC0gQWN0aW9uKHMpLlxuICAgKiBAcGFyYW0ge0FiaWxpdHlDb25kaXRpb25zVHlwZX0gW2FyZ3MuY29uZGl0aW9uc10gLSBDb25kaXRpb25zLlxuICAgKiBAcGFyYW0ge1wiYWxsb3dcIiB8IFwiZGVueVwifSBhcmdzLmVmZmVjdCAtIEVmZmVjdC5cbiAgICogQHBhcmFtIHt0eXBlb2YgaW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IGFyZ3MubW9kZWxDbGFzcyAtIE1vZGVsIGNsYXNzLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBhZGRSdWxlKHthY3Rpb25zLCBjb25kaXRpb25zLCBlZmZlY3QsIG1vZGVsQ2xhc3N9KSB7XG4gICAgY29uc3Qgbm9ybWFsaXplZEFjdGlvbnMgPSBBcnJheS5pc0FycmF5KGFjdGlvbnMpID8gYWN0aW9ucyA6IFthY3Rpb25zXVxuXG4gICAgdGhpcy5ydWxlcy5wdXNoKHthY3Rpb25zOiBub3JtYWxpemVkQWN0aW9ucywgY29uZGl0aW9ucywgZWZmZWN0LCBtb2RlbENsYXNzfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGxvYWQgYWJpbGl0aWVzIGZvciBtb2RlbCBjbGFzcy5cbiAgICogQHBhcmFtIHt0eXBlb2YgaW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IG1vZGVsQ2xhc3MgLSBNb2RlbCBjbGFzcy5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgbG9hZEFiaWxpdGllc0Zvck1vZGVsQ2xhc3MobW9kZWxDbGFzcykge1xuICAgIGNvbnN0IGtleSA9IG1vZGVsQ2xhc3MuZ2V0TW9kZWxOYW1lKClcblxuICAgIGlmICh0aGlzLmxvYWRlZE1vZGVsQ2xhc3NBYmlsaXRpZXNba2V5XSkgcmV0dXJuXG5cbiAgICB0aGlzLmxvYWRlZE1vZGVsQ2xhc3NBYmlsaXRpZXNba2V5XSA9IHRydWVcblxuICAgIGZvciAoY29uc3QgUmVzb3VyY2VDbGFzcyBvZiB0aGlzLnJlc291cmNlcykge1xuICAgICAgY29uc3QgcmVzb3VyY2VNb2RlbENsYXNzID0gUmVzb3VyY2VDbGFzcy5tb2RlbENsYXNzKClcblxuICAgICAgaWYgKHJlc291cmNlTW9kZWxDbGFzcyAhPT0gbW9kZWxDbGFzcykgY29udGludWVcblxuICAgICAgY29uc3QgcmVzb3VyY2VJbnN0YW5jZSA9IG5ldyBSZXNvdXJjZUNsYXNzKHtcbiAgICAgICAgYWJpbGl0eTogdGhpcyxcbiAgICAgICAgY29udGV4dDogdGhpcy5jb250ZXh0LFxuICAgICAgICBsb2NhbHM6IHRoaXMubG9jYWxzXG4gICAgICB9KVxuXG4gICAgICByZXNvdXJjZUluc3RhbmNlLmFiaWxpdGllcygpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYXBwbHkgdG8gcXVlcnkuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gUXVlcnkgYXJncy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MuYWN0aW9uIC0gUmVxdWVzdGVkIGFjdGlvbi5cbiAgICogQHBhcmFtIHt0eXBlb2YgaW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IGFyZ3MubW9kZWxDbGFzcyAtIE1vZGVsIGNsYXNzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL3F1ZXJ5L21vZGVsLWNsYXNzLXF1ZXJ5LmpzXCIpLmRlZmF1bHQ8dHlwZW9mIGltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0Pn0gYXJncy5xdWVyeSAtIFF1ZXJ5LlxuICAgKiBAcGFyYW0geygpID0+IGltcG9ydChcIi4uL2RhdGFiYXNlL3F1ZXJ5L21vZGVsLWNsYXNzLXF1ZXJ5LmpzXCIpLmRlZmF1bHQ8dHlwZW9mIGltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0Pn0gW2FyZ3MucnVsZVF1ZXJ5RmFjdG9yeV0gLSBPcHRpb25hbCBmYWN0b3J5IGZvciB0aGUgcXVlcmllcyB0aGF0IGV2YWx1YXRlIGluZGl2aWR1YWwgY29uZGl0aW9uYWwgcnVsZXMuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9xdWVyeS9tb2RlbC1jbGFzcy1xdWVyeS5qc1wiKS5kZWZhdWx0PHR5cGVvZiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdD59IC0gQXV0aG9yaXplZCBxdWVyeS5cbiAgICovXG4gIGFwcGx5VG9RdWVyeSh7YWN0aW9uLCBtb2RlbENsYXNzLCBxdWVyeSwgcnVsZVF1ZXJ5RmFjdG9yeX0pIHtcbiAgICB0aGlzLmxvYWRBYmlsaXRpZXNGb3JNb2RlbENsYXNzKG1vZGVsQ2xhc3MpXG5cbiAgICBjb25zdCBhcHBsaWNhYmxlUnVsZXMgPSB0aGlzLnJ1bGVzRm9yKHthY3Rpb24sIG1vZGVsQ2xhc3N9KVxuICAgIGNvbnN0IGFsbG93UnVsZXMgPSBhcHBsaWNhYmxlUnVsZXMuZmlsdGVyKChydWxlKSA9PiBydWxlLmVmZmVjdCA9PT0gXCJhbGxvd1wiKVxuICAgIGNvbnN0IGRlbnlSdWxlcyA9IGFwcGxpY2FibGVSdWxlcy5maWx0ZXIoKHJ1bGUpID0+IHJ1bGUuZWZmZWN0ID09PSBcImRlbnlcIilcblxuICAgIGlmIChhbGxvd1J1bGVzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgcmV0dXJuIHF1ZXJ5LndoZXJlKFwiMT0wXCIpXG4gICAgfVxuXG4gICAgaWYgKGFsbG93UnVsZXMuc29tZSgocnVsZSkgPT4gIXJ1bGUuY29uZGl0aW9ucykpIHtcbiAgICAgIHRoaXMuYXBwbHlEZW55UnVsZXMoe2FjdGlvbiwgZGVueVJ1bGVzLCBtb2RlbENsYXNzLCBxdWVyeSwgcnVsZVF1ZXJ5RmFjdG9yeX0pXG4gICAgICByZXR1cm4gcXVlcnlcbiAgICB9XG5cbiAgICBjb25zdCBhbGxvd1NxbFBhcnRzID0gdGhpcy5jb25kaXRpb25TcWxQYXJ0cyh7YWN0aW9uLCBtb2RlbENsYXNzLCBxdWVyeSwgcnVsZVF1ZXJ5RmFjdG9yeSwgcnVsZXM6IGFsbG93UnVsZXN9KVxuXG4gICAgaWYgKGFsbG93U3FsUGFydHMubGVuZ3RoID09PSAwKSB7XG4gICAgICByZXR1cm4gcXVlcnkud2hlcmUoXCIxPTBcIilcbiAgICB9XG5cbiAgICBxdWVyeS53aGVyZShgKCR7YWxsb3dTcWxQYXJ0cy5qb2luKFwiIE9SIFwiKX0pYClcbiAgICB0aGlzLmFwcGx5RGVueVJ1bGVzKHthY3Rpb24sIGRlbnlSdWxlcywgbW9kZWxDbGFzcywgcXVlcnksIHJ1bGVRdWVyeUZhY3Rvcnl9KVxuXG4gICAgcmV0dXJuIHF1ZXJ5XG4gIH1cblxuICAvKipcbiAgICogUnVucyBydWxlcyBmb3IuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gUnVsZSBsb29rdXAgYXJncy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MuYWN0aW9uIC0gQWN0aW9uLlxuICAgKiBAcGFyYW0ge3R5cGVvZiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gYXJncy5tb2RlbENsYXNzIC0gTW9kZWwgY2xhc3MuXG4gICAqIEByZXR1cm5zIHtBYmlsaXR5UnVsZVR5cGVbXX0gLSBNYXRjaGluZyBydWxlcy5cbiAgICovXG4gIHJ1bGVzRm9yKHthY3Rpb24sIG1vZGVsQ2xhc3N9KSB7XG4gICAgcmV0dXJuIHRoaXMucnVsZXMuZmlsdGVyKChydWxlKSA9PiB7XG4gICAgICBpZiAocnVsZS5tb2RlbENsYXNzICE9PSBtb2RlbENsYXNzKSByZXR1cm4gZmFsc2VcblxuICAgICAgcmV0dXJuIHJ1bGUuYWN0aW9ucy5pbmNsdWRlcyhhY3Rpb24pIHx8IHJ1bGUuYWN0aW9ucy5pbmNsdWRlcyhcIm1hbmFnZVwiKVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBjb25kaXRpb24gc3FsIHBhcnRzLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIFNRTCBhcmdzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5hY3Rpb24gLSBBY3Rpb24uXG4gICAqIEBwYXJhbSB7dHlwZW9mIGltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBhcmdzLm1vZGVsQ2xhc3MgLSBNb2RlbCBjbGFzcy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9xdWVyeS9tb2RlbC1jbGFzcy1xdWVyeS5qc1wiKS5kZWZhdWx0PHR5cGVvZiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdD59IGFyZ3MucXVlcnkgLSBCYXNlIHF1ZXJ5LlxuICAgKiBAcGFyYW0geygpID0+IGltcG9ydChcIi4uL2RhdGFiYXNlL3F1ZXJ5L21vZGVsLWNsYXNzLXF1ZXJ5LmpzXCIpLmRlZmF1bHQ8dHlwZW9mIGltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0Pn0gW2FyZ3MucnVsZVF1ZXJ5RmFjdG9yeV0gLSBPcHRpb25hbCBjb25kaXRpb25hbC1ydWxlIHF1ZXJ5IGZhY3RvcnkuXG4gICAqIEBwYXJhbSB7QWJpbGl0eVJ1bGVUeXBlW119IGFyZ3MucnVsZXMgLSBSdWxlcy5cbiAgICogQHJldHVybnMge3N0cmluZ1tdfSAtIFNRTCBjb25kaXRpb24gcGFydHMuXG4gICAqL1xuICBjb25kaXRpb25TcWxQYXJ0cyh7YWN0aW9uLCBtb2RlbENsYXNzLCBxdWVyeSwgcnVsZVF1ZXJ5RmFjdG9yeSwgcnVsZXN9KSB7XG4gICAgY29uc3QgcHJpbWFyeUtleSA9IG1vZGVsQ2xhc3MucHJpbWFyeUtleSgpXG4gICAgY29uc3QgcHJpbWFyeUtleUF0dHJpYnV0ZXMgPSBBcnJheS5pc0FycmF5KHByaW1hcnlLZXkpID8gcHJpbWFyeUtleSA6IFtwcmltYXJ5S2V5XVxuICAgIGNvbnN0IHF1b3RlZEJhc2VUYWJsZSA9IHF1ZXJ5LmRyaXZlci5xdW90ZVRhYmxlKHF1ZXJ5LmdldFRhYmxlUmVmZXJlbmNlRm9ySm9pbigpKVxuICAgIGNvbnN0IHNxbFBhcnRzID0gW11cblxuICAgIGZvciAoY29uc3QgcnVsZSBvZiBydWxlcykge1xuICAgICAgaWYgKCFydWxlLmNvbmRpdGlvbnMpIGNvbnRpbnVlXG5cbiAgICAgIGNvbnN0IHNjb3BlZFF1ZXJ5ID0gcnVsZVF1ZXJ5RmFjdG9yeSA/IHJ1bGVRdWVyeUZhY3RvcnkoKSA6IG1vZGVsQ2xhc3MuX25ld1F1ZXJ5KClcbiAgICAgIGNvbnN0IHJlc3VsdFF1ZXJ5ID0gdGhpcy5hcHBseVJ1bGVDb25kaXRpb24oe1xuICAgICAgICBhY3Rpb24sXG4gICAgICAgIGNvbmRpdGlvbnM6IHJ1bGUuY29uZGl0aW9ucyxcbiAgICAgICAgbW9kZWxDbGFzcyxcbiAgICAgICAgcXVlcnk6IHNjb3BlZFF1ZXJ5XG4gICAgICB9KVxuICAgICAgY29uc3QgZmluYWxRdWVyeSA9IHJlc3VsdFF1ZXJ5IHx8IHNjb3BlZFF1ZXJ5XG4gICAgICBjb25zdCBxdW90ZWRTY29wZWRUYWJsZSA9IHF1ZXJ5LmRyaXZlci5xdW90ZVRhYmxlKGZpbmFsUXVlcnkuZ2V0VGFibGVSZWZlcmVuY2VGb3JKb2luKCkpXG4gICAgICBjb25zdCBwcmltYXJ5S2V5Q29sdW1ucyA9IHByaW1hcnlLZXlBdHRyaWJ1dGVzLm1hcCgoYXR0cmlidXRlTmFtZSkgPT4gbW9kZWxDbGFzcy5nZXRDb2x1bW5OYW1lRm9yQXR0cmlidXRlTmFtZShhdHRyaWJ1dGVOYW1lKSlcbiAgICAgIGNvbnN0IHNlbGVjdGVkUGtTcWwgPSBwcmltYXJ5S2V5Q29sdW1ucy5tYXAoKGNvbHVtbk5hbWUpID0+IGAke3F1b3RlZFNjb3BlZFRhYmxlfS4ke3F1ZXJ5LmRyaXZlci5xdW90ZUNvbHVtbihjb2x1bW5OYW1lKX1gKVxuXG4gICAgICBpZiAoZmluYWxRdWVyeS5fZGlzdGluY3QpIHtcbiAgICAgICAgcXVlcnkuZGlzdGluY3QodHJ1ZSlcbiAgICAgIH1cblxuICAgICAgZmluYWxRdWVyeS5zZWxlY3Qoc2VsZWN0ZWRQa1NxbClcblxuICAgICAgaWYgKEFycmF5LmlzQXJyYXkocHJpbWFyeUtleSkpIHtcbiAgICAgICAgY29uc3QgYXV0aG9yaXplZFJvd3NBbGlhcyA9IHF1ZXJ5LmRyaXZlci5xdW90ZVRhYmxlKFwidmVsb2Npb3VzX2F1dGhvcml6ZWRfcm93c1wiKVxuICAgICAgICBjb25zdCBpZGVudGl0eVNxbCA9IHByaW1hcnlLZXlDb2x1bW5zLm1hcCgoY29sdW1uTmFtZSkgPT4ge1xuICAgICAgICAgIGNvbnN0IHF1b3RlZENvbHVtbiA9IHF1ZXJ5LmRyaXZlci5xdW90ZUNvbHVtbihjb2x1bW5OYW1lKVxuXG4gICAgICAgICAgcmV0dXJuIGAke2F1dGhvcml6ZWRSb3dzQWxpYXN9LiR7cXVvdGVkQ29sdW1ufSA9ICR7cXVvdGVkQmFzZVRhYmxlfS4ke3F1b3RlZENvbHVtbn1gXG4gICAgICAgIH0pLmpvaW4oXCIgQU5EIFwiKVxuXG4gICAgICAgIHNxbFBhcnRzLnB1c2goYEVYSVNUUyAoU0VMRUNUIDEgRlJPTSAoJHtmaW5hbFF1ZXJ5LnRvU3FsKCl9KSBBUyAke2F1dGhvcml6ZWRSb3dzQWxpYXN9IFdIRVJFICR7aWRlbnRpdHlTcWx9KWApXG4gICAgICB9IGVsc2Uge1xuICAgICAgICBzcWxQYXJ0cy5wdXNoKGAke3F1b3RlZEJhc2VUYWJsZX0uJHtxdWVyeS5kcml2ZXIucXVvdGVDb2x1bW4ocHJpbWFyeUtleUNvbHVtbnNbMF0pfSBJTiAoJHtmaW5hbFF1ZXJ5LnRvU3FsKCl9KWApXG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIHNxbFBhcnRzXG4gIH1cblxuICAvKipcbiAgICogUnVucyBhcHBseSBkZW55IHJ1bGVzLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIERlbnkgYXJncy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MuYWN0aW9uIC0gQWN0aW9uLlxuICAgKiBAcGFyYW0ge0FiaWxpdHlSdWxlVHlwZVtdfSBhcmdzLmRlbnlSdWxlcyAtIERlbnkgcnVsZXMuXG4gICAqIEBwYXJhbSB7dHlwZW9mIGltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBhcmdzLm1vZGVsQ2xhc3MgLSBNb2RlbCBjbGFzcy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9xdWVyeS9tb2RlbC1jbGFzcy1xdWVyeS5qc1wiKS5kZWZhdWx0PHR5cGVvZiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdD59IGFyZ3MucXVlcnkgLSBRdWVyeS5cbiAgICogQHBhcmFtIHsoKSA9PiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9xdWVyeS9tb2RlbC1jbGFzcy1xdWVyeS5qc1wiKS5kZWZhdWx0PHR5cGVvZiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdD59IFthcmdzLnJ1bGVRdWVyeUZhY3RvcnldIC0gT3B0aW9uYWwgY29uZGl0aW9uYWwtcnVsZSBxdWVyeSBmYWN0b3J5LlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBhcHBseURlbnlSdWxlcyh7YWN0aW9uLCBkZW55UnVsZXMsIG1vZGVsQ2xhc3MsIHF1ZXJ5LCBydWxlUXVlcnlGYWN0b3J5fSkge1xuICAgIGlmIChkZW55UnVsZXMubGVuZ3RoID09PSAwKSByZXR1cm5cblxuICAgIGlmIChkZW55UnVsZXMuc29tZSgocnVsZSkgPT4gIXJ1bGUuY29uZGl0aW9ucykpIHtcbiAgICAgIHF1ZXJ5LndoZXJlKFwiMT0wXCIpXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBjb25zdCBkZW55U3FsUGFydHMgPSB0aGlzLmNvbmRpdGlvblNxbFBhcnRzKHthY3Rpb24sIG1vZGVsQ2xhc3MsIHF1ZXJ5LCBydWxlUXVlcnlGYWN0b3J5LCBydWxlczogZGVueVJ1bGVzfSlcblxuICAgIGlmIChkZW55U3FsUGFydHMubGVuZ3RoID4gMCkge1xuICAgICAgcXVlcnkud2hlcmUoYE5PVCAoJHtkZW55U3FsUGFydHMuam9pbihcIiBPUiBcIil9KWApXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYXBwbHkgcnVsZSBjb25kaXRpb24uXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gQ29uZGl0aW9uIGFyZ3MuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmFjdGlvbiAtIEFjdGlvbi5cbiAgICogQHBhcmFtIHtBYmlsaXR5Q29uZGl0aW9uc1R5cGV9IGFyZ3MuY29uZGl0aW9ucyAtIFJ1bGUgY29uZGl0aW9ucy5cbiAgICogQHBhcmFtIHt0eXBlb2YgaW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IGFyZ3MubW9kZWxDbGFzcyAtIE1vZGVsIGNsYXNzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL3F1ZXJ5L21vZGVsLWNsYXNzLXF1ZXJ5LmpzXCIpLmRlZmF1bHQ8dHlwZW9mIGltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0Pn0gYXJncy5xdWVyeSAtIFF1ZXJ5LlxuICAgKiBAcmV0dXJucyB7dm9pZCB8IGltcG9ydChcIi4uL2RhdGFiYXNlL3F1ZXJ5L21vZGVsLWNsYXNzLXF1ZXJ5LmpzXCIpLmRlZmF1bHQ8dHlwZW9mIGltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0Pn0gLSBPcHRpb25hbCByZXBsYWNlbWVudCBxdWVyeS5cbiAgICovXG4gIGFwcGx5UnVsZUNvbmRpdGlvbih7YWN0aW9uLCBjb25kaXRpb25zLCBtb2RlbENsYXNzLCBxdWVyeX0pIHtcbiAgICBpZiAodHlwZW9mIGNvbmRpdGlvbnMgPT09IFwic3RyaW5nXCIpIHtcbiAgICAgIHF1ZXJ5LndoZXJlKGNvbmRpdGlvbnMpXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBpZiAodHlwZW9mIGNvbmRpdGlvbnMgPT09IFwiZnVuY3Rpb25cIikge1xuICAgICAgcmV0dXJuIGNvbmRpdGlvbnMocXVlcnksIHtcbiAgICAgICAgYWJpbGl0eTogdGhpcyxcbiAgICAgICAgYWN0aW9uLFxuICAgICAgICBtb2RlbENsYXNzXG4gICAgICB9KVxuICAgIH1cblxuICAgIHF1ZXJ5LndoZXJlKGNvbmRpdGlvbnMpXG4gIH1cbn1cbiJdfQ==