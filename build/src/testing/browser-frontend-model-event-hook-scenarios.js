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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYnJvd3Nlci1mcm9udGVuZC1tb2RlbC1ldmVudC1ob29rLXNjZW5hcmlvcy5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy90ZXN0aW5nL2Jyb3dzZXItZnJvbnRlbmQtbW9kZWwtZXZlbnQtaG9vay1zY2VuYXJpb3MuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLE9BQU8sS0FBSyxNQUFNLE9BQU8sQ0FBQTtBQUN6QixPQUFPLEVBQUMsVUFBVSxFQUFDLE1BQU0sa0JBQWtCLENBQUE7QUFFM0MsT0FBTyxpQkFBaUIsTUFBTSwyQ0FBMkMsQ0FBQTtBQUN6RSxPQUFPLGVBQWUsTUFBTSx5Q0FBeUMsQ0FBQTtBQUNyRSxPQUFPLGlCQUFpQixNQUFNLDRCQUE0QixDQUFBO0FBQzFELE9BQU8sa0JBQWtCLE1BQU0sNkNBQTZDLENBQUE7QUFDNUUsT0FBTyxlQUFlLE1BQU0seUNBQXlDLENBQUE7QUFDckUsT0FBTyxJQUFJLE1BQU0sd0JBQXdCLENBQUE7QUFFekM7OzZHQUU2RztBQUM3Rzs7Z0dBRWdHO0FBQ2hHOztpRUFFaUU7QUFDakU7Ozs7Ozs7R0FPRztBQUVIOzs7R0FHRztBQUNILEtBQUssVUFBVSxZQUFZO0lBQ3pCLE1BQU0sT0FBTyxDQUFDLE9BQU8sRUFBRSxDQUFBO0lBQ3ZCLE1BQU0sSUFBSSxPQUFPLENBQUMsQ0FBQyxPQUFPLEVBQUUsRUFBRSxDQUFDLFVBQVUsQ0FBQyxPQUFPLEVBQUUsQ0FBQyxDQUFDLENBQUMsQ0FBQTtBQUN4RCxDQUFDO0FBRUQ7Ozs7R0FJRztBQUNILEtBQUssVUFBVSxPQUFPLENBQUMsUUFBUTtJQUM3QixNQUFNLFNBQVMsR0FBRyxJQUFJLENBQUMsR0FBRyxFQUFFLENBQUE7SUFFNUIsT0FBTyxDQUFDLFFBQVEsRUFBRSxFQUFFLENBQUM7UUFDbkIsSUFBSSxJQUFJLENBQUMsR0FBRyxFQUFFLEdBQUcsU0FBUyxHQUFHLElBQUk7WUFBRSxPQUFNO1FBRXpDLE1B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TyxFQUFFLENBQUE7SUFFeEIsT0FBTztRQUNMLHNDQUFzQztRQUN0QyxxQ0FBcUM7UUFDckMsZ0NBQWdDO1FBQ2hDLCtCQUErQjtRQUMvQix1QkFBdUI7UUFDdkIsdUNBQXVDO1FBQ3ZDLHNDQUFzQztLQUN2QyxDQUFBO0FBQ0gsQ0FBQztBQUVELE1BQU0sU0FBUyxHQUFHO0lBQ2hCLGNBQWMsRUFBRSxzQkFBc0I7SUFDdEMsZUFBZSxFQUFFLHVCQUF1QjtJQUN4QyxpQkFBaUIsRUFBRSx5QkFBeUI7SUFDNUMsaUJBQWlCLEVBQUUseUJBQXlCO0lBQzVDLG1CQUFtQixFQUFFLDJCQUEyQjtDQUNqRCxDQUFBO0FBRUQ7Ozs7R0FJRztBQUNILE1BQU0sQ0FBQyxPQUFPLENBQUMsS0FBSyxVQUFVLGlDQUFpQyxDQUFDLFlBQVk7SUFDMUUsTUFBTSxRQUFRLEdBQUcsU0FBUyxDQUFDLFlBQVksQ0FBQyxDQUFBO0lBRXhDLElBQUksQ0FBQyxRQUFRO1FBQUUsTUFBTSxJQUFJLEtBQUssQ0FBQywrQ0FBK0MsWUFBWSxFQUFFLENBQUMsQ0FBQTtJQUU3RixPQUFPLE1BQU0sUUFBUSxFQUFFLENBQUE7QUFDekIsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG5pbXBvcnQgUmVhY3QgZnJvbSBcInJlYWN0XCJcbmltcG9ydCB7Y3JlYXRlUm9vdH0gZnJvbSBcInJlYWN0LWRvbS9jbGllbnRcIlxuXG5pbXBvcnQgdXNlRGVzdHJveWVkRXZlbnQgZnJvbSBcIi4uL2Zyb250ZW5kLW1vZGVscy91c2UtZGVzdHJveWVkLWV2ZW50LmpzXCJcbmltcG9ydCB1c2VDcmVhdGVkRXZlbnQgZnJvbSBcIi4uL2Zyb250ZW5kLW1vZGVscy91c2UtY3JlYXRlZC1ldmVudC5qc1wiXG5pbXBvcnQgRnJvbnRlbmRNb2RlbEJhc2UgZnJvbSBcIi4uL2Zyb250ZW5kLW1vZGVscy9iYXNlLmpzXCJcbmltcG9ydCB1c2VNb2RlbENsYXNzRXZlbnQgZnJvbSBcIi4uL2Zyb250ZW5kLW1vZGVscy91c2UtbW9kZWwtY2xhc3MtZXZlbnQuanNcIlxuaW1wb3J0IHVzZVVwZGF0ZWRFdmVudCBmcm9tIFwiLi4vZnJvbnRlbmQtbW9kZWxzL3VzZS11cGRhdGVkLWV2ZW50LmpzXCJcbmltcG9ydCB3YWl0IGZyb20gXCJhd2FpdGVyeS9idWlsZC93YWl0LmpzXCJcblxuLyoqXG4gKiBGcm9udGVuZE1vZGVsUmVzb3VyY2VDb25maWcgdHlwZS5cbiAqIEB0eXBlZGVmIHtpbXBvcnQoXCIuLi9mcm9udGVuZC1tb2RlbHMvYmFzZS5qc1wiKS5Gcm9udGVuZE1vZGVsUmVzb3VyY2VDb25maWd9IEZyb250ZW5kTW9kZWxSZXNvdXJjZUNvbmZpZyAqL1xuLyoqXG4gKiBEZWZpbmVzIHRoaXMgdHlwZWRlZi5cbiAqIEB0eXBlZGVmIHt7aWQ6IHN0cmluZywgbW9kZWw6IEZyb250ZW5kTW9kZWxCYXNlfX0gRnJvbnRlbmRNb2RlbEhvb2tUZXN0Q3JlYXRlVXBkYXRlUGF5bG9hZCAqL1xuLyoqXG4gKiBEZWZpbmVzIHRoaXMgdHlwZWRlZi5cbiAqIEB0eXBlZGVmIHt7aWQ6IHN0cmluZ319IEZyb250ZW5kTW9kZWxIb29rVGVzdERlc3Ryb3lQYXlsb2FkICovXG4vKipcbiAqIEZha2VTdWJzY3JpcHRpb25zIHR5cGUuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBGYWtlU3Vic2NyaXB0aW9uc1xuICogQHByb3BlcnR5IHtTZXQ8KHBheWxvYWQ6IEZyb250ZW5kTW9kZWxIb29rVGVzdENyZWF0ZVVwZGF0ZVBheWxvYWQpID0+IHZvaWQ+fSBjcmVhdGUgLSBDcmVhdGUgY2FsbGJhY2tzLlxuICogQHByb3BlcnR5IHtTZXQ8KHBheWxvYWQ6IEZyb250ZW5kTW9kZWxIb29rVGVzdERlc3Ryb3lQYXlsb2FkKSA9PiB2b2lkPn0gZGVzdHJveSAtIERlc3Ryb3kgY2FsbGJhY2tzLlxuICogQHByb3BlcnR5IHt7Y3JlYXRlOiBpbXBvcnQoXCIuLi9mcm9udGVuZC1tb2RlbHMvcXVlcnkuanNcIikuRnJvbnRlbmRNb2RlbEV2ZW50T3B0aW9uc09iamVjdFtdLCBkZXN0cm95OiBpbXBvcnQoXCIuLi9mcm9udGVuZC1tb2RlbHMvcXVlcnkuanNcIikuRnJvbnRlbmRNb2RlbEV2ZW50T3B0aW9uc09iamVjdFtdLCB1cGRhdGU6IGltcG9ydChcIi4uL2Zyb250ZW5kLW1vZGVscy9xdWVyeS5qc1wiKS5Gcm9udGVuZE1vZGVsRXZlbnRPcHRpb25zT2JqZWN0W119fSBvcHRpb25zIC0gU3Vic2NyaXB0aW9uIG9wdGlvbnMuXG4gKiBAcHJvcGVydHkge1NldDwocGF5bG9hZDogRnJvbnRlbmRNb2RlbEhvb2tUZXN0Q3JlYXRlVXBkYXRlUGF5bG9hZCkgPT4gdm9pZD59IHVwZGF0ZSAtIFVwZGF0ZSBjYWxsYmFja3MuXG4gKi9cblxuLyoqXG4gKiBSdW5zIGZsdXNoIGVmZmVjdHMuXG4gKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciBSZWFjdCBlZmZlY3RzIGhhdmUgcnVuLlxuICovXG5hc3luYyBmdW5jdGlvbiBmbHVzaEVmZmVjdHMoKSB7XG4gIGF3YWl0IFByb21pc2UucmVzb2x2ZSgpXG4gIGF3YWl0IG5ldyBQcm9taXNlKChyZXNvbHZlKSA9PiBzZXRUaW1lb3V0KHJlc29sdmUsIDApKVxufVxuXG4vKipcbiAqIFJ1bnMgd2FpdCBmb3IuXG4gKiBAcGFyYW0geygpID0+IGJvb2xlYW59IGNhbGxiYWNrIC0gUHJlZGljYXRlIHRvIHdhaXQgZm9yLlxuICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiB0aGUgcHJlZGljYXRlIHJldHVybnMgdHJ1ZS5cbiAqL1xuYXN5bmMgZnVuY3Rpb24gd2FpdEZvcihjYWxsYmFjaykge1xuICBjb25zdCBzdGFydGVkQXQgPSBEYXRlLm5vdygpXG5cbiAgd2hpbGUgKCFjYWxsYmFjaygpKSB7XG4gICAgaWYgKERhdGUubm93KCkgLSBzdGFydGVkQXQgPiAxMDAwKSByZXR1cm5cblxuICAgIGF3YWl0IHdhaXQoMTApXG4gIH1cbn1cblxuLyoqXG4gKiBSdW5zIGJ1aWxkIGZha2Ugc3Vic2NyaXB0aW9ucy5cbiAqIEByZXR1cm5zIHtGYWtlU3Vic2NyaXB0aW9uc30gLSBFbXB0eSBmYWtlIHN1YnNjcmlwdGlvbiBzdG9yZS5cbiAqL1xuZnVuY3Rpb24gYnVpbGRGYWtlU3Vic2NyaXB0aW9ucygpIHtcbiAgcmV0dXJuIHtcbiAgICBjcmVhdGU6IG5ldyBTZXQoKSxcbiAgICBkZXN0cm95OiBuZXcgU2V0KCksXG4gICAgb3B0aW9uczoge2NyZWF0ZTogW10sIGRlc3Ryb3k6IFtdLCB1cGRhdGU6IFtdfSxcbiAgICB1cGRhdGU6IG5ldyBTZXQoKVxuICB9XG59XG5cbi8qKlxuICogUnVucyBmYWtlIHJlc291cmNlIGNvbmZpZy5cbiAqIEBwYXJhbSB7c3RyaW5nfSBtb2RlbE5hbWUgLSBGYWtlIGZyb250ZW5kIG1vZGVsIG5hbWUuXG4gKiBAcmV0dXJucyB7RnJvbnRlbmRNb2RlbFJlc291cmNlQ29uZmlnfSAtIE1pbmltYWwgcmVzb3VyY2UgY29uZmlnIGZvciBmYWtlIHN1YmNsYXNzZXMuXG4gKi9cbmZ1bmN0aW9uIGZha2VSZXNvdXJjZUNvbmZpZyhtb2RlbE5hbWUpIHtcbiAgcmV0dXJuIHtcbiAgICBhdHRyaWJ1dGVzOiBbXCJpZFwiXSxcbiAgICBtb2RlbE5hbWUsXG4gICAgcHJpbWFyeUtleTogXCJpZFwiXG4gIH1cbn1cblxuLyoqXG4gKiBSdW5zIHJlbmRlciBlbGVtZW50LlxuICogQHBhcmFtIHtSZWFjdC5SZWFjdEVsZW1lbnR9IGVsZW1lbnQgLSBFbGVtZW50IHRvIHJlbmRlci5cbiAqIEByZXR1cm5zIHtQcm9taXNlPHtyZXJlbmRlcjogKG5leHRFbGVtZW50OiBSZWFjdC5SZWFjdEVsZW1lbnQpID0+IFByb21pc2U8dm9pZD4sIHVubW91bnQ6ICgpID0+IFByb21pc2U8dm9pZD59Pn0gLSBSZW5kZXIgY29udHJvbHMuXG4gKi9cbmFzeW5jIGZ1bmN0aW9uIHJlbmRlckVsZW1lbnQoZWxlbWVudCkge1xuICBjb25zdCBjb250YWluZXIgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwiZGl2XCIpXG4gIGRvY3VtZW50LmJvZHkuYXBwZW5kQ2hpbGQoY29udGFpbmVyKVxuICBjb25zdCByb290ID0gY3JlYXRlUm9vdChjb250YWluZXIpXG5cbiAgcm9vdC5yZW5kZXIoZWxlbWVudClcbiAgYXdhaXQgZmx1c2hFZmZlY3RzKClcblxuICByZXR1cm4ge1xuICAgIHJlcmVuZGVyOiBhc3luYyAobmV4dEVsZW1lbnQpID0+IHtcbiAgICAgIHJvb3QucmVuZGVyKG5leHRFbGVtZW50KVxuICAgICAgYXdhaXQgZmx1c2hFZmZlY3RzKClcbiAgICB9LFxuICAgIHVubW91bnQ6IGFzeW5jICgpID0+IHtcbiAgICAgIHJvb3QudW5tb3VudCgpXG4gICAgICBjb250YWluZXIucmVtb3ZlKClcbiAgICAgIGF3YWl0IGZsdXNoRWZmZWN0cygpXG4gICAgfVxuICB9XG59XG5cbi8qKlxuICogUnVucyBidWlsZCBmYWtlIG1vZGVsIGNsYXNzLlxuICogQHJldHVybnMge3tNb2RlbENsYXNzOiBpbXBvcnQoXCIuLi9mcm9udGVuZC1tb2RlbHMvYmFzZS5qc1wiKS5Gcm9udGVuZE1vZGVsQ2xhc3M8RnJvbnRlbmRNb2RlbEJhc2U+LCBzdWJzY3JpcHRpb25zOiBGYWtlU3Vic2NyaXB0aW9uc319IC0gRmFrZSBtb2RlbCBjbGFzcyBzZXR1cC5cbiAqL1xuZnVuY3Rpb24gYnVpbGRGYWtlTW9kZWxDbGFzcygpIHtcbiAgY29uc3Qgc3Vic2NyaXB0aW9ucyA9IGJ1aWxkRmFrZVN1YnNjcmlwdGlvbnMoKVxuXG4gIGNsYXNzIEZha2VNb2RlbENsYXNzIGV4dGVuZHMgRnJvbnRlbmRNb2RlbEJhc2Uge1xuICAgIC8qKlxuICAgICAqIFJ1bnMgcmVzb3VyY2UgY29uZmlnLlxuICAgICAqIEByZXR1cm5zIHtGcm9udGVuZE1vZGVsUmVzb3VyY2VDb25maWd9IC0gRmFrZSByZXNvdXJjZSBjb25maWcuXG4gICAgICovXG4gICAgc3RhdGljIHJlc291cmNlQ29uZmlnKCkge1xuICAgICAgcmV0dXJuIGZha2VSZXNvdXJjZUNvbmZpZyhcIkhvb2tGYWtlQ2xhc3NNb2RlbFwiKVxuICAgIH1cblxuICAgIC8qKlxuICAgICAqIFJ1bnMgb24gY3JlYXRlLlxuICAgICAqIEBwYXJhbSB7KHBheWxvYWQ6IEZyb250ZW5kTW9kZWxIb29rVGVzdENyZWF0ZVVwZGF0ZVBheWxvYWQpID0+IHZvaWR9IGNhbGxiYWNrIC0gRXZlbnQgY2FsbGJhY2suXG4gICAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9mcm9udGVuZC1tb2RlbHMvcXVlcnkuanNcIikuRnJvbnRlbmRNb2RlbEV2ZW50T3B0aW9uc09iamVjdH0gW29wdGlvbnNdIC0gRXZlbnQgcXVlcnkgb3IgcHJvamVjdGlvbiBvcHRpb25zLlxuICAgICAqIEByZXR1cm5zIHtQcm9taXNlPCgpID0+IHZvaWQ+fSAtIFVuc3Vic2NyaWJlIGNhbGxiYWNrLlxuICAgICAqL1xuICAgIHN0YXRpYyBhc3luYyBvbkNyZWF0ZShjYWxsYmFjaywgb3B0aW9ucyA9IHt9KSB7XG4gICAgICBzdWJzY3JpcHRpb25zLmNyZWF0ZS5hZGQoY2FsbGJhY2spXG4gICAgICBzdWJzY3JpcHRpb25zLm9wdGlvbnMuY3JlYXRlLnB1c2gob3B0aW9ucylcblxuICAgICAgcmV0dXJuICgpID0+IHN1YnNjcmlwdGlvbnMuY3JlYXRlLmRlbGV0ZShjYWxsYmFjaylcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBSdW5zIG9uIGRlc3Ryb3kuXG4gICAgICogQHBhcmFtIHsocGF5bG9hZDogRnJvbnRlbmRNb2RlbEhvb2tUZXN0RGVzdHJveVBheWxvYWQpID0+IHZvaWR9IGNhbGxiYWNrIC0gRXZlbnQgY2FsbGJhY2suXG4gICAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9mcm9udGVuZC1tb2RlbHMvcXVlcnkuanNcIikuRnJvbnRlbmRNb2RlbEV2ZW50T3B0aW9uc09iamVjdH0gW29wdGlvbnNdIC0gRXZlbnQgcXVlcnkgb3IgcHJvamVjdGlvbiBvcHRpb25zLlxuICAgICAqIEByZXR1cm5zIHtQcm9taXNlPCgpID0+IHZvaWQ+fSAtIFVuc3Vic2NyaWJlIGNhbGxiYWNrLlxuICAgICAqL1xuICAgIHN0YXRpYyBhc3luYyBvbkRlc3Ryb3koY2FsbGJhY2ssIG9wdGlvbnMgPSB7fSkge1xuICAgICAgc3Vic2NyaXB0aW9ucy5kZXN0cm95LmFkZChjYWxsYmFjaylcbiAgICAgIHN1YnNjcmlwdGlvbnMub3B0aW9ucy5kZXN0cm95LnB1c2gob3B0aW9ucylcblxuICAgICAgcmV0dXJuICgpID0+IHN1YnNjcmlwdGlvbnMuZGVzdHJveS5kZWxldGUoY2FsbGJhY2spXG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogUnVucyBvbiB1cGRhdGUuXG4gICAgICogQHBhcmFtIHsocGF5bG9hZDogRnJvbnRlbmRNb2RlbEhvb2tUZXN0Q3JlYXRlVXBkYXRlUGF5bG9hZCkgPT4gdm9pZH0gY2FsbGJhY2sgLSBFdmVudCBjYWxsYmFjay5cbiAgICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2Zyb250ZW5kLW1vZGVscy9xdWVyeS5qc1wiKS5Gcm9udGVuZE1vZGVsRXZlbnRPcHRpb25zT2JqZWN0fSBbb3B0aW9uc10gLSBFdmVudCBxdWVyeSBvciBwcm9qZWN0aW9uIG9wdGlvbnMuXG4gICAgICogQHJldHVybnMge1Byb21pc2U8KCkgPT4gdm9pZD59IC0gVW5zdWJzY3JpYmUgY2FsbGJhY2suXG4gICAgICovXG4gICAgc3RhdGljIGFzeW5jIG9uVXBkYXRlKGNhbGxiYWNrLCBvcHRpb25zID0ge30pIHtcbiAgICAgIHN1YnNjcmlwdGlvbnMudXBkYXRlLmFkZChjYWxsYmFjaylcbiAgICAgIHN1YnNjcmlwdGlvbnMub3B0aW9ucy51cGRhdGUucHVzaChvcHRpb25zKVxuXG4gICAgICByZXR1cm4gKCkgPT4gc3Vic2NyaXB0aW9ucy51cGRhdGUuZGVsZXRlKGNhbGxiYWNrKVxuICAgIH1cbiAgfVxuXG4gIHJldHVybiB7TW9kZWxDbGFzczogRmFrZU1vZGVsQ2xhc3MsIHN1YnNjcmlwdGlvbnN9XG59XG5cbi8qKlxuICogUnVucyBlbWl0IGV2ZW50LlxuICogQHBhcmFtIHtGYWtlU3Vic2NyaXB0aW9uc30gc3Vic2NyaXB0aW9ucyAtIENhbGxiYWNrIHNldHMuXG4gKiBAcGFyYW0ge1wiY3JlYXRlXCIgfCBcImRlc3Ryb3lcIiB8IFwidXBkYXRlXCJ9IGV2ZW50TmFtZSAtIEV2ZW50IG5hbWUuXG4gKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxIb29rVGVzdENyZWF0ZVVwZGF0ZVBheWxvYWQgfCBGcm9udGVuZE1vZGVsSG9va1Rlc3REZXN0cm95UGF5bG9hZH0gcGF5bG9hZCAtIEV2ZW50IHBheWxvYWQuXG4gKiBAcmV0dXJucyB7dm9pZH1cbiAqL1xuZnVuY3Rpb24gZW1pdEV2ZW50KHN1YnNjcmlwdGlvbnMsIGV2ZW50TmFtZSwgcGF5bG9hZCkge1xuICBpZiAoZXZlbnROYW1lID09PSBcImRlc3Ryb3lcIikge1xuICAgIGZvciAoY29uc3QgY2FsbGJhY2sgb2Ygc3Vic2NyaXB0aW9ucy5kZXN0cm95KSB7XG4gICAgICBjYWxsYmFjayh7aWQ6IHBheWxvYWQuaWR9KVxuICAgIH1cblxuICAgIHJldHVyblxuICB9XG5cbiAgaWYgKCEoXCJtb2RlbFwiIGluIHBheWxvYWQpKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGBFeHBlY3RlZCBtb2RlbCBwYXlsb2FkIGZvciAke2V2ZW50TmFtZX1gKVxuICB9XG5cbiAgZm9yIChjb25zdCBjYWxsYmFjayBvZiBzdWJzY3JpcHRpb25zW2V2ZW50TmFtZV0pIHtcbiAgICBjYWxsYmFjayhwYXlsb2FkKVxuICB9XG59XG5cbi8qKlxuICogUnVucyBidWlsZCBmYWtlIG1vZGVsLlxuICogQHBhcmFtIHtzdHJpbmd9IGlkIC0gTW9kZWwgaWQuXG4gKiBAcGFyYW0ge0Zha2VTdWJzY3JpcHRpb25zfSBzdWJzY3JpcHRpb25zIC0gQ2FsbGJhY2sgc2V0cy5cbiAqIEByZXR1cm5zIHtGcm9udGVuZE1vZGVsQmFzZX0gLSBGYWtlIG1vZGVsIGluc3RhbmNlLlxuICovXG5mdW5jdGlvbiBidWlsZEZha2VNb2RlbChpZCwgc3Vic2NyaXB0aW9ucykge1xuICBjbGFzcyBGYWtlTW9kZWwgZXh0ZW5kcyBGcm9udGVuZE1vZGVsQmFzZSB7XG4gICAgLyoqXG4gICAgICogUnVucyByZXNvdXJjZSBjb25maWcuXG4gICAgICogQHJldHVybnMge0Zyb250ZW5kTW9kZWxSZXNvdXJjZUNvbmZpZ30gLSBGYWtlIHJlc291cmNlIGNvbmZpZy5cbiAgICAgKi9cbiAgICBzdGF0aWMgcmVzb3VyY2VDb25maWcoKSB7XG4gICAgICByZXR1cm4gZmFrZVJlc291cmNlQ29uZmlnKFwiSG9va0Zha2VJbnN0YW5jZU1vZGVsXCIpXG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogUnVucyBvbiBkZXN0cm95LlxuICAgICAqIEBwYXJhbSB7KHBheWxvYWQ6IEZyb250ZW5kTW9kZWxIb29rVGVzdERlc3Ryb3lQYXlsb2FkKSA9PiB2b2lkfSBjYWxsYmFjayAtIEV2ZW50IGNhbGxiYWNrLlxuICAgICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZnJvbnRlbmQtbW9kZWxzL3F1ZXJ5LmpzXCIpLkZyb250ZW5kTW9kZWxFdmVudE9wdGlvbnNPYmplY3R9IFtvcHRpb25zXSAtIEV2ZW50IHF1ZXJ5IG9yIHByb2plY3Rpb24gb3B0aW9ucy5cbiAgICAgKiBAcmV0dXJucyB7UHJvbWlzZTwoKSA9PiB2b2lkPn0gLSBVbnN1YnNjcmliZSBjYWxsYmFjay5cbiAgICAgKi9cbiAgICBhc3luYyBvbkRlc3Ryb3koY2FsbGJhY2ssIG9wdGlvbnMgPSB7fSkge1xuICAgICAgc3Vic2NyaXB0aW9ucy5kZXN0cm95LmFkZChjYWxsYmFjaylcbiAgICAgIHN1YnNjcmlwdGlvbnMub3B0aW9ucy5kZXN0cm95LnB1c2gob3B0aW9ucylcblxuICAgICAgcmV0dXJuICgpID0+IHN1YnNjcmlwdGlvbnMuZGVzdHJveS5kZWxldGUoY2FsbGJhY2spXG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogUnVucyBvbiB1cGRhdGUuXG4gICAgICogQHBhcmFtIHsocGF5bG9hZDogRnJvbnRlbmRNb2RlbEhvb2tUZXN0Q3JlYXRlVXBkYXRlUGF5bG9hZCkgPT4gdm9pZH0gY2FsbGJhY2sgLSBFdmVudCBjYWxsYmFjay5cbiAgICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2Zyb250ZW5kLW1vZGVscy9xdWVyeS5qc1wiKS5Gcm9udGVuZE1vZGVsRXZlbnRPcHRpb25zT2JqZWN0fSBbb3B0aW9uc10gLSBFdmVudCBxdWVyeSBvciBwcm9qZWN0aW9uIG9wdGlvbnMuXG4gICAgICogQHJldHVybnMge1Byb21pc2U8KCkgPT4gdm9pZD59IC0gVW5zdWJzY3JpYmUgY2FsbGJhY2suXG4gICAgICovXG4gICAgYXN5bmMgb25VcGRhdGUoY2FsbGJhY2ssIG9wdGlvbnMgPSB7fSkge1xuICAgICAgc3Vic2NyaXB0aW9ucy51cGRhdGUuYWRkKGNhbGxiYWNrKVxuICAgICAgc3Vic2NyaXB0aW9ucy5vcHRpb25zLnVwZGF0ZS5wdXNoKG9wdGlvbnMpXG5cbiAgICAgIHJldHVybiAoKSA9PiBzdWJzY3JpcHRpb25zLnVwZGF0ZS5kZWxldGUoY2FsbGJhY2spXG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogUnVucyBwcmltYXJ5IGtleSB2YWx1ZS5cbiAgICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFByaW1hcnkga2V5IHZhbHVlLlxuICAgICAqL1xuICAgIHByaW1hcnlLZXlWYWx1ZSgpIHtcbiAgICAgIHJldHVybiBpZFxuICAgIH1cbiAgfVxuXG4gIHJldHVybiBuZXcgRmFrZU1vZGVsKHtpZH0pXG59XG5cbi8qKlxuICogUnVucyBjbGFzcyBsaWZlY3ljbGUgc2NlbmFyaW8uXG4gKiBAcmV0dXJucyB7UHJvbWlzZTxSZWNvcmQ8c3RyaW5nLCBudW1iZXI+Pn0gLSBTY2VuYXJpbyByZXN1bHQuXG4gKi9cbmFzeW5jIGZ1bmN0aW9uIGNsYXNzTGlmZWN5Y2xlU2NlbmFyaW8oKSB7XG4gIGNvbnN0IHtNb2RlbENsYXNzLCBzdWJzY3JpcHRpb25zfSA9IGJ1aWxkRmFrZU1vZGVsQ2xhc3MoKVxuICBjb25zdCBldmVudE1vZGVsID0gYnVpbGRGYWtlTW9kZWwoXCIxXCIsIGJ1aWxkRmFrZVN1YnNjcmlwdGlvbnMoKSlcbiAgLyoqXG4gICAqIFJlY2VpdmVkIGV2ZW50cy5cbiAgICogQHR5cGUge0FycmF5PEZyb250ZW5kTW9kZWxIb29rVGVzdENyZWF0ZVVwZGF0ZVBheWxvYWQgfCBGcm9udGVuZE1vZGVsSG9va1Rlc3REZXN0cm95UGF5bG9hZD59ICovXG4gIGNvbnN0IHJlY2VpdmVkRXZlbnRzID0gW11cbiAgbGV0IGNvbm5lY3RlZENvdW50ID0gMFxuXG4gIC8qKlxuICAgKiBSdW5zIHRlc3QgY29tcG9uZW50LlxuICAgKiBAcmV0dXJucyB7UmVhY3QuUmVhY3RFbGVtZW50fSAtIFRlc3QgZWxlbWVudC5cbiAgICovXG4gIGZ1bmN0aW9uIFRlc3RDb21wb25lbnQoKSB7XG4gICAgdXNlTW9kZWxDbGFzc0V2ZW50KE1vZGVsQ2xhc3MsIFtcImNyZWF0ZVwiLCBcInVwZGF0ZVwiXSwgKHBheWxvYWQpID0+IHJlY2VpdmVkRXZlbnRzLnB1c2gocGF5bG9hZCksIHtcbiAgICAgIG9uQ29ubmVjdGVkOiAoKSA9PiB7IGNvbm5lY3RlZENvdW50ICs9IDEgfVxuICAgIH0pXG4gICAgdXNlQ3JlYXRlZEV2ZW50KE1vZGVsQ2xhc3MsIChwYXlsb2FkKSA9PiByZWNlaXZlZEV2ZW50cy5wdXNoKHBheWxvYWQpKVxuXG4gICAgcmV0dXJuIFJlYWN0LmNyZWF0ZUVsZW1lbnQoXCJkaXZcIilcbiAgfVxuXG4gIGNvbnN0IGNvbnRyb2xzID0gYXdhaXQgcmVuZGVyRWxlbWVudChSZWFjdC5jcmVhdGVFbGVtZW50KFRlc3RDb21wb25lbnQpKVxuICBhd2FpdCB3YWl0Rm9yKCgpID0+IHN1YnNjcmlwdGlvbnMuY3JlYXRlLnNpemUgPT09IDIgJiYgc3Vic2NyaXB0aW9ucy51cGRhdGUuc2l6ZSA9PT0gMSlcblxuICBjb25zdCBtb3VudGVkQ3JlYXRlU3Vic2NyaXB0aW9ucyA9IHN1YnNjcmlwdGlvbnMuY3JlYXRlLnNpemVcbiAgY29uc3QgbW91bnRlZFVwZGF0ZVN1YnNjcmlwdGlvbnMgPSBzdWJzY3JpcHRpb25zLnVwZGF0ZS5zaXplXG4gIGNvbnN0IG1vdW50ZWREZXN0cm95U3Vic2NyaXB0aW9ucyA9IHN1YnNjcmlwdGlvbnMuZGVzdHJveS5zaXplXG4gIGNvbnN0IG1vdW50ZWRDb25uZWN0ZWRDb3VudCA9IGNvbm5lY3RlZENvdW50XG5cbiAgZW1pdEV2ZW50KHN1YnNjcmlwdGlvbnMsIFwiY3JlYXRlXCIsIHtpZDogXCIxXCIsIG1vZGVsOiBldmVudE1vZGVsfSlcbiAgZW1pdEV2ZW50KHN1YnNjcmlwdGlvbnMsIFwidXBkYXRlXCIsIHtpZDogXCIxXCIsIG1vZGVsOiBldmVudE1vZGVsfSlcbiAgZW1pdEV2ZW50KHN1YnNjcmlwdGlvbnMsIFwiZGVzdHJveVwiLCB7aWQ6IFwiMVwifSlcblxuICBjb25zdCByZWNlaXZlZEV2ZW50c0FmdGVyRW1pdCA9IHJlY2VpdmVkRXZlbnRzLmxlbmd0aFxuXG4gIGF3YWl0IGNvbnRyb2xzLnVubW91bnQoKVxuXG4gIHJldHVybiB7XG4gICAgbW91bnRlZENvbm5lY3RlZENvdW50LFxuICAgIG1vdW50ZWRDcmVhdGVTdWJzY3JpcHRpb25zLFxuICAgIG1vdW50ZWREZXN0cm95U3Vic2NyaXB0aW9ucyxcbiAgICBtb3VudGVkVXBkYXRlU3Vic2NyaXB0aW9ucyxcbiAgICByZWNlaXZlZEV2ZW50c0FmdGVyRW1pdCxcbiAgICB1bm1vdW50ZWRDcmVhdGVTdWJzY3JpcHRpb25zOiBzdWJzY3JpcHRpb25zLmNyZWF0ZS5zaXplLFxuICAgIHVubW91bnRlZFVwZGF0ZVN1YnNjcmlwdGlvbnM6IHN1YnNjcmlwdGlvbnMudXBkYXRlLnNpemVcbiAgfVxufVxuXG4vKipcbiAqIFJ1bnMgaW5zdGFuY2UgbGlmZWN5Y2xlIHNjZW5hcmlvLlxuICogQHJldHVybnMge1Byb21pc2U8UmVjb3JkPHN0cmluZywgbnVtYmVyPj59IC0gU2NlbmFyaW8gcmVzdWx0LlxuICovXG5hc3luYyBmdW5jdGlvbiBpbnN0YW5jZUxpZmVjeWNsZVNjZW5hcmlvKCkge1xuICBjb25zdCBzdWJzY3JpcHRpb25zID0gYnVpbGRGYWtlU3Vic2NyaXB0aW9ucygpXG4gIGNvbnN0IG1vZGVsID0gYnVpbGRGYWtlTW9kZWwoXCJ0YXNrLTFcIiwgc3Vic2NyaXB0aW9ucylcbiAgLyoqXG4gICAqIFJlY2VpdmVkIGV2ZW50cy5cbiAgICogQHR5cGUge0FycmF5PEZyb250ZW5kTW9kZWxIb29rVGVzdENyZWF0ZVVwZGF0ZVBheWxvYWQgfCBGcm9udGVuZE1vZGVsSG9va1Rlc3REZXN0cm95UGF5bG9hZD59ICovXG4gIGNvbnN0IHJlY2VpdmVkRXZlbnRzID0gW11cbiAgbGV0IGNvbm5lY3RlZENvdW50ID0gMFxuXG4gIC8qKlxuICAgKiBSdW5zIHRlc3QgY29tcG9uZW50LlxuICAgKiBAcmV0dXJucyB7UmVhY3QuUmVhY3RFbGVtZW50fSAtIFRlc3QgZWxlbWVudC5cbiAgICovXG4gIGZ1bmN0aW9uIFRlc3RDb21wb25lbnQoKSB7XG4gICAgdXNlVXBkYXRlZEV2ZW50KG1vZGVsLCAocGF5bG9hZCkgPT4gcmVjZWl2ZWRFdmVudHMucHVzaChwYXlsb2FkKSwge1xuICAgICAgb25Db25uZWN0ZWQ6ICgpID0+IHsgY29ubmVjdGVkQ291bnQgKz0gMSB9XG4gICAgfSlcbiAgICB1c2VEZXN0cm95ZWRFdmVudChbbW9kZWxdLCAocGF5bG9hZCkgPT4gcmVjZWl2ZWRFdmVudHMucHVzaChwYXlsb2FkKSwge1xuICAgICAgb25Db25uZWN0ZWQ6ICgpID0+IHsgY29ubmVjdGVkQ291bnQgKz0gMSB9XG4gICAgfSlcblxuICAgIHJldHVybiBSZWFjdC5jcmVhdGVFbGVtZW50KFwiZGl2XCIpXG4gIH1cblxuICBjb25zdCBjb250cm9scyA9IGF3YWl0IHJlbmRlckVsZW1lbnQoUmVhY3QuY3JlYXRlRWxlbWVudChUZXN0Q29tcG9uZW50KSlcbiAgYXdhaXQgd2FpdEZvcigoKSA9PiBzdWJzY3JpcHRpb25zLnVwZGF0ZS5zaXplID09PSAxICYmIHN1YnNjcmlwdGlvbnMuZGVzdHJveS5zaXplID09PSAxKVxuXG4gIGNvbnN0IG1vdW50ZWRDb25uZWN0ZWRDb3VudCA9IGNvbm5lY3RlZENvdW50XG4gIGNvbnN0IG1vdW50ZWREZXN0cm95U3Vic2NyaXB0aW9ucyA9IHN1YnNjcmlwdGlvbnMuZGVzdHJveS5zaXplXG4gIGNvbnN0IG1vdW50ZWRVcGRhdGVTdWJzY3JpcHRpb25zID0gc3Vic2NyaXB0aW9ucy51cGRhdGUuc2l6ZVxuXG4gIGVtaXRFdmVudChzdWJzY3JpcHRpb25zLCBcInVwZGF0ZVwiLCB7aWQ6IFwidGFzay0xXCIsIG1vZGVsfSlcbiAgZW1pdEV2ZW50KHN1YnNjcmlwdGlvbnMsIFwiZGVzdHJveVwiLCB7aWQ6IFwidGFzay0xXCJ9KVxuXG4gIGNvbnN0IHJlY2VpdmVkRXZlbnRzQWZ0ZXJFbWl0ID0gcmVjZWl2ZWRFdmVudHMubGVuZ3RoXG5cbiAgYXdhaXQgY29udHJvbHMudW5tb3VudCgpXG5cbiAgcmV0dXJuIHtcbiAgICBtb3VudGVkQ29ubmVjdGVkQ291bnQsXG4gICAgbW91bnRlZERlc3Ryb3lTdWJzY3JpcHRpb25zLFxuICAgIG1vdW50ZWRVcGRhdGVTdWJzY3JpcHRpb25zLFxuICAgIHJlY2VpdmVkRXZlbnRzQWZ0ZXJFbWl0LFxuICAgIHVubW91bnRlZERlc3Ryb3lTdWJzY3JpcHRpb25zOiBzdWJzY3JpcHRpb25zLmRlc3Ryb3kuc2l6ZSxcbiAgICB1bm1vdW50ZWRVcGRhdGVTdWJzY3JpcHRpb25zOiBzdWJzY3JpcHRpb25zLnVwZGF0ZS5zaXplXG4gIH1cbn1cblxuLyoqXG4gKiBSdW5zIHByb2plY3Rpb24gb3B0aW9ucyBzY2VuYXJpby5cbiAqIEByZXR1cm5zIHtQcm9taXNlPFJlY29yZDxzdHJpbmcsIG51bWJlcj4+fSAtIFNjZW5hcmlvIHJlc3VsdC5cbiAqL1xuYXN5bmMgZnVuY3Rpb24gcHJvamVjdGlvbk9wdGlvbnNTY2VuYXJpbygpIHtcbiAgY29uc3Qge01vZGVsQ2xhc3MsIHN1YnNjcmlwdGlvbnM6IGNsYXNzU3Vic2NyaXB0aW9uc30gPSBidWlsZEZha2VNb2RlbENsYXNzKClcbiAgY29uc3QgaW5zdGFuY2VTdWJzY3JpcHRpb25zID0gYnVpbGRGYWtlU3Vic2NyaXB0aW9ucygpXG4gIGNvbnN0IG1vZGVsID0gYnVpbGRGYWtlTW9kZWwoXCJ0YXNrLTFcIiwgaW5zdGFuY2VTdWJzY3JpcHRpb25zKVxuICBjb25zdCBjbGFzc1F1ZXJ5ID0gTW9kZWxDbGFzc1xuICAgIC53aGVyZSh7aWQ6IFwidGFzay0xXCJ9KVxuICAgIC5zZWxlY3QoW1wiaWRcIl0pXG4gIGNvbnN0IHJlcXVlc3RDb250ZXh0ID0ge3dvcmtzcGFjZUlkOiBcIndvcmtzcGFjZS1hbHBoYVwifVxuXG4gIC8qKlxuICAgKiBSdW5zIHRlc3QgY29tcG9uZW50LlxuICAgKiBAcmV0dXJucyB7UmVhY3QuUmVhY3RFbGVtZW50fSAtIFRlc3QgZWxlbWVudC5cbiAgICovXG4gIGZ1bmN0aW9uIFRlc3RDb21wb25lbnQoKSB7XG4gICAgdXNlQ3JlYXRlZEV2ZW50KE1vZGVsQ2xhc3MsICgpID0+IHt9LCB7XG4gICAgICBwcmVsb2FkOiBcInByb2plY3RcIixcbiAgICAgIHF1ZXJ5OiBjbGFzc1F1ZXJ5LFxuICAgICAgcmVxdWVzdENvbnRleHQsXG4gICAgICBzZWxlY3Q6IHtUYXNrOiBbXCJpZFwiLCBcIm5hbWVVcHBlcmNhc2VcIl19XG4gICAgfSlcbiAgICB1c2VVcGRhdGVkRXZlbnQobW9kZWwsICgpID0+IHt9LCB7XG4gICAgICByZXF1ZXN0Q29udGV4dCxcbiAgICAgIHNlbGVjdDogW1wiaWRcIl0sXG4gICAgICB3aXRoQ291bnQ6IFwiY29tbWVudHNcIlxuICAgIH0pXG4gICAgdXNlRGVzdHJveWVkRXZlbnQobW9kZWwsICgpID0+IHt9LCB7XG4gICAgICBwcmVsb2FkOiBcInByb2plY3RcIixcbiAgICAgIHJlcXVlc3RDb250ZXh0LFxuICAgICAgc2VsZWN0OiBbXCJpZFwiXVxuICAgIH0pXG5cbiAgICByZXR1cm4gUmVhY3QuY3JlYXRlRWxlbWVudChcImRpdlwiKVxuICB9XG5cbiAgY29uc3QgY29udHJvbHMgPSBhd2FpdCByZW5kZXJFbGVtZW50KFJlYWN0LmNyZWF0ZUVsZW1lbnQoVGVzdENvbXBvbmVudCkpXG4gIGF3YWl0IHdhaXRGb3IoKCkgPT4gY2xhc3NTdWJzY3JpcHRpb25zLmNyZWF0ZS5zaXplID09PSAxICYmIGluc3RhbmNlU3Vic2NyaXB0aW9ucy51cGRhdGUuc2l6ZSA9PT0gMSAmJiBpbnN0YW5jZVN1YnNjcmlwdGlvbnMuZGVzdHJveS5zaXplID09PSAxKVxuXG4gIGNvbnN0IGNyZWF0ZU9wdGlvbnMgPSBjbGFzc1N1YnNjcmlwdGlvbnMub3B0aW9ucy5jcmVhdGVbMF0gfHwge31cbiAgY29uc3QgdXBkYXRlT3B0aW9ucyA9IGluc3RhbmNlU3Vic2NyaXB0aW9ucy5vcHRpb25zLnVwZGF0ZVswXSB8fCB7fVxuICBjb25zdCBkZXN0cm95T3B0aW9ucyA9IGluc3RhbmNlU3Vic2NyaXB0aW9ucy5vcHRpb25zLmRlc3Ryb3lbMF0gfHwge31cblxuICBhd2FpdCBjb250cm9scy51bm1vdW50KClcblxuICByZXR1cm4ge1xuICAgIGNsYXNzQ3JlYXRlUHJlbG9hZFByb2plY3Q6IGNyZWF0ZU9wdGlvbnMucHJlbG9hZCA9PT0gXCJwcm9qZWN0XCIgPyAxIDogMCxcbiAgICBjbGFzc0NyZWF0ZVF1ZXJ5UGFzc2VkOiBjcmVhdGVPcHRpb25zLnF1ZXJ5ID09PSBjbGFzc1F1ZXJ5ID8gMSA6IDAsXG4gICAgY2xhc3NDcmVhdGVSZXF1ZXN0Q29udGV4dFBhc3NlZDogY3JlYXRlT3B0aW9ucy5yZXF1ZXN0Q29udGV4dCA9PT0gcmVxdWVzdENvbnRleHQgPyAxIDogMCxcbiAgICBjbGFzc0NyZWF0ZVNlbGVjdENvdW50OiBjcmVhdGVPcHRpb25zLnNlbGVjdCAmJiB0eXBlb2YgY3JlYXRlT3B0aW9ucy5zZWxlY3QgPT09IFwib2JqZWN0XCIgJiYgIUFycmF5LmlzQXJyYXkoY3JlYXRlT3B0aW9ucy5zZWxlY3QpICYmIEFycmF5LmlzQXJyYXkoY3JlYXRlT3B0aW9ucy5zZWxlY3QuVGFzaykgPyBjcmVhdGVPcHRpb25zLnNlbGVjdC5UYXNrLmxlbmd0aCA6IDAsXG4gICAgaW5zdGFuY2VEZXN0cm95UHJlbG9hZFByb2plY3Q6IGRlc3Ryb3lPcHRpb25zLnByZWxvYWQgPT09IFwicHJvamVjdFwiID8gMSA6IDAsXG4gICAgaW5zdGFuY2VEZXN0cm95UmVxdWVzdENvbnRleHRQYXNzZWQ6IGRlc3Ryb3lPcHRpb25zLnJlcXVlc3RDb250ZXh0ID09PSByZXF1ZXN0Q29udGV4dCA/IDEgOiAwLFxuICAgIGluc3RhbmNlRGVzdHJveVNlbGVjdENvdW50OiBBcnJheS5pc0FycmF5KGRlc3Ryb3lPcHRpb25zLnNlbGVjdCkgPyBkZXN0cm95T3B0aW9ucy5zZWxlY3QubGVuZ3RoIDogMCxcbiAgICBpbnN0YW5jZVVwZGF0ZVJlcXVlc3RDb250ZXh0UGFzc2VkOiB1cGRhdGVPcHRpb25zLnJlcXVlc3RDb250ZXh0ID09PSByZXF1ZXN0Q29udGV4dCA/IDEgOiAwLFxuICAgIGluc3RhbmNlVXBkYXRlU2VsZWN0Q291bnQ6IEFycmF5LmlzQXJyYXkodXBkYXRlT3B0aW9ucy5zZWxlY3QpID8gdXBkYXRlT3B0aW9ucy5zZWxlY3QubGVuZ3RoIDogMCxcbiAgICBpbnN0YW5jZVVwZGF0ZVdpdGhDb3VudENvbW1lbnRzOiB1cGRhdGVPcHRpb25zLndpdGhDb3VudCA9PT0gXCJjb21tZW50c1wiID8gMSA6IDBcbiAgfVxufVxuXG4vKipcbiAqIFJ1bnMgZGVib3VuY2UgdW5tb3VudCBzY2VuYXJpby5cbiAqIEByZXR1cm5zIHtQcm9taXNlPFJlY29yZDxzdHJpbmcsIG51bWJlcj4+fSAtIFNjZW5hcmlvIHJlc3VsdC5cbiAqL1xuYXN5bmMgZnVuY3Rpb24gZGVib3VuY2VVbm1vdW50U2NlbmFyaW8oKSB7XG4gIGNvbnN0IHtNb2RlbENsYXNzLCBzdWJzY3JpcHRpb25zOiBjbGFzc1N1YnNjcmlwdGlvbnN9ID0gYnVpbGRGYWtlTW9kZWxDbGFzcygpXG4gIGNvbnN0IGluc3RhbmNlU3Vic2NyaXB0aW9ucyA9IGJ1aWxkRmFrZVN1YnNjcmlwdGlvbnMoKVxuICBjb25zdCBtb2RlbCA9IGJ1aWxkRmFrZU1vZGVsKFwidGFzay0xXCIsIGluc3RhbmNlU3Vic2NyaXB0aW9ucylcbiAgLyoqXG4gICAqIFJlY2VpdmVkIGV2ZW50cy5cbiAgICogQHR5cGUge0FycmF5PEZyb250ZW5kTW9kZWxIb29rVGVzdENyZWF0ZVVwZGF0ZVBheWxvYWQgfCBGcm9udGVuZE1vZGVsSG9va1Rlc3REZXN0cm95UGF5bG9hZD59ICovXG4gIGNvbnN0IHJlY2VpdmVkRXZlbnRzID0gW11cblxuICAvKipcbiAgICogUnVucyB0ZXN0IGNvbXBvbmVudC5cbiAgICogQHJldHVybnMge1JlYWN0LlJlYWN0RWxlbWVudH0gLSBUZXN0IGVsZW1lbnQuXG4gICAqL1xuICBmdW5jdGlvbiBUZXN0Q29tcG9uZW50KCkge1xuICAgIHVzZU1vZGVsQ2xhc3NFdmVudChNb2RlbENsYXNzLCBcInVwZGF0ZVwiLCAocGF5bG9hZCkgPT4gcmVjZWl2ZWRFdmVudHMucHVzaChwYXlsb2FkKSwge2RlYm91bmNlOiAyMH0pXG4gICAgdXNlVXBkYXRlZEV2ZW50KG1vZGVsLCAocGF5bG9hZCkgPT4gcmVjZWl2ZWRFdmVudHMucHVzaChwYXlsb2FkKSwge2RlYm91bmNlOiAyMH0pXG4gICAgdXNlRGVzdHJveWVkRXZlbnQobW9kZWwsIChwYXlsb2FkKSA9PiByZWNlaXZlZEV2ZW50cy5wdXNoKHBheWxvYWQpLCB7ZGVib3VuY2U6IDIwfSlcblxuICAgIHJldHVybiBSZWFjdC5jcmVhdGVFbGVtZW50KFwiZGl2XCIpXG4gIH1cblxuICBjb25zdCBjb250cm9scyA9IGF3YWl0IHJlbmRlckVsZW1lbnQoUmVhY3QuY3JlYXRlRWxlbWVudChUZXN0Q29tcG9uZW50KSlcbiAgYXdhaXQgd2FpdEZvcigoKSA9PiBjbGFzc1N1YnNjcmlwdGlvbnMudXBkYXRlLnNpemUgPT09IDEgJiYgaW5zdGFuY2VTdWJzY3JpcHRpb25zLnVwZGF0ZS5zaXplID09PSAxICYmIGluc3RhbmNlU3Vic2NyaXB0aW9ucy5kZXN0cm95LnNpemUgPT09IDEpXG5cbiAgZW1pdEV2ZW50KGNsYXNzU3Vic2NyaXB0aW9ucywgXCJ1cGRhdGVcIiwge2lkOiBcInRhc2stMVwiLCBtb2RlbH0pXG4gIGVtaXRFdmVudChpbnN0YW5jZVN1YnNjcmlwdGlvbnMsIFwidXBkYXRlXCIsIHtpZDogXCJ0YXNrLTFcIiwgbW9kZWx9KVxuICBlbWl0RXZlbnQoaW5zdGFuY2VTdWJzY3JpcHRpb25zLCBcImRlc3Ryb3lcIiwge2lkOiBcInRhc2stMVwifSlcblxuICBhd2FpdCBjb250cm9scy51bm1vdW50KClcbiAgYXdhaXQgd2FpdCgzMClcblxuICByZXR1cm4ge3JlY2VpdmVkRXZlbnRzQWZ0ZXJEZWJvdW5jZVdpbmRvdzogcmVjZWl2ZWRFdmVudHMubGVuZ3RofVxufVxuXG4vKipcbiAqIFJ1bnMgcmVzdWJzY3JpYmUgaW5zdGFuY2Ugc2NlbmFyaW8uXG4gKiBAcmV0dXJucyB7UHJvbWlzZTxSZWNvcmQ8c3RyaW5nLCBudW1iZXI+Pn0gLSBTY2VuYXJpbyByZXN1bHQuXG4gKi9cbmFzeW5jIGZ1bmN0aW9uIHJlc3Vic2NyaWJlSW5zdGFuY2VTY2VuYXJpbygpIHtcbiAgY29uc3QgZmlyc3RTdWJzY3JpcHRpb25zID0gYnVpbGRGYWtlU3Vic2NyaXB0aW9ucygpXG4gIGNvbnN0IHNlY29uZFN1YnNjcmlwdGlvbnMgPSBidWlsZEZha2VTdWJzY3JpcHRpb25zKClcbiAgY29uc3QgZmlyc3RNb2RlbCA9IGJ1aWxkRmFrZU1vZGVsKFwidGFzay0xXCIsIGZpcnN0U3Vic2NyaXB0aW9ucylcbiAgY29uc3Qgc2Vjb25kTW9kZWwgPSBidWlsZEZha2VNb2RlbChcInRhc2stMVwiLCBzZWNvbmRTdWJzY3JpcHRpb25zKVxuICAvKipcbiAgICogUmVjZWl2ZWQgZXZlbnRzLlxuICAgKiBAdHlwZSB7QXJyYXk8RnJvbnRlbmRNb2RlbEhvb2tUZXN0Q3JlYXRlVXBkYXRlUGF5bG9hZCB8IEZyb250ZW5kTW9kZWxIb29rVGVzdERlc3Ryb3lQYXlsb2FkPn0gKi9cbiAgY29uc3QgcmVjZWl2ZWRFdmVudHMgPSBbXVxuXG4gIC8qKlxuICAgKiBSdW5zIHRlc3QgY29tcG9uZW50LlxuICAgKiBAcGFyYW0ge3ttb2RlbDogaW1wb3J0KFwiLi4vZnJvbnRlbmQtbW9kZWxzL2Jhc2UuanNcIikuZGVmYXVsdH19IHByb3BzIC0gQ29tcG9uZW50IHByb3BzLlxuICAgKiBAcmV0dXJucyB7UmVhY3QuUmVhY3RFbGVtZW50fSAtIFRlc3QgZWxlbWVudC5cbiAgICovXG4gIGZ1bmN0aW9uIFRlc3RDb21wb25lbnQoe21vZGVsfSkge1xuICAgIHVzZVVwZGF0ZWRFdmVudChtb2RlbCwgKHBheWxvYWQpID0+IHJlY2VpdmVkRXZlbnRzLnB1c2gocGF5bG9hZCkpXG4gICAgdXNlRGVzdHJveWVkRXZlbnQobW9kZWwsIChwYXlsb2FkKSA9PiByZWNlaXZlZEV2ZW50cy5wdXNoKHBheWxvYWQpKVxuXG4gICAgcmV0dXJuIFJlYWN0LmNyZWF0ZUVsZW1lbnQoXCJkaXZcIilcbiAgfVxuXG4gIGNvbnN0IGNvbnRyb2xzID0gYXdhaXQgcmVuZGVyRWxlbWVudChSZWFjdC5jcmVhdGVFbGVtZW50KFRlc3RDb21wb25lbnQsIHttb2RlbDogZmlyc3RNb2RlbH0pKVxuICBhd2FpdCB3YWl0Rm9yKCgpID0+IGZpcnN0U3Vic2NyaXB0aW9ucy51cGRhdGUuc2l6ZSA9PT0gMSAmJiBmaXJzdFN1YnNjcmlwdGlvbnMuZGVzdHJveS5zaXplID09PSAxKVxuXG4gIGNvbnN0IGZpcnN0TW91bnRlZERlc3Ryb3lTdWJzY3JpcHRpb25zID0gZmlyc3RTdWJzY3JpcHRpb25zLmRlc3Ryb3kuc2l6ZVxuICBjb25zdCBmaXJzdE1vdW50ZWRVcGRhdGVTdWJzY3JpcHRpb25zID0gZmlyc3RTdWJzY3JpcHRpb25zLnVwZGF0ZS5zaXplXG5cbiAgYXdhaXQgY29udHJvbHMucmVyZW5kZXIoUmVhY3QuY3JlYXRlRWxlbWVudChUZXN0Q29tcG9uZW50LCB7bW9kZWw6IHNlY29uZE1vZGVsfSkpXG4gIGF3YWl0IHdhaXRGb3IoKCkgPT4gZmlyc3RTdWJzY3JpcHRpb25zLnVwZGF0ZS5zaXplID09PSAwICYmIGZpcnN0U3Vic2NyaXB0aW9ucy5kZXN0cm95LnNpemUgPT09IDAgJiYgc2Vjb25kU3Vic2NyaXB0aW9ucy51cGRhdGUuc2l6ZSA9PT0gMSAmJiBzZWNvbmRTdWJzY3JpcHRpb25zLmRlc3Ryb3kuc2l6ZSA9PT0gMSlcblxuICBjb25zdCBmaXJzdEFmdGVyUmVyZW5kZXJEZXN0cm95U3Vic2NyaXB0aW9ucyA9IGZpcnN0U3Vic2NyaXB0aW9ucy5kZXN0cm95LnNpemVcbiAgY29uc3QgZmlyc3RBZnRlclJlcmVuZGVyVXBkYXRlU3Vic2NyaXB0aW9ucyA9IGZpcnN0U3Vic2NyaXB0aW9ucy51cGRhdGUuc2l6ZVxuICBjb25zdCBzZWNvbmRBZnRlclJlcmVuZGVyRGVzdHJveVN1YnNjcmlwdGlvbnMgPSBzZWNvbmRTdWJzY3JpcHRpb25zLmRlc3Ryb3kuc2l6ZVxuICBjb25zdCBzZWNvbmRBZnRlclJlcmVuZGVyVXBkYXRlU3Vic2NyaXB0aW9ucyA9IHNlY29uZFN1YnNjcmlwdGlvbnMudXBkYXRlLnNpemVcblxuICBlbWl0RXZlbnQoZmlyc3RTdWJzY3JpcHRpb25zLCBcInVwZGF0ZVwiLCB7aWQ6IFwidGFzay0xXCIsIG1vZGVsOiBmaXJzdE1vZGVsfSlcbiAgZW1pdEV2ZW50KHNlY29uZFN1YnNjcmlwdGlvbnMsIFwidXBkYXRlXCIsIHtpZDogXCJ0YXNrLTFcIiwgbW9kZWw6IHNlY29uZE1vZGVsfSlcbiAgZW1pdEV2ZW50KHNlY29uZFN1YnNjcmlwdGlvbnMsIFwiZGVzdHJveVwiLCB7aWQ6IFwidGFzay0xXCJ9KVxuXG4gIGNvbnN0IHJlY2VpdmVkRXZlbnRzQWZ0ZXJFbWl0ID0gcmVjZWl2ZWRFdmVudHMubGVuZ3RoXG5cbiAgYXdhaXQgY29udHJvbHMudW5tb3VudCgpXG5cbiAgcmV0dXJuIHtcbiAgICBmaXJzdEFmdGVyUmVyZW5kZXJEZXN0cm95U3Vic2NyaXB0aW9ucyxcbiAgICBmaXJzdEFmdGVyUmVyZW5kZXJVcGRhdGVTdWJzY3JpcHRpb25zLFxuICAgIGZpcnN0TW91bnRlZERlc3Ryb3lTdWJzY3JpcHRpb25zLFxuICAgIGZpcnN0TW91bnRlZFVwZGF0ZVN1YnNjcmlwdGlvbnMsXG4gICAgcmVjZWl2ZWRFdmVudHNBZnRlckVtaXQsXG4gICAgc2Vjb25kQWZ0ZXJSZXJlbmRlckRlc3Ryb3lTdWJzY3JpcHRpb25zLFxuICAgIHNlY29uZEFmdGVyUmVyZW5kZXJVcGRhdGVTdWJzY3JpcHRpb25zXG4gIH1cbn1cblxuY29uc3Qgc2NlbmFyaW9zID0ge1xuICBjbGFzc0xpZmVjeWNsZTogY2xhc3NMaWZlY3ljbGVTY2VuYXJpbyxcbiAgZGVib3VuY2VVbm1vdW50OiBkZWJvdW5jZVVubW91bnRTY2VuYXJpbyxcbiAgaW5zdGFuY2VMaWZlY3ljbGU6IGluc3RhbmNlTGlmZWN5Y2xlU2NlbmFyaW8sXG4gIHByb2plY3Rpb25PcHRpb25zOiBwcm9qZWN0aW9uT3B0aW9uc1NjZW5hcmlvLFxuICByZXN1YnNjcmliZUluc3RhbmNlOiByZXN1YnNjcmliZUluc3RhbmNlU2NlbmFyaW9cbn1cblxuLyoqXG4gKiBSdW5zIHJ1biBmcm9udGVuZCBtb2RlbCBldmVudCBob29rIHNjZW5hcmlvLlxuICogQHBhcmFtIHtrZXlvZiB0eXBlb2Ygc2NlbmFyaW9zfSBzY2VuYXJpb05hbWUgLSBTY2VuYXJpbyBuYW1lLlxuICogQHJldHVybnMge1Byb21pc2U8UmVjb3JkPHN0cmluZywgbnVtYmVyPj59IC0gU2NlbmFyaW8gcmVzdWx0LlxuICovXG5leHBvcnQgZGVmYXVsdCBhc3luYyBmdW5jdGlvbiBydW5Gcm9udGVuZE1vZGVsRXZlbnRIb29rU2NlbmFyaW8oc2NlbmFyaW9OYW1lKSB7XG4gIGNvbnN0IHNjZW5hcmlvID0gc2NlbmFyaW9zW3NjZW5hcmlvTmFtZV1cblxuICBpZiAoIXNjZW5hcmlvKSB0aHJvdyBuZXcgRXJyb3IoYFVua25vd24gZnJvbnRlbmQgbW9kZWwgZXZlbnQgaG9vayBzY2VuYXJpbzogJHtzY2VuYXJpb05hbWV9YClcblxuICByZXR1cm4gYXdhaXQgc2NlbmFyaW8oKVxufVxuIl19