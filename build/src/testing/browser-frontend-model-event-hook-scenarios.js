// @ts-check
import React from "react";
import { createRoot } from "react-dom/client";
import useDestroyedEvent from "../frontend-models/use-destroyed-event.js";
import useCreatedEvent from "../frontend-models/use-created-event.js";
import FrontendModelBase from "../frontend-models/base.js";
import useModelClassEvent from "../frontend-models/use-model-class-event.js";
import useUpdatedEvent from "../frontend-models/use-updated-event.js";
import wait from "awaitery/build/wait.js";
/**
 * FrontendModelResourceConfig type.
 * @typedef {import("../frontend-models/base.js").FrontendModelResourceConfig} FrontendModelResourceConfig */
/**
 * Defines this typedef.
 * @typedef {{id: string, model: FrontendModelBase}} FrontendModelHookTestCreateUpdatePayload */
/**
 * Defines this typedef.
 * @typedef {{id: string}} FrontendModelHookTestDestroyPayload */
/**
 * FakeSubscriptions type.
 * @typedef {object} FakeSubscriptions
 * @property {Set<(payload: FrontendModelHookTestCreateUpdatePayload) => void>} create - Create callbacks.
 * @property {Set<(payload: FrontendModelHookTestDestroyPayload) => void>} destroy - Destroy callbacks.
 * @property {{create: import("../frontend-models/query.js").FrontendModelEventOptionsObject[], destroy: import("../frontend-models/query.js").FrontendModelEventOptionsObject[], update: import("../frontend-models/query.js").FrontendModelEventOptionsObject[]}} options - Subscription options.
 * @property {Set<(payload: FrontendModelHookTestCreateUpdatePayload) => void>} update - Update callbacks.
 */
/**
 * Runs flush effects.
 * @returns {Promise<void>} - Resolves after React effects have run.
 */
async function flushEffects() {
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
}
/**
 * Runs wait for.
 * @param {() => boolean} callback - Predicate to wait for.
 * @returns {Promise<void>} - Resolves when the predicate returns true.
 */
async function waitFor(callback) {
    const startedAt = Date.now();
    while (!callback()) {
        if (Date.now() - startedAt > 1000)
            return;
        await wait(10);
    }
}
/**
 * Runs build fake subscriptions.
 * @returns {FakeSubscriptions} - Empty fake subscription store.
 */
function buildFakeSubscriptions() {
    return {
        create: new Set(),
        destroy: new Set(),
        options: { create: [], destroy: [], update: [] },
        update: new Set()
    };
}
/**
 * Runs fake resource config.
 * @param {string} modelName - Fake frontend model name.
 * @returns {FrontendModelResourceConfig} - Minimal resource config for fake subclasses.
 */
function fakeResourceConfig(modelName) {
    return {
        attributes: ["id"],
        modelName,
        primaryKey: "id"
    };
}
/**
 * Runs render element.
 * @param {React.ReactElement} element - Element to render.
 * @returns {Promise<{rerender: (nextElement: React.ReactElement) => Promise<void>, unmount: () => Promise<void>}>} - Render controls.
 */
async function renderElement(element) {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    root.render(element);
    await flushEffects();
    return {
        rerender: async (nextElement) => {
            root.render(nextElement);
            await flushEffects();
        },
        unmount: async () => {
            root.unmount();
            container.remove();
            await flushEffects();
        }
    };
}
/**
 * Runs build fake model class.
 * @returns {{ModelClass: import("../frontend-models/base.js").FrontendModelClass<FrontendModelBase>, subscriptions: FakeSubscriptions}} - Fake model class setup.
 */
function buildFakeModelClass() {
    const subscriptions = buildFakeSubscriptions();
    class FakeModelClass extends FrontendModelBase {
        /**
         * Runs resource config.
         * @returns {FrontendModelResourceConfig} - Fake resource config.
         */
        static resourceConfig() {
            return fakeResourceConfig("HookFakeClassModel");
        }
        /**
         * Runs on create.
         * @param {(payload: FrontendModelHookTestCreateUpdatePayload) => void} callback - Event callback.
         * @param {import("../frontend-models/query.js").FrontendModelEventOptionsObject} [options] - Event query or projection options.
         * @returns {Promise<() => void>} - Unsubscribe callback.
         */
        static async onCreate(callback, options = {}) {
            subscriptions.create.add(callback);
            subscriptions.options.create.push(options);
            return () => subscriptions.create.delete(callback);
        }
        /**
         * Runs on destroy.
         * @param {(payload: FrontendModelHookTestDestroyPayload) => void} callback - Event callback.
         * @param {import("../frontend-models/query.js").FrontendModelEventOptionsObject} [options] - Event query or projection options.
         * @returns {Promise<() => void>} - Unsubscribe callback.
         */
        static async onDestroy(callback, options = {}) {
            subscriptions.destroy.add(callback);
            subscriptions.options.destroy.push(options);
            return () => subscriptions.destroy.delete(callback);
        }
        /**
         * Runs on update.
         * @param {(payload: FrontendModelHookTestCreateUpdatePayload) => void} callback - Event callback.
         * @param {import("../frontend-models/query.js").FrontendModelEventOptionsObject} [options] - Event query or projection options.
         * @returns {Promise<() => void>} - Unsubscribe callback.
         */
        static async onUpdate(callback, options = {}) {
            subscriptions.update.add(callback);
            subscriptions.options.update.push(options);
            return () => subscriptions.update.delete(callback);
        }
    }
    return { ModelClass: FakeModelClass, subscriptions };
}
/**
 * Runs emit event.
 * @param {FakeSubscriptions} subscriptions - Callback sets.
 * @param {"create" | "destroy" | "update"} eventName - Event name.
 * @param {FrontendModelHookTestCreateUpdatePayload | FrontendModelHookTestDestroyPayload} payload - Event payload.
 * @returns {void}
 */
function emitEvent(subscriptions, eventName, payload) {
    if (eventName === "destroy") {
        for (const callback of subscriptions.destroy) {
            callback({ id: payload.id });
        }
        return;
    }
    if (!("model" in payload)) {
        throw new Error(`Expected model payload for ${eventName}`);
    }
    for (const callback of subscriptions[eventName]) {
        callback(payload);
    }
}
/**
 * Runs build fake model.
 * @param {string} id - Model id.
 * @param {FakeSubscriptions} subscriptions - Callback sets.
 * @returns {FrontendModelBase} - Fake model instance.
 */
function buildFakeModel(id, subscriptions) {
    class FakeModel extends FrontendModelBase {
        /**
         * Runs resource config.
         * @returns {FrontendModelResourceConfig} - Fake resource config.
         */
        static resourceConfig() {
            return fakeResourceConfig("HookFakeInstanceModel");
        }
        /**
         * Runs on destroy.
         * @param {(payload: FrontendModelHookTestDestroyPayload) => void} callback - Event callback.
         * @param {import("../frontend-models/query.js").FrontendModelEventOptionsObject} [options] - Event query or projection options.
         * @returns {Promise<() => void>} - Unsubscribe callback.
         */
        async onDestroy(callback, options = {}) {
            subscriptions.destroy.add(callback);
            subscriptions.options.destroy.push(options);
            return () => subscriptions.destroy.delete(callback);
        }
        /**
         * Runs on update.
         * @param {(payload: FrontendModelHookTestCreateUpdatePayload) => void} callback - Event callback.
         * @param {import("../frontend-models/query.js").FrontendModelEventOptionsObject} [options] - Event query or projection options.
         * @returns {Promise<() => void>} - Unsubscribe callback.
         */
        async onUpdate(callback, options = {}) {
            subscriptions.update.add(callback);
            subscriptions.options.update.push(options);
            return () => subscriptions.update.delete(callback);
        }
        /**
         * Runs primary key value.
         * @returns {string} - Primary key value.
         */
        primaryKeyValue() {
            return id;
        }
    }
    return new FakeModel({ id });
}
/**
 * Runs class lifecycle scenario.
 * @returns {Promise<Record<string, number>>} - Scenario result.
 */
async function classLifecycleScenario() {
    const { ModelClass, subscriptions } = buildFakeModelClass();
    const eventModel = buildFakeModel("1", buildFakeSubscriptions());
    /**
     * Received events.
     * @type {Array<FrontendModelHookTestCreateUpdatePayload | FrontendModelHookTestDestroyPayload>} */
    const receivedEvents = [];
    let connectedCount = 0;
    /**
     * Runs test component.
     * @returns {React.ReactElement} - Test element.
     */
    function TestComponent() {
        useModelClassEvent(ModelClass, ["create", "update"], (payload) => receivedEvents.push(payload), {
            onConnected: () => { connectedCount += 1; }
        });
        useCreatedEvent(ModelClass, (payload) => receivedEvents.push(payload));
        return React.createElement("div");
    }
    const controls = await renderElement(React.createElement(TestComponent));
    await waitFor(() => subscriptions.create.size === 2 && subscriptions.update.size === 1);
    const mountedCreateSubscriptions = subscriptions.create.size;
    const mountedUpdateSubscriptions = subscriptions.update.size;
    const mountedDestroySubscriptions = subscriptions.destroy.size;
    const mountedConnectedCount = connectedCount;
    emitEvent(subscriptions, "create", { id: "1", model: eventModel });
    emitEvent(subscriptions, "update", { id: "1", model: eventModel });
    emitEvent(subscriptions, "destroy", { id: "1" });
    const receivedEventsAfterEmit = receivedEvents.length;
    await controls.unmount();
    return {
        mountedConnectedCount,
        mountedCreateSubscriptions,
        mountedDestroySubscriptions,
        mountedUpdateSubscriptions,
        receivedEventsAfterEmit,
        unmountedCreateSubscriptions: subscriptions.create.size,
        unmountedUpdateSubscriptions: subscriptions.update.size
    };
}
/**
 * Runs instance lifecycle scenario.
 * @returns {Promise<Record<string, number>>} - Scenario result.
 */
async function instanceLifecycleScenario() {
    const subscriptions = buildFakeSubscriptions();
    const model = buildFakeModel("task-1", subscriptions);
    /**
     * Received events.
     * @type {Array<FrontendModelHookTestCreateUpdatePayload | FrontendModelHookTestDestroyPayload>} */
    const receivedEvents = [];
    let connectedCount = 0;
    /**
     * Runs test component.
     * @returns {React.ReactElement} - Test element.
     */
    function TestComponent() {
        useUpdatedEvent(model, (payload) => receivedEvents.push(payload), {
            onConnected: () => { connectedCount += 1; }
        });
        useDestroyedEvent([model], (payload) => receivedEvents.push(payload), {
            onConnected: () => { connectedCount += 1; }
        });
        return React.createElement("div");
    }
    const controls = await renderElement(React.createElement(TestComponent));
    await waitFor(() => subscriptions.update.size === 1 && subscriptions.destroy.size === 1);
    const mountedConnectedCount = connectedCount;
    const mountedDestroySubscriptions = subscriptions.destroy.size;
    const mountedUpdateSubscriptions = subscriptions.update.size;
    emitEvent(subscriptions, "update", { id: "task-1", model });
    emitEvent(subscriptions, "destroy", { id: "task-1" });
    const receivedEventsAfterEmit = receivedEvents.length;
    await controls.unmount();
    return {
        mountedConnectedCount,
        mountedDestroySubscriptions,
        mountedUpdateSubscriptions,
        receivedEventsAfterEmit,
        unmountedDestroySubscriptions: subscriptions.destroy.size,
        unmountedUpdateSubscriptions: subscriptions.update.size
    };
}
/**
 * Runs projection options scenario.
 * @returns {Promise<Record<string, number>>} - Scenario result.
 */
async function projectionOptionsScenario() {
    const { ModelClass, subscriptions: classSubscriptions } = buildFakeModelClass();
    const instanceSubscriptions = buildFakeSubscriptions();
    const model = buildFakeModel("task-1", instanceSubscriptions);
    const classQuery = ModelClass
        .where({ id: "task-1" })
        .select(["id"]);
    const requestContext = { workspaceId: "workspace-alpha" };
    /**
     * Runs test component.
     * @returns {React.ReactElement} - Test element.
     */
    function TestComponent() {
        useCreatedEvent(ModelClass, () => { }, {
            preload: "project",
            query: classQuery,
            requestContext,
            select: { Task: ["id", "nameUppercase"] }
        });
        useUpdatedEvent(model, () => { }, {
            requestContext,
            select: ["id"],
            withCount: "comments"
        });
        useDestroyedEvent(model, () => { }, {
            preload: "project",
            requestContext,
            select: ["id"]
        });
        return React.createElement("div");
    }
    const controls = await renderElement(React.createElement(TestComponent));
    await waitFor(() => classSubscriptions.create.size === 1 && instanceSubscriptions.update.size === 1 && instanceSubscriptions.destroy.size === 1);
    const createOptions = classSubscriptions.options.create[0] || {};
    const updateOptions = instanceSubscriptions.options.update[0] || {};
    const destroyOptions = instanceSubscriptions.options.destroy[0] || {};
    await controls.unmount();
    return {
        classCreatePreloadProject: createOptions.preload === "project" ? 1 : 0,
        classCreateQueryPassed: createOptions.query === classQuery ? 1 : 0,
        classCreateRequestContextPassed: createOptions.requestContext === requestContext ? 1 : 0,
        classCreateSelectCount: createOptions.select && typeof createOptions.select === "object" && !Array.isArray(createOptions.select) && Array.isArray(createOptions.select.Task) ? createOptions.select.Task.length : 0,
        instanceDestroyPreloadProject: destroyOptions.preload === "project" ? 1 : 0,
        instanceDestroyRequestContextPassed: destroyOptions.requestContext === requestContext ? 1 : 0,
        instanceDestroySelectCount: Array.isArray(destroyOptions.select) ? destroyOptions.select.length : 0,
        instanceUpdateRequestContextPassed: updateOptions.requestContext === requestContext ? 1 : 0,
        instanceUpdateSelectCount: Array.isArray(updateOptions.select) ? updateOptions.select.length : 0,
        instanceUpdateWithCountComments: updateOptions.withCount === "comments" ? 1 : 0
    };
}
/**
 * Runs request context presence scenario.
 * @returns {Promise<Record<string, number>>} - Scenario result.
 */
async function requestContextPresenceScenario() {
    const { ModelClass, subscriptions: classSubscriptions } = buildFakeModelClass();
    const instanceSubscriptions = buildFakeSubscriptions();
    const model = buildFakeModel("task-1", instanceSubscriptions);
    /**
     * Runs test component.
     * @param {{explicitEmpty: boolean}} props - Component props.
     * @returns {React.ReactElement} - Test element.
     */
    function TestComponent({ explicitEmpty }) {
        const options = explicitEmpty ? { requestContext: {} } : {};
        useModelClassEvent(ModelClass, "create", () => { }, options);
        useUpdatedEvent(model, () => { }, options);
        useDestroyedEvent(model, () => { }, options);
        return React.createElement("div");
    }
    const registrationCount = () => classSubscriptions.options.create.length + instanceSubscriptions.options.update.length + instanceSubscriptions.options.destroy.length;
    const activeSubscriptionCount = () => classSubscriptions.create.size + instanceSubscriptions.update.size + instanceSubscriptions.destroy.size;
    const controls = await renderElement(React.createElement(TestComponent, { explicitEmpty: false }));
    await waitFor(() => registrationCount() === 3 && activeSubscriptionCount() === 3);
    const registrationsAfterInheritedRender = registrationCount();
    await controls.rerender(React.createElement(TestComponent, { explicitEmpty: false }));
    const registrationsAfterStableInheritedRender = registrationCount();
    await controls.rerender(React.createElement(TestComponent, { explicitEmpty: true }));
    await waitFor(() => registrationCount() === 6 && activeSubscriptionCount() === 3);
    const registrationsAfterExplicitEmptyRender = registrationCount();
    await controls.rerender(React.createElement(TestComponent, { explicitEmpty: true }));
    const registrationsAfterStableExplicitEmptyRender = registrationCount();
    await controls.rerender(React.createElement(TestComponent, { explicitEmpty: false }));
    await waitFor(() => registrationCount() === 9 && activeSubscriptionCount() === 3);
    const routingOptions = [
        classSubscriptions.options.create,
        instanceSubscriptions.options.update,
        instanceSubscriptions.options.destroy
    ];
    const explicitEmptyRoutingRegistrations = routingOptions.filter((options) => {
        const requestContext = options[1]?.requestContext;
        return requestContext && Object.keys(requestContext).length === 0;
    }).length;
    const inheritedRoutingRegistrations = routingOptions.reduce((count, options) => (count + [options[0], options[2]].filter((entry) => entry?.requestContext === undefined).length), 0);
    const result = {
        activeSubscriptionsAfterTransitions: activeSubscriptionCount(),
        classRegistrationsAfterTransitions: classSubscriptions.options.create.length,
        explicitEmptyRoutingRegistrations,
        inheritedRoutingRegistrations,
        instanceDestroyRegistrationsAfterTransitions: instanceSubscriptions.options.destroy.length,
        instanceUpdateRegistrationsAfterTransitions: instanceSubscriptions.options.update.length,
        registrationsAfterExplicitEmptyRender,
        registrationsAfterInheritedAgainRender: registrationCount(),
        registrationsAfterInheritedRender,
        registrationsAfterStableExplicitEmptyRender,
        registrationsAfterStableInheritedRender
    };
    await controls.unmount();
    return {
        ...result,
        activeSubscriptionsAfterUnmount: activeSubscriptionCount()
    };
}
/**
 * Runs debounce unmount scenario.
 * @returns {Promise<Record<string, number>>} - Scenario result.
 */
async function debounceUnmountScenario() {
    const { ModelClass, subscriptions: classSubscriptions } = buildFakeModelClass();
    const instanceSubscriptions = buildFakeSubscriptions();
    const model = buildFakeModel("task-1", instanceSubscriptions);
    /**
     * Received events.
     * @type {Array<FrontendModelHookTestCreateUpdatePayload | FrontendModelHookTestDestroyPayload>} */
    const receivedEvents = [];
    /**
     * Runs test component.
     * @returns {React.ReactElement} - Test element.
     */
    function TestComponent() {
        useModelClassEvent(ModelClass, "update", (payload) => receivedEvents.push(payload), { debounce: 20 });
        useUpdatedEvent(model, (payload) => receivedEvents.push(payload), { debounce: 20 });
        useDestroyedEvent(model, (payload) => receivedEvents.push(payload), { debounce: 20 });
        return React.createElement("div");
    }
    const controls = await renderElement(React.createElement(TestComponent));
    await waitFor(() => classSubscriptions.update.size === 1 && instanceSubscriptions.update.size === 1 && instanceSubscriptions.destroy.size === 1);
    emitEvent(classSubscriptions, "update", { id: "task-1", model });
    emitEvent(instanceSubscriptions, "update", { id: "task-1", model });
    emitEvent(instanceSubscriptions, "destroy", { id: "task-1" });
    await controls.unmount();
    await wait(30);
    return { receivedEventsAfterDebounceWindow: receivedEvents.length };
}
/**
 * Runs resubscribe instance scenario.
 * @returns {Promise<Record<string, number>>} - Scenario result.
 */
async function resubscribeInstanceScenario() {
    const firstSubscriptions = buildFakeSubscriptions();
    const secondSubscriptions = buildFakeSubscriptions();
    const firstModel = buildFakeModel("task-1", firstSubscriptions);
    const secondModel = buildFakeModel("task-1", secondSubscriptions);
    /**
     * Received events.
     * @type {Array<FrontendModelHookTestCreateUpdatePayload | FrontendModelHookTestDestroyPayload>} */
    const receivedEvents = [];
    /**
     * Runs test component.
     * @param {{model: import("../frontend-models/base.js").default}} props - Component props.
     * @returns {React.ReactElement} - Test element.
     */
    function TestComponent({ model }) {
        useUpdatedEvent(model, (payload) => receivedEvents.push(payload));
        useDestroyedEvent(model, (payload) => receivedEvents.push(payload));
        return React.createElement("div");
    }
    const controls = await renderElement(React.createElement(TestComponent, { model: firstModel }));
    await waitFor(() => firstSubscriptions.update.size === 1 && firstSubscriptions.destroy.size === 1);
    const firstMountedDestroySubscriptions = firstSubscriptions.destroy.size;
    const firstMountedUpdateSubscriptions = firstSubscriptions.update.size;
    await controls.rerender(React.createElement(TestComponent, { model: secondModel }));
    await waitFor(() => firstSubscriptions.update.size === 0 && firstSubscriptions.destroy.size === 0 && secondSubscriptions.update.size === 1 && secondSubscriptions.destroy.size === 1);
    const firstAfterRerenderDestroySubscriptions = firstSubscriptions.destroy.size;
    const firstAfterRerenderUpdateSubscriptions = firstSubscriptions.update.size;
    const secondAfterRerenderDestroySubscriptions = secondSubscriptions.destroy.size;
    const secondAfterRerenderUpdateSubscriptions = secondSubscriptions.update.size;
    emitEvent(firstSubscriptions, "update", { id: "task-1", model: firstModel });
    emitEvent(secondSubscriptions, "update", { id: "task-1", model: secondModel });
    emitEvent(secondSubscriptions, "destroy", { id: "task-1" });
    const receivedEventsAfterEmit = receivedEvents.length;
    await controls.unmount();
    return {
        firstAfterRerenderDestroySubscriptions,
        firstAfterRerenderUpdateSubscriptions,
        firstMountedDestroySubscriptions,
        firstMountedUpdateSubscriptions,
        receivedEventsAfterEmit,
        secondAfterRerenderDestroySubscriptions,
        secondAfterRerenderUpdateSubscriptions
    };
}
const scenarios = {
    classLifecycle: classLifecycleScenario,
    debounceUnmount: debounceUnmountScenario,
    instanceLifecycle: instanceLifecycleScenario,
    projectionOptions: projectionOptionsScenario,
    requestContextPresence: requestContextPresenceScenario,
    resubscribeInstance: resubscribeInstanceScenario
};
/**
 * Runs run frontend model event hook scenario.
 * @param {keyof typeof scenarios} scenarioName - Scenario name.
 * @returns {Promise<Record<string, number>>} - Scenario result.
 */
export default async function runFrontendModelEventHookScenario(scenarioName) {
    const scenario = scenarios[scenarioName];
    if (!scenario)
        throw new Error(`Unknown frontend model event hook scenario: ${scenarioName}`);
    return await scenario();
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYnJvd3Nlci1mcm9udGVuZC1tb2RlbC1ldmVudC1ob29rLXNjZW5hcmlvcy5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy90ZXN0aW5nL2Jyb3dzZXItZnJvbnRlbmQtbW9kZWwtZXZlbnQtaG9vay1zY2VuYXJpb3MuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLE9BQU8sS0FBSyxNQUFNLE9BQU8sQ0FBQTtBQUN6QixPQUFPLEVBQUMsVUFBVSxFQUFDLE1BQU0sa0JBQWtCLENBQUE7QUFFM0MsT0FBTyxpQkFBaUIsTUFBTSwyQ0FBMkMsQ0FBQTtBQUN6RSxPQUFPLGVBQWUsTUFBTSx5Q0FBeUMsQ0FBQTtBQUNyRSxPQUFPLGlCQUFpQixNQUFNLDRCQUE0QixDQUFBO0FBQzFELE9BQU8sa0JBQWtCLE1BQU0sNkNBQTZDLENBQUE7QUFDNUUsT0FBTyxlQUFlLE1BQU0seUNBQXlDLENBQUE7QUFDckUsT0FBTyxJQUFJLE1BQU0sd0JBQXdCLENBQUE7QUFFekM7OzZHQUU2RztBQUM3Rzs7Z0dBRWdHO0FBQ2hHOztpRUFFaUU7QUFDakU7Ozs7Ozs7R0FPRztBQUVIOzs7R0FHRztBQUNILEtBQUssVUFBVSxZQUFZO0lBQ3pCLE1BQU0sT0FBTyxDQUFDLE9BQU8sRUFBRSxDQUFBO0lBQ3ZCLE1BQU0sSUFBSSxPQUFPLENBQUMsQ0FBQyxPQUFPLEVBQUUsRUFBRSxDQUFDLFVBQVUsQ0FBQyxPQUFPLEVBQUUsQ0FBQyxDQUFDLENBQUMsQ0FBQTtBQUN4RCxDQUFDO0FBRUQ7Ozs7R0FJRztBQUNILEtBQUssVUFBVSxPQUFPLENBQUMsUUFBUTtJQUM3QixNQUFNLFNBQVMsR0FBRyxJQUFJLENBQUMsR0FBRyxFQUFFLENBQUE7SUFFNUIsT0FBTyxDQUFDLFFBQVEsRUFBRSxFQUFFLENBQUM7UUFDbkIsSUFBSSxJQUFJLENBQUMsR0FBRyxFQUFFLEdBQUcsU0FBUyxHQUFHLElBQUk7WUFBRSxPQUFNO1FBRXpDLE1B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bUJBQW1CLEVBQUUsUUFBUSxFQUFFLEVBQUMsRUFBRSxFQUFFLFFBQVEsRUFBRSxLQUFLLEVBQUUsV0FBVyxFQUFDLENBQUMsQ0FBQTtJQUM1RSxTQUFTLENBQUMsbUJBQW1CLEVBQUUsU0FBUyxFQUFFLEVBQUMsRUFBRSxFQUFFLFFBQVEsRUFBQyxDQUFDLENBQUE7SUFFekQsTUFBTSx1QkFBdUIsR0FBRyxjQUFjLENBQUMsTUFBTSxDQUFBO0lBRXJELE1BQU0sUUFBUSxDQUFDLE9BQU8sRUFBRSxDQUFBO0lBRXhCLE9BQU87UUFDTCxzQ0FBc0M7UUFDdEMscUNBQXFDO1FBQ3JDLGdDQUFnQztRQUNoQywrQkFBK0I7UUFDL0IsdUJBQXVCO1FBQ3ZCLHVDQUF1QztRQUN2QyxzQ0FBc0M7S0FDdkMsQ0FBQTtBQUNILENBQUM7QUFFRCxNQUFNLFNBQVMsR0FBRztJQUNoQixjQUFjLEVBQUUsc0JBQXNCO0lBQ3RDLGVBQWUsRUFBRSx1QkFBdUI7SUFDeEMsaUJBQWlCLEVBQUUseUJBQXlCO0lBQzVDLGlCQUFpQixFQUFFLHlCQUF5QjtJQUM1QyxzQkFBc0IsRUFBRSw4QkFBOEI7SUFDdEQsbUJBQW1CLEVBQUUsMkJBQTJCO0NBQ2pELENBQUE7QUFFRDs7OztHQUlHO0FBQ0gsTUFBTSxDQUFDLE9BQU8sQ0FBQyxLQUFLLFVBQVUsaUNBQWlDLENBQUMsWUFBWTtJQUMxRSxNQUFNLFFBQVEsR0FBRyxTQUFTLENBQUMsWUFBWSxDQUFDLENBQUE7SUFFeEMsSUFBSSxDQUFDLFFBQVE7UUFBRSxNQUFNLElBQUksS0FBSyxDQUFDLCtDQUErQyxZQUFZLEVBQUUsQ0FBQyxDQUFBO0lBRTdGLE9BQU8sTUFBTSxRQUFRLEVBQUUsQ0FBQTtBQUN6QixDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbmltcG9ydCBSZWFjdCBmcm9tIFwicmVhY3RcIlxuaW1wb3J0IHtjcmVhdGVSb290fSBmcm9tIFwicmVhY3QtZG9tL2NsaWVudFwiXG5cbmltcG9ydCB1c2VEZXN0cm95ZWRFdmVudCBmcm9tIFwiLi4vZnJvbnRlbmQtbW9kZWxzL3VzZS1kZXN0cm95ZWQtZXZlbnQuanNcIlxuaW1wb3J0IHVzZUNyZWF0ZWRFdmVudCBmcm9tIFwiLi4vZnJvbnRlbmQtbW9kZWxzL3VzZS1jcmVhdGVkLWV2ZW50LmpzXCJcbmltcG9ydCBGcm9udGVuZE1vZGVsQmFzZSBmcm9tIFwiLi4vZnJvbnRlbmQtbW9kZWxzL2Jhc2UuanNcIlxuaW1wb3J0IHVzZU1vZGVsQ2xhc3NFdmVudCBmcm9tIFwiLi4vZnJvbnRlbmQtbW9kZWxzL3VzZS1tb2RlbC1jbGFzcy1ldmVudC5qc1wiXG5pbXBvcnQgdXNlVXBkYXRlZEV2ZW50IGZyb20gXCIuLi9mcm9udGVuZC1tb2RlbHMvdXNlLXVwZGF0ZWQtZXZlbnQuanNcIlxuaW1wb3J0IHdhaXQgZnJvbSBcImF3YWl0ZXJ5L2J1aWxkL3dhaXQuanNcIlxuXG4vKipcbiAqIEZyb250ZW5kTW9kZWxSZXNvdXJjZUNvbmZpZyB0eXBlLlxuICogQHR5cGVkZWYge2ltcG9ydChcIi4uL2Zyb250ZW5kLW1vZGVscy9iYXNlLmpzXCIpLkZyb250ZW5kTW9kZWxSZXNvdXJjZUNvbmZpZ30gRnJvbnRlbmRNb2RlbFJlc291cmNlQ29uZmlnICovXG4vKipcbiAqIERlZmluZXMgdGhpcyB0eXBlZGVmLlxuICogQHR5cGVkZWYge3tpZDogc3RyaW5nLCBtb2RlbDogRnJvbnRlbmRNb2RlbEJhc2V9fSBGcm9udGVuZE1vZGVsSG9va1Rlc3RDcmVhdGVVcGRhdGVQYXlsb2FkICovXG4vKipcbiAqIERlZmluZXMgdGhpcyB0eXBlZGVmLlxuICogQHR5cGVkZWYge3tpZDogc3RyaW5nfX0gRnJvbnRlbmRNb2RlbEhvb2tUZXN0RGVzdHJveVBheWxvYWQgKi9cbi8qKlxuICogRmFrZVN1YnNjcmlwdGlvbnMgdHlwZS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IEZha2VTdWJzY3JpcHRpb25zXG4gKiBAcHJvcGVydHkge1NldDwocGF5bG9hZDogRnJvbnRlbmRNb2RlbEhvb2tUZXN0Q3JlYXRlVXBkYXRlUGF5bG9hZCkgPT4gdm9pZD59IGNyZWF0ZSAtIENyZWF0ZSBjYWxsYmFja3MuXG4gKiBAcHJvcGVydHkge1NldDwocGF5bG9hZDogRnJvbnRlbmRNb2RlbEhvb2tUZXN0RGVzdHJveVBheWxvYWQpID0+IHZvaWQ+fSBkZXN0cm95IC0gRGVzdHJveSBjYWxsYmFja3MuXG4gKiBAcHJvcGVydHkge3tjcmVhdGU6IGltcG9ydChcIi4uL2Zyb250ZW5kLW1vZGVscy9xdWVyeS5qc1wiKS5Gcm9udGVuZE1vZGVsRXZlbnRPcHRpb25zT2JqZWN0W10sIGRlc3Ryb3k6IGltcG9ydChcIi4uL2Zyb250ZW5kLW1vZGVscy9xdWVyeS5qc1wiKS5Gcm9udGVuZE1vZGVsRXZlbnRPcHRpb25zT2JqZWN0W10sIHVwZGF0ZTogaW1wb3J0KFwiLi4vZnJvbnRlbmQtbW9kZWxzL3F1ZXJ5LmpzXCIpLkZyb250ZW5kTW9kZWxFdmVudE9wdGlvbnNPYmplY3RbXX19IG9wdGlvbnMgLSBTdWJzY3JpcHRpb24gb3B0aW9ucy5cbiAqIEBwcm9wZXJ0eSB7U2V0PChwYXlsb2FkOiBGcm9udGVuZE1vZGVsSG9va1Rlc3RDcmVhdGVVcGRhdGVQYXlsb2FkKSA9PiB2b2lkPn0gdXBkYXRlIC0gVXBkYXRlIGNhbGxiYWNrcy5cbiAqL1xuXG4vKipcbiAqIFJ1bnMgZmx1c2ggZWZmZWN0cy5cbiAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIFJlYWN0IGVmZmVjdHMgaGF2ZSBydW4uXG4gKi9cbmFzeW5jIGZ1bmN0aW9uIGZsdXNoRWZmZWN0cygpIHtcbiAgYXdhaXQgUHJvbWlzZS5yZXNvbHZlKClcbiAgYXdhaXQgbmV3IFByb21pc2UoKHJlc29sdmUpID0+IHNldFRpbWVvdXQocmVzb2x2ZSwgMCkpXG59XG5cbi8qKlxuICogUnVucyB3YWl0IGZvci5cbiAqIEBwYXJhbSB7KCkgPT4gYm9vbGVhbn0gY2FsbGJhY2sgLSBQcmVkaWNhdGUgdG8gd2FpdCBmb3IuXG4gKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHRoZSBwcmVkaWNhdGUgcmV0dXJucyB0cnVlLlxuICovXG5hc3luYyBmdW5jdGlvbiB3YWl0Rm9yKGNhbGxiYWNrKSB7XG4gIGNvbnN0IHN0YXJ0ZWRBdCA9IERhdGUubm93KClcblxuICB3aGlsZSAoIWNhbGxiYWNrKCkpIHtcbiAgICBpZiAoRGF0ZS5ub3coKSAtIHN0YXJ0ZWRBdCA+IDEwMDApIHJldHVyblxuXG4gICAgYXdhaXQgd2FpdCgxMClcbiAgfVxufVxuXG4vKipcbiAqIFJ1bnMgYnVpbGQgZmFrZSBzdWJzY3JpcHRpb25zLlxuICogQHJldHVybnMge0Zha2VTdWJzY3JpcHRpb25zfSAtIEVtcHR5IGZha2Ugc3Vic2NyaXB0aW9uIHN0b3JlLlxuICovXG5mdW5jdGlvbiBidWlsZEZha2VTdWJzY3JpcHRpb25zKCkge1xuICByZXR1cm4ge1xuICAgIGNyZWF0ZTogbmV3IFNldCgpLFxuICAgIGRlc3Ryb3k6IG5ldyBTZXQoKSxcbiAgICBvcHRpb25zOiB7Y3JlYXRlOiBbXSwgZGVzdHJveTogW10sIHVwZGF0ZTogW119LFxuICAgIHVwZGF0ZTogbmV3IFNldCgpXG4gIH1cbn1cblxuLyoqXG4gKiBSdW5zIGZha2UgcmVzb3VyY2UgY29uZmlnLlxuICogQHBhcmFtIHtzdHJpbmd9IG1vZGVsTmFtZSAtIEZha2UgZnJvbnRlbmQgbW9kZWwgbmFtZS5cbiAqIEByZXR1cm5zIHtGcm9udGVuZE1vZGVsUmVzb3VyY2VDb25maWd9IC0gTWluaW1hbCByZXNvdXJjZSBjb25maWcgZm9yIGZha2Ugc3ViY2xhc3Nlcy5cbiAqL1xuZnVuY3Rpb24gZmFrZVJlc291cmNlQ29uZmlnKG1vZGVsTmFtZSkge1xuICByZXR1cm4ge1xuICAgIGF0dHJpYnV0ZXM6IFtcImlkXCJdLFxuICAgIG1vZGVsTmFtZSxcbiAgICBwcmltYXJ5S2V5OiBcImlkXCJcbiAgfVxufVxuXG4vKipcbiAqIFJ1bnMgcmVuZGVyIGVsZW1lbnQuXG4gKiBAcGFyYW0ge1JlYWN0LlJlYWN0RWxlbWVudH0gZWxlbWVudCAtIEVsZW1lbnQgdG8gcmVuZGVyLlxuICogQHJldHVybnMge1Byb21pc2U8e3JlcmVuZGVyOiAobmV4dEVsZW1lbnQ6IFJlYWN0LlJlYWN0RWxlbWVudCkgPT4gUHJvbWlzZTx2b2lkPiwgdW5tb3VudDogKCkgPT4gUHJvbWlzZTx2b2lkPn0+fSAtIFJlbmRlciBjb250cm9scy5cbiAqL1xuYXN5bmMgZnVuY3Rpb24gcmVuZGVyRWxlbWVudChlbGVtZW50KSB7XG4gIGNvbnN0IGNvbnRhaW5lciA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJkaXZcIilcbiAgZG9jdW1lbnQuYm9keS5hcHBlbmRDaGlsZChjb250YWluZXIpXG4gIGNvbnN0IHJvb3QgPSBjcmVhdGVSb290KGNvbnRhaW5lcilcblxuICByb290LnJlbmRlcihlbGVtZW50KVxuICBhd2FpdCBmbHVzaEVmZmVjdHMoKVxuXG4gIHJldHVybiB7XG4gICAgcmVyZW5kZXI6IGFzeW5jIChuZXh0RWxlbWVudCkgPT4ge1xuICAgICAgcm9vdC5yZW5kZXIobmV4dEVsZW1lbnQpXG4gICAgICBhd2FpdCBmbHVzaEVmZmVjdHMoKVxuICAgIH0sXG4gICAgdW5tb3VudDogYXN5bmMgKCkgPT4ge1xuICAgICAgcm9vdC51bm1vdW50KClcbiAgICAgIGNvbnRhaW5lci5yZW1vdmUoKVxuICAgICAgYXdhaXQgZmx1c2hFZmZlY3RzKClcbiAgICB9XG4gIH1cbn1cblxuLyoqXG4gKiBSdW5zIGJ1aWxkIGZha2UgbW9kZWwgY2xhc3MuXG4gKiBAcmV0dXJucyB7e01vZGVsQ2xhc3M6IGltcG9ydChcIi4uL2Zyb250ZW5kLW1vZGVscy9iYXNlLmpzXCIpLkZyb250ZW5kTW9kZWxDbGFzczxGcm9udGVuZE1vZGVsQmFzZT4sIHN1YnNjcmlwdGlvbnM6IEZha2VTdWJzY3JpcHRpb25zfX0gLSBGYWtlIG1vZGVsIGNsYXNzIHNldHVwLlxuICovXG5mdW5jdGlvbiBidWlsZEZha2VNb2RlbENsYXNzKCkge1xuICBjb25zdCBzdWJzY3JpcHRpb25zID0gYnVpbGRGYWtlU3Vic2NyaXB0aW9ucygpXG5cbiAgY2xhc3MgRmFrZU1vZGVsQ2xhc3MgZXh0ZW5kcyBGcm9udGVuZE1vZGVsQmFzZSB7XG4gICAgLyoqXG4gICAgICogUnVucyByZXNvdXJjZSBjb25maWcuXG4gICAgICogQHJldHVybnMge0Zyb250ZW5kTW9kZWxSZXNvdXJjZUNvbmZpZ30gLSBGYWtlIHJlc291cmNlIGNvbmZpZy5cbiAgICAgKi9cbiAgICBzdGF0aWMgcmVzb3VyY2VDb25maWcoKSB7XG4gICAgICByZXR1cm4gZmFrZVJlc291cmNlQ29uZmlnKFwiSG9va0Zha2VDbGFzc01vZGVsXCIpXG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogUnVucyBvbiBjcmVhdGUuXG4gICAgICogQHBhcmFtIHsocGF5bG9hZDogRnJvbnRlbmRNb2RlbEhvb2tUZXN0Q3JlYXRlVXBkYXRlUGF5bG9hZCkgPT4gdm9pZH0gY2FsbGJhY2sgLSBFdmVudCBjYWxsYmFjay5cbiAgICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2Zyb250ZW5kLW1vZGVscy9xdWVyeS5qc1wiKS5Gcm9udGVuZE1vZGVsRXZlbnRPcHRpb25zT2JqZWN0fSBbb3B0aW9uc10gLSBFdmVudCBxdWVyeSBvciBwcm9qZWN0aW9uIG9wdGlvbnMuXG4gICAgICogQHJldHVybnMge1Byb21pc2U8KCkgPT4gdm9pZD59IC0gVW5zdWJzY3JpYmUgY2FsbGJhY2suXG4gICAgICovXG4gICAgc3RhdGljIGFzeW5jIG9uQ3JlYXRlKGNhbGxiYWNrLCBvcHRpb25zID0ge30pIHtcbiAgICAgIHN1YnNjcmlwdGlvbnMuY3JlYXRlLmFkZChjYWxsYmFjaylcbiAgICAgIHN1YnNjcmlwdGlvbnMub3B0aW9ucy5jcmVhdGUucHVzaChvcHRpb25zKVxuXG4gICAgICByZXR1cm4gKCkgPT4gc3Vic2NyaXB0aW9ucy5jcmVhdGUuZGVsZXRlKGNhbGxiYWNrKVxuICAgIH1cblxuICAgIC8qKlxuICAgICAqIFJ1bnMgb24gZGVzdHJveS5cbiAgICAgKiBAcGFyYW0geyhwYXlsb2FkOiBGcm9udGVuZE1vZGVsSG9va1Rlc3REZXN0cm95UGF5bG9hZCkgPT4gdm9pZH0gY2FsbGJhY2sgLSBFdmVudCBjYWxsYmFjay5cbiAgICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2Zyb250ZW5kLW1vZGVscy9xdWVyeS5qc1wiKS5Gcm9udGVuZE1vZGVsRXZlbnRPcHRpb25zT2JqZWN0fSBbb3B0aW9uc10gLSBFdmVudCBxdWVyeSBvciBwcm9qZWN0aW9uIG9wdGlvbnMuXG4gICAgICogQHJldHVybnMge1Byb21pc2U8KCkgPT4gdm9pZD59IC0gVW5zdWJzY3JpYmUgY2FsbGJhY2suXG4gICAgICovXG4gICAgc3RhdGljIGFzeW5jIG9uRGVzdHJveShjYWxsYmFjaywgb3B0aW9ucyA9IHt9KSB7XG4gICAgICBzdWJzY3JpcHRpb25zLmRlc3Ryb3kuYWRkKGNhbGxiYWNrKVxuICAgICAgc3Vic2NyaXB0aW9ucy5vcHRpb25zLmRlc3Ryb3kucHVzaChvcHRpb25zKVxuXG4gICAgICByZXR1cm4gKCkgPT4gc3Vic2NyaXB0aW9ucy5kZXN0cm95LmRlbGV0ZShjYWxsYmFjaylcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBSdW5zIG9uIHVwZGF0ZS5cbiAgICAgKiBAcGFyYW0geyhwYXlsb2FkOiBGcm9udGVuZE1vZGVsSG9va1Rlc3RDcmVhdGVVcGRhdGVQYXlsb2FkKSA9PiB2b2lkfSBjYWxsYmFjayAtIEV2ZW50IGNhbGxiYWNrLlxuICAgICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZnJvbnRlbmQtbW9kZWxzL3F1ZXJ5LmpzXCIpLkZyb250ZW5kTW9kZWxFdmVudE9wdGlvbnNPYmplY3R9IFtvcHRpb25zXSAtIEV2ZW50IHF1ZXJ5IG9yIHByb2plY3Rpb24gb3B0aW9ucy5cbiAgICAgKiBAcmV0dXJucyB7UHJvbWlzZTwoKSA9PiB2b2lkPn0gLSBVbnN1YnNjcmliZSBjYWxsYmFjay5cbiAgICAgKi9cbiAgICBzdGF0aWMgYXN5bmMgb25VcGRhdGUoY2FsbGJhY2ssIG9wdGlvbnMgPSB7fSkge1xuICAgICAgc3Vic2NyaXB0aW9ucy51cGRhdGUuYWRkKGNhbGxiYWNrKVxuICAgICAgc3Vic2NyaXB0aW9ucy5vcHRpb25zLnVwZGF0ZS5wdXNoKG9wdGlvbnMpXG5cbiAgICAgIHJldHVybiAoKSA9PiBzdWJzY3JpcHRpb25zLnVwZGF0ZS5kZWxldGUoY2FsbGJhY2spXG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIHtNb2RlbENsYXNzOiBGYWtlTW9kZWxDbGFzcywgc3Vic2NyaXB0aW9uc31cbn1cblxuLyoqXG4gKiBSdW5zIGVtaXQgZXZlbnQuXG4gKiBAcGFyYW0ge0Zha2VTdWJzY3JpcHRpb25zfSBzdWJzY3JpcHRpb25zIC0gQ2FsbGJhY2sgc2V0cy5cbiAqIEBwYXJhbSB7XCJjcmVhdGVcIiB8IFwiZGVzdHJveVwiIHwgXCJ1cGRhdGVcIn0gZXZlbnROYW1lIC0gRXZlbnQgbmFtZS5cbiAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbEhvb2tUZXN0Q3JlYXRlVXBkYXRlUGF5bG9hZCB8IEZyb250ZW5kTW9kZWxIb29rVGVzdERlc3Ryb3lQYXlsb2FkfSBwYXlsb2FkIC0gRXZlbnQgcGF5bG9hZC5cbiAqIEByZXR1cm5zIHt2b2lkfVxuICovXG5mdW5jdGlvbiBlbWl0RXZlbnQoc3Vic2NyaXB0aW9ucywgZXZlbnROYW1lLCBwYXlsb2FkKSB7XG4gIGlmIChldmVudE5hbWUgPT09IFwiZGVzdHJveVwiKSB7XG4gICAgZm9yIChjb25zdCBjYWxsYmFjayBvZiBzdWJzY3JpcHRpb25zLmRlc3Ryb3kpIHtcbiAgICAgIGNhbGxiYWNrKHtpZDogcGF5bG9hZC5pZH0pXG4gICAgfVxuXG4gICAgcmV0dXJuXG4gIH1cblxuICBpZiAoIShcIm1vZGVsXCIgaW4gcGF5bG9hZCkpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYEV4cGVjdGVkIG1vZGVsIHBheWxvYWQgZm9yICR7ZXZlbnROYW1lfWApXG4gIH1cblxuICBmb3IgKGNvbnN0IGNhbGxiYWNrIG9mIHN1YnNjcmlwdGlvbnNbZXZlbnROYW1lXSkge1xuICAgIGNhbGxiYWNrKHBheWxvYWQpXG4gIH1cbn1cblxuLyoqXG4gKiBSdW5zIGJ1aWxkIGZha2UgbW9kZWwuXG4gKiBAcGFyYW0ge3N0cmluZ30gaWQgLSBNb2RlbCBpZC5cbiAqIEBwYXJhbSB7RmFrZVN1YnNjcmlwdGlvbnN9IHN1YnNjcmlwdGlvbnMgLSBDYWxsYmFjayBzZXRzLlxuICogQHJldHVybnMge0Zyb250ZW5kTW9kZWxCYXNlfSAtIEZha2UgbW9kZWwgaW5zdGFuY2UuXG4gKi9cbmZ1bmN0aW9uIGJ1aWxkRmFrZU1vZGVsKGlkLCBzdWJzY3JpcHRpb25zKSB7XG4gIGNsYXNzIEZha2VNb2RlbCBleHRlbmRzIEZyb250ZW5kTW9kZWxCYXNlIHtcbiAgICAvKipcbiAgICAgKiBSdW5zIHJlc291cmNlIGNvbmZpZy5cbiAgICAgKiBAcmV0dXJucyB7RnJvbnRlbmRNb2RlbFJlc291cmNlQ29uZmlnfSAtIEZha2UgcmVzb3VyY2UgY29uZmlnLlxuICAgICAqL1xuICAgIHN0YXRpYyByZXNvdXJjZUNvbmZpZygpIHtcbiAgICAgIHJldHVybiBmYWtlUmVzb3VyY2VDb25maWcoXCJIb29rRmFrZUluc3RhbmNlTW9kZWxcIilcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBSdW5zIG9uIGRlc3Ryb3kuXG4gICAgICogQHBhcmFtIHsocGF5bG9hZDogRnJvbnRlbmRNb2RlbEhvb2tUZXN0RGVzdHJveVBheWxvYWQpID0+IHZvaWR9IGNhbGxiYWNrIC0gRXZlbnQgY2FsbGJhY2suXG4gICAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9mcm9udGVuZC1tb2RlbHMvcXVlcnkuanNcIikuRnJvbnRlbmRNb2RlbEV2ZW50T3B0aW9uc09iamVjdH0gW29wdGlvbnNdIC0gRXZlbnQgcXVlcnkgb3IgcHJvamVjdGlvbiBvcHRpb25zLlxuICAgICAqIEByZXR1cm5zIHtQcm9taXNlPCgpID0+IHZvaWQ+fSAtIFVuc3Vic2NyaWJlIGNhbGxiYWNrLlxuICAgICAqL1xuICAgIGFzeW5jIG9uRGVzdHJveShjYWxsYmFjaywgb3B0aW9ucyA9IHt9KSB7XG4gICAgICBzdWJzY3JpcHRpb25zLmRlc3Ryb3kuYWRkKGNhbGxiYWNrKVxuICAgICAgc3Vic2NyaXB0aW9ucy5vcHRpb25zLmRlc3Ryb3kucHVzaChvcHRpb25zKVxuXG4gICAgICByZXR1cm4gKCkgPT4gc3Vic2NyaXB0aW9ucy5kZXN0cm95LmRlbGV0ZShjYWxsYmFjaylcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBSdW5zIG9uIHVwZGF0ZS5cbiAgICAgKiBAcGFyYW0geyhwYXlsb2FkOiBGcm9udGVuZE1vZGVsSG9va1Rlc3RDcmVhdGVVcGRhdGVQYXlsb2FkKSA9PiB2b2lkfSBjYWxsYmFjayAtIEV2ZW50IGNhbGxiYWNrLlxuICAgICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZnJvbnRlbmQtbW9kZWxzL3F1ZXJ5LmpzXCIpLkZyb250ZW5kTW9kZWxFdmVudE9wdGlvbnNPYmplY3R9IFtvcHRpb25zXSAtIEV2ZW50IHF1ZXJ5IG9yIHByb2plY3Rpb24gb3B0aW9ucy5cbiAgICAgKiBAcmV0dXJucyB7UHJvbWlzZTwoKSA9PiB2b2lkPn0gLSBVbnN1YnNjcmliZSBjYWxsYmFjay5cbiAgICAgKi9cbiAgICBhc3luYyBvblVwZGF0ZShjYWxsYmFjaywgb3B0aW9ucyA9IHt9KSB7XG4gICAgICBzdWJzY3JpcHRpb25zLnVwZGF0ZS5hZGQoY2FsbGJhY2spXG4gICAgICBzdWJzY3JpcHRpb25zLm9wdGlvbnMudXBkYXRlLnB1c2gob3B0aW9ucylcblxuICAgICAgcmV0dXJuICgpID0+IHN1YnNjcmlwdGlvbnMudXBkYXRlLmRlbGV0ZShjYWxsYmFjaylcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBSdW5zIHByaW1hcnkga2V5IHZhbHVlLlxuICAgICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gUHJpbWFyeSBrZXkgdmFsdWUuXG4gICAgICovXG4gICAgcHJpbWFyeUtleVZhbHVlKCkge1xuICAgICAgcmV0dXJuIGlkXG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIG5ldyBGYWtlTW9kZWwoe2lkfSlcbn1cblxuLyoqXG4gKiBSdW5zIGNsYXNzIGxpZmVjeWNsZSBzY2VuYXJpby5cbiAqIEByZXR1cm5zIHtQcm9taXNlPFJlY29yZDxzdHJpbmcsIG51bWJlcj4+fSAtIFNjZW5hcmlvIHJlc3VsdC5cbiAqL1xuYXN5bmMgZnVuY3Rpb24gY2xhc3NMaWZlY3ljbGVTY2VuYXJpbygpIHtcbiAgY29uc3Qge01vZGVsQ2xhc3MsIHN1YnNjcmlwdGlvbnN9ID0gYnVpbGRGYWtlTW9kZWxDbGFzcygpXG4gIGNvbnN0IGV2ZW50TW9kZWwgPSBidWlsZEZha2VNb2RlbChcIjFcIiwgYnVpbGRGYWtlU3Vic2NyaXB0aW9ucygpKVxuICAvKipcbiAgICogUmVjZWl2ZWQgZXZlbnRzLlxuICAgKiBAdHlwZSB7QXJyYXk8RnJvbnRlbmRNb2RlbEhvb2tUZXN0Q3JlYXRlVXBkYXRlUGF5bG9hZCB8IEZyb250ZW5kTW9kZWxIb29rVGVzdERlc3Ryb3lQYXlsb2FkPn0gKi9cbiAgY29uc3QgcmVjZWl2ZWRFdmVudHMgPSBbXVxuICBsZXQgY29ubmVjdGVkQ291bnQgPSAwXG5cbiAgLyoqXG4gICAqIFJ1bnMgdGVzdCBjb21wb25lbnQuXG4gICAqIEByZXR1cm5zIHtSZWFjdC5SZWFjdEVsZW1lbnR9IC0gVGVzdCBlbGVtZW50LlxuICAgKi9cbiAgZnVuY3Rpb24gVGVzdENvbXBvbmVudCgpIHtcbiAgICB1c2VNb2RlbENsYXNzRXZlbnQoTW9kZWxDbGFzcywgW1wiY3JlYXRlXCIsIFwidXBkYXRlXCJdLCAocGF5bG9hZCkgPT4gcmVjZWl2ZWRFdmVudHMucHVzaChwYXlsb2FkKSwge1xuICAgICAgb25Db25uZWN0ZWQ6ICgpID0+IHsgY29ubmVjdGVkQ291bnQgKz0gMSB9XG4gICAgfSlcbiAgICB1c2VDcmVhdGVkRXZlbnQoTW9kZWxDbGFzcywgKHBheWxvYWQpID0+IHJlY2VpdmVkRXZlbnRzLnB1c2gocGF5bG9hZCkpXG5cbiAgICByZXR1cm4gUmVhY3QuY3JlYXRlRWxlbWVudChcImRpdlwiKVxuICB9XG5cbiAgY29uc3QgY29udHJvbHMgPSBhd2FpdCByZW5kZXJFbGVtZW50KFJlYWN0LmNyZWF0ZUVsZW1lbnQoVGVzdENvbXBvbmVudCkpXG4gIGF3YWl0IHdhaXRGb3IoKCkgPT4gc3Vic2NyaXB0aW9ucy5jcmVhdGUuc2l6ZSA9PT0gMiAmJiBzdWJzY3JpcHRpb25zLnVwZGF0ZS5zaXplID09PSAxKVxuXG4gIGNvbnN0IG1vdW50ZWRDcmVhdGVTdWJzY3JpcHRpb25zID0gc3Vic2NyaXB0aW9ucy5jcmVhdGUuc2l6ZVxuICBjb25zdCBtb3VudGVkVXBkYXRlU3Vic2NyaXB0aW9ucyA9IHN1YnNjcmlwdGlvbnMudXBkYXRlLnNpemVcbiAgY29uc3QgbW91bnRlZERlc3Ryb3lTdWJzY3JpcHRpb25zID0gc3Vic2NyaXB0aW9ucy5kZXN0cm95LnNpemVcbiAgY29uc3QgbW91bnRlZENvbm5lY3RlZENvdW50ID0gY29ubmVjdGVkQ291bnRcblxuICBlbWl0RXZlbnQoc3Vic2NyaXB0aW9ucywgXCJjcmVhdGVcIiwge2lkOiBcIjFcIiwgbW9kZWw6IGV2ZW50TW9kZWx9KVxuICBlbWl0RXZlbnQoc3Vic2NyaXB0aW9ucywgXCJ1cGRhdGVcIiwge2lkOiBcIjFcIiwgbW9kZWw6IGV2ZW50TW9kZWx9KVxuICBlbWl0RXZlbnQoc3Vic2NyaXB0aW9ucywgXCJkZXN0cm95XCIsIHtpZDogXCIxXCJ9KVxuXG4gIGNvbnN0IHJlY2VpdmVkRXZlbnRzQWZ0ZXJFbWl0ID0gcmVjZWl2ZWRFdmVudHMubGVuZ3RoXG5cbiAgYXdhaXQgY29udHJvbHMudW5tb3VudCgpXG5cbiAgcmV0dXJuIHtcbiAgICBtb3VudGVkQ29ubmVjdGVkQ291bnQsXG4gICAgbW91bnRlZENyZWF0ZVN1YnNjcmlwdGlvbnMsXG4gICAgbW91bnRlZERlc3Ryb3lTdWJzY3JpcHRpb25zLFxuICAgIG1vdW50ZWRVcGRhdGVTdWJzY3JpcHRpb25zLFxuICAgIHJlY2VpdmVkRXZlbnRzQWZ0ZXJFbWl0LFxuICAgIHVubW91bnRlZENyZWF0ZVN1YnNjcmlwdGlvbnM6IHN1YnNjcmlwdGlvbnMuY3JlYXRlLnNpemUsXG4gICAgdW5tb3VudGVkVXBkYXRlU3Vic2NyaXB0aW9uczogc3Vic2NyaXB0aW9ucy51cGRhdGUuc2l6ZVxuICB9XG59XG5cbi8qKlxuICogUnVucyBpbnN0YW5jZSBsaWZlY3ljbGUgc2NlbmFyaW8uXG4gKiBAcmV0dXJucyB7UHJvbWlzZTxSZWNvcmQ8c3RyaW5nLCBudW1iZXI+Pn0gLSBTY2VuYXJpbyByZXN1bHQuXG4gKi9cbmFzeW5jIGZ1bmN0aW9uIGluc3RhbmNlTGlmZWN5Y2xlU2NlbmFyaW8oKSB7XG4gIGNvbnN0IHN1YnNjcmlwdGlvbnMgPSBidWlsZEZha2VTdWJzY3JpcHRpb25zKClcbiAgY29uc3QgbW9kZWwgPSBidWlsZEZha2VNb2RlbChcInRhc2stMVwiLCBzdWJzY3JpcHRpb25zKVxuICAvKipcbiAgICogUmVjZWl2ZWQgZXZlbnRzLlxuICAgKiBAdHlwZSB7QXJyYXk8RnJvbnRlbmRNb2RlbEhvb2tUZXN0Q3JlYXRlVXBkYXRlUGF5bG9hZCB8IEZyb250ZW5kTW9kZWxIb29rVGVzdERlc3Ryb3lQYXlsb2FkPn0gKi9cbiAgY29uc3QgcmVjZWl2ZWRFdmVudHMgPSBbXVxuICBsZXQgY29ubmVjdGVkQ291bnQgPSAwXG5cbiAgLyoqXG4gICAqIFJ1bnMgdGVzdCBjb21wb25lbnQuXG4gICAqIEByZXR1cm5zIHtSZWFjdC5SZWFjdEVsZW1lbnR9IC0gVGVzdCBlbGVtZW50LlxuICAgKi9cbiAgZnVuY3Rpb24gVGVzdENvbXBvbmVudCgpIHtcbiAgICB1c2VVcGRhdGVkRXZlbnQobW9kZWwsIChwYXlsb2FkKSA9PiByZWNlaXZlZEV2ZW50cy5wdXNoKHBheWxvYWQpLCB7XG4gICAgICBvbkNvbm5lY3RlZDogKCkgPT4geyBjb25uZWN0ZWRDb3VudCArPSAxIH1cbiAgICB9KVxuICAgIHVzZURlc3Ryb3llZEV2ZW50KFttb2RlbF0sIChwYXlsb2FkKSA9PiByZWNlaXZlZEV2ZW50cy5wdXNoKHBheWxvYWQpLCB7XG4gICAgICBvbkNvbm5lY3RlZDogKCkgPT4geyBjb25uZWN0ZWRDb3VudCArPSAxIH1cbiAgICB9KVxuXG4gICAgcmV0dXJuIFJlYWN0LmNyZWF0ZUVsZW1lbnQoXCJkaXZcIilcbiAgfVxuXG4gIGNvbnN0IGNvbnRyb2xzID0gYXdhaXQgcmVuZGVyRWxlbWVudChSZWFjdC5jcmVhdGVFbGVtZW50KFRlc3RDb21wb25lbnQpKVxuICBhd2FpdCB3YWl0Rm9yKCgpID0+IHN1YnNjcmlwdGlvbnMudXBkYXRlLnNpemUgPT09IDEgJiYgc3Vic2NyaXB0aW9ucy5kZXN0cm95LnNpemUgPT09IDEpXG5cbiAgY29uc3QgbW91bnRlZENvbm5lY3RlZENvdW50ID0gY29ubmVjdGVkQ291bnRcbiAgY29uc3QgbW91bnRlZERlc3Ryb3lTdWJzY3JpcHRpb25zID0gc3Vic2NyaXB0aW9ucy5kZXN0cm95LnNpemVcbiAgY29uc3QgbW91bnRlZFVwZGF0ZVN1YnNjcmlwdGlvbnMgPSBzdWJzY3JpcHRpb25zLnVwZGF0ZS5zaXplXG5cbiAgZW1pdEV2ZW50KHN1YnNjcmlwdGlvbnMsIFwidXBkYXRlXCIsIHtpZDogXCJ0YXNrLTFcIiwgbW9kZWx9KVxuICBlbWl0RXZlbnQoc3Vic2NyaXB0aW9ucywgXCJkZXN0cm95XCIsIHtpZDogXCJ0YXNrLTFcIn0pXG5cbiAgY29uc3QgcmVjZWl2ZWRFdmVudHNBZnRlckVtaXQgPSByZWNlaXZlZEV2ZW50cy5sZW5ndGhcblxuICBhd2FpdCBjb250cm9scy51bm1vdW50KClcblxuICByZXR1cm4ge1xuICAgIG1vdW50ZWRDb25uZWN0ZWRDb3VudCxcbiAgICBtb3VudGVkRGVzdHJveVN1YnNjcmlwdGlvbnMsXG4gICAgbW91bnRlZFVwZGF0ZVN1YnNjcmlwdGlvbnMsXG4gICAgcmVjZWl2ZWRFdmVudHNBZnRlckVtaXQsXG4gICAgdW5tb3VudGVkRGVzdHJveVN1YnNjcmlwdGlvbnM6IHN1YnNjcmlwdGlvbnMuZGVzdHJveS5zaXplLFxuICAgIHVubW91bnRlZFVwZGF0ZVN1YnNjcmlwdGlvbnM6IHN1YnNjcmlwdGlvbnMudXBkYXRlLnNpemVcbiAgfVxufVxuXG4vKipcbiAqIFJ1bnMgcHJvamVjdGlvbiBvcHRpb25zIHNjZW5hcmlvLlxuICogQHJldHVybnMge1Byb21pc2U8UmVjb3JkPHN0cmluZywgbnVtYmVyPj59IC0gU2NlbmFyaW8gcmVzdWx0LlxuICovXG5hc3luYyBmdW5jdGlvbiBwcm9qZWN0aW9uT3B0aW9uc1NjZW5hcmlvKCkge1xuICBjb25zdCB7TW9kZWxDbGFzcywgc3Vic2NyaXB0aW9uczogY2xhc3NTdWJzY3JpcHRpb25zfSA9IGJ1aWxkRmFrZU1vZGVsQ2xhc3MoKVxuICBjb25zdCBpbnN0YW5jZVN1YnNjcmlwdGlvbnMgPSBidWlsZEZha2VTdWJzY3JpcHRpb25zKClcbiAgY29uc3QgbW9kZWwgPSBidWlsZEZha2VNb2RlbChcInRhc2stMVwiLCBpbnN0YW5jZVN1YnNjcmlwdGlvbnMpXG4gIGNvbnN0IGNsYXNzUXVlcnkgPSBNb2RlbENsYXNzXG4gICAgLndoZXJlKHtpZDogXCJ0YXNrLTFcIn0pXG4gICAgLnNlbGVjdChbXCJpZFwiXSlcbiAgY29uc3QgcmVxdWVzdENvbnRleHQgPSB7d29ya3NwYWNlSWQ6IFwid29ya3NwYWNlLWFscGhhXCJ9XG5cbiAgLyoqXG4gICAqIFJ1bnMgdGVzdCBjb21wb25lbnQuXG4gICAqIEByZXR1cm5zIHtSZWFjdC5SZWFjdEVsZW1lbnR9IC0gVGVzdCBlbGVtZW50LlxuICAgKi9cbiAgZnVuY3Rpb24gVGVzdENvbXBvbmVudCgpIHtcbiAgICB1c2VDcmVhdGVkRXZlbnQoTW9kZWxDbGFzcywgKCkgPT4ge30sIHtcbiAgICAgIHByZWxvYWQ6IFwicHJvamVjdFwiLFxuICAgICAgcXVlcnk6IGNsYXNzUXVlcnksXG4gICAgICByZXF1ZXN0Q29udGV4dCxcbiAgICAgIHNlbGVjdDoge1Rhc2s6IFtcImlkXCIsIFwibmFtZVVwcGVyY2FzZVwiXX1cbiAgICB9KVxuICAgIHVzZVVwZGF0ZWRFdmVudChtb2RlbCwgKCkgPT4ge30sIHtcbiAgICAgIHJlcXVlc3RDb250ZXh0LFxuICAgICAgc2VsZWN0OiBbXCJpZFwiXSxcbiAgICAgIHdpdGhDb3VudDogXCJjb21tZW50c1wiXG4gICAgfSlcbiAgICB1c2VEZXN0cm95ZWRFdmVudChtb2RlbCwgKCkgPT4ge30sIHtcbiAgICAgIHByZWxvYWQ6IFwicHJvamVjdFwiLFxuICAgICAgcmVxdWVzdENvbnRleHQsXG4gICAgICBzZWxlY3Q6IFtcImlkXCJdXG4gICAgfSlcblxuICAgIHJldHVybiBSZWFjdC5jcmVhdGVFbGVtZW50KFwiZGl2XCIpXG4gIH1cblxuICBjb25zdCBjb250cm9scyA9IGF3YWl0IHJlbmRlckVsZW1lbnQoUmVhY3QuY3JlYXRlRWxlbWVudChUZXN0Q29tcG9uZW50KSlcbiAgYXdhaXQgd2FpdEZvcigoKSA9PiBjbGFzc1N1YnNjcmlwdGlvbnMuY3JlYXRlLnNpemUgPT09IDEgJiYgaW5zdGFuY2VTdWJzY3JpcHRpb25zLnVwZGF0ZS5zaXplID09PSAxICYmIGluc3RhbmNlU3Vic2NyaXB0aW9ucy5kZXN0cm95LnNpemUgPT09IDEpXG5cbiAgY29uc3QgY3JlYXRlT3B0aW9ucyA9IGNsYXNzU3Vic2NyaXB0aW9ucy5vcHRpb25zLmNyZWF0ZVswXSB8fCB7fVxuICBjb25zdCB1cGRhdGVPcHRpb25zID0gaW5zdGFuY2VTdWJzY3JpcHRpb25zLm9wdGlvbnMudXBkYXRlWzBdIHx8IHt9XG4gIGNvbnN0IGRlc3Ryb3lPcHRpb25zID0gaW5zdGFuY2VTdWJzY3JpcHRpb25zLm9wdGlvbnMuZGVzdHJveVswXSB8fCB7fVxuXG4gIGF3YWl0IGNvbnRyb2xzLnVubW91bnQoKVxuXG4gIHJldHVybiB7XG4gICAgY2xhc3NDcmVhdGVQcmVsb2FkUHJvamVjdDogY3JlYXRlT3B0aW9ucy5wcmVsb2FkID09PSBcInByb2plY3RcIiA/IDEgOiAwLFxuICAgIGNsYXNzQ3JlYXRlUXVlcnlQYXNzZWQ6IGNyZWF0ZU9wdGlvbnMucXVlcnkgPT09IGNsYXNzUXVlcnkgPyAxIDogMCxcbiAgICBjbGFzc0NyZWF0ZVJlcXVlc3RDb250ZXh0UGFzc2VkOiBjcmVhdGVPcHRpb25zLnJlcXVlc3RDb250ZXh0ID09PSByZXF1ZXN0Q29udGV4dCA/IDEgOiAwLFxuICAgIGNsYXNzQ3JlYXRlU2VsZWN0Q291bnQ6IGNyZWF0ZU9wdGlvbnMuc2VsZWN0ICYmIHR5cGVvZiBjcmVhdGVPcHRpb25zLnNlbGVjdCA9PT0gXCJvYmplY3RcIiAmJiAhQXJyYXkuaXNBcnJheShjcmVhdGVPcHRpb25zLnNlbGVjdCkgJiYgQXJyYXkuaXNBcnJheShjcmVhdGVPcHRpb25zLnNlbGVjdC5UYXNrKSA/IGNyZWF0ZU9wdGlvbnMuc2VsZWN0LlRhc2subGVuZ3RoIDogMCxcbiAgICBpbnN0YW5jZURlc3Ryb3lQcmVsb2FkUHJvamVjdDogZGVzdHJveU9wdGlvbnMucHJlbG9hZCA9PT0gXCJwcm9qZWN0XCIgPyAxIDogMCxcbiAgICBpbnN0YW5jZURlc3Ryb3lSZXF1ZXN0Q29udGV4dFBhc3NlZDogZGVzdHJveU9wdGlvbnMucmVxdWVzdENvbnRleHQgPT09IHJlcXVlc3RDb250ZXh0ID8gMSA6IDAsXG4gICAgaW5zdGFuY2VEZXN0cm95U2VsZWN0Q291bnQ6IEFycmF5LmlzQXJyYXkoZGVzdHJveU9wdGlvbnMuc2VsZWN0KSA/IGRlc3Ryb3lPcHRpb25zLnNlbGVjdC5sZW5ndGggOiAwLFxuICAgIGluc3RhbmNlVXBkYXRlUmVxdWVzdENvbnRleHRQYXNzZWQ6IHVwZGF0ZU9wdGlvbnMucmVxdWVzdENvbnRleHQgPT09IHJlcXVlc3RDb250ZXh0ID8gMSA6IDAsXG4gICAgaW5zdGFuY2VVcGRhdGVTZWxlY3RDb3VudDogQXJyYXkuaXNBcnJheSh1cGRhdGVPcHRpb25zLnNlbGVjdCkgPyB1cGRhdGVPcHRpb25zLnNlbGVjdC5sZW5ndGggOiAwLFxuICAgIGluc3RhbmNlVXBkYXRlV2l0aENvdW50Q29tbWVudHM6IHVwZGF0ZU9wdGlvbnMud2l0aENvdW50ID09PSBcImNvbW1lbnRzXCIgPyAxIDogMFxuICB9XG59XG5cbi8qKlxuICogUnVucyByZXF1ZXN0IGNvbnRleHQgcHJlc2VuY2Ugc2NlbmFyaW8uXG4gKiBAcmV0dXJucyB7UHJvbWlzZTxSZWNvcmQ8c3RyaW5nLCBudW1iZXI+Pn0gLSBTY2VuYXJpbyByZXN1bHQuXG4gKi9cbmFzeW5jIGZ1bmN0aW9uIHJlcXVlc3RDb250ZXh0UHJlc2VuY2VTY2VuYXJpbygpIHtcbiAgY29uc3Qge01vZGVsQ2xhc3MsIHN1YnNjcmlwdGlvbnM6IGNsYXNzU3Vic2NyaXB0aW9uc30gPSBidWlsZEZha2VNb2RlbENsYXNzKClcbiAgY29uc3QgaW5zdGFuY2VTdWJzY3JpcHRpb25zID0gYnVpbGRGYWtlU3Vic2NyaXB0aW9ucygpXG4gIGNvbnN0IG1vZGVsID0gYnVpbGRGYWtlTW9kZWwoXCJ0YXNrLTFcIiwgaW5zdGFuY2VTdWJzY3JpcHRpb25zKVxuXG4gIC8qKlxuICAgKiBSdW5zIHRlc3QgY29tcG9uZW50LlxuICAgKiBAcGFyYW0ge3tleHBsaWNpdEVtcHR5OiBib29sZWFufX0gcHJvcHMgLSBDb21wb25lbnQgcHJvcHMuXG4gICAqIEByZXR1cm5zIHtSZWFjdC5SZWFjdEVsZW1lbnR9IC0gVGVzdCBlbGVtZW50LlxuICAgKi9cbiAgZnVuY3Rpb24gVGVzdENvbXBvbmVudCh7ZXhwbGljaXRFbXB0eX0pIHtcbiAgICBjb25zdCBvcHRpb25zID0gZXhwbGljaXRFbXB0eSA/IHtyZXF1ZXN0Q29udGV4dDoge319IDoge31cblxuICAgIHVzZU1vZGVsQ2xhc3NFdmVudChNb2RlbENsYXNzLCBcImNyZWF0ZVwiLCAoKSA9PiB7fSwgb3B0aW9ucylcbiAgICB1c2VVcGRhdGVkRXZlbnQobW9kZWwsICgpID0+IHt9LCBvcHRpb25zKVxuICAgIHVzZURlc3Ryb3llZEV2ZW50KG1vZGVsLCAoKSA9PiB7fSwgb3B0aW9ucylcblxuICAgIHJldHVybiBSZWFjdC5jcmVhdGVFbGVtZW50KFwiZGl2XCIpXG4gIH1cblxuICBjb25zdCByZWdpc3RyYXRpb25Db3VudCA9ICgpID0+IGNsYXNzU3Vic2NyaXB0aW9ucy5vcHRpb25zLmNyZWF0ZS5sZW5ndGggKyBpbnN0YW5jZVN1YnNjcmlwdGlvbnMub3B0aW9ucy51cGRhdGUubGVuZ3RoICsgaW5zdGFuY2VTdWJzY3JpcHRpb25zLm9wdGlvbnMuZGVzdHJveS5sZW5ndGhcbiAgY29uc3QgYWN0aXZlU3Vic2NyaXB0aW9uQ291bnQgPSAoKSA9PiBjbGFzc1N1YnNjcmlwdGlvbnMuY3JlYXRlLnNpemUgKyBpbnN0YW5jZVN1YnNjcmlwdGlvbnMudXBkYXRlLnNpemUgKyBpbnN0YW5jZVN1YnNjcmlwdGlvbnMuZGVzdHJveS5zaXplXG4gIGNvbnN0IGNvbnRyb2xzID0gYXdhaXQgcmVuZGVyRWxlbWVudChSZWFjdC5jcmVhdGVFbGVtZW50KFRlc3RDb21wb25lbnQsIHtleHBsaWNpdEVtcHR5OiBmYWxzZX0pKVxuICBhd2FpdCB3YWl0Rm9yKCgpID0+IHJlZ2lzdHJhdGlvbkNvdW50KCkgPT09IDMgJiYgYWN0aXZlU3Vic2NyaXB0aW9uQ291bnQoKSA9PT0gMylcblxuICBjb25zdCByZWdpc3RyYXRpb25zQWZ0ZXJJbmhlcml0ZWRSZW5kZXIgPSByZWdpc3RyYXRpb25Db3VudCgpXG5cbiAgYXdhaXQgY29udHJvbHMucmVyZW5kZXIoUmVhY3QuY3JlYXRlRWxlbWVudChUZXN0Q29tcG9uZW50LCB7ZXhwbGljaXRFbXB0eTogZmFsc2V9KSlcbiAgY29uc3QgcmVnaXN0cmF0aW9uc0FmdGVyU3RhYmxlSW5oZXJpdGVkUmVuZGVyID0gcmVnaXN0cmF0aW9uQ291bnQoKVxuXG4gIGF3YWl0IGNvbnRyb2xzLnJlcmVuZGVyKFJlYWN0LmNyZWF0ZUVsZW1lbnQoVGVzdENvbXBvbmVudCwge2V4cGxpY2l0RW1wdHk6IHRydWV9KSlcbiAgYXdhaXQgd2FpdEZvcigoKSA9PiByZWdpc3RyYXRpb25Db3VudCgpID09PSA2ICYmIGFjdGl2ZVN1YnNjcmlwdGlvbkNvdW50KCkgPT09IDMpXG4gIGNvbnN0IHJlZ2lzdHJhdGlvbnNBZnRlckV4cGxpY2l0RW1wdHlSZW5kZXIgPSByZWdpc3RyYXRpb25Db3VudCgpXG5cbiAgYXdhaXQgY29udHJvbHMucmVyZW5kZXIoUmVhY3QuY3JlYXRlRWxlbWVudChUZXN0Q29tcG9uZW50LCB7ZXhwbGljaXRFbXB0eTogdHJ1ZX0pKVxuICBjb25zdCByZWdpc3RyYXRpb25zQWZ0ZXJTdGFibGVFeHBsaWNpdEVtcHR5UmVuZGVyID0gcmVnaXN0cmF0aW9uQ291bnQoKVxuXG4gIGF3YWl0IGNvbnRyb2xzLnJlcmVuZGVyKFJlYWN0LmNyZWF0ZUVsZW1lbnQoVGVzdENvbXBvbmVudCwge2V4cGxpY2l0RW1wdHk6IGZhbHNlfSkpXG4gIGF3YWl0IHdhaXRGb3IoKCkgPT4gcmVnaXN0cmF0aW9uQ291bnQoKSA9PT0gOSAmJiBhY3RpdmVTdWJzY3JpcHRpb25Db3VudCgpID09PSAzKVxuXG4gIGNvbnN0IHJvdXRpbmdPcHRpb25zID0gW1xuICAgIGNsYXNzU3Vic2NyaXB0aW9ucy5vcHRpb25zLmNyZWF0ZSxcbiAgICBpbnN0YW5jZVN1YnNjcmlwdGlvbnMub3B0aW9ucy51cGRhdGUsXG4gICAgaW5zdGFuY2VTdWJzY3JpcHRpb25zLm9wdGlvbnMuZGVzdHJveVxuICBdXG4gIGNvbnN0IGV4cGxpY2l0RW1wdHlSb3V0aW5nUmVnaXN0cmF0aW9ucyA9IHJvdXRpbmdPcHRpb25zLmZpbHRlcigob3B0aW9ucykgPT4ge1xuICAgIGNvbnN0IHJlcXVlc3RDb250ZXh0ID0gb3B0aW9uc1sxXT8ucmVxdWVzdENvbnRleHRcblxuICAgIHJldHVybiByZXF1ZXN0Q29udGV4dCAmJiBPYmplY3Qua2V5cyhyZXF1ZXN0Q29udGV4dCkubGVuZ3RoID09PSAwXG4gIH0pLmxlbmd0aFxuICBjb25zdCBpbmhlcml0ZWRSb3V0aW5nUmVnaXN0cmF0aW9ucyA9IHJvdXRpbmdPcHRpb25zLnJlZHVjZSgoY291bnQsIG9wdGlvbnMpID0+IChcbiAgICBjb3VudCArIFtvcHRpb25zWzBdLCBvcHRpb25zWzJdXS5maWx0ZXIoKGVudHJ5KSA9PiBlbnRyeT8ucmVxdWVzdENvbnRleHQgPT09IHVuZGVmaW5lZCkubGVuZ3RoXG4gICksIDApXG5cbiAgY29uc3QgcmVzdWx0ID0ge1xuICAgIGFjdGl2ZVN1YnNjcmlwdGlvbnNBZnRlclRyYW5zaXRpb25zOiBhY3RpdmVTdWJzY3JpcHRpb25Db3VudCgpLFxuICAgIGNsYXNzUmVnaXN0cmF0aW9uc0FmdGVyVHJhbnNpdGlvbnM6IGNsYXNzU3Vic2NyaXB0aW9ucy5vcHRpb25zLmNyZWF0ZS5sZW5ndGgsXG4gICAgZXhwbGljaXRFbXB0eVJvdXRpbmdSZWdpc3RyYXRpb25zLFxuICAgIGluaGVyaXRlZFJvdXRpbmdSZWdpc3RyYXRpb25zLFxuICAgIGluc3RhbmNlRGVzdHJveVJlZ2lzdHJhdGlvbnNBZnRlclRyYW5zaXRpb25zOiBpbnN0YW5jZVN1YnNjcmlwdGlvbnMub3B0aW9ucy5kZXN0cm95Lmxlbmd0aCxcbiAgICBpbnN0YW5jZVVwZGF0ZVJlZ2lzdHJhdGlvbnNBZnRlclRyYW5zaXRpb25zOiBpbnN0YW5jZVN1YnNjcmlwdGlvbnMub3B0aW9ucy51cGRhdGUubGVuZ3RoLFxuICAgIHJlZ2lzdHJhdGlvbnNBZnRlckV4cGxpY2l0RW1wdHlSZW5kZXIsXG4gICAgcmVnaXN0cmF0aW9uc0FmdGVySW5oZXJpdGVkQWdhaW5SZW5kZXI6IHJlZ2lzdHJhdGlvbkNvdW50KCksXG4gICAgcmVnaXN0cmF0aW9uc0FmdGVySW5oZXJpdGVkUmVuZGVyLFxuICAgIHJlZ2lzdHJhdGlvbnNBZnRlclN0YWJsZUV4cGxpY2l0RW1wdHlSZW5kZXIsXG4gICAgcmVnaXN0cmF0aW9uc0FmdGVyU3RhYmxlSW5oZXJpdGVkUmVuZGVyXG4gIH1cblxuICBhd2FpdCBjb250cm9scy51bm1vdW50KClcblxuICByZXR1cm4ge1xuICAgIC4uLnJlc3VsdCxcbiAgICBhY3RpdmVTdWJzY3JpcHRpb25zQWZ0ZXJVbm1vdW50OiBhY3RpdmVTdWJzY3JpcHRpb25Db3VudCgpXG4gIH1cbn1cblxuLyoqXG4gKiBSdW5zIGRlYm91bmNlIHVubW91bnQgc2NlbmFyaW8uXG4gKiBAcmV0dXJucyB7UHJvbWlzZTxSZWNvcmQ8c3RyaW5nLCBudW1iZXI+Pn0gLSBTY2VuYXJpbyByZXN1bHQuXG4gKi9cbmFzeW5jIGZ1bmN0aW9uIGRlYm91bmNlVW5tb3VudFNjZW5hcmlvKCkge1xuICBjb25zdCB7TW9kZWxDbGFzcywgc3Vic2NyaXB0aW9uczogY2xhc3NTdWJzY3JpcHRpb25zfSA9IGJ1aWxkRmFrZU1vZGVsQ2xhc3MoKVxuICBjb25zdCBpbnN0YW5jZVN1YnNjcmlwdGlvbnMgPSBidWlsZEZha2VTdWJzY3JpcHRpb25zKClcbiAgY29uc3QgbW9kZWwgPSBidWlsZEZha2VNb2RlbChcInRhc2stMVwiLCBpbnN0YW5jZVN1YnNjcmlwdGlvbnMpXG4gIC8qKlxuICAgKiBSZWNlaXZlZCBldmVudHMuXG4gICAqIEB0eXBlIHtBcnJheTxGcm9udGVuZE1vZGVsSG9va1Rlc3RDcmVhdGVVcGRhdGVQYXlsb2FkIHwgRnJvbnRlbmRNb2RlbEhvb2tUZXN0RGVzdHJveVBheWxvYWQ+fSAqL1xuICBjb25zdCByZWNlaXZlZEV2ZW50cyA9IFtdXG5cbiAgLyoqXG4gICAqIFJ1bnMgdGVzdCBjb21wb25lbnQuXG4gICAqIEByZXR1cm5zIHtSZWFjdC5SZWFjdEVsZW1lbnR9IC0gVGVzdCBlbGVtZW50LlxuICAgKi9cbiAgZnVuY3Rpb24gVGVzdENvbXBvbmVudCgpIHtcbiAgICB1c2VNb2RlbENsYXNzRXZlbnQoTW9kZWxDbGFzcywgXCJ1cGRhdGVcIiwgKHBheWxvYWQpID0+IHJlY2VpdmVkRXZlbnRzLnB1c2gocGF5bG9hZCksIHtkZWJvdW5jZTogMjB9KVxuICAgIHVzZVVwZGF0ZWRFdmVudChtb2RlbCwgKHBheWxvYWQpID0+IHJlY2VpdmVkRXZlbnRzLnB1c2gocGF5bG9hZCksIHtkZWJvdW5jZTogMjB9KVxuICAgIHVzZURlc3Ryb3llZEV2ZW50KG1vZGVsLCAocGF5bG9hZCkgPT4gcmVjZWl2ZWRFdmVudHMucHVzaChwYXlsb2FkKSwge2RlYm91bmNlOiAyMH0pXG5cbiAgICByZXR1cm4gUmVhY3QuY3JlYXRlRWxlbWVudChcImRpdlwiKVxuICB9XG5cbiAgY29uc3QgY29udHJvbHMgPSBhd2FpdCByZW5kZXJFbGVtZW50KFJlYWN0LmNyZWF0ZUVsZW1lbnQoVGVzdENvbXBvbmVudCkpXG4gIGF3YWl0IHdhaXRGb3IoKCkgPT4gY2xhc3NTdWJzY3JpcHRpb25zLnVwZGF0ZS5zaXplID09PSAxICYmIGluc3RhbmNlU3Vic2NyaXB0aW9ucy51cGRhdGUuc2l6ZSA9PT0gMSAmJiBpbnN0YW5jZVN1YnNjcmlwdGlvbnMuZGVzdHJveS5zaXplID09PSAxKVxuXG4gIGVtaXRFdmVudChjbGFzc1N1YnNjcmlwdGlvbnMsIFwidXBkYXRlXCIsIHtpZDogXCJ0YXNrLTFcIiwgbW9kZWx9KVxuICBlbWl0RXZlbnQoaW5zdGFuY2VTdWJzY3JpcHRpb25zLCBcInVwZGF0ZVwiLCB7aWQ6IFwidGFzay0xXCIsIG1vZGVsfSlcbiAgZW1pdEV2ZW50KGluc3RhbmNlU3Vic2NyaXB0aW9ucywgXCJkZXN0cm95XCIsIHtpZDogXCJ0YXNrLTFcIn0pXG5cbiAgYXdhaXQgY29udHJvbHMudW5tb3VudCgpXG4gIGF3YWl0IHdhaXQoMzApXG5cbiAgcmV0dXJuIHtyZWNlaXZlZEV2ZW50c0FmdGVyRGVib3VuY2VXaW5kb3c6IHJlY2VpdmVkRXZlbnRzLmxlbmd0aH1cbn1cblxuLyoqXG4gKiBSdW5zIHJlc3Vic2NyaWJlIGluc3RhbmNlIHNjZW5hcmlvLlxuICogQHJldHVybnMge1Byb21pc2U8UmVjb3JkPHN0cmluZywgbnVtYmVyPj59IC0gU2NlbmFyaW8gcmVzdWx0LlxuICovXG5hc3luYyBmdW5jdGlvbiByZXN1YnNjcmliZUluc3RhbmNlU2NlbmFyaW8oKSB7XG4gIGNvbnN0IGZpcnN0U3Vic2NyaXB0aW9ucyA9IGJ1aWxkRmFrZVN1YnNjcmlwdGlvbnMoKVxuICBjb25zdCBzZWNvbmRTdWJzY3JpcHRpb25zID0gYnVpbGRGYWtlU3Vic2NyaXB0aW9ucygpXG4gIGNvbnN0IGZpcnN0TW9kZWwgPSBidWlsZEZha2VNb2RlbChcInRhc2stMVwiLCBmaXJzdFN1YnNjcmlwdGlvbnMpXG4gIGNvbnN0IHNlY29uZE1vZGVsID0gYnVpbGRGYWtlTW9kZWwoXCJ0YXNrLTFcIiwgc2Vjb25kU3Vic2NyaXB0aW9ucylcbiAgLyoqXG4gICAqIFJlY2VpdmVkIGV2ZW50cy5cbiAgICogQHR5cGUge0FycmF5PEZyb250ZW5kTW9kZWxIb29rVGVzdENyZWF0ZVVwZGF0ZVBheWxvYWQgfCBGcm9udGVuZE1vZGVsSG9va1Rlc3REZXN0cm95UGF5bG9hZD59ICovXG4gIGNvbnN0IHJlY2VpdmVkRXZlbnRzID0gW11cblxuICAvKipcbiAgICogUnVucyB0ZXN0IGNvbXBvbmVudC5cbiAgICogQHBhcmFtIHt7bW9kZWw6IGltcG9ydChcIi4uL2Zyb250ZW5kLW1vZGVscy9iYXNlLmpzXCIpLmRlZmF1bHR9fSBwcm9wcyAtIENvbXBvbmVudCBwcm9wcy5cbiAgICogQHJldHVybnMge1JlYWN0LlJlYWN0RWxlbWVudH0gLSBUZXN0IGVsZW1lbnQuXG4gICAqL1xuICBmdW5jdGlvbiBUZXN0Q29tcG9uZW50KHttb2RlbH0pIHtcbiAgICB1c2VVcGRhdGVkRXZlbnQobW9kZWwsIChwYXlsb2FkKSA9PiByZWNlaXZlZEV2ZW50cy5wdXNoKHBheWxvYWQpKVxuICAgIHVzZURlc3Ryb3llZEV2ZW50KG1vZGVsLCAocGF5bG9hZCkgPT4gcmVjZWl2ZWRFdmVudHMucHVzaChwYXlsb2FkKSlcblxuICAgIHJldHVybiBSZWFjdC5jcmVhdGVFbGVtZW50KFwiZGl2XCIpXG4gIH1cblxuICBjb25zdCBjb250cm9scyA9IGF3YWl0IHJlbmRlckVsZW1lbnQoUmVhY3QuY3JlYXRlRWxlbWVudChUZXN0Q29tcG9uZW50LCB7bW9kZWw6IGZpcnN0TW9kZWx9KSlcbiAgYXdhaXQgd2FpdEZvcigoKSA9PiBmaXJzdFN1YnNjcmlwdGlvbnMudXBkYXRlLnNpemUgPT09IDEgJiYgZmlyc3RTdWJzY3JpcHRpb25zLmRlc3Ryb3kuc2l6ZSA9PT0gMSlcblxuICBjb25zdCBmaXJzdE1vdW50ZWREZXN0cm95U3Vic2NyaXB0aW9ucyA9IGZpcnN0U3Vic2NyaXB0aW9ucy5kZXN0cm95LnNpemVcbiAgY29uc3QgZmlyc3RNb3VudGVkVXBkYXRlU3Vic2NyaXB0aW9ucyA9IGZpcnN0U3Vic2NyaXB0aW9ucy51cGRhdGUuc2l6ZVxuXG4gIGF3YWl0IGNvbnRyb2xzLnJlcmVuZGVyKFJlYWN0LmNyZWF0ZUVsZW1lbnQoVGVzdENvbXBvbmVudCwge21vZGVsOiBzZWNvbmRNb2RlbH0pKVxuICBhd2FpdCB3YWl0Rm9yKCgpID0+IGZpcnN0U3Vic2NyaXB0aW9ucy51cGRhdGUuc2l6ZSA9PT0gMCAmJiBmaXJzdFN1YnNjcmlwdGlvbnMuZGVzdHJveS5zaXplID09PSAwICYmIHNlY29uZFN1YnNjcmlwdGlvbnMudXBkYXRlLnNpemUgPT09IDEgJiYgc2Vjb25kU3Vic2NyaXB0aW9ucy5kZXN0cm95LnNpemUgPT09IDEpXG5cbiAgY29uc3QgZmlyc3RBZnRlclJlcmVuZGVyRGVzdHJveVN1YnNjcmlwdGlvbnMgPSBmaXJzdFN1YnNjcmlwdGlvbnMuZGVzdHJveS5zaXplXG4gIGNvbnN0IGZpcnN0QWZ0ZXJSZXJlbmRlclVwZGF0ZVN1YnNjcmlwdGlvbnMgPSBmaXJzdFN1YnNjcmlwdGlvbnMudXBkYXRlLnNpemVcbiAgY29uc3Qgc2Vjb25kQWZ0ZXJSZXJlbmRlckRlc3Ryb3lTdWJzY3JpcHRpb25zID0gc2Vjb25kU3Vic2NyaXB0aW9ucy5kZXN0cm95LnNpemVcbiAgY29uc3Qgc2Vjb25kQWZ0ZXJSZXJlbmRlclVwZGF0ZVN1YnNjcmlwdGlvbnMgPSBzZWNvbmRTdWJzY3JpcHRpb25zLnVwZGF0ZS5zaXplXG5cbiAgZW1pdEV2ZW50KGZpcnN0U3Vic2NyaXB0aW9ucywgXCJ1cGRhdGVcIiwge2lkOiBcInRhc2stMVwiLCBtb2RlbDogZmlyc3RNb2RlbH0pXG4gIGVtaXRFdmVudChzZWNvbmRTdWJzY3JpcHRpb25zLCBcInVwZGF0ZVwiLCB7aWQ6IFwidGFzay0xXCIsIG1vZGVsOiBzZWNvbmRNb2RlbH0pXG4gIGVtaXRFdmVudChzZWNvbmRTdWJzY3JpcHRpb25zLCBcImRlc3Ryb3lcIiwge2lkOiBcInRhc2stMVwifSlcblxuICBjb25zdCByZWNlaXZlZEV2ZW50c0FmdGVyRW1pdCA9IHJlY2VpdmVkRXZlbnRzLmxlbmd0aFxuXG4gIGF3YWl0IGNvbnRyb2xzLnVubW91bnQoKVxuXG4gIHJldHVybiB7XG4gICAgZmlyc3RBZnRlclJlcmVuZGVyRGVzdHJveVN1YnNjcmlwdGlvbnMsXG4gICAgZmlyc3RBZnRlclJlcmVuZGVyVXBkYXRlU3Vic2NyaXB0aW9ucyxcbiAgICBmaXJzdE1vdW50ZWREZXN0cm95U3Vic2NyaXB0aW9ucyxcbiAgICBmaXJzdE1vdW50ZWRVcGRhdGVTdWJzY3JpcHRpb25zLFxuICAgIHJlY2VpdmVkRXZlbnRzQWZ0ZXJFbWl0LFxuICAgIHNlY29uZEFmdGVyUmVyZW5kZXJEZXN0cm95U3Vic2NyaXB0aW9ucyxcbiAgICBzZWNvbmRBZnRlclJlcmVuZGVyVXBkYXRlU3Vic2NyaXB0aW9uc1xuICB9XG59XG5cbmNvbnN0IHNjZW5hcmlvcyA9IHtcbiAgY2xhc3NMaWZlY3ljbGU6IGNsYXNzTGlmZWN5Y2xlU2NlbmFyaW8sXG4gIGRlYm91bmNlVW5tb3VudDogZGVib3VuY2VVbm1vdW50U2NlbmFyaW8sXG4gIGluc3RhbmNlTGlmZWN5Y2xlOiBpbnN0YW5jZUxpZmVjeWNsZVNjZW5hcmlvLFxuICBwcm9qZWN0aW9uT3B0aW9uczogcHJvamVjdGlvbk9wdGlvbnNTY2VuYXJpbyxcbiAgcmVxdWVzdENvbnRleHRQcmVzZW5jZTogcmVxdWVzdENvbnRleHRQcmVzZW5jZVNjZW5hcmlvLFxuICByZXN1YnNjcmliZUluc3RhbmNlOiByZXN1YnNjcmliZUluc3RhbmNlU2NlbmFyaW9cbn1cblxuLyoqXG4gKiBSdW5zIHJ1biBmcm9udGVuZCBtb2RlbCBldmVudCBob29rIHNjZW5hcmlvLlxuICogQHBhcmFtIHtrZXlvZiB0eXBlb2Ygc2NlbmFyaW9zfSBzY2VuYXJpb05hbWUgLSBTY2VuYXJpbyBuYW1lLlxuICogQHJldHVybnMge1Byb21pc2U8UmVjb3JkPHN0cmluZywgbnVtYmVyPj59IC0gU2NlbmFyaW8gcmVzdWx0LlxuICovXG5leHBvcnQgZGVmYXVsdCBhc3luYyBmdW5jdGlvbiBydW5Gcm9udGVuZE1vZGVsRXZlbnRIb29rU2NlbmFyaW8oc2NlbmFyaW9OYW1lKSB7XG4gIGNvbnN0IHNjZW5hcmlvID0gc2NlbmFyaW9zW3NjZW5hcmlvTmFtZV1cblxuICBpZiAoIXNjZW5hcmlvKSB0aHJvdyBuZXcgRXJyb3IoYFVua25vd24gZnJvbnRlbmQgbW9kZWwgZXZlbnQgaG9vayBzY2VuYXJpbzogJHtzY2VuYXJpb05hbWV9YClcblxuICByZXR1cm4gYXdhaXQgc2NlbmFyaW8oKVxufVxuIl19