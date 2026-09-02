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
    /**
     * Runs test component.
     * @returns {React.ReactElement} - Test element.
     */
    function TestComponent() {
        useCreatedEvent(ModelClass, () => { }, {
            preload: "project",
            query: classQuery,
            select: { Task: ["id", "nameUppercase"] }
        });
        useUpdatedEvent(model, () => { }, {
            select: ["id"],
            withCount: "comments"
        });
        useDestroyedEvent(model, () => { }, {
            preload: "project",
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
        classCreateSelectCount: createOptions.select && typeof createOptions.select === "object" && !Array.isArray(createOptions.select) && Array.isArray(createOptions.select.Task) ? createOptions.select.Task.length : 0,
        instanceDestroyPreloadProject: destroyOptions.preload === "project" ? 1 : 0,
        instanceDestroySelectCount: Array.isArray(destroyOptions.select) ? destroyOptions.select.length : 0,
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYnJvd3Nlci1mcm9udGVuZC1tb2RlbC1ldmVudC1ob29rLXNjZW5hcmlvcy5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy90ZXN0aW5nL2Jyb3dzZXItZnJvbnRlbmQtbW9kZWwtZXZlbnQtaG9vay1zY2VuYXJpb3MuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLE9BQU8sS0FBSyxNQUFNLE9BQU8sQ0FBQTtBQUN6QixPQUFPLEVBQUMsVUFBVSxFQUFDLE1BQU0sa0JBQWtCLENBQUE7QUFFM0MsT0FBTyxpQkFBaUIsTUFBTSwyQ0FBMkMsQ0FBQTtBQUN6RSxPQUFPLGVBQWUsTUFBTSx5Q0FBeUMsQ0FBQTtBQUNyRSxPQUFPLGlCQUFpQixNQUFNLDRCQUE0QixDQUFBO0FBQzFELE9BQU8sa0JBQWtCLE1BQU0sNkNBQTZDLENBQUE7QUFDNUUsT0FBTyxlQUFlLE1BQU0seUNBQXlDLENBQUE7QUFDckUsT0FBTyxJQUFJLE1BQU0sd0JBQXdCLENBQUE7QUFFekM7OzZHQUU2RztBQUM3Rzs7Z0dBRWdHO0FBQ2hHOztpRUFFaUU7QUFDakU7Ozs7Ozs7R0FPRztBQUVIOzs7R0FHRztBQUNILEtBQUssVUFBVSxZQUFZO0lBQ3pCLE1BQU0sT0FBTyxDQUFDLE9BQU8sRUFBRSxDQUFBO0lBQ3ZCLE1BQU0sSUFBSSxPQUFPLENBQUMsQ0FBQyxPQUFPLEVBQUUsRUFBRSxDQUFDLFVBQVUsQ0FBQyxPQUFPLEVBQUUsQ0FBQyxDQUFDLENBQUMsQ0FBQTtBQUN4RCxDQUFDO0FBRUQ7Ozs7R0FJRztBQUNILEtBQUssVUFBVSxPQUFPLENBQUMsUUFBUTtJQUM3QixNQUFNLFNBQVMsR0FBRyxJQUFJLENBQUMsR0FBRyxFQUFFLENBQUE7SUFFNUIsT0FBTyxDQUFDLFFBQVEsRUFBRSxFQUFFLENBQUM7UUFDbkIsSUFBSSxJQUFJLENBQUMsR0FBRyxFQUFFLEdBQUcsU0FBUyxHQUFHLElBQUk7WUFBRSxPQUFNO1FBRXpDLE1B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VSxpQ0FBaUMsQ0FBQyxZQUFZO0lBQzFFLE1BQU0sUUFBUSxHQUFHLFNBQVMsQ0FBQyxZQUFZLENBQUMsQ0FBQTtJQUV4QyxJQUFJLENBQUMsUUFBUTtRQUFFLE1BQU0sSUFBSSxLQUFLLENBQUMsK0NBQStDLFlBQVksRUFBRSxDQUFDLENBQUE7SUFFN0YsT0FBTyxNQUFNLFFBQVEsRUFBRSxDQUFBO0FBQ3pCLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuaW1wb3J0IFJlYWN0IGZyb20gXCJyZWFjdFwiXG5pbXBvcnQge2NyZWF0ZVJvb3R9IGZyb20gXCJyZWFjdC1kb20vY2xpZW50XCJcblxuaW1wb3J0IHVzZURlc3Ryb3llZEV2ZW50IGZyb20gXCIuLi9mcm9udGVuZC1tb2RlbHMvdXNlLWRlc3Ryb3llZC1ldmVudC5qc1wiXG5pbXBvcnQgdXNlQ3JlYXRlZEV2ZW50IGZyb20gXCIuLi9mcm9udGVuZC1tb2RlbHMvdXNlLWNyZWF0ZWQtZXZlbnQuanNcIlxuaW1wb3J0IEZyb250ZW5kTW9kZWxCYXNlIGZyb20gXCIuLi9mcm9udGVuZC1tb2RlbHMvYmFzZS5qc1wiXG5pbXBvcnQgdXNlTW9kZWxDbGFzc0V2ZW50IGZyb20gXCIuLi9mcm9udGVuZC1tb2RlbHMvdXNlLW1vZGVsLWNsYXNzLWV2ZW50LmpzXCJcbmltcG9ydCB1c2VVcGRhdGVkRXZlbnQgZnJvbSBcIi4uL2Zyb250ZW5kLW1vZGVscy91c2UtdXBkYXRlZC1ldmVudC5qc1wiXG5pbXBvcnQgd2FpdCBmcm9tIFwiYXdhaXRlcnkvYnVpbGQvd2FpdC5qc1wiXG5cbi8qKlxuICogRnJvbnRlbmRNb2RlbFJlc291cmNlQ29uZmlnIHR5cGUuXG4gKiBAdHlwZWRlZiB7aW1wb3J0KFwiLi4vZnJvbnRlbmQtbW9kZWxzL2Jhc2UuanNcIikuRnJvbnRlbmRNb2RlbFJlc291cmNlQ29uZmlnfSBGcm9udGVuZE1vZGVsUmVzb3VyY2VDb25maWcgKi9cbi8qKlxuICogRGVmaW5lcyB0aGlzIHR5cGVkZWYuXG4gKiBAdHlwZWRlZiB7e2lkOiBzdHJpbmcsIG1vZGVsOiBGcm9udGVuZE1vZGVsQmFzZX19IEZyb250ZW5kTW9kZWxIb29rVGVzdENyZWF0ZVVwZGF0ZVBheWxvYWQgKi9cbi8qKlxuICogRGVmaW5lcyB0aGlzIHR5cGVkZWYuXG4gKiBAdHlwZWRlZiB7e2lkOiBzdHJpbmd9fSBGcm9udGVuZE1vZGVsSG9va1Rlc3REZXN0cm95UGF5bG9hZCAqL1xuLyoqXG4gKiBGYWtlU3Vic2NyaXB0aW9ucyB0eXBlLlxuICogQHR5cGVkZWYge29iamVjdH0gRmFrZVN1YnNjcmlwdGlvbnNcbiAqIEBwcm9wZXJ0eSB7U2V0PChwYXlsb2FkOiBGcm9udGVuZE1vZGVsSG9va1Rlc3RDcmVhdGVVcGRhdGVQYXlsb2FkKSA9PiB2b2lkPn0gY3JlYXRlIC0gQ3JlYXRlIGNhbGxiYWNrcy5cbiAqIEBwcm9wZXJ0eSB7U2V0PChwYXlsb2FkOiBGcm9udGVuZE1vZGVsSG9va1Rlc3REZXN0cm95UGF5bG9hZCkgPT4gdm9pZD59IGRlc3Ryb3kgLSBEZXN0cm95IGNhbGxiYWNrcy5cbiAqIEBwcm9wZXJ0eSB7e2NyZWF0ZTogaW1wb3J0KFwiLi4vZnJvbnRlbmQtbW9kZWxzL3F1ZXJ5LmpzXCIpLkZyb250ZW5kTW9kZWxFdmVudE9wdGlvbnNPYmplY3RbXSwgZGVzdHJveTogaW1wb3J0KFwiLi4vZnJvbnRlbmQtbW9kZWxzL3F1ZXJ5LmpzXCIpLkZyb250ZW5kTW9kZWxFdmVudE9wdGlvbnNPYmplY3RbXSwgdXBkYXRlOiBpbXBvcnQoXCIuLi9mcm9udGVuZC1tb2RlbHMvcXVlcnkuanNcIikuRnJvbnRlbmRNb2RlbEV2ZW50T3B0aW9uc09iamVjdFtdfX0gb3B0aW9ucyAtIFN1YnNjcmlwdGlvbiBvcHRpb25zLlxuICogQHByb3BlcnR5IHtTZXQ8KHBheWxvYWQ6IEZyb250ZW5kTW9kZWxIb29rVGVzdENyZWF0ZVVwZGF0ZVBheWxvYWQpID0+IHZvaWQ+fSB1cGRhdGUgLSBVcGRhdGUgY2FsbGJhY2tzLlxuICovXG5cbi8qKlxuICogUnVucyBmbHVzaCBlZmZlY3RzLlxuICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgUmVhY3QgZWZmZWN0cyBoYXZlIHJ1bi5cbiAqL1xuYXN5bmMgZnVuY3Rpb24gZmx1c2hFZmZlY3RzKCkge1xuICBhd2FpdCBQcm9taXNlLnJlc29sdmUoKVxuICBhd2FpdCBuZXcgUHJvbWlzZSgocmVzb2x2ZSkgPT4gc2V0VGltZW91dChyZXNvbHZlLCAwKSlcbn1cblxuLyoqXG4gKiBSdW5zIHdhaXQgZm9yLlxuICogQHBhcmFtIHsoKSA9PiBib29sZWFufSBjYWxsYmFjayAtIFByZWRpY2F0ZSB0byB3YWl0IGZvci5cbiAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gdGhlIHByZWRpY2F0ZSByZXR1cm5zIHRydWUuXG4gKi9cbmFzeW5jIGZ1bmN0aW9uIHdhaXRGb3IoY2FsbGJhY2spIHtcbiAgY29uc3Qgc3RhcnRlZEF0ID0gRGF0ZS5ub3coKVxuXG4gIHdoaWxlICghY2FsbGJhY2soKSkge1xuICAgIGlmIChEYXRlLm5vdygpIC0gc3RhcnRlZEF0ID4gMTAwMCkgcmV0dXJuXG5cbiAgICBhd2FpdCB3YWl0KDEwKVxuICB9XG59XG5cbi8qKlxuICogUnVucyBidWlsZCBmYWtlIHN1YnNjcmlwdGlvbnMuXG4gKiBAcmV0dXJucyB7RmFrZVN1YnNjcmlwdGlvbnN9IC0gRW1wdHkgZmFrZSBzdWJzY3JpcHRpb24gc3RvcmUuXG4gKi9cbmZ1bmN0aW9uIGJ1aWxkRmFrZVN1YnNjcmlwdGlvbnMoKSB7XG4gIHJldHVybiB7XG4gICAgY3JlYXRlOiBuZXcgU2V0KCksXG4gICAgZGVzdHJveTogbmV3IFNldCgpLFxuICAgIG9wdGlvbnM6IHtjcmVhdGU6IFtdLCBkZXN0cm95OiBbXSwgdXBkYXRlOiBbXX0sXG4gICAgdXBkYXRlOiBuZXcgU2V0KClcbiAgfVxufVxuXG4vKipcbiAqIFJ1bnMgZmFrZSByZXNvdXJjZSBjb25maWcuXG4gKiBAcGFyYW0ge3N0cmluZ30gbW9kZWxOYW1lIC0gRmFrZSBmcm9udGVuZCBtb2RlbCBuYW1lLlxuICogQHJldHVybnMge0Zyb250ZW5kTW9kZWxSZXNvdXJjZUNvbmZpZ30gLSBNaW5pbWFsIHJlc291cmNlIGNvbmZpZyBmb3IgZmFrZSBzdWJjbGFzc2VzLlxuICovXG5mdW5jdGlvbiBmYWtlUmVzb3VyY2VDb25maWcobW9kZWxOYW1lKSB7XG4gIHJldHVybiB7XG4gICAgYXR0cmlidXRlczogW1wiaWRcIl0sXG4gICAgbW9kZWxOYW1lLFxuICAgIHByaW1hcnlLZXk6IFwiaWRcIlxuICB9XG59XG5cbi8qKlxuICogUnVucyByZW5kZXIgZWxlbWVudC5cbiAqIEBwYXJhbSB7UmVhY3QuUmVhY3RFbGVtZW50fSBlbGVtZW50IC0gRWxlbWVudCB0byByZW5kZXIuXG4gKiBAcmV0dXJucyB7UHJvbWlzZTx7cmVyZW5kZXI6IChuZXh0RWxlbWVudDogUmVhY3QuUmVhY3RFbGVtZW50KSA9PiBQcm9taXNlPHZvaWQ+LCB1bm1vdW50OiAoKSA9PiBQcm9taXNlPHZvaWQ+fT59IC0gUmVuZGVyIGNvbnRyb2xzLlxuICovXG5hc3luYyBmdW5jdGlvbiByZW5kZXJFbGVtZW50KGVsZW1lbnQpIHtcbiAgY29uc3QgY29udGFpbmVyID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcImRpdlwiKVxuICBkb2N1bWVudC5ib2R5LmFwcGVuZENoaWxkKGNvbnRhaW5lcilcbiAgY29uc3Qgcm9vdCA9IGNyZWF0ZVJvb3QoY29udGFpbmVyKVxuXG4gIHJvb3QucmVuZGVyKGVsZW1lbnQpXG4gIGF3YWl0IGZsdXNoRWZmZWN0cygpXG5cbiAgcmV0dXJuIHtcbiAgICByZXJlbmRlcjogYXN5bmMgKG5leHRFbGVtZW50KSA9PiB7XG4gICAgICByb290LnJlbmRlcihuZXh0RWxlbWVudClcbiAgICAgIGF3YWl0IGZsdXNoRWZmZWN0cygpXG4gICAgfSxcbiAgICB1bm1vdW50OiBhc3luYyAoKSA9PiB7XG4gICAgICByb290LnVubW91bnQoKVxuICAgICAgY29udGFpbmVyLnJlbW92ZSgpXG4gICAgICBhd2FpdCBmbHVzaEVmZmVjdHMoKVxuICAgIH1cbiAgfVxufVxuXG4vKipcbiAqIFJ1bnMgYnVpbGQgZmFrZSBtb2RlbCBjbGFzcy5cbiAqIEByZXR1cm5zIHt7TW9kZWxDbGFzczogaW1wb3J0KFwiLi4vZnJvbnRlbmQtbW9kZWxzL2Jhc2UuanNcIikuRnJvbnRlbmRNb2RlbENsYXNzPEZyb250ZW5kTW9kZWxCYXNlPiwgc3Vic2NyaXB0aW9uczogRmFrZVN1YnNjcmlwdGlvbnN9fSAtIEZha2UgbW9kZWwgY2xhc3Mgc2V0dXAuXG4gKi9cbmZ1bmN0aW9uIGJ1aWxkRmFrZU1vZGVsQ2xhc3MoKSB7XG4gIGNvbnN0IHN1YnNjcmlwdGlvbnMgPSBidWlsZEZha2VTdWJzY3JpcHRpb25zKClcblxuICBjbGFzcyBGYWtlTW9kZWxDbGFzcyBleHRlbmRzIEZyb250ZW5kTW9kZWxCYXNlIHtcbiAgICAvKipcbiAgICAgKiBSdW5zIHJlc291cmNlIGNvbmZpZy5cbiAgICAgKiBAcmV0dXJucyB7RnJvbnRlbmRNb2RlbFJlc291cmNlQ29uZmlnfSAtIEZha2UgcmVzb3VyY2UgY29uZmlnLlxuICAgICAqL1xuICAgIHN0YXRpYyByZXNvdXJjZUNvbmZpZygpIHtcbiAgICAgIHJldHVybiBmYWtlUmVzb3VyY2VDb25maWcoXCJIb29rRmFrZUNsYXNzTW9kZWxcIilcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBSdW5zIG9uIGNyZWF0ZS5cbiAgICAgKiBAcGFyYW0geyhwYXlsb2FkOiBGcm9udGVuZE1vZGVsSG9va1Rlc3RDcmVhdGVVcGRhdGVQYXlsb2FkKSA9PiB2b2lkfSBjYWxsYmFjayAtIEV2ZW50IGNhbGxiYWNrLlxuICAgICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZnJvbnRlbmQtbW9kZWxzL3F1ZXJ5LmpzXCIpLkZyb250ZW5kTW9kZWxFdmVudE9wdGlvbnNPYmplY3R9IFtvcHRpb25zXSAtIEV2ZW50IHF1ZXJ5IG9yIHByb2plY3Rpb24gb3B0aW9ucy5cbiAgICAgKiBAcmV0dXJucyB7UHJvbWlzZTwoKSA9PiB2b2lkPn0gLSBVbnN1YnNjcmliZSBjYWxsYmFjay5cbiAgICAgKi9cbiAgICBzdGF0aWMgYXN5bmMgb25DcmVhdGUoY2FsbGJhY2ssIG9wdGlvbnMgPSB7fSkge1xuICAgICAgc3Vic2NyaXB0aW9ucy5jcmVhdGUuYWRkKGNhbGxiYWNrKVxuICAgICAgc3Vic2NyaXB0aW9ucy5vcHRpb25zLmNyZWF0ZS5wdXNoKG9wdGlvbnMpXG5cbiAgICAgIHJldHVybiAoKSA9PiBzdWJzY3JpcHRpb25zLmNyZWF0ZS5kZWxldGUoY2FsbGJhY2spXG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogUnVucyBvbiBkZXN0cm95LlxuICAgICAqIEBwYXJhbSB7KHBheWxvYWQ6IEZyb250ZW5kTW9kZWxIb29rVGVzdERlc3Ryb3lQYXlsb2FkKSA9PiB2b2lkfSBjYWxsYmFjayAtIEV2ZW50IGNhbGxiYWNrLlxuICAgICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZnJvbnRlbmQtbW9kZWxzL3F1ZXJ5LmpzXCIpLkZyb250ZW5kTW9kZWxFdmVudE9wdGlvbnNPYmplY3R9IFtvcHRpb25zXSAtIEV2ZW50IHF1ZXJ5IG9yIHByb2plY3Rpb24gb3B0aW9ucy5cbiAgICAgKiBAcmV0dXJucyB7UHJvbWlzZTwoKSA9PiB2b2lkPn0gLSBVbnN1YnNjcmliZSBjYWxsYmFjay5cbiAgICAgKi9cbiAgICBzdGF0aWMgYXN5bmMgb25EZXN0cm95KGNhbGxiYWNrLCBvcHRpb25zID0ge30pIHtcbiAgICAgIHN1YnNjcmlwdGlvbnMuZGVzdHJveS5hZGQoY2FsbGJhY2spXG4gICAgICBzdWJzY3JpcHRpb25zLm9wdGlvbnMuZGVzdHJveS5wdXNoKG9wdGlvbnMpXG5cbiAgICAgIHJldHVybiAoKSA9PiBzdWJzY3JpcHRpb25zLmRlc3Ryb3kuZGVsZXRlKGNhbGxiYWNrKVxuICAgIH1cblxuICAgIC8qKlxuICAgICAqIFJ1bnMgb24gdXBkYXRlLlxuICAgICAqIEBwYXJhbSB7KHBheWxvYWQ6IEZyb250ZW5kTW9kZWxIb29rVGVzdENyZWF0ZVVwZGF0ZVBheWxvYWQpID0+IHZvaWR9IGNhbGxiYWNrIC0gRXZlbnQgY2FsbGJhY2suXG4gICAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9mcm9udGVuZC1tb2RlbHMvcXVlcnkuanNcIikuRnJvbnRlbmRNb2RlbEV2ZW50T3B0aW9uc09iamVjdH0gW29wdGlvbnNdIC0gRXZlbnQgcXVlcnkgb3IgcHJvamVjdGlvbiBvcHRpb25zLlxuICAgICAqIEByZXR1cm5zIHtQcm9taXNlPCgpID0+IHZvaWQ+fSAtIFVuc3Vic2NyaWJlIGNhbGxiYWNrLlxuICAgICAqL1xuICAgIHN0YXRpYyBhc3luYyBvblVwZGF0ZShjYWxsYmFjaywgb3B0aW9ucyA9IHt9KSB7XG4gICAgICBzdWJzY3JpcHRpb25zLnVwZGF0ZS5hZGQoY2FsbGJhY2spXG4gICAgICBzdWJzY3JpcHRpb25zLm9wdGlvbnMudXBkYXRlLnB1c2gob3B0aW9ucylcblxuICAgICAgcmV0dXJuICgpID0+IHN1YnNjcmlwdGlvbnMudXBkYXRlLmRlbGV0ZShjYWxsYmFjaylcbiAgICB9XG4gIH1cblxuICByZXR1cm4ge01vZGVsQ2xhc3M6IEZha2VNb2RlbENsYXNzLCBzdWJzY3JpcHRpb25zfVxufVxuXG4vKipcbiAqIFJ1bnMgZW1pdCBldmVudC5cbiAqIEBwYXJhbSB7RmFrZVN1YnNjcmlwdGlvbnN9IHN1YnNjcmlwdGlvbnMgLSBDYWxsYmFjayBzZXRzLlxuICogQHBhcmFtIHtcImNyZWF0ZVwiIHwgXCJkZXN0cm95XCIgfCBcInVwZGF0ZVwifSBldmVudE5hbWUgLSBFdmVudCBuYW1lLlxuICogQHBhcmFtIHtGcm9udGVuZE1vZGVsSG9va1Rlc3RDcmVhdGVVcGRhdGVQYXlsb2FkIHwgRnJvbnRlbmRNb2RlbEhvb2tUZXN0RGVzdHJveVBheWxvYWR9IHBheWxvYWQgLSBFdmVudCBwYXlsb2FkLlxuICogQHJldHVybnMge3ZvaWR9XG4gKi9cbmZ1bmN0aW9uIGVtaXRFdmVudChzdWJzY3JpcHRpb25zLCBldmVudE5hbWUsIHBheWxvYWQpIHtcbiAgaWYgKGV2ZW50TmFtZSA9PT0gXCJkZXN0cm95XCIpIHtcbiAgICBmb3IgKGNvbnN0IGNhbGxiYWNrIG9mIHN1YnNjcmlwdGlvbnMuZGVzdHJveSkge1xuICAgICAgY2FsbGJhY2soe2lkOiBwYXlsb2FkLmlkfSlcbiAgICB9XG5cbiAgICByZXR1cm5cbiAgfVxuXG4gIGlmICghKFwibW9kZWxcIiBpbiBwYXlsb2FkKSkge1xuICAgIHRocm93IG5ldyBFcnJvcihgRXhwZWN0ZWQgbW9kZWwgcGF5bG9hZCBmb3IgJHtldmVudE5hbWV9YClcbiAgfVxuXG4gIGZvciAoY29uc3QgY2FsbGJhY2sgb2Ygc3Vic2NyaXB0aW9uc1tldmVudE5hbWVdKSB7XG4gICAgY2FsbGJhY2socGF5bG9hZClcbiAgfVxufVxuXG4vKipcbiAqIFJ1bnMgYnVpbGQgZmFrZSBtb2RlbC5cbiAqIEBwYXJhbSB7c3RyaW5nfSBpZCAtIE1vZGVsIGlkLlxuICogQHBhcmFtIHtGYWtlU3Vic2NyaXB0aW9uc30gc3Vic2NyaXB0aW9ucyAtIENhbGxiYWNrIHNldHMuXG4gKiBAcmV0dXJucyB7RnJvbnRlbmRNb2RlbEJhc2V9IC0gRmFrZSBtb2RlbCBpbnN0YW5jZS5cbiAqL1xuZnVuY3Rpb24gYnVpbGRGYWtlTW9kZWwoaWQsIHN1YnNjcmlwdGlvbnMpIHtcbiAgY2xhc3MgRmFrZU1vZGVsIGV4dGVuZHMgRnJvbnRlbmRNb2RlbEJhc2Uge1xuICAgIC8qKlxuICAgICAqIFJ1bnMgcmVzb3VyY2UgY29uZmlnLlxuICAgICAqIEByZXR1cm5zIHtGcm9udGVuZE1vZGVsUmVzb3VyY2VDb25maWd9IC0gRmFrZSByZXNvdXJjZSBjb25maWcuXG4gICAgICovXG4gICAgc3RhdGljIHJlc291cmNlQ29uZmlnKCkge1xuICAgICAgcmV0dXJuIGZha2VSZXNvdXJjZUNvbmZpZyhcIkhvb2tGYWtlSW5zdGFuY2VNb2RlbFwiKVxuICAgIH1cblxuICAgIC8qKlxuICAgICAqIFJ1bnMgb24gZGVzdHJveS5cbiAgICAgKiBAcGFyYW0geyhwYXlsb2FkOiBGcm9udGVuZE1vZGVsSG9va1Rlc3REZXN0cm95UGF5bG9hZCkgPT4gdm9pZH0gY2FsbGJhY2sgLSBFdmVudCBjYWxsYmFjay5cbiAgICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2Zyb250ZW5kLW1vZGVscy9xdWVyeS5qc1wiKS5Gcm9udGVuZE1vZGVsRXZlbnRPcHRpb25zT2JqZWN0fSBbb3B0aW9uc10gLSBFdmVudCBxdWVyeSBvciBwcm9qZWN0aW9uIG9wdGlvbnMuXG4gICAgICogQHJldHVybnMge1Byb21pc2U8KCkgPT4gdm9pZD59IC0gVW5zdWJzY3JpYmUgY2FsbGJhY2suXG4gICAgICovXG4gICAgYXN5bmMgb25EZXN0cm95KGNhbGxiYWNrLCBvcHRpb25zID0ge30pIHtcbiAgICAgIHN1YnNjcmlwdGlvbnMuZGVzdHJveS5hZGQoY2FsbGJhY2spXG4gICAgICBzdWJzY3JpcHRpb25zLm9wdGlvbnMuZGVzdHJveS5wdXNoKG9wdGlvbnMpXG5cbiAgICAgIHJldHVybiAoKSA9PiBzdWJzY3JpcHRpb25zLmRlc3Ryb3kuZGVsZXRlKGNhbGxiYWNrKVxuICAgIH1cblxuICAgIC8qKlxuICAgICAqIFJ1bnMgb24gdXBkYXRlLlxuICAgICAqIEBwYXJhbSB7KHBheWxvYWQ6IEZyb250ZW5kTW9kZWxIb29rVGVzdENyZWF0ZVVwZGF0ZVBheWxvYWQpID0+IHZvaWR9IGNhbGxiYWNrIC0gRXZlbnQgY2FsbGJhY2suXG4gICAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9mcm9udGVuZC1tb2RlbHMvcXVlcnkuanNcIikuRnJvbnRlbmRNb2RlbEV2ZW50T3B0aW9uc09iamVjdH0gW29wdGlvbnNdIC0gRXZlbnQgcXVlcnkgb3IgcHJvamVjdGlvbiBvcHRpb25zLlxuICAgICAqIEByZXR1cm5zIHtQcm9taXNlPCgpID0+IHZvaWQ+fSAtIFVuc3Vic2NyaWJlIGNhbGxiYWNrLlxuICAgICAqL1xuICAgIGFzeW5jIG9uVXBkYXRlKGNhbGxiYWNrLCBvcHRpb25zID0ge30pIHtcbiAgICAgIHN1YnNjcmlwdGlvbnMudXBkYXRlLmFkZChjYWxsYmFjaylcbiAgICAgIHN1YnNjcmlwdGlvbnMub3B0aW9ucy51cGRhdGUucHVzaChvcHRpb25zKVxuXG4gICAgICByZXR1cm4gKCkgPT4gc3Vic2NyaXB0aW9ucy51cGRhdGUuZGVsZXRlKGNhbGxiYWNrKVxuICAgIH1cblxuICAgIC8qKlxuICAgICAqIFJ1bnMgcHJpbWFyeSBrZXkgdmFsdWUuXG4gICAgICogQHJldHVybnMge3N0cmluZ30gLSBQcmltYXJ5IGtleSB2YWx1ZS5cbiAgICAgKi9cbiAgICBwcmltYXJ5S2V5VmFsdWUoKSB7XG4gICAgICByZXR1cm4gaWRcbiAgICB9XG4gIH1cblxuICByZXR1cm4gbmV3IEZha2VNb2RlbCh7aWR9KVxufVxuXG4vKipcbiAqIFJ1bnMgY2xhc3MgbGlmZWN5Y2xlIHNjZW5hcmlvLlxuICogQHJldHVybnMge1Byb21pc2U8UmVjb3JkPHN0cmluZywgbnVtYmVyPj59IC0gU2NlbmFyaW8gcmVzdWx0LlxuICovXG5hc3luYyBmdW5jdGlvbiBjbGFzc0xpZmVjeWNsZVNjZW5hcmlvKCkge1xuICBjb25zdCB7TW9kZWxDbGFzcywgc3Vic2NyaXB0aW9uc30gPSBidWlsZEZha2VNb2RlbENsYXNzKClcbiAgY29uc3QgZXZlbnRNb2RlbCA9IGJ1aWxkRmFrZU1vZGVsKFwiMVwiLCBidWlsZEZha2VTdWJzY3JpcHRpb25zKCkpXG4gIC8qKlxuICAgKiBSZWNlaXZlZCBldmVudHMuXG4gICAqIEB0eXBlIHtBcnJheTxGcm9udGVuZE1vZGVsSG9va1Rlc3RDcmVhdGVVcGRhdGVQYXlsb2FkIHwgRnJvbnRlbmRNb2RlbEhvb2tUZXN0RGVzdHJveVBheWxvYWQ+fSAqL1xuICBjb25zdCByZWNlaXZlZEV2ZW50cyA9IFtdXG4gIGxldCBjb25uZWN0ZWRDb3VudCA9IDBcblxuICAvKipcbiAgICogUnVucyB0ZXN0IGNvbXBvbmVudC5cbiAgICogQHJldHVybnMge1JlYWN0LlJlYWN0RWxlbWVudH0gLSBUZXN0IGVsZW1lbnQuXG4gICAqL1xuICBmdW5jdGlvbiBUZXN0Q29tcG9uZW50KCkge1xuICAgIHVzZU1vZGVsQ2xhc3NFdmVudChNb2RlbENsYXNzLCBbXCJjcmVhdGVcIiwgXCJ1cGRhdGVcIl0sIChwYXlsb2FkKSA9PiByZWNlaXZlZEV2ZW50cy5wdXNoKHBheWxvYWQpLCB7XG4gICAgICBvbkNvbm5lY3RlZDogKCkgPT4geyBjb25uZWN0ZWRDb3VudCArPSAxIH1cbiAgICB9KVxuICAgIHVzZUNyZWF0ZWRFdmVudChNb2RlbENsYXNzLCAocGF5bG9hZCkgPT4gcmVjZWl2ZWRFdmVudHMucHVzaChwYXlsb2FkKSlcblxuICAgIHJldHVybiBSZWFjdC5jcmVhdGVFbGVtZW50KFwiZGl2XCIpXG4gIH1cblxuICBjb25zdCBjb250cm9scyA9IGF3YWl0IHJlbmRlckVsZW1lbnQoUmVhY3QuY3JlYXRlRWxlbWVudChUZXN0Q29tcG9uZW50KSlcbiAgYXdhaXQgd2FpdEZvcigoKSA9PiBzdWJzY3JpcHRpb25zLmNyZWF0ZS5zaXplID09PSAyICYmIHN1YnNjcmlwdGlvbnMudXBkYXRlLnNpemUgPT09IDEpXG5cbiAgY29uc3QgbW91bnRlZENyZWF0ZVN1YnNjcmlwdGlvbnMgPSBzdWJzY3JpcHRpb25zLmNyZWF0ZS5zaXplXG4gIGNvbnN0IG1vdW50ZWRVcGRhdGVTdWJzY3JpcHRpb25zID0gc3Vic2NyaXB0aW9ucy51cGRhdGUuc2l6ZVxuICBjb25zdCBtb3VudGVkRGVzdHJveVN1YnNjcmlwdGlvbnMgPSBzdWJzY3JpcHRpb25zLmRlc3Ryb3kuc2l6ZVxuICBjb25zdCBtb3VudGVkQ29ubmVjdGVkQ291bnQgPSBjb25uZWN0ZWRDb3VudFxuXG4gIGVtaXRFdmVudChzdWJzY3JpcHRpb25zLCBcImNyZWF0ZVwiLCB7aWQ6IFwiMVwiLCBtb2RlbDogZXZlbnRNb2RlbH0pXG4gIGVtaXRFdmVudChzdWJzY3JpcHRpb25zLCBcInVwZGF0ZVwiLCB7aWQ6IFwiMVwiLCBtb2RlbDogZXZlbnRNb2RlbH0pXG4gIGVtaXRFdmVudChzdWJzY3JpcHRpb25zLCBcImRlc3Ryb3lcIiwge2lkOiBcIjFcIn0pXG5cbiAgY29uc3QgcmVjZWl2ZWRFdmVudHNBZnRlckVtaXQgPSByZWNlaXZlZEV2ZW50cy5sZW5ndGhcblxuICBhd2FpdCBjb250cm9scy51bm1vdW50KClcblxuICByZXR1cm4ge1xuICAgIG1vdW50ZWRDb25uZWN0ZWRDb3VudCxcbiAgICBtb3VudGVkQ3JlYXRlU3Vic2NyaXB0aW9ucyxcbiAgICBtb3VudGVkRGVzdHJveVN1YnNjcmlwdGlvbnMsXG4gICAgbW91bnRlZFVwZGF0ZVN1YnNjcmlwdGlvbnMsXG4gICAgcmVjZWl2ZWRFdmVudHNBZnRlckVtaXQsXG4gICAgdW5tb3VudGVkQ3JlYXRlU3Vic2NyaXB0aW9uczogc3Vic2NyaXB0aW9ucy5jcmVhdGUuc2l6ZSxcbiAgICB1bm1vdW50ZWRVcGRhdGVTdWJzY3JpcHRpb25zOiBzdWJzY3JpcHRpb25zLnVwZGF0ZS5zaXplXG4gIH1cbn1cblxuLyoqXG4gKiBSdW5zIGluc3RhbmNlIGxpZmVjeWNsZSBzY2VuYXJpby5cbiAqIEByZXR1cm5zIHtQcm9taXNlPFJlY29yZDxzdHJpbmcsIG51bWJlcj4+fSAtIFNjZW5hcmlvIHJlc3VsdC5cbiAqL1xuYXN5bmMgZnVuY3Rpb24gaW5zdGFuY2VMaWZlY3ljbGVTY2VuYXJpbygpIHtcbiAgY29uc3Qgc3Vic2NyaXB0aW9ucyA9IGJ1aWxkRmFrZVN1YnNjcmlwdGlvbnMoKVxuICBjb25zdCBtb2RlbCA9IGJ1aWxkRmFrZU1vZGVsKFwidGFzay0xXCIsIHN1YnNjcmlwdGlvbnMpXG4gIC8qKlxuICAgKiBSZWNlaXZlZCBldmVudHMuXG4gICAqIEB0eXBlIHtBcnJheTxGcm9udGVuZE1vZGVsSG9va1Rlc3RDcmVhdGVVcGRhdGVQYXlsb2FkIHwgRnJvbnRlbmRNb2RlbEhvb2tUZXN0RGVzdHJveVBheWxvYWQ+fSAqL1xuICBjb25zdCByZWNlaXZlZEV2ZW50cyA9IFtdXG4gIGxldCBjb25uZWN0ZWRDb3VudCA9IDBcblxuICAvKipcbiAgICogUnVucyB0ZXN0IGNvbXBvbmVudC5cbiAgICogQHJldHVybnMge1JlYWN0LlJlYWN0RWxlbWVudH0gLSBUZXN0IGVsZW1lbnQuXG4gICAqL1xuICBmdW5jdGlvbiBUZXN0Q29tcG9uZW50KCkge1xuICAgIHVzZVVwZGF0ZWRFdmVudChtb2RlbCwgKHBheWxvYWQpID0+IHJlY2VpdmVkRXZlbnRzLnB1c2gocGF5bG9hZCksIHtcbiAgICAgIG9uQ29ubmVjdGVkOiAoKSA9PiB7IGNvbm5lY3RlZENvdW50ICs9IDEgfVxuICAgIH0pXG4gICAgdXNlRGVzdHJveWVkRXZlbnQoW21vZGVsXSwgKHBheWxvYWQpID0+IHJlY2VpdmVkRXZlbnRzLnB1c2gocGF5bG9hZCksIHtcbiAgICAgIG9uQ29ubmVjdGVkOiAoKSA9PiB7IGNvbm5lY3RlZENvdW50ICs9IDEgfVxuICAgIH0pXG5cbiAgICByZXR1cm4gUmVhY3QuY3JlYXRlRWxlbWVudChcImRpdlwiKVxuICB9XG5cbiAgY29uc3QgY29udHJvbHMgPSBhd2FpdCByZW5kZXJFbGVtZW50KFJlYWN0LmNyZWF0ZUVsZW1lbnQoVGVzdENvbXBvbmVudCkpXG4gIGF3YWl0IHdhaXRGb3IoKCkgPT4gc3Vic2NyaXB0aW9ucy51cGRhdGUuc2l6ZSA9PT0gMSAmJiBzdWJzY3JpcHRpb25zLmRlc3Ryb3kuc2l6ZSA9PT0gMSlcblxuICBjb25zdCBtb3VudGVkQ29ubmVjdGVkQ291bnQgPSBjb25uZWN0ZWRDb3VudFxuICBjb25zdCBtb3VudGVkRGVzdHJveVN1YnNjcmlwdGlvbnMgPSBzdWJzY3JpcHRpb25zLmRlc3Ryb3kuc2l6ZVxuICBjb25zdCBtb3VudGVkVXBkYXRlU3Vic2NyaXB0aW9ucyA9IHN1YnNjcmlwdGlvbnMudXBkYXRlLnNpemVcblxuICBlbWl0RXZlbnQoc3Vic2NyaXB0aW9ucywgXCJ1cGRhdGVcIiwge2lkOiBcInRhc2stMVwiLCBtb2RlbH0pXG4gIGVtaXRFdmVudChzdWJzY3JpcHRpb25zLCBcImRlc3Ryb3lcIiwge2lkOiBcInRhc2stMVwifSlcblxuICBjb25zdCByZWNlaXZlZEV2ZW50c0FmdGVyRW1pdCA9IHJlY2VpdmVkRXZlbnRzLmxlbmd0aFxuXG4gIGF3YWl0IGNvbnRyb2xzLnVubW91bnQoKVxuXG4gIHJldHVybiB7XG4gICAgbW91bnRlZENvbm5lY3RlZENvdW50LFxuICAgIG1vdW50ZWREZXN0cm95U3Vic2NyaXB0aW9ucyxcbiAgICBtb3VudGVkVXBkYXRlU3Vic2NyaXB0aW9ucyxcbiAgICByZWNlaXZlZEV2ZW50c0FmdGVyRW1pdCxcbiAgICB1bm1vdW50ZWREZXN0cm95U3Vic2NyaXB0aW9uczogc3Vic2NyaXB0aW9ucy5kZXN0cm95LnNpemUsXG4gICAgdW5tb3VudGVkVXBkYXRlU3Vic2NyaXB0aW9uczogc3Vic2NyaXB0aW9ucy51cGRhdGUuc2l6ZVxuICB9XG59XG5cbi8qKlxuICogUnVucyBwcm9qZWN0aW9uIG9wdGlvbnMgc2NlbmFyaW8uXG4gKiBAcmV0dXJucyB7UHJvbWlzZTxSZWNvcmQ8c3RyaW5nLCBudW1iZXI+Pn0gLSBTY2VuYXJpbyByZXN1bHQuXG4gKi9cbmFzeW5jIGZ1bmN0aW9uIHByb2plY3Rpb25PcHRpb25zU2NlbmFyaW8oKSB7XG4gIGNvbnN0IHtNb2RlbENsYXNzLCBzdWJzY3JpcHRpb25zOiBjbGFzc1N1YnNjcmlwdGlvbnN9ID0gYnVpbGRGYWtlTW9kZWxDbGFzcygpXG4gIGNvbnN0IGluc3RhbmNlU3Vic2NyaXB0aW9ucyA9IGJ1aWxkRmFrZVN1YnNjcmlwdGlvbnMoKVxuICBjb25zdCBtb2RlbCA9IGJ1aWxkRmFrZU1vZGVsKFwidGFzay0xXCIsIGluc3RhbmNlU3Vic2NyaXB0aW9ucylcbiAgY29uc3QgY2xhc3NRdWVyeSA9IE1vZGVsQ2xhc3NcbiAgICAud2hlcmUoe2lkOiBcInRhc2stMVwifSlcbiAgICAuc2VsZWN0KFtcImlkXCJdKVxuXG4gIC8qKlxuICAgKiBSdW5zIHRlc3QgY29tcG9uZW50LlxuICAgKiBAcmV0dXJucyB7UmVhY3QuUmVhY3RFbGVtZW50fSAtIFRlc3QgZWxlbWVudC5cbiAgICovXG4gIGZ1bmN0aW9uIFRlc3RDb21wb25lbnQoKSB7XG4gICAgdXNlQ3JlYXRlZEV2ZW50KE1vZGVsQ2xhc3MsICgpID0+IHt9LCB7XG4gICAgICBwcmVsb2FkOiBcInByb2plY3RcIixcbiAgICAgIHF1ZXJ5OiBjbGFzc1F1ZXJ5LFxuICAgICAgc2VsZWN0OiB7VGFzazogW1wiaWRcIiwgXCJuYW1lVXBwZXJjYXNlXCJdfVxuICAgIH0pXG4gICAgdXNlVXBkYXRlZEV2ZW50KG1vZGVsLCAoKSA9PiB7fSwge1xuICAgICAgc2VsZWN0OiBbXCJpZFwiXSxcbiAgICAgIHdpdGhDb3VudDogXCJjb21tZW50c1wiXG4gICAgfSlcbiAgICB1c2VEZXN0cm95ZWRFdmVudChtb2RlbCwgKCkgPT4ge30sIHtcbiAgICAgIHByZWxvYWQ6IFwicHJvamVjdFwiLFxuICAgICAgc2VsZWN0OiBbXCJpZFwiXVxuICAgIH0pXG5cbiAgICByZXR1cm4gUmVhY3QuY3JlYXRlRWxlbWVudChcImRpdlwiKVxuICB9XG5cbiAgY29uc3QgY29udHJvbHMgPSBhd2FpdCByZW5kZXJFbGVtZW50KFJlYWN0LmNyZWF0ZUVsZW1lbnQoVGVzdENvbXBvbmVudCkpXG4gIGF3YWl0IHdhaXRGb3IoKCkgPT4gY2xhc3NTdWJzY3JpcHRpb25zLmNyZWF0ZS5zaXplID09PSAxICYmIGluc3RhbmNlU3Vic2NyaXB0aW9ucy51cGRhdGUuc2l6ZSA9PT0gMSAmJiBpbnN0YW5jZVN1YnNjcmlwdGlvbnMuZGVzdHJveS5zaXplID09PSAxKVxuXG4gIGNvbnN0IGNyZWF0ZU9wdGlvbnMgPSBjbGFzc1N1YnNjcmlwdGlvbnMub3B0aW9ucy5jcmVhdGVbMF0gfHwge31cbiAgY29uc3QgdXBkYXRlT3B0aW9ucyA9IGluc3RhbmNlU3Vic2NyaXB0aW9ucy5vcHRpb25zLnVwZGF0ZVswXSB8fCB7fVxuICBjb25zdCBkZXN0cm95T3B0aW9ucyA9IGluc3RhbmNlU3Vic2NyaXB0aW9ucy5vcHRpb25zLmRlc3Ryb3lbMF0gfHwge31cblxuICBhd2FpdCBjb250cm9scy51bm1vdW50KClcblxuICByZXR1cm4ge1xuICAgIGNsYXNzQ3JlYXRlUHJlbG9hZFByb2plY3Q6IGNyZWF0ZU9wdGlvbnMucHJlbG9hZCA9PT0gXCJwcm9qZWN0XCIgPyAxIDogMCxcbiAgICBjbGFzc0NyZWF0ZVF1ZXJ5UGFzc2VkOiBjcmVhdGVPcHRpb25zLnF1ZXJ5ID09PSBjbGFzc1F1ZXJ5ID8gMSA6IDAsXG4gICAgY2xhc3NDcmVhdGVTZWxlY3RDb3VudDogY3JlYXRlT3B0aW9ucy5zZWxlY3QgJiYgdHlwZW9mIGNyZWF0ZU9wdGlvbnMuc2VsZWN0ID09PSBcIm9iamVjdFwiICYmICFBcnJheS5pc0FycmF5KGNyZWF0ZU9wdGlvbnMuc2VsZWN0KSAmJiBBcnJheS5pc0FycmF5KGNyZWF0ZU9wdGlvbnMuc2VsZWN0LlRhc2spID8gY3JlYXRlT3B0aW9ucy5zZWxlY3QuVGFzay5sZW5ndGggOiAwLFxuICAgIGluc3RhbmNlRGVzdHJveVByZWxvYWRQcm9qZWN0OiBkZXN0cm95T3B0aW9ucy5wcmVsb2FkID09PSBcInByb2plY3RcIiA/IDEgOiAwLFxuICAgIGluc3RhbmNlRGVzdHJveVNlbGVjdENvdW50OiBBcnJheS5pc0FycmF5KGRlc3Ryb3lPcHRpb25zLnNlbGVjdCkgPyBkZXN0cm95T3B0aW9ucy5zZWxlY3QubGVuZ3RoIDogMCxcbiAgICBpbnN0YW5jZVVwZGF0ZVNlbGVjdENvdW50OiBBcnJheS5pc0FycmF5KHVwZGF0ZU9wdGlvbnMuc2VsZWN0KSA/IHVwZGF0ZU9wdGlvbnMuc2VsZWN0Lmxlbmd0aCA6IDAsXG4gICAgaW5zdGFuY2VVcGRhdGVXaXRoQ291bnRDb21tZW50czogdXBkYXRlT3B0aW9ucy53aXRoQ291bnQgPT09IFwiY29tbWVudHNcIiA/IDEgOiAwXG4gIH1cbn1cblxuLyoqXG4gKiBSdW5zIGRlYm91bmNlIHVubW91bnQgc2NlbmFyaW8uXG4gKiBAcmV0dXJucyB7UHJvbWlzZTxSZWNvcmQ8c3RyaW5nLCBudW1iZXI+Pn0gLSBTY2VuYXJpbyByZXN1bHQuXG4gKi9cbmFzeW5jIGZ1bmN0aW9uIGRlYm91bmNlVW5tb3VudFNjZW5hcmlvKCkge1xuICBjb25zdCB7TW9kZWxDbGFzcywgc3Vic2NyaXB0aW9uczogY2xhc3NTdWJzY3JpcHRpb25zfSA9IGJ1aWxkRmFrZU1vZGVsQ2xhc3MoKVxuICBjb25zdCBpbnN0YW5jZVN1YnNjcmlwdGlvbnMgPSBidWlsZEZha2VTdWJzY3JpcHRpb25zKClcbiAgY29uc3QgbW9kZWwgPSBidWlsZEZha2VNb2RlbChcInRhc2stMVwiLCBpbnN0YW5jZVN1YnNjcmlwdGlvbnMpXG4gIC8qKlxuICAgKiBSZWNlaXZlZCBldmVudHMuXG4gICAqIEB0eXBlIHtBcnJheTxGcm9udGVuZE1vZGVsSG9va1Rlc3RDcmVhdGVVcGRhdGVQYXlsb2FkIHwgRnJvbnRlbmRNb2RlbEhvb2tUZXN0RGVzdHJveVBheWxvYWQ+fSAqL1xuICBjb25zdCByZWNlaXZlZEV2ZW50cyA9IFtdXG5cbiAgLyoqXG4gICAqIFJ1bnMgdGVzdCBjb21wb25lbnQuXG4gICAqIEByZXR1cm5zIHtSZWFjdC5SZWFjdEVsZW1lbnR9IC0gVGVzdCBlbGVtZW50LlxuICAgKi9cbiAgZnVuY3Rpb24gVGVzdENvbXBvbmVudCgpIHtcbiAgICB1c2VNb2RlbENsYXNzRXZlbnQoTW9kZWxDbGFzcywgXCJ1cGRhdGVcIiwgKHBheWxvYWQpID0+IHJlY2VpdmVkRXZlbnRzLnB1c2gocGF5bG9hZCksIHtkZWJvdW5jZTogMjB9KVxuICAgIHVzZVVwZGF0ZWRFdmVudChtb2RlbCwgKHBheWxvYWQpID0+IHJlY2VpdmVkRXZlbnRzLnB1c2gocGF5bG9hZCksIHtkZWJvdW5jZTogMjB9KVxuICAgIHVzZURlc3Ryb3llZEV2ZW50KG1vZGVsLCAocGF5bG9hZCkgPT4gcmVjZWl2ZWRFdmVudHMucHVzaChwYXlsb2FkKSwge2RlYm91bmNlOiAyMH0pXG5cbiAgICByZXR1cm4gUmVhY3QuY3JlYXRlRWxlbWVudChcImRpdlwiKVxuICB9XG5cbiAgY29uc3QgY29udHJvbHMgPSBhd2FpdCByZW5kZXJFbGVtZW50KFJlYWN0LmNyZWF0ZUVsZW1lbnQoVGVzdENvbXBvbmVudCkpXG4gIGF3YWl0IHdhaXRGb3IoKCkgPT4gY2xhc3NTdWJzY3JpcHRpb25zLnVwZGF0ZS5zaXplID09PSAxICYmIGluc3RhbmNlU3Vic2NyaXB0aW9ucy51cGRhdGUuc2l6ZSA9PT0gMSAmJiBpbnN0YW5jZVN1YnNjcmlwdGlvbnMuZGVzdHJveS5zaXplID09PSAxKVxuXG4gIGVtaXRFdmVudChjbGFzc1N1YnNjcmlwdGlvbnMsIFwidXBkYXRlXCIsIHtpZDogXCJ0YXNrLTFcIiwgbW9kZWx9KVxuICBlbWl0RXZlbnQoaW5zdGFuY2VTdWJzY3JpcHRpb25zLCBcInVwZGF0ZVwiLCB7aWQ6IFwidGFzay0xXCIsIG1vZGVsfSlcbiAgZW1pdEV2ZW50KGluc3RhbmNlU3Vic2NyaXB0aW9ucywgXCJkZXN0cm95XCIsIHtpZDogXCJ0YXNrLTFcIn0pXG5cbiAgYXdhaXQgY29udHJvbHMudW5tb3VudCgpXG4gIGF3YWl0IHdhaXQoMzApXG5cbiAgcmV0dXJuIHtyZWNlaXZlZEV2ZW50c0FmdGVyRGVib3VuY2VXaW5kb3c6IHJlY2VpdmVkRXZlbnRzLmxlbmd0aH1cbn1cblxuLyoqXG4gKiBSdW5zIHJlc3Vic2NyaWJlIGluc3RhbmNlIHNjZW5hcmlvLlxuICogQHJldHVybnMge1Byb21pc2U8UmVjb3JkPHN0cmluZywgbnVtYmVyPj59IC0gU2NlbmFyaW8gcmVzdWx0LlxuICovXG5hc3luYyBmdW5jdGlvbiByZXN1YnNjcmliZUluc3RhbmNlU2NlbmFyaW8oKSB7XG4gIGNvbnN0IGZpcnN0U3Vic2NyaXB0aW9ucyA9IGJ1aWxkRmFrZVN1YnNjcmlwdGlvbnMoKVxuICBjb25zdCBzZWNvbmRTdWJzY3JpcHRpb25zID0gYnVpbGRGYWtlU3Vic2NyaXB0aW9ucygpXG4gIGNvbnN0IGZpcnN0TW9kZWwgPSBidWlsZEZha2VNb2RlbChcInRhc2stMVwiLCBmaXJzdFN1YnNjcmlwdGlvbnMpXG4gIGNvbnN0IHNlY29uZE1vZGVsID0gYnVpbGRGYWtlTW9kZWwoXCJ0YXNrLTFcIiwgc2Vjb25kU3Vic2NyaXB0aW9ucylcbiAgLyoqXG4gICAqIFJlY2VpdmVkIGV2ZW50cy5cbiAgICogQHR5cGUge0FycmF5PEZyb250ZW5kTW9kZWxIb29rVGVzdENyZWF0ZVVwZGF0ZVBheWxvYWQgfCBGcm9udGVuZE1vZGVsSG9va1Rlc3REZXN0cm95UGF5bG9hZD59ICovXG4gIGNvbnN0IHJlY2VpdmVkRXZlbnRzID0gW11cblxuICAvKipcbiAgICogUnVucyB0ZXN0IGNvbXBvbmVudC5cbiAgICogQHBhcmFtIHt7bW9kZWw6IGltcG9ydChcIi4uL2Zyb250ZW5kLW1vZGVscy9iYXNlLmpzXCIpLmRlZmF1bHR9fSBwcm9wcyAtIENvbXBvbmVudCBwcm9wcy5cbiAgICogQHJldHVybnMge1JlYWN0LlJlYWN0RWxlbWVudH0gLSBUZXN0IGVsZW1lbnQuXG4gICAqL1xuICBmdW5jdGlvbiBUZXN0Q29tcG9uZW50KHttb2RlbH0pIHtcbiAgICB1c2VVcGRhdGVkRXZlbnQobW9kZWwsIChwYXlsb2FkKSA9PiByZWNlaXZlZEV2ZW50cy5wdXNoKHBheWxvYWQpKVxuICAgIHVzZURlc3Ryb3llZEV2ZW50KG1vZGVsLCAocGF5bG9hZCkgPT4gcmVjZWl2ZWRFdmVudHMucHVzaChwYXlsb2FkKSlcblxuICAgIHJldHVybiBSZWFjdC5jcmVhdGVFbGVtZW50KFwiZGl2XCIpXG4gIH1cblxuICBjb25zdCBjb250cm9scyA9IGF3YWl0IHJlbmRlckVsZW1lbnQoUmVhY3QuY3JlYXRlRWxlbWVudChUZXN0Q29tcG9uZW50LCB7bW9kZWw6IGZpcnN0TW9kZWx9KSlcbiAgYXdhaXQgd2FpdEZvcigoKSA9PiBmaXJzdFN1YnNjcmlwdGlvbnMudXBkYXRlLnNpemUgPT09IDEgJiYgZmlyc3RTdWJzY3JpcHRpb25zLmRlc3Ryb3kuc2l6ZSA9PT0gMSlcblxuICBjb25zdCBmaXJzdE1vdW50ZWREZXN0cm95U3Vic2NyaXB0aW9ucyA9IGZpcnN0U3Vic2NyaXB0aW9ucy5kZXN0cm95LnNpemVcbiAgY29uc3QgZmlyc3RNb3VudGVkVXBkYXRlU3Vic2NyaXB0aW9ucyA9IGZpcnN0U3Vic2NyaXB0aW9ucy51cGRhdGUuc2l6ZVxuXG4gIGF3YWl0IGNvbnRyb2xzLnJlcmVuZGVyKFJlYWN0LmNyZWF0ZUVsZW1lbnQoVGVzdENvbXBvbmVudCwge21vZGVsOiBzZWNvbmRNb2RlbH0pKVxuICBhd2FpdCB3YWl0Rm9yKCgpID0+IGZpcnN0U3Vic2NyaXB0aW9ucy51cGRhdGUuc2l6ZSA9PT0gMCAmJiBmaXJzdFN1YnNjcmlwdGlvbnMuZGVzdHJveS5zaXplID09PSAwICYmIHNlY29uZFN1YnNjcmlwdGlvbnMudXBkYXRlLnNpemUgPT09IDEgJiYgc2Vjb25kU3Vic2NyaXB0aW9ucy5kZXN0cm95LnNpemUgPT09IDEpXG5cbiAgY29uc3QgZmlyc3RBZnRlclJlcmVuZGVyRGVzdHJveVN1YnNjcmlwdGlvbnMgPSBmaXJzdFN1YnNjcmlwdGlvbnMuZGVzdHJveS5zaXplXG4gIGNvbnN0IGZpcnN0QWZ0ZXJSZXJlbmRlclVwZGF0ZVN1YnNjcmlwdGlvbnMgPSBmaXJzdFN1YnNjcmlwdGlvbnMudXBkYXRlLnNpemVcbiAgY29uc3Qgc2Vjb25kQWZ0ZXJSZXJlbmRlckRlc3Ryb3lTdWJzY3JpcHRpb25zID0gc2Vjb25kU3Vic2NyaXB0aW9ucy5kZXN0cm95LnNpemVcbiAgY29uc3Qgc2Vjb25kQWZ0ZXJSZXJlbmRlclVwZGF0ZVN1YnNjcmlwdGlvbnMgPSBzZWNvbmRTdWJzY3JpcHRpb25zLnVwZGF0ZS5zaXplXG5cbiAgZW1pdEV2ZW50KGZpcnN0U3Vic2NyaXB0aW9ucywgXCJ1cGRhdGVcIiwge2lkOiBcInRhc2stMVwiLCBtb2RlbDogZmlyc3RNb2RlbH0pXG4gIGVtaXRFdmVudChzZWNvbmRTdWJzY3JpcHRpb25zLCBcInVwZGF0ZVwiLCB7aWQ6IFwidGFzay0xXCIsIG1vZGVsOiBzZWNvbmRNb2RlbH0pXG4gIGVtaXRFdmVudChzZWNvbmRTdWJzY3JpcHRpb25zLCBcImRlc3Ryb3lcIiwge2lkOiBcInRhc2stMVwifSlcblxuICBjb25zdCByZWNlaXZlZEV2ZW50c0FmdGVyRW1pdCA9IHJlY2VpdmVkRXZlbnRzLmxlbmd0aFxuXG4gIGF3YWl0IGNvbnRyb2xzLnVubW91bnQoKVxuXG4gIHJldHVybiB7XG4gICAgZmlyc3RBZnRlclJlcmVuZGVyRGVzdHJveVN1YnNjcmlwdGlvbnMsXG4gICAgZmlyc3RBZnRlclJlcmVuZGVyVXBkYXRlU3Vic2NyaXB0aW9ucyxcbiAgICBmaXJzdE1vdW50ZWREZXN0cm95U3Vic2NyaXB0aW9ucyxcbiAgICBmaXJzdE1vdW50ZWRVcGRhdGVTdWJzY3JpcHRpb25zLFxuICAgIHJlY2VpdmVkRXZlbnRzQWZ0ZXJFbWl0LFxuICAgIHNlY29uZEFmdGVyUmVyZW5kZXJEZXN0cm95U3Vic2NyaXB0aW9ucyxcbiAgICBzZWNvbmRBZnRlclJlcmVuZGVyVXBkYXRlU3Vic2NyaXB0aW9uc1xuICB9XG59XG5cbmNvbnN0IHNjZW5hcmlvcyA9IHtcbiAgY2xhc3NMaWZlY3ljbGU6IGNsYXNzTGlmZWN5Y2xlU2NlbmFyaW8sXG4gIGRlYm91bmNlVW5tb3VudDogZGVib3VuY2VVbm1vdW50U2NlbmFyaW8sXG4gIGluc3RhbmNlTGlmZWN5Y2xlOiBpbnN0YW5jZUxpZmVjeWNsZVNjZW5hcmlvLFxuICBwcm9qZWN0aW9uT3B0aW9uczogcHJvamVjdGlvbk9wdGlvbnNTY2VuYXJpbyxcbiAgcmVzdWJzY3JpYmVJbnN0YW5jZTogcmVzdWJzY3JpYmVJbnN0YW5jZVNjZW5hcmlvXG59XG5cbi8qKlxuICogUnVucyBydW4gZnJvbnRlbmQgbW9kZWwgZXZlbnQgaG9vayBzY2VuYXJpby5cbiAqIEBwYXJhbSB7a2V5b2YgdHlwZW9mIHNjZW5hcmlvc30gc2NlbmFyaW9OYW1lIC0gU2NlbmFyaW8gbmFtZS5cbiAqIEByZXR1cm5zIHtQcm9taXNlPFJlY29yZDxzdHJpbmcsIG51bWJlcj4+fSAtIFNjZW5hcmlvIHJlc3VsdC5cbiAqL1xuZXhwb3J0IGRlZmF1bHQgYXN5bmMgZnVuY3Rpb24gcnVuRnJvbnRlbmRNb2RlbEV2ZW50SG9va1NjZW5hcmlvKHNjZW5hcmlvTmFtZSkge1xuICBjb25zdCBzY2VuYXJpbyA9IHNjZW5hcmlvc1tzY2VuYXJpb05hbWVdXG5cbiAgaWYgKCFzY2VuYXJpbykgdGhyb3cgbmV3IEVycm9yKGBVbmtub3duIGZyb250ZW5kIG1vZGVsIGV2ZW50IGhvb2sgc2NlbmFyaW86ICR7c2NlbmFyaW9OYW1lfWApXG5cbiAgcmV0dXJuIGF3YWl0IHNjZW5hcmlvKClcbn1cbiJdfQ==