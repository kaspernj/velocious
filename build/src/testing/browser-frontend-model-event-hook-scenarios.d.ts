import FrontendModelBase from "../frontend-models/base.js";
export type FrontendModelResourceConfig = import("../frontend-models/base.js").FrontendModelResourceConfig;
export type FrontendModelClass = import("../frontend-models/base.js").FrontendModelClass;
export type FrontendModelHookTestCreateUpdatePayload = {
    id: import("../utils/model-primary-key.js").ModelPrimaryKeyValue;
    model: FrontendModelBase;
};
export type FrontendModelHookTestDestroyPayload = {
    id: import("../utils/model-primary-key.js").ModelPrimaryKeyValue;
};
export type ErasedFrontendModelHookCallback = (payload: never) => void;
export type FakeSubscriptions = {
    /**
     * - Heterogeneous create callbacks owned by the fake transport.
     */
    create: Set<ErasedFrontendModelHookCallback>;
    /**
     * - Heterogeneous destroy callbacks owned by the fake transport.
     */
    destroy: Set<ErasedFrontendModelHookCallback>;
    /**
     * - Subscription options.
     */
    options: {
        create: import("../frontend-models/query.js").FrontendModelEventOptionsObject[];
        destroy: import("../frontend-models/query.js").FrontendModelEventOptionsObject[];
        update: import("../frontend-models/query.js").FrontendModelEventOptionsObject[];
    };
    /**
     * - Heterogeneous update callbacks owned by the fake transport.
     */
    update: Set<ErasedFrontendModelHookCallback>;
};
/**
 * Runs class lifecycle scenario.
 * @returns {Promise<Record<string, number>>} - Scenario result.
 */
declare function classLifecycleScenario(): Promise<Record<string, number>>;
/**
 * Runs instance lifecycle scenario.
 * @returns {Promise<Record<string, number>>} - Scenario result.
 */
declare function instanceLifecycleScenario(): Promise<Record<string, number>>;
/**
 * Runs projection options scenario.
 * @returns {Promise<Record<string, number>>} - Scenario result.
 */
declare function projectionOptionsScenario(): Promise<Record<string, number>>;
/**
 * Runs request context presence scenario.
 * @returns {Promise<Record<string, number>>} - Scenario result.
 */
declare function requestContextPresenceScenario(): Promise<Record<string, number>>;
/**
 * Runs debounce unmount scenario.
 * @returns {Promise<Record<string, number>>} - Scenario result.
 */
declare function debounceUnmountScenario(): Promise<Record<string, number>>;
/**
 * Runs resubscribe instance scenario.
 * @returns {Promise<Record<string, number>>} - Scenario result.
 */
declare function resubscribeInstanceScenario(): Promise<Record<string, number>>;
declare const scenarios: {
    classLifecycle: typeof classLifecycleScenario;
    debounceUnmount: typeof debounceUnmountScenario;
    instanceLifecycle: typeof instanceLifecycleScenario;
    projectionOptions: typeof projectionOptionsScenario;
    requestContextPresence: typeof requestContextPresenceScenario;
    resubscribeInstance: typeof resubscribeInstanceScenario;
};
/**
 * Runs run frontend model event hook scenario.
 * @param {keyof typeof scenarios} scenarioName - Scenario name.
 * @returns {Promise<Record<string, number>>} - Scenario result.
 */
export default function runFrontendModelEventHookScenario(scenarioName: keyof typeof scenarios): Promise<Record<string, number>>;
export {};
//# sourceMappingURL=browser-frontend-model-event-hook-scenarios.d.ts.map