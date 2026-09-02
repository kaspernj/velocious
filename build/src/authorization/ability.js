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
     * @returns {import("../database/query/model-class-query.js").default<typeof import("../database/record/index.js").default>} - Authorized query.
     */
    applyToQuery({ action, modelClass, query }) {
        this.loadAbilitiesForModelClass(modelClass);
        const applicableRules = this.rulesFor({ action, modelClass });
        const allowRules = applicableRules.filter((rule) => rule.effect === "allow");
        const denyRules = applicableRules.filter((rule) => rule.effect === "deny");
        if (allowRules.length === 0) {
            return query.where("1=0");
        }
        if (allowRules.some((rule) => !rule.conditions)) {
            this.applyDenyRules({ action, denyRules, modelClass, query });
            return query;
        }
        const allowSqlParts = this.conditionSqlParts({ action, modelClass, query, rules: allowRules });
        if (allowSqlParts.length === 0) {
            return query.where("1=0");
        }
        query.where(`(${allowSqlParts.join(" OR ")})`);
        this.applyDenyRules({ action, denyRules, modelClass, query });
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
     * @param {AbilityRuleType[]} args.rules - Rules.
     * @returns {string[]} - SQL condition parts.
     */
    conditionSqlParts({ action, modelClass, query, rules }) {
        const pk = modelClass.primaryKey();
        const quotedBaseTable = query.driver.quoteTable(modelClass.tableName());
        const quotedPk = query.driver.quoteColumn(pk);
        const sqlParts = [];
        for (const rule of rules) {
            if (!rule.conditions)
                continue;
            const scopedQuery = modelClass._newQuery();
            const resultQuery = this.applyRuleCondition({
                action,
                conditions: rule.conditions,
                modelClass,
                query: scopedQuery
            });
            const finalQuery = resultQuery || scopedQuery;
            const selectedPkSql = `${quotedBaseTable}.${quotedPk}`;
            if (finalQuery._distinct) {
                query.distinct(true);
            }
            finalQuery.select(selectedPkSql);
            sqlParts.push(`${quotedBaseTable}.${quotedPk} IN (${finalQuery.toSql()})`);
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
     * @returns {void} - No return value.
     */
    applyDenyRules({ action, denyRules, modelClass, query }) {
        if (denyRules.length === 0)
            return;
        if (denyRules.some((rule) => !rule.conditions)) {
            query.where("1=0");
            return;
        }
        const denySqlParts = this.conditionSqlParts({ action, modelClass, query, rules: denyRules });
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYWJpbGl0eS5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9hdXRob3JpemF0aW9uL2FiaWxpdHkuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaOzs7O0dBSUc7QUFFSDs7Ozs7OztHQU9HO0FBRUgsa0VBQWtFO0FBQ2xFLE1BQU0sQ0FBQyxPQUFPLE9BQU8sNkJBQTZCO0lBQ2hEOzswQkFFc0I7SUFDdEIsTUFBTSxDQUFDLE1BQU0sR0FBRyxDQUFDLFFBQVEsQ0FBQyxDQUFBO0lBRTFCOzswQkFFc0I7SUFDdEIsTUFBTSxDQUFDLElBQUksR0FBRyxDQUFDLE1BQU0sQ0FBQyxDQUFBO0lBRXRCOzswQkFFc0I7SUFDdEIsTUFBTSxDQUFDLE1BQU0sR0FBRyxDQUFDLFFBQVEsQ0FBQyxDQUFBO0lBRTFCOzswQkFFc0I7SUFDdEIsTUFBTSxDQUFDLE9BQU8sR0FBRyxDQUFDLFNBQVMsQ0FBQyxDQUFBO0lBRTVCOzswQkFFc0I7SUFDdEIsTUFBTSxDQUFDLElBQUksR0FBRyxDQUFDLFFBQVEsRUFBRSxNQUFNLEVBQUUsUUFBUSxFQUFFLFNBQVMsQ0FBQyxDQUFBO0lBRXJEOzs7Ozs7T0FNRztJQUNILFlBQVksRUFBQyxPQUFPLEdBQUcsRUFBRSxFQUFFLE1BQU0sR0FBRyxFQUFFLEVBQUUsU0FBUyxFQUFDLEdBQUcsRUFBRTtRQUNyRCxJQUFJLENBQUMsT0FBTyxHQUFHLE9BQU8sQ0FBQTtRQUN0QixJQUFJLENBQUMsTUFBTSxHQUFHLE1BQU0sQ0FBQTtRQUNwQixJQUFJLENBQUMsU0FBUyxHQUFHLFNBQVMsSUFBSSxJQUFJLENBQUMsa0NBQWtDLEVBQUUsQ0FBQTtRQUV2RTs7dUNBRStCO1FBQy9CLElBQUksQ0FBQyxLQUFLLEdBQUcsRUFBRSxDQUFBO1FBRWY7OzZDQUVxQztRQUNyQyxJQUFJLENBQUMseUJBQXlCLEdBQUcsRUFBRSxDQUFBO0lBQ3JDLENBQUM7SUFFRDs7O09BR0c7SUFDSCxrQ0FBa0M7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QUFBO1FBRTFGLElBQUksWUFBWSxDQUFDLE1BQU0sR0FBRyxDQUFDLEVBQUUsQ0FBQztZQUM1QixLQUFLLENBQUMsS0FBSyxDQUFDLFFBQVEsWUFBWSxDQUFDLElBQUksQ0FBQyxNQUFNLENBQUMsR0FBRyxDQUFDLENBQUE7UUFDbkQsQ0FBQztJQUNILENBQUM7SUFFRDs7Ozs7Ozs7T0FRRztJQUNILGtCQUFrQixDQUFDLEVBQUMsTUFBTSxFQUFFLFVBQVUsRUFBRSxVQUFVLEVBQUUsS0FBSyxFQUFDO1FBQ3hELElBQUksT0FBTyxVQUFVLEtBQUssUUFBUSxFQUFFLENBQUM7WUFDbkMsS0FBSyxDQUFDLEtBQUssQ0FBQyxVQUFVLENBQUMsQ0FBQTtZQUN2QixPQUFNO1FBQ1IsQ0FBQztRQUVELElBQUksT0FBTyxVQUFVLEtBQUssVUFBVSxFQUFFLENBQUM7WUFDckMsT0FBTyxVQUFVLENBQUMsS0FBSyxFQUFFO2dCQUN2QixPQUFPLEVBQUUsSUFBSTtnQkFDYixNQUFNO2dCQUNOLFVBQVU7YUFDWCxDQUFDLENBQUE7UUFDSixDQUFDO1FBRUQsS0FBSyxDQUFDLEtBQUssQ0FBQyxVQUFVLENBQUMsQ0FBQTtJQUN6QixDQUFDO0NBQ0YiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuLyoqXG4gKiBEZWZpbmVzIHRoaXMgdHlwZWRlZi5cbiAqIEB0ZW1wbGF0ZSB7dHlwZW9mIGltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBbTUM9dHlwZW9mIGltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0XVxuICogQHR5cGVkZWYge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiB8IHN0cmluZyB8ICgocXVlcnk6IGltcG9ydChcIi4uL2RhdGFiYXNlL3F1ZXJ5L21vZGVsLWNsYXNzLXF1ZXJ5LmpzXCIpLmRlZmF1bHQ8TUM+LCBhcmdzOiB7YWJpbGl0eTogVmVsb2Npb3VzQXV0aG9yaXphdGlvbkFiaWxpdHksIGFjdGlvbjogc3RyaW5nLCBtb2RlbENsYXNzOiBNQ30pID0+IHZvaWQgfCBpbXBvcnQoXCIuLi9kYXRhYmFzZS9xdWVyeS9tb2RlbC1jbGFzcy1xdWVyeS5qc1wiKS5kZWZhdWx0PE1DPil9IEFiaWxpdHlDb25kaXRpb25zVHlwZVxuICovXG5cbi8qKlxuICogQWJpbGl0eVJ1bGVUeXBlIHR5cGUuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBBYmlsaXR5UnVsZVR5cGVcbiAqIEBwcm9wZXJ0eSB7c3RyaW5nW119IGFjdGlvbnMgLSBBY3Rpb25zIGNvdmVyZWQgYnkgcnVsZS5cbiAqIEBwcm9wZXJ0eSB7dHlwZW9mIGltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBtb2RlbENsYXNzIC0gTW9kZWwgY2xhc3MuXG4gKiBAcHJvcGVydHkge0FiaWxpdHlDb25kaXRpb25zVHlwZSB8IHVuZGVmaW5lZH0gY29uZGl0aW9ucyAtIENvbmRpdGlvbnMuXG4gKiBAcHJvcGVydHkge1wiYWxsb3dcIiB8IFwiZGVueVwifSBlZmZlY3QgLSBSdWxlIGVmZmVjdC5cbiAqL1xuXG4vKiogQ2FuQ2FuLXN0eWxlIGFiaWxpdHkgb2JqZWN0IGZvciBxdWVyeS1sZXZlbCBhY2Nlc3MgY29udHJvbC4gKi9cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIFZlbG9jaW91c0F1dGhvcml6YXRpb25BYmlsaXR5IHtcbiAgLyoqXG4gICAqIENyZWF0ZS5cbiAgICogQHR5cGUge3N0cmluZ1tdfSAqL1xuICBzdGF0aWMgQ1JFQVRFID0gW1wiY3JlYXRlXCJdXG5cbiAgLyoqXG4gICAqIFJlYWQuXG4gICAqIEB0eXBlIHtzdHJpbmdbXX0gKi9cbiAgc3RhdGljIFJFQUQgPSBbXCJyZWFkXCJdXG5cbiAgLyoqXG4gICAqIFVwZGF0ZS5cbiAgICogQHR5cGUge3N0cmluZ1tdfSAqL1xuICBzdGF0aWMgVVBEQVRFID0gW1widXBkYXRlXCJdXG5cbiAgLyoqXG4gICAqIERlc3Ryb3kuXG4gICAqIEB0eXBlIHtzdHJpbmdbXX0gKi9cbiAgc3RhdGljIERFU1RST1kgPSBbXCJkZXN0cm95XCJdXG5cbiAgLyoqXG4gICAqIENydWQuXG4gICAqIEB0eXBlIHtzdHJpbmdbXX0gKi9cbiAgc3RhdGljIENSVUQgPSBbXCJjcmVhdGVcIiwgXCJyZWFkXCIsIFwidXBkYXRlXCIsIFwiZGVzdHJveVwiXVxuXG4gIC8qKlxuICAgKiBSdW5zIGNvbnN0cnVjdG9yLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEFiaWxpdHkgYXJncy5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IFthcmdzLmNvbnRleHRdIC0gQWJpbGl0eSBjb250ZXh0LlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gW2FyZ3MubG9jYWxzXSAtIEFiaWxpdHkgbG9jYWxzLlxuICAgKiBAcGFyYW0ge0FycmF5PHR5cGVvZiBpbXBvcnQoXCIuL2Jhc2UtcmVzb3VyY2UuanNcIikuZGVmYXVsdD59IFthcmdzLnJlc291cmNlc10gLSBSZXNvdXJjZSBjbGFzc2VzLlxuICAgKi9cbiAgY29uc3RydWN0b3Ioe2NvbnRleHQgPSB7fSwgbG9jYWxzID0ge30sIHJlc291cmNlc30gPSB7fSkge1xuICAgIHRoaXMuY29udGV4dCA9IGNvbnRleHRcbiAgICB0aGlzLmxvY2FscyA9IGxvY2Fsc1xuICAgIHRoaXMucmVzb3VyY2VzID0gcmVzb3VyY2VzIHx8IHRoaXMuX3Jlc29sdmVSZXNvdXJjZXNGcm9tQ29uZmlndXJhdGlvbigpXG5cbiAgICAvKipcbiAgICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAgICogQHR5cGUge0FiaWxpdHlSdWxlVHlwZVtdfSAqL1xuICAgIHRoaXMucnVsZXMgPSBbXVxuXG4gICAgLyoqXG4gICAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBib29sZWFuPn0gKi9cbiAgICB0aGlzLmxvYWRlZE1vZGVsQ2xhc3NBYmlsaXRpZXMgPSB7fVxuICB9XG5cbiAgLyoqXG4gICAqIEF1dG8tcmVzb2x2ZXMgcmVzb3VyY2UgY2xhc3NlcyBmcm9tIHRoZSBjb25maWd1cmF0aW9uJ3MgYmFja2VuZFByb2plY3RzIHdoZW4gbm8gZXhwbGljaXQgcmVzb3VyY2VzIGFyZSBwcm92aWRlZC5cbiAgICogQHJldHVybnMge0FycmF5PHR5cGVvZiBpbXBvcnQoXCIuL2Jhc2UtcmVzb3VyY2UuanNcIikuZGVmYXVsdD59IFJlc29sdmVkIHJlc291cmNlIGNsYXNzZXMuXG4gICAqL1xuICBfcmVzb2x2ZVJlc291cmNlc0Zyb21Db25maWd1cmF0aW9uKCkge1xuICAgIGNvbnN0IGNvbmZpZ3VyYXRpb24gPSB0aGlzLmNvbnRleHQ/LmNvbmZpZ3VyYXRpb25cblxuICAgIGlmICghY29uZmlndXJhdGlvbikge1xuICAgICAgcmV0dXJuIFtdXG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogUmVzb2x2ZWQuXG4gICAgICogQHR5cGUge0FycmF5PHR5cGVvZiBpbXBvcnQoXCIuL2Jhc2UtcmVzb3VyY2UuanNcIikuZGVmYXVsdD59ICovXG4gICAgY29uc3QgcmVzb2x2ZWQgPSBbXVxuICAgIGNvbnN0IGJhY2tlbmRQcm9qZWN0cyA9IGNvbmZpZ3VyYXRpb24uZ2V0QmFja2VuZFByb2plY3RzKClcblxuICAgIGZvciAoY29uc3QgYmFja2VuZFByb2plY3Qgb2YgYmFja2VuZFByb2plY3RzKSB7XG4gICAgICBjb25zdCBmcm9udGVuZE1vZGVscyA9IGJhY2tlbmRQcm9qZWN0LmZyb250ZW5kTW9kZWxzXG5cbiAgICAgIGlmICghZnJvbnRlbmRNb2RlbHMpIGNvbnRpbnVlXG5cbiAgICAgIGZvciAoY29uc3QgcmVzb3VyY2VEZWZpbml0aW9uIG9mIE9iamVjdC52YWx1ZXMoZnJvbnRlbmRNb2RlbHMpKSB7XG4gICAgICAgIHJlc29sdmVkLnB1c2gocmVzb3VyY2VEZWZpbml0aW9uKVxuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiByZXNvbHZlZFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGNvbnRleHQuXG4gICAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gQ29udGV4dC5cbiAgICovXG4gIGdldENvbnRleHQoKSB7XG4gICAgcmV0dXJuIHRoaXMuY29udGV4dFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGxvY2Fscy5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBMb2NhbHMuXG4gICAqL1xuICBnZXRMb2NhbHMoKSB7XG4gICAgcmV0dXJuIHRoaXMubG9jYWxzXG4gIH1cblxuICAvKipcbiAgICogUnVucyBjdXJyZW50IHVzZXIuXG4gICAqIEByZXR1cm5zIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gLSBDdXJyZW50IHVzZXIgZnJvbSBjb250ZXh0LlxuICAgKi9cbiAgY3VycmVudFVzZXIoKSB7XG4gICAgcmV0dXJuIHRoaXMuY29udGV4dC5jdXJyZW50VXNlclxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY2FuLlxuICAgKiBAcGFyYW0ge3N0cmluZyB8IHN0cmluZ1tdfSBhY3Rpb25zIC0gQWN0aW9uKHMpLlxuICAgKiBAcGFyYW0ge3R5cGVvZiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gbW9kZWxDbGFzcyAtIE1vZGVsIGNsYXNzLlxuICAgKiBAcGFyYW0ge0FiaWxpdHlDb25kaXRpb25zVHlwZX0gW2NvbmRpdGlvbnNdIC0gQ29uZGl0aW9ucy5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgY2FuKGFjdGlvbnMsIG1vZGVsQ2xhc3MsIGNvbmRpdGlvbnMpIHtcbiAgICB0aGlzLmFkZFJ1bGUoe2FjdGlvbnMsIGNvbmRpdGlvbnMsIGVmZmVjdDogXCJhbGxvd1wiLCBtb2RlbENsYXNzfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNhbm5vdC5cbiAgICogQHBhcmFtIHtzdHJpbmcgfCBzdHJpbmdbXX0gYWN0aW9ucyAtIEFjdGlvbihzKS5cbiAgICogQHBhcmFtIHt0eXBlb2YgaW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IG1vZGVsQ2xhc3MgLSBNb2RlbCBjbGFzcy5cbiAgICogQHBhcmFtIHtBYmlsaXR5Q29uZGl0aW9uc1R5cGV9IFtjb25kaXRpb25zXSAtIENvbmRpdGlvbnMuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIGNhbm5vdChhY3Rpb25zLCBtb2RlbENsYXNzLCBjb25kaXRpb25zKSB7XG4gICAgdGhpcy5hZGRSdWxlKHthY3Rpb25zLCBjb25kaXRpb25zLCBlZmZlY3Q6IFwiZGVueVwiLCBtb2RlbENsYXNzfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGFkZCBydWxlLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIFJ1bGUgYXJncy5cbiAgICogQHBhcmFtIHtzdHJpbmcgfCBzdHJpbmdbXX0gYXJncy5hY3Rpb25zIC0gQWN0aW9uKHMpLlxuICAgKiBAcGFyYW0ge0FiaWxpdHlDb25kaXRpb25zVHlwZX0gW2FyZ3MuY29uZGl0aW9uc10gLSBDb25kaXRpb25zLlxuICAgKiBAcGFyYW0ge1wiYWxsb3dcIiB8IFwiZGVueVwifSBhcmdzLmVmZmVjdCAtIEVmZmVjdC5cbiAgICogQHBhcmFtIHt0eXBlb2YgaW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IGFyZ3MubW9kZWxDbGFzcyAtIE1vZGVsIGNsYXNzLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBhZGRSdWxlKHthY3Rpb25zLCBjb25kaXRpb25zLCBlZmZlY3QsIG1vZGVsQ2xhc3N9KSB7XG4gICAgY29uc3Qgbm9ybWFsaXplZEFjdGlvbnMgPSBBcnJheS5pc0FycmF5KGFjdGlvbnMpID8gYWN0aW9ucyA6IFthY3Rpb25zXVxuXG4gICAgdGhpcy5ydWxlcy5wdXNoKHthY3Rpb25zOiBub3JtYWxpemVkQWN0aW9ucywgY29uZGl0aW9ucywgZWZmZWN0LCBtb2RlbENsYXNzfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGxvYWQgYWJpbGl0aWVzIGZvciBtb2RlbCBjbGFzcy5cbiAgICogQHBhcmFtIHt0eXBlb2YgaW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IG1vZGVsQ2xhc3MgLSBNb2RlbCBjbGFzcy5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgbG9hZEFiaWxpdGllc0Zvck1vZGVsQ2xhc3MobW9kZWxDbGFzcykge1xuICAgIGNvbnN0IGtleSA9IG1vZGVsQ2xhc3MuZ2V0TW9kZWxOYW1lKClcblxuICAgIGlmICh0aGlzLmxvYWRlZE1vZGVsQ2xhc3NBYmlsaXRpZXNba2V5XSkgcmV0dXJuXG5cbiAgICB0aGlzLmxvYWRlZE1vZGVsQ2xhc3NBYmlsaXRpZXNba2V5XSA9IHRydWVcblxuICAgIGZvciAoY29uc3QgUmVzb3VyY2VDbGFzcyBvZiB0aGlzLnJlc291cmNlcykge1xuICAgICAgY29uc3QgcmVzb3VyY2VNb2RlbENsYXNzID0gUmVzb3VyY2VDbGFzcy5tb2RlbENsYXNzKClcblxuICAgICAgaWYgKHJlc291cmNlTW9kZWxDbGFzcyAhPT0gbW9kZWxDbGFzcykgY29udGludWVcblxuICAgICAgY29uc3QgcmVzb3VyY2VJbnN0YW5jZSA9IG5ldyBSZXNvdXJjZUNsYXNzKHtcbiAgICAgICAgYWJpbGl0eTogdGhpcyxcbiAgICAgICAgY29udGV4dDogdGhpcy5jb250ZXh0LFxuICAgICAgICBsb2NhbHM6IHRoaXMubG9jYWxzXG4gICAgICB9KVxuXG4gICAgICByZXNvdXJjZUluc3RhbmNlLmFiaWxpdGllcygpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYXBwbHkgdG8gcXVlcnkuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gUXVlcnkgYXJncy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MuYWN0aW9uIC0gUmVxdWVzdGVkIGFjdGlvbi5cbiAgICogQHBhcmFtIHt0eXBlb2YgaW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IGFyZ3MubW9kZWxDbGFzcyAtIE1vZGVsIGNsYXNzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL3F1ZXJ5L21vZGVsLWNsYXNzLXF1ZXJ5LmpzXCIpLmRlZmF1bHQ8dHlwZW9mIGltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0Pn0gYXJncy5xdWVyeSAtIFF1ZXJ5LlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvcXVlcnkvbW9kZWwtY2xhc3MtcXVlcnkuanNcIikuZGVmYXVsdDx0eXBlb2YgaW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHQ+fSAtIEF1dGhvcml6ZWQgcXVlcnkuXG4gICAqL1xuICBhcHBseVRvUXVlcnkoe2FjdGlvbiwgbW9kZWxDbGFzcywgcXVlcnl9KSB7XG4gICAgdGhpcy5sb2FkQWJpbGl0aWVzRm9yTW9kZWxDbGFzcyhtb2RlbENsYXNzKVxuXG4gICAgY29uc3QgYXBwbGljYWJsZVJ1bGVzID0gdGhpcy5ydWxlc0Zvcih7YWN0aW9uLCBtb2RlbENsYXNzfSlcbiAgICBjb25zdCBhbGxvd1J1bGVzID0gYXBwbGljYWJsZVJ1bGVzLmZpbHRlcigocnVsZSkgPT4gcnVsZS5lZmZlY3QgPT09IFwiYWxsb3dcIilcbiAgICBjb25zdCBkZW55UnVsZXMgPSBhcHBsaWNhYmxlUnVsZXMuZmlsdGVyKChydWxlKSA9PiBydWxlLmVmZmVjdCA9PT0gXCJkZW55XCIpXG5cbiAgICBpZiAoYWxsb3dSdWxlcy5sZW5ndGggPT09IDApIHtcbiAgICAgIHJldHVybiBxdWVyeS53aGVyZShcIjE9MFwiKVxuICAgIH1cblxuICAgIGlmIChhbGxvd1J1bGVzLnNvbWUoKHJ1bGUpID0+ICFydWxlLmNvbmRpdGlvbnMpKSB7XG4gICAgICB0aGlzLmFwcGx5RGVueVJ1bGVzKHthY3Rpb24sIGRlbnlSdWxlcywgbW9kZWxDbGFzcywgcXVlcnl9KVxuICAgICAgcmV0dXJuIHF1ZXJ5XG4gICAgfVxuXG4gICAgY29uc3QgYWxsb3dTcWxQYXJ0cyA9IHRoaXMuY29uZGl0aW9uU3FsUGFydHMoe2FjdGlvbiwgbW9kZWxDbGFzcywgcXVlcnksIHJ1bGVzOiBhbGxvd1J1bGVzfSlcblxuICAgIGlmIChhbGxvd1NxbFBhcnRzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgcmV0dXJuIHF1ZXJ5LndoZXJlKFwiMT0wXCIpXG4gICAgfVxuXG4gICAgcXVlcnkud2hlcmUoYCgke2FsbG93U3FsUGFydHMuam9pbihcIiBPUiBcIil9KWApXG4gICAgdGhpcy5hcHBseURlbnlSdWxlcyh7YWN0aW9uLCBkZW55UnVsZXMsIG1vZGVsQ2xhc3MsIHF1ZXJ5fSlcblxuICAgIHJldHVybiBxdWVyeVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcnVsZXMgZm9yLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIFJ1bGUgbG9va3VwIGFyZ3MuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmFjdGlvbiAtIEFjdGlvbi5cbiAgICogQHBhcmFtIHt0eXBlb2YgaW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IGFyZ3MubW9kZWxDbGFzcyAtIE1vZGVsIGNsYXNzLlxuICAgKiBAcmV0dXJucyB7QWJpbGl0eVJ1bGVUeXBlW119IC0gTWF0Y2hpbmcgcnVsZXMuXG4gICAqL1xuICBydWxlc0Zvcih7YWN0aW9uLCBtb2RlbENsYXNzfSkge1xuICAgIHJldHVybiB0aGlzLnJ1bGVzLmZpbHRlcigocnVsZSkgPT4ge1xuICAgICAgaWYgKHJ1bGUubW9kZWxDbGFzcyAhPT0gbW9kZWxDbGFzcykgcmV0dXJuIGZhbHNlXG5cbiAgICAgIHJldHVybiBydWxlLmFjdGlvbnMuaW5jbHVkZXMoYWN0aW9uKSB8fCBydWxlLmFjdGlvbnMuaW5jbHVkZXMoXCJtYW5hZ2VcIilcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY29uZGl0aW9uIHNxbCBwYXJ0cy5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBTUUwgYXJncy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MuYWN0aW9uIC0gQWN0aW9uLlxuICAgKiBAcGFyYW0ge3R5cGVvZiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gYXJncy5tb2RlbENsYXNzIC0gTW9kZWwgY2xhc3MuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvcXVlcnkvbW9kZWwtY2xhc3MtcXVlcnkuanNcIikuZGVmYXVsdDx0eXBlb2YgaW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHQ+fSBhcmdzLnF1ZXJ5IC0gQmFzZSBxdWVyeS5cbiAgICogQHBhcmFtIHtBYmlsaXR5UnVsZVR5cGVbXX0gYXJncy5ydWxlcyAtIFJ1bGVzLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nW119IC0gU1FMIGNvbmRpdGlvbiBwYXJ0cy5cbiAgICovXG4gIGNvbmRpdGlvblNxbFBhcnRzKHthY3Rpb24sIG1vZGVsQ2xhc3MsIHF1ZXJ5LCBydWxlc30pIHtcbiAgICBjb25zdCBwayA9IG1vZGVsQ2xhc3MucHJpbWFyeUtleSgpXG4gICAgY29uc3QgcXVvdGVkQmFzZVRhYmxlID0gcXVlcnkuZHJpdmVyLnF1b3RlVGFibGUobW9kZWxDbGFzcy50YWJsZU5hbWUoKSlcbiAgICBjb25zdCBxdW90ZWRQayA9IHF1ZXJ5LmRyaXZlci5xdW90ZUNvbHVtbihwaylcbiAgICBjb25zdCBzcWxQYXJ0cyA9IFtdXG5cbiAgICBmb3IgKGNvbnN0IHJ1bGUgb2YgcnVsZXMpIHtcbiAgICAgIGlmICghcnVsZS5jb25kaXRpb25zKSBjb250aW51ZVxuXG4gICAgICBjb25zdCBzY29wZWRRdWVyeSA9IG1vZGVsQ2xhc3MuX25ld1F1ZXJ5KClcbiAgICAgIGNvbnN0IHJlc3VsdFF1ZXJ5ID0gdGhpcy5hcHBseVJ1bGVDb25kaXRpb24oe1xuICAgICAgICBhY3Rpb24sXG4gICAgICAgIGNvbmRpdGlvbnM6IHJ1bGUuY29uZGl0aW9ucyxcbiAgICAgICAgbW9kZWxDbGFzcyxcbiAgICAgICAgcXVlcnk6IHNjb3BlZFF1ZXJ5XG4gICAgICB9KVxuICAgICAgY29uc3QgZmluYWxRdWVyeSA9IHJlc3VsdFF1ZXJ5IHx8IHNjb3BlZFF1ZXJ5XG4gICAgICBjb25zdCBzZWxlY3RlZFBrU3FsID0gYCR7cXVvdGVkQmFzZVRhYmxlfS4ke3F1b3RlZFBrfWBcblxuICAgICAgaWYgKGZpbmFsUXVlcnkuX2Rpc3RpbmN0KSB7XG4gICAgICAgIHF1ZXJ5LmRpc3RpbmN0KHRydWUpXG4gICAgICB9XG5cbiAgICAgIGZpbmFsUXVlcnkuc2VsZWN0KHNlbGVjdGVkUGtTcWwpXG5cbiAgICAgIHNxbFBhcnRzLnB1c2goYCR7cXVvdGVkQmFzZVRhYmxlfS4ke3F1b3RlZFBrfSBJTiAoJHtmaW5hbFF1ZXJ5LnRvU3FsKCl9KWApXG4gICAgfVxuXG4gICAgcmV0dXJuIHNxbFBhcnRzXG4gIH1cblxuICAvKipcbiAgICogUnVucyBhcHBseSBkZW55IHJ1bGVzLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIERlbnkgYXJncy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MuYWN0aW9uIC0gQWN0aW9uLlxuICAgKiBAcGFyYW0ge0FiaWxpdHlSdWxlVHlwZVtdfSBhcmdzLmRlbnlSdWxlcyAtIERlbnkgcnVsZXMuXG4gICAqIEBwYXJhbSB7dHlwZW9mIGltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBhcmdzLm1vZGVsQ2xhc3MgLSBNb2RlbCBjbGFzcy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9xdWVyeS9tb2RlbC1jbGFzcy1xdWVyeS5qc1wiKS5kZWZhdWx0PHR5cGVvZiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdD59IGFyZ3MucXVlcnkgLSBRdWVyeS5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgYXBwbHlEZW55UnVsZXMoe2FjdGlvbiwgZGVueVJ1bGVzLCBtb2RlbENsYXNzLCBxdWVyeX0pIHtcbiAgICBpZiAoZGVueVJ1bGVzLmxlbmd0aCA9PT0gMCkgcmV0dXJuXG5cbiAgICBpZiAoZGVueVJ1bGVzLnNvbWUoKHJ1bGUpID0+ICFydWxlLmNvbmRpdGlvbnMpKSB7XG4gICAgICBxdWVyeS53aGVyZShcIjE9MFwiKVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgY29uc3QgZGVueVNxbFBhcnRzID0gdGhpcy5jb25kaXRpb25TcWxQYXJ0cyh7YWN0aW9uLCBtb2RlbENsYXNzLCBxdWVyeSwgcnVsZXM6IGRlbnlSdWxlc30pXG5cbiAgICBpZiAoZGVueVNxbFBhcnRzLmxlbmd0aCA+IDApIHtcbiAgICAgIHF1ZXJ5LndoZXJlKGBOT1QgKCR7ZGVueVNxbFBhcnRzLmpvaW4oXCIgT1IgXCIpfSlgKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGFwcGx5IHJ1bGUgY29uZGl0aW9uLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIENvbmRpdGlvbiBhcmdzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5hY3Rpb24gLSBBY3Rpb24uXG4gICAqIEBwYXJhbSB7QWJpbGl0eUNvbmRpdGlvbnNUeXBlfSBhcmdzLmNvbmRpdGlvbnMgLSBSdWxlIGNvbmRpdGlvbnMuXG4gICAqIEBwYXJhbSB7dHlwZW9mIGltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBhcmdzLm1vZGVsQ2xhc3MgLSBNb2RlbCBjbGFzcy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9xdWVyeS9tb2RlbC1jbGFzcy1xdWVyeS5qc1wiKS5kZWZhdWx0PHR5cGVvZiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdD59IGFyZ3MucXVlcnkgLSBRdWVyeS5cbiAgICogQHJldHVybnMge3ZvaWQgfCBpbXBvcnQoXCIuLi9kYXRhYmFzZS9xdWVyeS9tb2RlbC1jbGFzcy1xdWVyeS5qc1wiKS5kZWZhdWx0PHR5cGVvZiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdD59IC0gT3B0aW9uYWwgcmVwbGFjZW1lbnQgcXVlcnkuXG4gICAqL1xuICBhcHBseVJ1bGVDb25kaXRpb24oe2FjdGlvbiwgY29uZGl0aW9ucywgbW9kZWxDbGFzcywgcXVlcnl9KSB7XG4gICAgaWYgKHR5cGVvZiBjb25kaXRpb25zID09PSBcInN0cmluZ1wiKSB7XG4gICAgICBxdWVyeS53aGVyZShjb25kaXRpb25zKVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgaWYgKHR5cGVvZiBjb25kaXRpb25zID09PSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgIHJldHVybiBjb25kaXRpb25zKHF1ZXJ5LCB7XG4gICAgICAgIGFiaWxpdHk6IHRoaXMsXG4gICAgICAgIGFjdGlvbixcbiAgICAgICAgbW9kZWxDbGFzc1xuICAgICAgfSlcbiAgICB9XG5cbiAgICBxdWVyeS53aGVyZShjb25kaXRpb25zKVxuICB9XG59XG4iXX0=