/** Base class for authorization resources defining abilities for a model. */
export default class AuthorizationBaseResource {
    ability: import("./ability.js").default | undefined;
    context: import("../configuration-types.js").VelociousLooseObject;
    locals: import("../configuration-types.js").VelociousLooseObject;
    /**
     * Model class.
     * @type {typeof import("../database/record/index.js").default | undefined} */
    static ModelClass: typeof import("../database/record/index.js").default | undefined;
    /**
     * Runs constructor.
     * @param {object} args - Resource args.
     * @param {import("./ability.js").default} [args.ability] - Ability instance.
     * @param {import("../configuration-types.js").VelociousLooseObject} [args.context] - Ability context.
     * @param {import("../configuration-types.js").VelociousLooseObject} [args.locals] - Ability locals.
     */
    constructor({ ability, context, locals }: {
        ability?: import("./ability.js").default;
        context?: import("../configuration-types.js").VelociousLooseObject;
        locals?: import("../configuration-types.js").VelociousLooseObject;
    });
    /**
     * Runs model class.
     * @returns {typeof import("../database/record/index.js").default} - Model class handled by this resource.
     */
    static modelClass(): typeof import("../database/record/index.js").default;
    /**
     * Runs can.
     * @template {typeof import("../database/record/index.js").default} MC
     * @param {string | string[]} actions - Ability action(s).
     * @param {import("./ability.js").AbilityConditionsType<MC>} [conditions] - Conditions.
     * @returns {void} - No return value.
     */
    can<MC extends typeof import("../database/record/index.js").default>(actions: string | string[], conditions?: import("./ability.js").AbilityConditionsType<MC>): void;
    /**
     * Runs cannot.
     * @template {typeof import("../database/record/index.js").default} MC
     * @param {string | string[]} actions - Ability action(s).
     * @param {import("./ability.js").AbilityConditionsType<MC>} [conditions] - Conditions.
     * @returns {void} - No return value.
     */
    cannot<MC extends typeof import("../database/record/index.js").default>(actions: string | string[], conditions?: import("./ability.js").AbilityConditionsType<MC>): void;
    /**
     * Runs required ability.
     * @returns {import("./ability.js").default} - Ability instance.
     */
    requiredAbility(): import("./ability.js").default;
    /**
     * Runs required model class.
     * @returns {typeof import("../database/record/index.js").default} - Model class handled by this resource.
     */
    requiredModelClass(): typeof import("../database/record/index.js").default;
    /**
     * Runs assert resource conditions signature.
     * @param {object} args - Signature args.
     * @param {ReturnType<typeof JSON.parse>} args.conditions - Conditions value.
     * @param {"can" | "cannot"} args.methodName - Method name.
     * @returns {void}
     */
    assertResourceConditionsSignature({ conditions, methodName }: {
        conditions: ReturnType<typeof JSON.parse>;
        methodName: "can" | "cannot";
    }): void;
    /**
     * Runs get context.
     * @returns {import("../configuration-types.js").VelociousLooseObject} - Ability context.
     */
    getContext(): import("../configuration-types.js").VelociousLooseObject;
    /**
     * Runs get locals.
     * @returns {import("../configuration-types.js").VelociousLooseObject} - Ability locals.
     */
    getLocals(): import("../configuration-types.js").VelociousLooseObject;
    /**
     * Runs current user.
     * @returns {unknown} - Current user from context.
     */
    currentUser(): unknown;
    /**
     * Runs current device.
     * @returns {unknown} - Current device from context.
     */
    currentDevice(): unknown;
    /**
     * Runs offline grant.
     * @returns {unknown} - Offline grant from context.
     */
    offlineGrant(): unknown;
    /**
     * Runs now.
     * @returns {Date} - Current time from context or the system clock.
     */
    now(): Date;
    /**
     * Runs resource runtime.
     * @returns {"backend" | "frontend" | "offline"} - Resource runtime context.
     */
    resourceRuntime(): "backend" | "frontend" | "offline";
    /**
     * Runs is backend.
     * @returns {boolean} - Whether the resource is running in the backend runtime.
     */
    isBackend(): boolean;
    /**
     * Runs is frontend.
     * @returns {boolean} - Whether the resource is running in the frontend runtime.
     */
    isFrontend(): boolean;
    /**
     * Runs is offline.
     * @returns {boolean} - Whether the resource is running with offline context.
     */
    isOffline(): boolean;
    /**
     * Resolves a model class from the portable resource context.
     * @param {string} name - Model name.
     * @returns {unknown} - Model class from registry.
     */
    model(name: string): unknown;
    /**
     * Runs request.
     * @returns {import("../http-server/client/request.js").default | import("../http-server/client/websocket-request.js").default | undefined} - Request from context.
     */
    request(): import("../http-server/client/request.js").default | import("../http-server/client/websocket-request.js").default | undefined;
    /**
     * Runs params.
     * @returns {import("../configuration-types.js").VelociousParams | undefined} - Params from context.
     */
    params(): import("../configuration-types.js").VelociousParams | undefined;
    /**
     * Runs abilities.
     * @returns {void} - Implement in subclasses to define abilities.
     */
    abilities(): void;
}
//# sourceMappingURL=base-resource.d.ts.map