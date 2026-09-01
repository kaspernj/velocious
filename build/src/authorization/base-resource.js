// @ts-check
/** Base class for authorization resources defining abilities for a model. */
export default class AuthorizationBaseResource {
    /**
     * Model class.
     * @type {typeof import("../database/record/index.js").default | undefined} */
    static ModelClass = undefined;
    /**
     * Runs constructor.
     * @param {object} args - Resource args.
     * @param {import("./ability.js").default} [args.ability] - Ability instance.
     * @param {import("../configuration-types.js").VelociousLooseObject} [args.context] - Ability context.
     * @param {import("../configuration-types.js").VelociousLooseObject} [args.locals] - Ability locals.
     */
    constructor({ ability, context = {}, locals = {} }) {
        this.ability = ability;
        this.context = context;
        this.locals = locals;
    }
    /**
     * Runs model class.
     * @returns {typeof import("../database/record/index.js").default} - Model class handled by this resource.
     */
    static modelClass() {
        if (!this.ModelClass) {
            throw new Error(`${this.name} must define static ModelClass before calling ability helpers.`);
        }
        return this.ModelClass;
    }
    /**
     * Runs can.
     * @template {typeof import("../database/record/index.js").default} MC
     * @param {string | string[]} actions - Ability action(s).
     * @param {import("./ability.js").AbilityConditionsType<MC>} [conditions] - Conditions.
     * @returns {void} - No return value.
     */
    can(actions, conditions) {
        this.assertResourceConditionsSignature({ conditions, methodName: "can" });
        this.requiredAbility().can(actions, this.requiredModelClass(), /** @type {import("./ability.js").AbilityConditionsType<typeof import("../database/record/index.js").default> | undefined} */ (conditions));
    }
    /**
     * Runs cannot.
     * @template {typeof import("../database/record/index.js").default} MC
     * @param {string | string[]} actions - Ability action(s).
     * @param {import("./ability.js").AbilityConditionsType<MC>} [conditions] - Conditions.
     * @returns {void} - No return value.
     */
    cannot(actions, conditions) {
        this.assertResourceConditionsSignature({ conditions, methodName: "cannot" });
        this.requiredAbility().cannot(actions, this.requiredModelClass(), /** @type {import("./ability.js").AbilityConditionsType<typeof import("../database/record/index.js").default> | undefined} */ (conditions));
    }
    /**
     * Runs required ability.
     * @returns {import("./ability.js").default} - Ability instance.
     */
    requiredAbility() {
        if (!this.ability) {
            throw new Error(`${this.constructor.name} requires an ability instance before defining abilities.`);
        }
        return this.ability;
    }
    /**
     * Runs required model class.
     * @returns {typeof import("../database/record/index.js").default} - Model class handled by this resource.
     */
    requiredModelClass() {
        const ResourceClass = /** @type {typeof AuthorizationBaseResource} */ (this.constructor);
        return ResourceClass.modelClass();
    }
    /**
     * Runs assert resource conditions signature.
     * @param {object} args - Signature args.
     * @param {ReturnType<typeof JSON.parse>} args.conditions - Conditions value.
     * @param {"can" | "cannot"} args.methodName - Method name.
     * @returns {void}
     */
    assertResourceConditionsSignature({ conditions, methodName }) {
        if (typeof conditions === "function" && "primaryKey" in conditions && "_newQuery" in conditions) {
            throw new Error(`${this.constructor.name}.${methodName}(...) no longer accepts a model class. Define static ModelClass and pass only conditions.`);
        }
    }
    /**
     * Runs get context.
     * @returns {import("../configuration-types.js").VelociousLooseObject} - Ability context.
     */
    getContext() {
        return this.context;
    }
    /**
     * Runs get locals.
     * @returns {import("../configuration-types.js").VelociousLooseObject} - Ability locals.
     */
    getLocals() {
        return this.locals;
    }
    /**
     * Runs current user.
     * @returns {unknown} - Current user from context.
     */
    currentUser() {
        return this.context.currentUser;
    }
    /**
     * Runs current device.
     * @returns {unknown} - Current device from context.
     */
    currentDevice() {
        return this.context.currentDevice;
    }
    /**
     * Runs offline grant.
     * @returns {unknown} - Offline grant from context.
     */
    offlineGrant() {
        return this.context.offlineGrant;
    }
    /**
     * Runs now.
     * @returns {Date} - Current time from context or the system clock.
     */
    now() {
        if (typeof this.context.now === "function")
            return this.context.now();
        if (this.context.now instanceof Date)
            return this.context.now;
        return new Date();
    }
    /**
     * Runs resource runtime.
     * @returns {"backend" | "frontend" | "offline"} - Resource runtime context.
     */
    resourceRuntime() {
        if (this.context.resourceRuntime === "frontend")
            return "frontend";
        if (this.context.resourceRuntime === "offline")
            return "offline";
        return "backend";
    }
    /**
     * Runs is backend.
     * @returns {boolean} - Whether the resource is running in the backend runtime.
     */
    isBackend() {
        return this.resourceRuntime() === "backend";
    }
    /**
     * Runs is frontend.
     * @returns {boolean} - Whether the resource is running in the frontend runtime.
     */
    isFrontend() {
        return this.resourceRuntime() === "frontend";
    }
    /**
     * Runs is offline.
     * @returns {boolean} - Whether the resource is running with offline context.
     */
    isOffline() {
        return this.resourceRuntime() === "offline" || this.context.offlineGrant !== undefined;
    }
    /**
     * Resolves a model class from the portable resource context.
     * @param {string} name - Model name.
     * @returns {unknown} - Model class from registry.
     */
    model(name) {
        const registry = this.context.modelRegistry;
        if (registry && typeof registry === "object") {
            if ("model" in registry && typeof registry.model === "function") {
                const modelClass = registry.model(name);
                if (modelClass)
                    return modelClass;
            }
            if (name in registry)
                return /** @type {Record<string, unknown>} */ (registry)[name];
        }
        const contextModel = this.context.model;
        if (typeof contextModel === "function") {
            const modelClass = contextModel(name);
            if (modelClass)
                return modelClass;
        }
        const configuration = this.context.configuration;
        if (configuration) {
            const modelClasses = configuration.getModelClasses();
            if (name in modelClasses)
                return modelClasses[name];
        }
        throw new Error(`${this.constructor.name} could not resolve model '${name}' from the resource context model registry.`);
    }
    /**
     * Runs request.
     * @returns {import("../http-server/client/request.js").default | import("../http-server/client/websocket-request.js").default | undefined} - Request from context.
     */
    request() {
        return this.context.request;
    }
    /**
     * Runs params.
     * @returns {import("../configuration-types.js").VelociousParams | undefined} - Params from context.
     */
    params() {
        return this.context.params;
    }
    /**
     * Runs abilities.
     * @returns {void} - Implement in subclasses to define abilities.
     */
    abilities() {
        // No-op by default.
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYmFzZS1yZXNvdXJjZS5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9hdXRob3JpemF0aW9uL2Jhc2UtcmVzb3VyY2UuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLDZFQUE2RTtBQUM3RSxNQUFNLENBQUMsT0FBTyxPQUFPLHlCQUF5QjtJQUM1Qzs7a0ZBRThFO0lBQzlFLE1BQU0sQ0FBQyxVQUFVLEdBQUcsU0FBUyxDQUFBO0lBRTdCOzs7Ozs7T0FNRztJQUNILFlBQVksRUFBQyxPQUFPLEVBQUUsT0FBTyxHQUFHLEVBQUUsRUFBRSxNQUFNLEdBQUcsRUFBRSxFQUFDO1FBQzlDLElBQUksQ0FBQyxPQUFPLEdBQUcsT0FBTyxDQUFBO1FBQ3RCLElBQUksQ0FBQyxPQUFPLEdBQUcsT0FBTyxDQUFBO1FBQ3RCLElBQUksQ0FBQyxNQUFNLEdBQUcsTUFBTSxDQUFBO0lBQ3RCLENBQUM7SUFFRDs7O09BR0c7SUFDSCxNQUFNLENBQUMsVUFBVTtRQUNmLElBQUksQ0FBQyxJQUFJLENBQUMsVUFBVSxFQUFFLENBQUM7WUFDckIsTUFBTSxJQUFJLEtBQUssQ0FBQyxHQUFHLElBQUksQ0FBQyxJQUFJLGdFQUFnRSxDQUFDLENBQUE7UUFDL0YsQ0FBQztRQUVELE9BQU8sSUFBSSxDQUFDLFVBQVUsQ0FBQTtJQUN4QixDQUFDO0lBRUQ7Ozs7OztPQU1HO0lBQ0gsR0FBRyxDQUFDLE9BQU8sRUFBRSxVQUFVO1FBQ3JCLElBQUksQ0FBQyxpQ0FBaUMsQ0FBQyxFQUFDLFVBQVUsRUFBRSxVQUFVLEVBQUUsS0FBSyxFQUFDLENBQUMsQ0FBQTtRQUN2RSxJQUFJLENBQUMsZUFBZSxFQUFFLENBQUMsR0FBRyxDQUFDLE9BQU8sRUFBRSxJQUFJLENBQUMsa0JBQWtCLEVBQUUsRUFBRSw2SEFBNkgsQ0FBQyxDQUFDLFVBQVUsQ0FBQyxDQUFDLENBQUE7SUFDNU0sQ0FBQztJQUVEOzs7Ozs7T0FNRztJQUNILE1BQU0sQ0FB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ekgsQ0FBQztJQUVEOzs7T0FHRztJQUNILE9BQU87UUFDTCxPQUFPLElBQUksQ0FBQyxPQUFPLENBQUMsT0FBTyxDQUFBO0lBQzdCLENBQUM7SUFFRDs7O09BR0c7SUFDSCxNQUFNO1FBQ0osT0FBTyxJQUFJLENBQUMsT0FBTyxDQUFDLE1BQU0sQ0FBQTtJQUM1QixDQUFDO0lBRUQ7OztPQUdHO0lBQ0gsU0FBUztRQUNQLG9CQUFvQjtJQUN0QixDQUFDO0NBQ0YiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuLyoqIEJhc2UgY2xhc3MgZm9yIGF1dGhvcml6YXRpb24gcmVzb3VyY2VzIGRlZmluaW5nIGFiaWxpdGllcyBmb3IgYSBtb2RlbC4gKi9cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIEF1dGhvcml6YXRpb25CYXNlUmVzb3VyY2Uge1xuICAvKipcbiAgICogTW9kZWwgY2xhc3MuXG4gICAqIEB0eXBlIHt0eXBlb2YgaW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHQgfCB1bmRlZmluZWR9ICovXG4gIHN0YXRpYyBNb2RlbENsYXNzID0gdW5kZWZpbmVkXG5cbiAgLyoqXG4gICAqIFJ1bnMgY29uc3RydWN0b3IuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gUmVzb3VyY2UgYXJncy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2FiaWxpdHkuanNcIikuZGVmYXVsdH0gW2FyZ3MuYWJpbGl0eV0gLSBBYmlsaXR5IGluc3RhbmNlLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuVmVsb2Npb3VzTG9vc2VPYmplY3R9IFthcmdzLmNvbnRleHRdIC0gQWJpbGl0eSBjb250ZXh0LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuVmVsb2Npb3VzTG9vc2VPYmplY3R9IFthcmdzLmxvY2Fsc10gLSBBYmlsaXR5IGxvY2Fscy5cbiAgICovXG4gIGNvbnN0cnVjdG9yKHthYmlsaXR5LCBjb250ZXh0ID0ge30sIGxvY2FscyA9IHt9fSkge1xuICAgIHRoaXMuYWJpbGl0eSA9IGFiaWxpdHlcbiAgICB0aGlzLmNvbnRleHQgPSBjb250ZXh0XG4gICAgdGhpcy5sb2NhbHMgPSBsb2NhbHNcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG1vZGVsIGNsYXNzLlxuICAgKiBAcmV0dXJucyB7dHlwZW9mIGltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSAtIE1vZGVsIGNsYXNzIGhhbmRsZWQgYnkgdGhpcyByZXNvdXJjZS5cbiAgICovXG4gIHN0YXRpYyBtb2RlbENsYXNzKCkge1xuICAgIGlmICghdGhpcy5Nb2RlbENsYXNzKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYCR7dGhpcy5uYW1lfSBtdXN0IGRlZmluZSBzdGF0aWMgTW9kZWxDbGFzcyBiZWZvcmUgY2FsbGluZyBhYmlsaXR5IGhlbHBlcnMuYClcbiAgICB9XG5cbiAgICByZXR1cm4gdGhpcy5Nb2RlbENsYXNzXG4gIH1cblxuICAvKipcbiAgICogUnVucyBjYW4uXG4gICAqIEB0ZW1wbGF0ZSB7dHlwZW9mIGltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBNQ1xuICAgKiBAcGFyYW0ge3N0cmluZyB8IHN0cmluZ1tdfSBhY3Rpb25zIC0gQWJpbGl0eSBhY3Rpb24ocykuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9hYmlsaXR5LmpzXCIpLkFiaWxpdHlDb25kaXRpb25zVHlwZTxNQz59IFtjb25kaXRpb25zXSAtIENvbmRpdGlvbnMuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIGNhbihhY3Rpb25zLCBjb25kaXRpb25zKSB7XG4gICAgdGhpcy5hc3NlcnRSZXNvdXJjZUNvbmRpdGlvbnNTaWduYXR1cmUoe2NvbmRpdGlvbnMsIG1ldGhvZE5hbWU6IFwiY2FuXCJ9KVxuICAgIHRoaXMucmVxdWlyZWRBYmlsaXR5KCkuY2FuKGFjdGlvbnMsIHRoaXMucmVxdWlyZWRNb2RlbENsYXNzKCksIC8qKiBAdHlwZSB7aW1wb3J0KFwiLi9hYmlsaXR5LmpzXCIpLkFiaWxpdHlDb25kaXRpb25zVHlwZTx0eXBlb2YgaW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHQ+IHwgdW5kZWZpbmVkfSAqLyAoY29uZGl0aW9ucykpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBjYW5ub3QuXG4gICAqIEB0ZW1wbGF0ZSB7dHlwZW9mIGltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBNQ1xuICAgKiBAcGFyYW0ge3N0cmluZyB8IHN0cmluZ1tdfSBhY3Rpb25zIC0gQWJpbGl0eSBhY3Rpb24ocykuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9hYmlsaXR5LmpzXCIpLkFiaWxpdHlDb25kaXRpb25zVHlwZTxNQz59IFtjb25kaXRpb25zXSAtIENvbmRpdGlvbnMuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIGNhbm5vdChhY3Rpb25zLCBjb25kaXRpb25zKSB7XG4gICAgdGhpcy5hc3NlcnRSZXNvdXJjZUNvbmRpdGlvbnNTaWduYXR1cmUoe2NvbmRpdGlvbnMsIG1ldGhvZE5hbWU6IFwiY2Fubm90XCJ9KVxuICAgIHRoaXMucmVxdWlyZWRBYmlsaXR5KCkuY2Fubm90KGFjdGlvbnMsIHRoaXMucmVxdWlyZWRNb2RlbENsYXNzKCksIC8qKiBAdHlwZSB7aW1wb3J0KFwiLi9hYmlsaXR5LmpzXCIpLkFiaWxpdHlDb25kaXRpb25zVHlwZTx0eXBlb2YgaW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHQ+IHwgdW5kZWZpbmVkfSAqLyAoY29uZGl0aW9ucykpXG4gIH1cblxuICAvKipcbiAgICogUnVucyByZXF1aXJlZCBhYmlsaXR5LlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9hYmlsaXR5LmpzXCIpLmRlZmF1bHR9IC0gQWJpbGl0eSBpbnN0YW5jZS5cbiAgICovXG4gIHJlcXVpcmVkQWJpbGl0eSgpIHtcbiAgICBpZiAoIXRoaXMuYWJpbGl0eSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGAke3RoaXMuY29uc3RydWN0b3IubmFtZX0gcmVxdWlyZXMgYW4gYWJpbGl0eSBpbnN0YW5jZSBiZWZvcmUgZGVmaW5pbmcgYWJpbGl0aWVzLmApXG4gICAgfVxuXG4gICAgcmV0dXJuIHRoaXMuYWJpbGl0eVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmVxdWlyZWQgbW9kZWwgY2xhc3MuXG4gICAqIEByZXR1cm5zIHt0eXBlb2YgaW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IC0gTW9kZWwgY2xhc3MgaGFuZGxlZCBieSB0aGlzIHJlc291cmNlLlxuICAgKi9cbiAgcmVxdWlyZWRNb2RlbENsYXNzKCkge1xuICAgIGNvbnN0IFJlc291cmNlQ2xhc3MgPSAvKiogQHR5cGUge3R5cGVvZiBBdXRob3JpemF0aW9uQmFzZVJlc291cmNlfSAqLyAodGhpcy5jb25zdHJ1Y3RvcilcblxuICAgIHJldHVybiBSZXNvdXJjZUNsYXNzLm1vZGVsQ2xhc3MoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYXNzZXJ0IHJlc291cmNlIGNvbmRpdGlvbnMgc2lnbmF0dXJlLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIFNpZ25hdHVyZSBhcmdzLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBhcmdzLmNvbmRpdGlvbnMgLSBDb25kaXRpb25zIHZhbHVlLlxuICAgKiBAcGFyYW0ge1wiY2FuXCIgfCBcImNhbm5vdFwifSBhcmdzLm1ldGhvZE5hbWUgLSBNZXRob2QgbmFtZS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBhc3NlcnRSZXNvdXJjZUNvbmRpdGlvbnNTaWduYXR1cmUoe2NvbmRpdGlvbnMsIG1ldGhvZE5hbWV9KSB7XG4gICAgaWYgKHR5cGVvZiBjb25kaXRpb25zID09PSBcImZ1bmN0aW9uXCIgJiYgXCJwcmltYXJ5S2V5XCIgaW4gY29uZGl0aW9ucyAmJiBcIl9uZXdRdWVyeVwiIGluIGNvbmRpdGlvbnMpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgJHt0aGlzLmNvbnN0cnVjdG9yLm5hbWV9LiR7bWV0aG9kTmFtZX0oLi4uKSBubyBsb25nZXIgYWNjZXB0cyBhIG1vZGVsIGNsYXNzLiBEZWZpbmUgc3RhdGljIE1vZGVsQ2xhc3MgYW5kIHBhc3Mgb25seSBjb25kaXRpb25zLmApXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGNvbnRleHQuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLlZlbG9jaW91c0xvb3NlT2JqZWN0fSAtIEFiaWxpdHkgY29udGV4dC5cbiAgICovXG4gIGdldENvbnRleHQoKSB7XG4gICAgcmV0dXJuIHRoaXMuY29udGV4dFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGxvY2Fscy5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuVmVsb2Npb3VzTG9vc2VPYmplY3R9IC0gQWJpbGl0eSBsb2NhbHMuXG4gICAqL1xuICBnZXRMb2NhbHMoKSB7XG4gICAgcmV0dXJuIHRoaXMubG9jYWxzXG4gIH1cblxuICAvKipcbiAgICogUnVucyBjdXJyZW50IHVzZXIuXG4gICAqIEByZXR1cm5zIHt1bmtub3dufSAtIEN1cnJlbnQgdXNlciBmcm9tIGNvbnRleHQuXG4gICAqL1xuICBjdXJyZW50VXNlcigpIHtcbiAgICByZXR1cm4gdGhpcy5jb250ZXh0LmN1cnJlbnRVc2VyXG4gIH1cblxuICAvKipcbiAgICogUnVucyBjdXJyZW50IGRldmljZS5cbiAgICogQHJldHVybnMge3Vua25vd259IC0gQ3VycmVudCBkZXZpY2UgZnJvbSBjb250ZXh0LlxuICAgKi9cbiAgY3VycmVudERldmljZSgpIHtcbiAgICByZXR1cm4gdGhpcy5jb250ZXh0LmN1cnJlbnREZXZpY2VcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG9mZmxpbmUgZ3JhbnQuXG4gICAqIEByZXR1cm5zIHt1bmtub3dufSAtIE9mZmxpbmUgZ3JhbnQgZnJvbSBjb250ZXh0LlxuICAgKi9cbiAgb2ZmbGluZUdyYW50KCkge1xuICAgIHJldHVybiB0aGlzLmNvbnRleHQub2ZmbGluZUdyYW50XG4gIH1cblxuICAvKipcbiAgICogUnVucyBub3cuXG4gICAqIEByZXR1cm5zIHtEYXRlfSAtIEN1cnJlbnQgdGltZSBmcm9tIGNvbnRleHQgb3IgdGhlIHN5c3RlbSBjbG9jay5cbiAgICovXG4gIG5vdygpIHtcbiAgICBpZiAodHlwZW9mIHRoaXMuY29udGV4dC5ub3cgPT09IFwiZnVuY3Rpb25cIikgcmV0dXJuIHRoaXMuY29udGV4dC5ub3coKVxuICAgIGlmICh0aGlzLmNvbnRleHQubm93IGluc3RhbmNlb2YgRGF0ZSkgcmV0dXJuIHRoaXMuY29udGV4dC5ub3dcblxuICAgIHJldHVybiBuZXcgRGF0ZSgpXG4gIH1cblxuICAvKipcbiAgICogUnVucyByZXNvdXJjZSBydW50aW1lLlxuICAgKiBAcmV0dXJucyB7XCJiYWNrZW5kXCIgfCBcImZyb250ZW5kXCIgfCBcIm9mZmxpbmVcIn0gLSBSZXNvdXJjZSBydW50aW1lIGNvbnRleHQuXG4gICAqL1xuICByZXNvdXJjZVJ1bnRpbWUoKSB7XG4gICAgaWYgKHRoaXMuY29udGV4dC5yZXNvdXJjZVJ1bnRpbWUgPT09IFwiZnJvbnRlbmRcIikgcmV0dXJuIFwiZnJvbnRlbmRcIlxuICAgIGlmICh0aGlzLmNvbnRleHQucmVzb3VyY2VSdW50aW1lID09PSBcIm9mZmxpbmVcIikgcmV0dXJuIFwib2ZmbGluZVwiXG5cbiAgICByZXR1cm4gXCJiYWNrZW5kXCJcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGlzIGJhY2tlbmQuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgdGhlIHJlc291cmNlIGlzIHJ1bm5pbmcgaW4gdGhlIGJhY2tlbmQgcnVudGltZS5cbiAgICovXG4gIGlzQmFja2VuZCgpIHtcbiAgICByZXR1cm4gdGhpcy5yZXNvdXJjZVJ1bnRpbWUoKSA9PT0gXCJiYWNrZW5kXCJcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGlzIGZyb250ZW5kLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHRoZSByZXNvdXJjZSBpcyBydW5uaW5nIGluIHRoZSBmcm9udGVuZCBydW50aW1lLlxuICAgKi9cbiAgaXNGcm9udGVuZCgpIHtcbiAgICByZXR1cm4gdGhpcy5yZXNvdXJjZVJ1bnRpbWUoKSA9PT0gXCJmcm9udGVuZFwiXG4gIH1cblxuICAvKipcbiAgICogUnVucyBpcyBvZmZsaW5lLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHRoZSByZXNvdXJjZSBpcyBydW5uaW5nIHdpdGggb2ZmbGluZSBjb250ZXh0LlxuICAgKi9cbiAgaXNPZmZsaW5lKCkge1xuICAgIHJldHVybiB0aGlzLnJlc291cmNlUnVudGltZSgpID09PSBcIm9mZmxpbmVcIiB8fCB0aGlzLmNvbnRleHQub2ZmbGluZUdyYW50ICE9PSB1bmRlZmluZWRcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXNvbHZlcyBhIG1vZGVsIGNsYXNzIGZyb20gdGhlIHBvcnRhYmxlIHJlc291cmNlIGNvbnRleHQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIC0gTW9kZWwgbmFtZS5cbiAgICogQHJldHVybnMge3Vua25vd259IC0gTW9kZWwgY2xhc3MgZnJvbSByZWdpc3RyeS5cbiAgICovXG4gIG1vZGVsKG5hbWUpIHtcbiAgICBjb25zdCByZWdpc3RyeSA9IHRoaXMuY29udGV4dC5tb2RlbFJlZ2lzdHJ5XG5cbiAgICBpZiAocmVnaXN0cnkgJiYgdHlwZW9mIHJlZ2lzdHJ5ID09PSBcIm9iamVjdFwiKSB7XG4gICAgICBpZiAoXCJtb2RlbFwiIGluIHJlZ2lzdHJ5ICYmIHR5cGVvZiByZWdpc3RyeS5tb2RlbCA9PT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICAgIGNvbnN0IG1vZGVsQ2xhc3MgPSByZWdpc3RyeS5tb2RlbChuYW1lKVxuXG4gICAgICAgIGlmIChtb2RlbENsYXNzKSByZXR1cm4gbW9kZWxDbGFzc1xuICAgICAgfVxuXG4gICAgICBpZiAobmFtZSBpbiByZWdpc3RyeSkgcmV0dXJuIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgdW5rbm93bj59ICovIChyZWdpc3RyeSlbbmFtZV1cbiAgICB9XG5cbiAgICBjb25zdCBjb250ZXh0TW9kZWwgPSB0aGlzLmNvbnRleHQubW9kZWxcblxuICAgIGlmICh0eXBlb2YgY29udGV4dE1vZGVsID09PSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgIGNvbnN0IG1vZGVsQ2xhc3MgPSBjb250ZXh0TW9kZWwobmFtZSlcblxuICAgICAgaWYgKG1vZGVsQ2xhc3MpIHJldHVybiBtb2RlbENsYXNzXG4gICAgfVxuXG4gICAgY29uc3QgY29uZmlndXJhdGlvbiA9IHRoaXMuY29udGV4dC5jb25maWd1cmF0aW9uXG5cbiAgICBpZiAoY29uZmlndXJhdGlvbikge1xuICAgICAgY29uc3QgbW9kZWxDbGFzc2VzID0gY29uZmlndXJhdGlvbi5nZXRNb2RlbENsYXNzZXMoKVxuXG4gICAgICBpZiAobmFtZSBpbiBtb2RlbENsYXNzZXMpIHJldHVybiBtb2RlbENsYXNzZXNbbmFtZV1cbiAgICB9XG5cbiAgICB0aHJvdyBuZXcgRXJyb3IoYCR7dGhpcy5jb25zdHJ1Y3Rvci5uYW1lfSBjb3VsZCBub3QgcmVzb2x2ZSBtb2RlbCAnJHtuYW1lfScgZnJvbSB0aGUgcmVzb3VyY2UgY29udGV4dCBtb2RlbCByZWdpc3RyeS5gKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmVxdWVzdC5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4uL2h0dHAtc2VydmVyL2NsaWVudC9yZXF1ZXN0LmpzXCIpLmRlZmF1bHQgfCBpbXBvcnQoXCIuLi9odHRwLXNlcnZlci9jbGllbnQvd2Vic29ja2V0LXJlcXVlc3QuanNcIikuZGVmYXVsdCB8IHVuZGVmaW5lZH0gLSBSZXF1ZXN0IGZyb20gY29udGV4dC5cbiAgICovXG4gIHJlcXVlc3QoKSB7XG4gICAgcmV0dXJuIHRoaXMuY29udGV4dC5yZXF1ZXN0XG4gIH1cblxuICAvKipcbiAgICogUnVucyBwYXJhbXMuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLlZlbG9jaW91c1BhcmFtcyB8IHVuZGVmaW5lZH0gLSBQYXJhbXMgZnJvbSBjb250ZXh0LlxuICAgKi9cbiAgcGFyYW1zKCkge1xuICAgIHJldHVybiB0aGlzLmNvbnRleHQucGFyYW1zXG4gIH1cblxuICAvKipcbiAgICogUnVucyBhYmlsaXRpZXMuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIEltcGxlbWVudCBpbiBzdWJjbGFzc2VzIHRvIGRlZmluZSBhYmlsaXRpZXMuXG4gICAqL1xuICBhYmlsaXRpZXMoKSB7XG4gICAgLy8gTm8tb3AgYnkgZGVmYXVsdC5cbiAgfVxufVxuIl19