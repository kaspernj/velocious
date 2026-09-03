// @ts-check
/**
 * Model class supported by authorization and shared frontend-model resources.
 * @typedef {{new (): import("../database/record/index.js").default | import("../frontend-models/base.js").default, getModelName: () => string}} AuthorizationResourceModelClass
 */
/** Base class for authorization resources defining abilities for a model. */
export default class AuthorizationBaseResource {
    /**
     * Model class.
     * @type {AuthorizationResourceModelClass | undefined} */
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
     * @template {AuthorizationResourceModelClass} TModelClass
     * @this {{ModelClass: TModelClass | undefined, name: string}}
     * @returns {TModelClass} - Model class handled by this resource.
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
        // Authorization query rules are backend-only even when a shared resource is bound to a frontend model.
        const modelClass = /** @type {typeof import("../database/record/index.js").default} */ (this.requiredModelClass());
        this.requiredAbility().can(actions, modelClass, /** @type {import("./ability.js").AbilityConditionsType<typeof import("../database/record/index.js").default> | undefined} */ (conditions));
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
        // Authorization query rules are backend-only even when a shared resource is bound to a frontend model.
        const modelClass = /** @type {typeof import("../database/record/index.js").default} */ (this.requiredModelClass());
        this.requiredAbility().cannot(actions, modelClass, /** @type {import("./ability.js").AbilityConditionsType<typeof import("../database/record/index.js").default> | undefined} */ (conditions));
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
     * @returns {AuthorizationResourceModelClass} - Model class handled by this resource.
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYmFzZS1yZXNvdXJjZS5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9hdXRob3JpemF0aW9uL2Jhc2UtcmVzb3VyY2UuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaOzs7R0FHRztBQUVILDZFQUE2RTtBQUM3RSxNQUFNLENBQUMsT0FBTyxPQUFPLHlCQUF5QjtJQUM1Qzs7NkRBRXlEO0lBQ3pELE1BQU0sQ0FBQyxVQUFVLEdBQUcsU0FBUyxDQUFBO0lBRTdCOzs7Ozs7T0FNRztJQUNILFlBQVksRUFBQyxPQUFPLEVBQUUsT0FBTyxHQUFHLEVBQUUsRUFBRSxNQUFNLEdBQUcsRUFBRSxFQUFDO1FBQzlDLElBQUksQ0FBQyxPQUFPLEdBQUcsT0FBTyxDQUFBO1FBQ3RCLElBQUksQ0FBQyxPQUFPLEdBQUcsT0FBTyxDQUFBO1FBQ3RCLElBQUksQ0FBQyxNQUFNLEdBQUcsTUFBTSxDQUFBO0lBQ3RCLENBQUM7SUFFRDs7Ozs7T0FLRztJQUNILE1BQU0sQ0FBQyxVQUFVO1FBQ2YsSUFBSSxDQUFDLElBQUksQ0FBQyxVQUFVLEVBQUUsQ0FBQztZQUNyQixNQUFNLElBQUksS0FBSyxDQUFDLEdBQUcsSUFBSSxDQUFDLElBQUksZ0VBQWdFLENBQUMsQ0FBQTtRQUMvRixDQUFDO1FBRUQsT0FBTyxJQUFJLENBQUMsVUFBVSxDQUFBO0lBQ3hCLENBQUM7SUFFRDs7Ozs7O09BTUc7SUFDSCxHQUFHLENBQUMsT0FBTyxFQUFFLFVBQVU7UUFDckIsSUFBSSxDQUFDLGlDQUFpQyxDQUFDLEVBQUMsVUFBVSxFQUFFLFVBQVUsRUFBRSxLQUFLLEVBQUMsQ0FBQyxDQUFBO1FBQ3ZFLHVHQUF1RztRQUN2RyxNQUFNLFVBQVUsR0FBRyxtRUFBbUUsQ0FBQyxDQUFDLElBQUksQ0FBQyxrQkFBa0IsRUFBRSxDQUFDLENBQUE7UUFFbEgsSUFBSSxDQUFDLGVBQWUsRUFBRSxDQUFDLEdBQUcsQ0FBQyxPQUFPLEVBQUUsVUFBVSxFQUFFLDZIQUE2SCxDQUFDLENBQUMsVUFBVSxDQUFDLENBQUMsQ0FBQTtJQUM3TCxDQUFDO0lBRUQ7Ozs7OztPQU1HO0lBQ0gsTUFBTSxDQUFDLE9BQU8sRUFBRSxVQUFVO1FBQ3hCLElBQUksQ0FBQyxpQ0FBaUMsQ0FBQyxFQUFDLFVBQVUsRUFBRSxVQUFVLEVBQUUsUUFBUSxFQUFDLENBQUMsQ0FBQTtRQUMxRSx1R0FBdUc7UUFDdkcsTUFBTSxVQUFVLEdBQUcsbUVBQW1FLENBQUMsQ0FBQyxJQUFJLENBQUMsa0JBQWtCLEVBQUUsQ0FBQyxDQUFBO1FBRWxILElBQUksQ0FBQyxlQUFlLEVBQUUsQ0FBQyxNQUFNLENBQUMsT0FBTyxFQUFFLFVBQVUsRUFBRSw2SEFBNkgsQ0FBQyxDQUFDLFVBQVUsQ0FBQyxDQUFDLENBQUE7SUFDaE0sQ0FBQztJQUVEOzs7T0FHRztJQUNILGVBQWU7UUFDYixJQUFJLENBQUMsSUFBSSxDQUFDLE9BQU8sRUFBRSxDQUFDO1lBQ2xCLE1BQU0sSUFBSSxLQUFLLENBQUMsR0FBRyxJQUFJLENBQUMsV0FBVyxDQUFDLElBQUksMERBQTBELENBQUMsQ0FBQTtRQUNyRyxDQUFDO1FBRUQsT0FBTyxJQUFJLENBQUMsT0FBTyxDQUFBO0lBQ3JCLENBQUM7SUFFRDs7O09BR0c7SUFDSCxrQkFBa0I7UUFDaEIsTUFBTSxhQUFhLEdBQUcsK0NBQStDLENBQUMsQ0FBQyxJQUFJLENBQUMsV0FBVyxDQUFDLENBQUE7UUFFeEYsT0FBTyxhQUFhLENBQUMsVUFBVSxFQUFFLENBQUE7SUFDbkMsQ0FBQztJQUVEOzs7Ozs7T0FNRztJQUNILGlDQUFpQyxDQUFDLEVBQUMsVUFBVSxFQUFFLFVBQVUsRUFBQztRQUN4RCxJQUFJLE9BQU8sVUFBVSxLQUFLLFVBQVUsSUFBSSxZQUFZLElBQUksVUFBVSxJQUFJLFdBQVcsSUFBSSxVQUFVLEVBQUUsQ0FBQztZQUNoRyxNQUFNLElBQUksS0FBSyxDQUFDLEdBQUcsSUFBSSxDQUFDLFdBQVcsQ0FBQyxJQUFJLElBQUksVUFBVSwyRkFBMkYsQ0FBQyxDQUFBO1FBQ3BKLENBQUM7SUFDSCxDQUFDO0lBRUQ7OztPQUdHO0lBQ0gsVUFBVTtRQUNSLE9BQU8sSUFBSSxDQUFDLE9BQU8sQ0FBQTtJQUNyQixDQUFDO0lBRUQ7OztPQUdHO0lBQ0gsU0FBUztRQUNQLE9BQU8sSUFBSSxDQUFDLE1BQU0sQ0FBQTtJQUNwQixDQUFDO0lBRUQ7OztPQUdHO0lBQ0gsV0FBVztRQUNULE9BQU8sSUFBSSxDQUFDLE9BQU8sQ0FBQyxXQUFXLENBQUE7SUFDakMsQ0FBQztJQUVEOzs7T0FHRztJQUNILGFBQWE7UUFDWCxPQUFPLElBQUksQ0FBQyxPQUFPLENBQUMsYUFBYSxDQUFBO0lBQ25DLENBQUM7SUFFRDs7O09BR0c7SUFDSCxZQUFZO1FBQ1YsT0FBTyxJQUFJLENBQUMsT0FBTyxDQUFDLFlBQVksQ0FBQTtJQUNsQyxDQUFDO0lBRUQ7OztPQUdHO0lBQ0gsR0FBRztRQUNELElBQUksT0FBTyxJQUFJLENBQUMsT0FBTyxDQUFDLEdBQUcsS0FBSyxVQUFVO1lBQUUsT0FBTyxJQUFJLENBQUMsT0FBTyxDQUFDLEdBQUcsRUFBRSxDQUFBO1FBQ3JFLElBQUksSUFBSSxDQUFDLE9BQU8sQ0FBQyxHQUFHLFlBQVksSUFBSTtZQUFFLE9BQU8sSUFBSSxDQUFDLE9BQU8sQ0FBQyxHQUFHLENBQUE7UUFFN0QsT0FBTyxJQUFJLElBQUksRUFBRSxDQUFBO0lBQ25CLENBQUM7SUFFRDs7O09BR0c7SUFDSCxlQUFlO1FBQ2IsSUFBSSxJQUFJLENBQUMsT0FBTyxDQUFDLGVBQWUsS0FBSyxVQUFVO1lBQUUsT0FBTyxVQUFVLENBQUE7UUFDbEUsSUFBSSxJQUFJLENBQUMsT0FBTyxDQUFDLGVBQWUsS0FBSyxTQUFTO1lBQUUsT0FBTyxTQUFTLENBQUE7UUFFaEUsT0FBTyxTQUFTLENBQUE7SUFDbEIsQ0FBQztJQUVEOzs7T0FHRztJQUNILFNBQVM7UUFDUCxPQUFPLElBQUksQ0FBQyxlQUFlLEVBQUUsS0FBSyxTQUFTLENBQUE7SUFDN0MsQ0FBQztJQUVEOzs7T0FHRztJQUNILFVBQVU7UUFDUixPQUFPLElBQUksQ0FBQyxlQUFlLEVBQUUsS0FBSyxVQUFVLENBQUE7SUFDOUMsQ0FBQztJQUVEOzs7T0FHRztJQUNILFNBQVM7UUFDUCxPQUFPLElBQUksQ0FBQyxlQUFlLEVBQUUsS0FBSyxTQUFTLElBQUksSUFBSSxDQUFDLE9BQU8sQ0FBQyxZQUFZLEtBQUssU0FBUyxDQUFBO0lBQ3hGLENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsS0FBSyxDQUFDLElBQUk7UUFDUixNQUFNLFFBQVEsR0FBRyxJQUFJLENBQUMsT0FBTyxDQUFDLGFBQWEsQ0FBQTtRQUUzQyxJQUFJLFFBQVEsSUFBSSxPQUFPLFFBQVEsS0FBSyxRQUFRLEVBQUUsQ0FBQztZQUM3QyxJQUFJLE9BQU8sSUFBSSxRQUFRLElBQUksT0FBTyxRQUFRLENBQUMsS0FBSyxLQUFLLFVBQVUsRUFBRSxDQUFDO2dCQUNoRSxNQUFNLFVBQVUsR0FBRyxRQUFRLENBQUMsS0FBSyxDQUFDLElBQUksQ0FBQyxDQUFBO2dCQUV2QyxJQUFJLFVBQVU7b0JBQUUsT0FBTyxVQUFVLENBQUE7WUFDbkMsQ0FBQztZQUVELElBQUksSUFBSSxJQUFJLFFBQVE7Z0JBQUUsT0FBTyxzQ0FBc0MsQ0FBQyxDQUFDLFFBQVEsQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFBO1FBQ3RGLENBQUM7UUFFRCxNQUFNLFlBQVksR0FBRyxJQUFJLENBQUMsT0FBTyxDQUFDLEtBQUssQ0FBQTtRQUV2QyxJQUFJLE9BQU8sWUFBWSxLQUFLLFVBQVUsRUFBRSxDQUFDO1lBQ3ZDLE1BQU0sVUFBVSxHQUFHLFlBQVksQ0FBQyxJQUFJLENBQUMsQ0FBQTtZQUVyQyxJQUFJLFVBQVU7Z0JBQUUsT0FBTyxVQUFVLENBQUE7UUFDbkMsQ0FBQztRQUVELE1BQU0sYUFBYSxHQUFHLElBQUksQ0FBQyxPQUFPLENBQUMsYUFBYSxDQUFBO1FBRWhELElBQUksYUFBYSxFQUFFLENBQUM7WUFDbEIsTUFBTSxZQUFZLEdBQUcsYUFBYSxDQUFDLGVBQWUsRUFBRSxDQUFBO1lBRXBELElBQUksSUFBSSxJQUFJLFlBQVk7Z0JBQUUsT0FBTyxZQUFZLENBQUMsSUFBSSxDQUFDLENBQUE7UUFDckQsQ0FBQztRQUVELE1BQU0sSUFBSSxLQUFLLENBQUMsR0FBRyxJQUFJLENBQUMsV0FBVyxDQUFDLElBQUksNkJBQTZCLElBQUksNkNBQTZDLENBQUMsQ0FBQTtJQUN6SCxDQUFDO0lBRUQ7OztPQUdHO0lBQ0gsT0FBTztRQUNMLE9BQU8sSUFBSSxDQUFDLE9BQU8sQ0FBQyxPQUFPLENBQUE7SUFDN0IsQ0FBQztJQUVEOzs7T0FHRztJQUNILE1BQU07UUFDSixPQUFPLElBQUksQ0FBQyxPQUFPLENBQUMsTUFBTSxDQUFBO0lBQzVCLENBQUM7SUFFRDs7O09BR0c7SUFDSCxTQUFTO1FBQ1Asb0JBQW9CO0lBQ3RCLENBQUM7Q0FDRiIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG4vKipcbiAqIE1vZGVsIGNsYXNzIHN1cHBvcnRlZCBieSBhdXRob3JpemF0aW9uIGFuZCBzaGFyZWQgZnJvbnRlbmQtbW9kZWwgcmVzb3VyY2VzLlxuICogQHR5cGVkZWYge3tuZXcgKCk6IGltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0IHwgaW1wb3J0KFwiLi4vZnJvbnRlbmQtbW9kZWxzL2Jhc2UuanNcIikuZGVmYXVsdCwgZ2V0TW9kZWxOYW1lOiAoKSA9PiBzdHJpbmd9fSBBdXRob3JpemF0aW9uUmVzb3VyY2VNb2RlbENsYXNzXG4gKi9cblxuLyoqIEJhc2UgY2xhc3MgZm9yIGF1dGhvcml6YXRpb24gcmVzb3VyY2VzIGRlZmluaW5nIGFiaWxpdGllcyBmb3IgYSBtb2RlbC4gKi9cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIEF1dGhvcml6YXRpb25CYXNlUmVzb3VyY2Uge1xuICAvKipcbiAgICogTW9kZWwgY2xhc3MuXG4gICAqIEB0eXBlIHtBdXRob3JpemF0aW9uUmVzb3VyY2VNb2RlbENsYXNzIHwgdW5kZWZpbmVkfSAqL1xuICBzdGF0aWMgTW9kZWxDbGFzcyA9IHVuZGVmaW5lZFxuXG4gIC8qKlxuICAgKiBSdW5zIGNvbnN0cnVjdG9yLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIFJlc291cmNlIGFyZ3MuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9hYmlsaXR5LmpzXCIpLmRlZmF1bHR9IFthcmdzLmFiaWxpdHldIC0gQWJpbGl0eSBpbnN0YW5jZS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLlZlbG9jaW91c0xvb3NlT2JqZWN0fSBbYXJncy5jb250ZXh0XSAtIEFiaWxpdHkgY29udGV4dC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLlZlbG9jaW91c0xvb3NlT2JqZWN0fSBbYXJncy5sb2NhbHNdIC0gQWJpbGl0eSBsb2NhbHMuXG4gICAqL1xuICBjb25zdHJ1Y3Rvcih7YWJpbGl0eSwgY29udGV4dCA9IHt9LCBsb2NhbHMgPSB7fX0pIHtcbiAgICB0aGlzLmFiaWxpdHkgPSBhYmlsaXR5XG4gICAgdGhpcy5jb250ZXh0ID0gY29udGV4dFxuICAgIHRoaXMubG9jYWxzID0gbG9jYWxzXG4gIH1cblxuICAvKipcbiAgICogUnVucyBtb2RlbCBjbGFzcy5cbiAgICogQHRlbXBsYXRlIHtBdXRob3JpemF0aW9uUmVzb3VyY2VNb2RlbENsYXNzfSBUTW9kZWxDbGFzc1xuICAgKiBAdGhpcyB7e01vZGVsQ2xhc3M6IFRNb2RlbENsYXNzIHwgdW5kZWZpbmVkLCBuYW1lOiBzdHJpbmd9fVxuICAgKiBAcmV0dXJucyB7VE1vZGVsQ2xhc3N9IC0gTW9kZWwgY2xhc3MgaGFuZGxlZCBieSB0aGlzIHJlc291cmNlLlxuICAgKi9cbiAgc3RhdGljIG1vZGVsQ2xhc3MoKSB7XG4gICAgaWYgKCF0aGlzLk1vZGVsQ2xhc3MpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgJHt0aGlzLm5hbWV9IG11c3QgZGVmaW5lIHN0YXRpYyBNb2RlbENsYXNzIGJlZm9yZSBjYWxsaW5nIGFiaWxpdHkgaGVscGVycy5gKVxuICAgIH1cblxuICAgIHJldHVybiB0aGlzLk1vZGVsQ2xhc3NcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNhbi5cbiAgICogQHRlbXBsYXRlIHt0eXBlb2YgaW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IE1DXG4gICAqIEBwYXJhbSB7c3RyaW5nIHwgc3RyaW5nW119IGFjdGlvbnMgLSBBYmlsaXR5IGFjdGlvbihzKS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2FiaWxpdHkuanNcIikuQWJpbGl0eUNvbmRpdGlvbnNUeXBlPE1DPn0gW2NvbmRpdGlvbnNdIC0gQ29uZGl0aW9ucy5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgY2FuKGFjdGlvbnMsIGNvbmRpdGlvbnMpIHtcbiAgICB0aGlzLmFzc2VydFJlc291cmNlQ29uZGl0aW9uc1NpZ25hdHVyZSh7Y29uZGl0aW9ucywgbWV0aG9kTmFtZTogXCJjYW5cIn0pXG4gICAgLy8gQXV0aG9yaXphdGlvbiBxdWVyeSBydWxlcyBhcmUgYmFja2VuZC1vbmx5IGV2ZW4gd2hlbiBhIHNoYXJlZCByZXNvdXJjZSBpcyBib3VuZCB0byBhIGZyb250ZW5kIG1vZGVsLlxuICAgIGNvbnN0IG1vZGVsQ2xhc3MgPSAvKiogQHR5cGUge3R5cGVvZiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gKi8gKHRoaXMucmVxdWlyZWRNb2RlbENsYXNzKCkpXG5cbiAgICB0aGlzLnJlcXVpcmVkQWJpbGl0eSgpLmNhbihhY3Rpb25zLCBtb2RlbENsYXNzLCAvKiogQHR5cGUge2ltcG9ydChcIi4vYWJpbGl0eS5qc1wiKS5BYmlsaXR5Q29uZGl0aW9uc1R5cGU8dHlwZW9mIGltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0PiB8IHVuZGVmaW5lZH0gKi8gKGNvbmRpdGlvbnMpKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY2Fubm90LlxuICAgKiBAdGVtcGxhdGUge3R5cGVvZiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gTUNcbiAgICogQHBhcmFtIHtzdHJpbmcgfCBzdHJpbmdbXX0gYWN0aW9ucyAtIEFiaWxpdHkgYWN0aW9uKHMpLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vYWJpbGl0eS5qc1wiKS5BYmlsaXR5Q29uZGl0aW9uc1R5cGU8TUM+fSBbY29uZGl0aW9uc10gLSBDb25kaXRpb25zLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBjYW5ub3QoYWN0aW9ucywgY29uZGl0aW9ucykge1xuICAgIHRoaXMuYXNzZXJ0UmVzb3VyY2VDb25kaXRpb25zU2lnbmF0dXJlKHtjb25kaXRpb25zLCBtZXRob2ROYW1lOiBcImNhbm5vdFwifSlcbiAgICAvLyBBdXRob3JpemF0aW9uIHF1ZXJ5IHJ1bGVzIGFyZSBiYWNrZW5kLW9ubHkgZXZlbiB3aGVuIGEgc2hhcmVkIHJlc291cmNlIGlzIGJvdW5kIHRvIGEgZnJvbnRlbmQgbW9kZWwuXG4gICAgY29uc3QgbW9kZWxDbGFzcyA9IC8qKiBAdHlwZSB7dHlwZW9mIGltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSAqLyAodGhpcy5yZXF1aXJlZE1vZGVsQ2xhc3MoKSlcblxuICAgIHRoaXMucmVxdWlyZWRBYmlsaXR5KCkuY2Fubm90KGFjdGlvbnMsIG1vZGVsQ2xhc3MsIC8qKiBAdHlwZSB7aW1wb3J0KFwiLi9hYmlsaXR5LmpzXCIpLkFiaWxpdHlDb25kaXRpb25zVHlwZTx0eXBlb2YgaW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHQ+IHwgdW5kZWZpbmVkfSAqLyAoY29uZGl0aW9ucykpXG4gIH1cblxuICAvKipcbiAgICogUnVucyByZXF1aXJlZCBhYmlsaXR5LlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9hYmlsaXR5LmpzXCIpLmRlZmF1bHR9IC0gQWJpbGl0eSBpbnN0YW5jZS5cbiAgICovXG4gIHJlcXVpcmVkQWJpbGl0eSgpIHtcbiAgICBpZiAoIXRoaXMuYWJpbGl0eSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGAke3RoaXMuY29uc3RydWN0b3IubmFtZX0gcmVxdWlyZXMgYW4gYWJpbGl0eSBpbnN0YW5jZSBiZWZvcmUgZGVmaW5pbmcgYWJpbGl0aWVzLmApXG4gICAgfVxuXG4gICAgcmV0dXJuIHRoaXMuYWJpbGl0eVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmVxdWlyZWQgbW9kZWwgY2xhc3MuXG4gICAqIEByZXR1cm5zIHtBdXRob3JpemF0aW9uUmVzb3VyY2VNb2RlbENsYXNzfSAtIE1vZGVsIGNsYXNzIGhhbmRsZWQgYnkgdGhpcyByZXNvdXJjZS5cbiAgICovXG4gIHJlcXVpcmVkTW9kZWxDbGFzcygpIHtcbiAgICBjb25zdCBSZXNvdXJjZUNsYXNzID0gLyoqIEB0eXBlIHt0eXBlb2YgQXV0aG9yaXphdGlvbkJhc2VSZXNvdXJjZX0gKi8gKHRoaXMuY29uc3RydWN0b3IpXG5cbiAgICByZXR1cm4gUmVzb3VyY2VDbGFzcy5tb2RlbENsYXNzKClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGFzc2VydCByZXNvdXJjZSBjb25kaXRpb25zIHNpZ25hdHVyZS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBTaWduYXR1cmUgYXJncy5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gYXJncy5jb25kaXRpb25zIC0gQ29uZGl0aW9ucyB2YWx1ZS5cbiAgICogQHBhcmFtIHtcImNhblwiIHwgXCJjYW5ub3RcIn0gYXJncy5tZXRob2ROYW1lIC0gTWV0aG9kIG5hbWUuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgYXNzZXJ0UmVzb3VyY2VDb25kaXRpb25zU2lnbmF0dXJlKHtjb25kaXRpb25zLCBtZXRob2ROYW1lfSkge1xuICAgIGlmICh0eXBlb2YgY29uZGl0aW9ucyA9PT0gXCJmdW5jdGlvblwiICYmIFwicHJpbWFyeUtleVwiIGluIGNvbmRpdGlvbnMgJiYgXCJfbmV3UXVlcnlcIiBpbiBjb25kaXRpb25zKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYCR7dGhpcy5jb25zdHJ1Y3Rvci5uYW1lfS4ke21ldGhvZE5hbWV9KC4uLikgbm8gbG9uZ2VyIGFjY2VwdHMgYSBtb2RlbCBjbGFzcy4gRGVmaW5lIHN0YXRpYyBNb2RlbENsYXNzIGFuZCBwYXNzIG9ubHkgY29uZGl0aW9ucy5gKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBjb250ZXh0LlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5WZWxvY2lvdXNMb29zZU9iamVjdH0gLSBBYmlsaXR5IGNvbnRleHQuXG4gICAqL1xuICBnZXRDb250ZXh0KCkge1xuICAgIHJldHVybiB0aGlzLmNvbnRleHRcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBsb2NhbHMuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLlZlbG9jaW91c0xvb3NlT2JqZWN0fSAtIEFiaWxpdHkgbG9jYWxzLlxuICAgKi9cbiAgZ2V0TG9jYWxzKCkge1xuICAgIHJldHVybiB0aGlzLmxvY2Fsc1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY3VycmVudCB1c2VyLlxuICAgKiBAcmV0dXJucyB7dW5rbm93bn0gLSBDdXJyZW50IHVzZXIgZnJvbSBjb250ZXh0LlxuICAgKi9cbiAgY3VycmVudFVzZXIoKSB7XG4gICAgcmV0dXJuIHRoaXMuY29udGV4dC5jdXJyZW50VXNlclxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY3VycmVudCBkZXZpY2UuXG4gICAqIEByZXR1cm5zIHt1bmtub3dufSAtIEN1cnJlbnQgZGV2aWNlIGZyb20gY29udGV4dC5cbiAgICovXG4gIGN1cnJlbnREZXZpY2UoKSB7XG4gICAgcmV0dXJuIHRoaXMuY29udGV4dC5jdXJyZW50RGV2aWNlXG4gIH1cblxuICAvKipcbiAgICogUnVucyBvZmZsaW5lIGdyYW50LlxuICAgKiBAcmV0dXJucyB7dW5rbm93bn0gLSBPZmZsaW5lIGdyYW50IGZyb20gY29udGV4dC5cbiAgICovXG4gIG9mZmxpbmVHcmFudCgpIHtcbiAgICByZXR1cm4gdGhpcy5jb250ZXh0Lm9mZmxpbmVHcmFudFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbm93LlxuICAgKiBAcmV0dXJucyB7RGF0ZX0gLSBDdXJyZW50IHRpbWUgZnJvbSBjb250ZXh0IG9yIHRoZSBzeXN0ZW0gY2xvY2suXG4gICAqL1xuICBub3coKSB7XG4gICAgaWYgKHR5cGVvZiB0aGlzLmNvbnRleHQubm93ID09PSBcImZ1bmN0aW9uXCIpIHJldHVybiB0aGlzLmNvbnRleHQubm93KClcbiAgICBpZiAodGhpcy5jb250ZXh0Lm5vdyBpbnN0YW5jZW9mIERhdGUpIHJldHVybiB0aGlzLmNvbnRleHQubm93XG5cbiAgICByZXR1cm4gbmV3IERhdGUoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmVzb3VyY2UgcnVudGltZS5cbiAgICogQHJldHVybnMge1wiYmFja2VuZFwiIHwgXCJmcm9udGVuZFwiIHwgXCJvZmZsaW5lXCJ9IC0gUmVzb3VyY2UgcnVudGltZSBjb250ZXh0LlxuICAgKi9cbiAgcmVzb3VyY2VSdW50aW1lKCkge1xuICAgIGlmICh0aGlzLmNvbnRleHQucmVzb3VyY2VSdW50aW1lID09PSBcImZyb250ZW5kXCIpIHJldHVybiBcImZyb250ZW5kXCJcbiAgICBpZiAodGhpcy5jb250ZXh0LnJlc291cmNlUnVudGltZSA9PT0gXCJvZmZsaW5lXCIpIHJldHVybiBcIm9mZmxpbmVcIlxuXG4gICAgcmV0dXJuIFwiYmFja2VuZFwiXG4gIH1cblxuICAvKipcbiAgICogUnVucyBpcyBiYWNrZW5kLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHRoZSByZXNvdXJjZSBpcyBydW5uaW5nIGluIHRoZSBiYWNrZW5kIHJ1bnRpbWUuXG4gICAqL1xuICBpc0JhY2tlbmQoKSB7XG4gICAgcmV0dXJuIHRoaXMucmVzb3VyY2VSdW50aW1lKCkgPT09IFwiYmFja2VuZFwiXG4gIH1cblxuICAvKipcbiAgICogUnVucyBpcyBmcm9udGVuZC5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciB0aGUgcmVzb3VyY2UgaXMgcnVubmluZyBpbiB0aGUgZnJvbnRlbmQgcnVudGltZS5cbiAgICovXG4gIGlzRnJvbnRlbmQoKSB7XG4gICAgcmV0dXJuIHRoaXMucmVzb3VyY2VSdW50aW1lKCkgPT09IFwiZnJvbnRlbmRcIlxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaXMgb2ZmbGluZS5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciB0aGUgcmVzb3VyY2UgaXMgcnVubmluZyB3aXRoIG9mZmxpbmUgY29udGV4dC5cbiAgICovXG4gIGlzT2ZmbGluZSgpIHtcbiAgICByZXR1cm4gdGhpcy5yZXNvdXJjZVJ1bnRpbWUoKSA9PT0gXCJvZmZsaW5lXCIgfHwgdGhpcy5jb250ZXh0Lm9mZmxpbmVHcmFudCAhPT0gdW5kZWZpbmVkXG4gIH1cblxuICAvKipcbiAgICogUmVzb2x2ZXMgYSBtb2RlbCBjbGFzcyBmcm9tIHRoZSBwb3J0YWJsZSByZXNvdXJjZSBjb250ZXh0LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbmFtZSAtIE1vZGVsIG5hbWUuXG4gICAqIEByZXR1cm5zIHt1bmtub3dufSAtIE1vZGVsIGNsYXNzIGZyb20gcmVnaXN0cnkuXG4gICAqL1xuICBtb2RlbChuYW1lKSB7XG4gICAgY29uc3QgcmVnaXN0cnkgPSB0aGlzLmNvbnRleHQubW9kZWxSZWdpc3RyeVxuXG4gICAgaWYgKHJlZ2lzdHJ5ICYmIHR5cGVvZiByZWdpc3RyeSA9PT0gXCJvYmplY3RcIikge1xuICAgICAgaWYgKFwibW9kZWxcIiBpbiByZWdpc3RyeSAmJiB0eXBlb2YgcmVnaXN0cnkubW9kZWwgPT09IFwiZnVuY3Rpb25cIikge1xuICAgICAgICBjb25zdCBtb2RlbENsYXNzID0gcmVnaXN0cnkubW9kZWwobmFtZSlcblxuICAgICAgICBpZiAobW9kZWxDbGFzcykgcmV0dXJuIG1vZGVsQ2xhc3NcbiAgICAgIH1cblxuICAgICAgaWYgKG5hbWUgaW4gcmVnaXN0cnkpIHJldHVybiAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIHVua25vd24+fSAqLyAocmVnaXN0cnkpW25hbWVdXG4gICAgfVxuXG4gICAgY29uc3QgY29udGV4dE1vZGVsID0gdGhpcy5jb250ZXh0Lm1vZGVsXG5cbiAgICBpZiAodHlwZW9mIGNvbnRleHRNb2RlbCA9PT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICBjb25zdCBtb2RlbENsYXNzID0gY29udGV4dE1vZGVsKG5hbWUpXG5cbiAgICAgIGlmIChtb2RlbENsYXNzKSByZXR1cm4gbW9kZWxDbGFzc1xuICAgIH1cblxuICAgIGNvbnN0IGNvbmZpZ3VyYXRpb24gPSB0aGlzLmNvbnRleHQuY29uZmlndXJhdGlvblxuXG4gICAgaWYgKGNvbmZpZ3VyYXRpb24pIHtcbiAgICAgIGNvbnN0IG1vZGVsQ2xhc3NlcyA9IGNvbmZpZ3VyYXRpb24uZ2V0TW9kZWxDbGFzc2VzKClcblxuICAgICAgaWYgKG5hbWUgaW4gbW9kZWxDbGFzc2VzKSByZXR1cm4gbW9kZWxDbGFzc2VzW25hbWVdXG4gICAgfVxuXG4gICAgdGhyb3cgbmV3IEVycm9yKGAke3RoaXMuY29uc3RydWN0b3IubmFtZX0gY291bGQgbm90IHJlc29sdmUgbW9kZWwgJyR7bmFtZX0nIGZyb20gdGhlIHJlc291cmNlIGNvbnRleHQgbW9kZWwgcmVnaXN0cnkuYClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJlcXVlc3QuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuLi9odHRwLXNlcnZlci9jbGllbnQvcmVxdWVzdC5qc1wiKS5kZWZhdWx0IHwgaW1wb3J0KFwiLi4vaHR0cC1zZXJ2ZXIvY2xpZW50L3dlYnNvY2tldC1yZXF1ZXN0LmpzXCIpLmRlZmF1bHQgfCB1bmRlZmluZWR9IC0gUmVxdWVzdCBmcm9tIGNvbnRleHQuXG4gICAqL1xuICByZXF1ZXN0KCkge1xuICAgIHJldHVybiB0aGlzLmNvbnRleHQucmVxdWVzdFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcGFyYW1zLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5WZWxvY2lvdXNQYXJhbXMgfCB1bmRlZmluZWR9IC0gUGFyYW1zIGZyb20gY29udGV4dC5cbiAgICovXG4gIHBhcmFtcygpIHtcbiAgICByZXR1cm4gdGhpcy5jb250ZXh0LnBhcmFtc1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYWJpbGl0aWVzLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBJbXBsZW1lbnQgaW4gc3ViY2xhc3NlcyB0byBkZWZpbmUgYWJpbGl0aWVzLlxuICAgKi9cbiAgYWJpbGl0aWVzKCkge1xuICAgIC8vIE5vLW9wIGJ5IGRlZmF1bHQuXG4gIH1cbn1cbiJdfQ==