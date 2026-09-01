// @ts-check
/**
 * Defines this typedef.
 * @typedef {{
 *   column?: string,
 *   initial: string,
 *   states: Record<string, StateDefinition>,
 *   events: Record<string, EventDefinition>
 * }} StateMachineDefinition
 * @typedef {{
 *   beforeEnter?: (model: import("./index.js").default) => void | Promise<void>,
 *   afterEnter?: (model: import("./index.js").default) => void | Promise<void>,
 *   beforeExit?: (model: import("./index.js").default) => void | Promise<void>,
 *   afterExit?: (model: import("./index.js").default) => void | Promise<void>
 * }} StateDefinition
 * @typedef {{
 *   from: string | string[],
 *   to: string,
 *   guard?: (model: import("./index.js").default) => boolean | Promise<boolean>,
 *   before?: (model: import("./index.js").default) => void | Promise<void>,
 *   after?: (model: import("./index.js").default) => void | Promise<void>
 * }} EventDefinition
 */
/**
 * Pending transition key.
 * @type {string} */
const PENDING_TRANSITION_KEY = "_stateMachinePendingTransition";
/**
 * Registers a state machine on a Velocious model class.
 *
 * Usage:
 * ```js
 * import {stateMachine} from "velocious/build/src/database/record/state-machine.js"
 *
 * class Build extends BuildBase {}
 *
 * stateMachine(Build, {
 *   column: "status",
 *   initial: "new",
 *   states: {
 *     new: {},
 *     queued: {beforeEnter: (build) => { build.setQueuedAt(new Date()) }},
 *     running: {beforeEnter: (build) => { build.setStartedAt(new Date()) }},
 *     failed: {beforeEnter: (build) => { build.setEndedAt(new Date()) }},
 *     succeeded: {beforeEnter: (build) => { build.setEndedAt(new Date()) }}
 *   },
 *   events: {
 *     queue: {from: "new", to: "queued"},
 *     run: {from: ["new", "queued", "crashed"], to: "running"},
 *     fail: {from: ["new", "queued", "running"], to: "failed"},
 *     succeed: {from: "running", to: "succeeded"},
 *     cancel: {from: ["new", "queued", "running"], to: "cancelled", guard: (build) => !build.isNewRecord()}
 *   }
 * })
 * ```
 * @param {typeof import("./index.js").default} ModelClass - The model class to add state machine behavior to.
 * @param {StateMachineDefinition} definition - The state machine definition.
 * @returns {void}
 */
export function stateMachine(ModelClass, definition) {
    const column = definition.column || "state";
    const stateNames = Object.keys(definition.states);
    // Store definition on the model class for introspection
    /**
     * Dynamic class.
     * @type {ReturnType<typeof JSON.parse>} */
    const dynamicClass = ModelClass;
    // Idempotent: re-declaring on the same class (or a re-evaluated module) must not
    // register the before/after-save transition hooks twice. Guard on an own property
    // so a subclass declaring its own machine is unaffected by the parent's flag.
    if (Object.prototype.hasOwnProperty.call(dynamicClass, "_stateMachineRegistered") && dynamicClass._stateMachineRegistered) {
        return;
    }
    dynamicClass._stateMachineRegistered = true;
    dynamicClass._stateMachineDefinition = definition;
    dynamicClass._stateMachineColumn = column;
    /**
     * Returns the registered state machine definition.
     * @returns {StateMachineDefinition} - The registered state machine definition.
     */
    dynamicClass.getStateMachineDefinition = function () {
        return dynamicClass._stateMachineDefinition;
    };
    /**
     * Returns the state column name.
     * @returns {string} - The column name used for state storage.
     */
    dynamicClass.getStateMachineColumn = function () {
        return dynamicClass._stateMachineColumn;
    };
    /**
     * Returns all declared state names.
     * @returns {string[]} - All declared state names.
     */
    dynamicClass.getStateMachineStateNames = function () {
        return stateNames;
    };
    // Register event methods and guard methods on the prototype
    /**
     * Proto.
     * @type {ReturnType<typeof JSON.parse>} */
    const proto = ModelClass.prototype;
    for (const [eventName, eventDef] of Object.entries(definition.events)) {
        const fromStates = Array.isArray(eventDef.from) ? eventDef.from : [eventDef.from];
        const capitalizedEvent = eventName.charAt(0).toUpperCase() + eventName.slice(1);
        const canMethodName = `can${capitalizedEvent}`;
        const setterName = columnSetterName(column);
        // Guard method: canQueue(), canRun(), etc.
        proto[canMethodName] = function () {
            const currentState = this.readAttribute(column);
            if (!fromStates.includes(currentState)) {
                return false;
            }
            if (eventDef.guard) {
                const guardResult = eventDef.guard(this);
                if (guardResult instanceof Promise) {
                    throw new Error(`Guard for event "${eventName}" returned a Promise. Use await model.can${capitalizedEvent}Async() instead.`);
                }
                return guardResult;
            }
            return true;
        };
        // Async guard method: canQueueAsync(), canRunAsync(), etc.
        proto[`${canMethodName}Async`] = async function () {
            const currentState = this.readAttribute(column);
            if (!fromStates.includes(currentState)) {
                return false;
            }
            if (eventDef.guard) {
                return await eventDef.guard(this);
            }
            return true;
        };
        // Transition method: queue(), run(), etc. — checks guard, sets the state, stashes event name
        proto[eventName] = function () {
            /**
             * Self.
             * @type {ReturnType<typeof JSON.parse>} */
            const self = this;
            const currentState = self.readAttribute(column);
            if (!fromStates.includes(currentState)) {
                throw new Error(`Cannot transition "${eventName}" from "${currentState}" on ${self.getModelClass().name}. ` +
                    `Allowed source states: ${fromStates.join(", ")}`);
            }
            // Enforce synchronous guard before mutating state
            if (eventDef.guard) {
                const guardResult = eventDef.guard(self);
                if (guardResult instanceof Promise) {
                    throw new Error(`Guard for event "${eventName}" returned a Promise. Use await model.${eventName}AndSave() for async guards.`);
                }
                if (!guardResult) {
                    throw new Error(`Guard rejected transition "${eventName}" from "${currentState}" on ${self.getModelClass().name}.`);
                }
            }
            // Stash the transition so beforeSave/afterSave know which event was invoked
            self[PENDING_TRANSITION_KEY] = { eventName, from: currentState, to: eventDef.to };
            self[setterName](eventDef.to);
        };
        // Bang method: queueAndSave(), runAndSave(), etc. — transitions AND saves (supports async guards)
        proto[`${eventName}AndSave`] = async function () {
            /**
             * Self.
             * @type {ReturnType<typeof JSON.parse>} */
            const self = this;
            const currentState = self.readAttribute(column);
            if (!fromStates.includes(currentState)) {
                throw new Error(`Cannot transition "${eventName}" from "${currentState}" on ${self.getModelClass().name}. ` +
                    `Allowed source states: ${fromStates.join(", ")}`);
            }
            // Enforce async guard before mutating state
            if (eventDef.guard) {
                const allowed = await eventDef.guard(self);
                if (!allowed) {
                    throw new Error(`Guard rejected transition "${eventName}" from "${currentState}" on ${self.getModelClass().name}.`);
                }
            }
            self[PENDING_TRANSITION_KEY] = { eventName, from: currentState, to: eventDef.to };
            self[setterName](eventDef.to);
            await self.save();
        };
    }
    // Register a beforeSave callback that fires state-enter hooks
    ModelClass.beforeSave(async function (model) {
        /**
         * Dynamic model.
         * @type {ReturnType<typeof JSON.parse>} */
        const dynamicModel = model;
        const pending = dynamicModel[PENDING_TRANSITION_KEY];
        if (!pending) {
            return;
        }
        const eventDef = definition.events[pending.eventName];
        // Run event-level before callback
        if (eventDef?.before) {
            await eventDef.before(model);
        }
        // Run the exited state's beforeExit, then the entered state's beforeEnter
        const fromStateDefinition = definition.states[pending.from];
        if (fromStateDefinition?.beforeExit) {
            await fromStateDefinition.beforeExit(model);
        }
        const stateDefinition = definition.states[pending.to];
        if (stateDefinition?.beforeEnter) {
            await stateDefinition.beforeEnter(model);
        }
    });
    // Register an afterSave callback for afterEnter hooks
    ModelClass.afterSave(async function (model) {
        /**
         * Dynamic model.
         * @type {ReturnType<typeof JSON.parse>} */
        const dynamicModel = model;
        const pending = dynamicModel[PENDING_TRANSITION_KEY];
        if (!pending) {
            return;
        }
        // Clear the pending transition now that save is complete
        dynamicModel[PENDING_TRANSITION_KEY] = null;
        // Run the entered state's afterEnter, then the exited state's afterExit
        const stateDefinition = definition.states[pending.to];
        if (stateDefinition?.afterEnter) {
            await stateDefinition.afterEnter(model);
        }
        const fromStateDefinition = definition.states[pending.from];
        if (fromStateDefinition?.afterExit) {
            await fromStateDefinition.afterExit(model);
        }
        // Run event-level after callback
        const eventDef = definition.events[pending.eventName];
        if (eventDef?.after) {
            await eventDef.after(model);
        }
    });
}
/**
 * Returns the setter method name for a column (e.g., "status" → "setStatus", "state" → "setState").
 * @param {string} column - The column name.
 * @returns {string} - The setter method name.
 */
function columnSetterName(column) {
    return `set${column.charAt(0).toUpperCase()}${column.slice(1)}`;
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic3RhdGUtbWFjaGluZS5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy9kYXRhYmFzZS9yZWNvcmQvc3RhdGUtbWFjaGluZS5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxZQUFZO0FBRVo7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztHQXFCRztBQUVIOztvQkFFb0I7QUFDcEIsTUFBTSxzQkFBc0IsR0FBRyxnQ0FBZ0MsQ0FBQTtBQUUvRDs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztHQStCRztBQUNILE1BQU0sVUFBVSxZQUFZLENBQUMsVUFBVSxFQUFFLFVBQVU7SUFDakQsTUFBTSxNQUFNLEdBQUcsVUFBVSxDQUFDLE1BQU0sSUFBSSxPQUFPLENBQUE7SUFDM0MsTUFBTSxVQUFVLEdBQUcsTUFBTSxDQUFDLElBQUksQ0FBQyxVQUFVLENBQUMsTUFBTSxDQUFDLENBQUE7SUFFakQsd0RBQXdEO0lBQ3hEOzsrQ0FFMkM7SUFDM0MsTUFBTSxZQUFZLEdBQUcsVUFBVSxDQUFBO0lBRS9CLGlGQUFpRjtJQUNqRixrRkFBa0Y7SUFDbEYsOEVBQThFO0lBQzlFLElBQUksTUFBTSxDQUFDLFNBQVMsQ0FBQyxjQUFjLENBQUMsSUFBSSxDQUFDLFlBQVksRUFBRSx5QkFBeUIsQ0FBQyxJQUFJLFlBQVksQ0FBQyx1QkFBdUIsRUFBRSxDQUFDO1FBQzFILE9BQU07SUFDUixDQUFDO0lBRUQsWUFBWSxDQUFDLHVCQUF1QixHQUFHLElBQUksQ0FBQTtJQUMzQyxZQUFZLENBQUMsdUJBQXVCLEdBQUcsVUFBVSxDQUFBO0lBQ2pELFlBQVksQ0FBQyxtQkFBbUIsR0FBRyxNQUFNLENBQUE7SUFFekM7OztPQUdHO0lBQ0gsWUFBWSxDQUFDLHlCQUF5QixHQUFHO1FBQ3ZDLE9BQU8sWUFBWSxDQUFDLHVCQUF1QixDQUFBO0lBQzdDLENBQUMsQ0FBQTtJQUVEOzs7T0FHRztJQUNILFlBQVksQ0FBQyxxQkFBcUIsR0FBRztRQUNuQyxP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QUFDO1FBRUQsaUNBQWlDO1FBQ2pDLE1BQU0sUUFBUSxHQUFHLFVBQVUsQ0FBQyxNQUFNLENBQUMsT0FBTyxDQUFDLFNBQVMsQ0FBQyxDQUFBO1FBRXJELElBQUksUUFBUSxFQUFFLEtBQUssRUFBRSxDQUFDO1lBQ3BCLE1BQU0sUUFBUSxDQUFDLEtBQUssQ0FBQyxLQUFLLENBQUMsQ0FBQTtRQUM3QixDQUFDO0lBQ0gsQ0FBQyxDQUFDLENBQUE7QUFDSixDQUFDO0FBRUQ7Ozs7R0FJRztBQUNILFNBQVMsZ0JBQWdCLENBQUMsTUFBTTtJQUM5QixPQUFPLE1BQU0sTUFBTSxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMsQ0FBQyxXQUFXLEVBQUUsR0FBRyxNQUFNLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUE7QUFDakUsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG4vKipcbiAqIERlZmluZXMgdGhpcyB0eXBlZGVmLlxuICogQHR5cGVkZWYge3tcbiAqICAgY29sdW1uPzogc3RyaW5nLFxuICogICBpbml0aWFsOiBzdHJpbmcsXG4gKiAgIHN0YXRlczogUmVjb3JkPHN0cmluZywgU3RhdGVEZWZpbml0aW9uPixcbiAqICAgZXZlbnRzOiBSZWNvcmQ8c3RyaW5nLCBFdmVudERlZmluaXRpb24+XG4gKiB9fSBTdGF0ZU1hY2hpbmVEZWZpbml0aW9uXG4gKiBAdHlwZWRlZiB7e1xuICogICBiZWZvcmVFbnRlcj86IChtb2RlbDogaW1wb3J0KFwiLi9pbmRleC5qc1wiKS5kZWZhdWx0KSA9PiB2b2lkIHwgUHJvbWlzZTx2b2lkPixcbiAqICAgYWZ0ZXJFbnRlcj86IChtb2RlbDogaW1wb3J0KFwiLi9pbmRleC5qc1wiKS5kZWZhdWx0KSA9PiB2b2lkIHwgUHJvbWlzZTx2b2lkPixcbiAqICAgYmVmb3JlRXhpdD86IChtb2RlbDogaW1wb3J0KFwiLi9pbmRleC5qc1wiKS5kZWZhdWx0KSA9PiB2b2lkIHwgUHJvbWlzZTx2b2lkPixcbiAqICAgYWZ0ZXJFeGl0PzogKG1vZGVsOiBpbXBvcnQoXCIuL2luZGV4LmpzXCIpLmRlZmF1bHQpID0+IHZvaWQgfCBQcm9taXNlPHZvaWQ+XG4gKiB9fSBTdGF0ZURlZmluaXRpb25cbiAqIEB0eXBlZGVmIHt7XG4gKiAgIGZyb206IHN0cmluZyB8IHN0cmluZ1tdLFxuICogICB0bzogc3RyaW5nLFxuICogICBndWFyZD86IChtb2RlbDogaW1wb3J0KFwiLi9pbmRleC5qc1wiKS5kZWZhdWx0KSA9PiBib29sZWFuIHwgUHJvbWlzZTxib29sZWFuPixcbiAqICAgYmVmb3JlPzogKG1vZGVsOiBpbXBvcnQoXCIuL2luZGV4LmpzXCIpLmRlZmF1bHQpID0+IHZvaWQgfCBQcm9taXNlPHZvaWQ+LFxuICogICBhZnRlcj86IChtb2RlbDogaW1wb3J0KFwiLi9pbmRleC5qc1wiKS5kZWZhdWx0KSA9PiB2b2lkIHwgUHJvbWlzZTx2b2lkPlxuICogfX0gRXZlbnREZWZpbml0aW9uXG4gKi9cblxuLyoqXG4gKiBQZW5kaW5nIHRyYW5zaXRpb24ga2V5LlxuICogQHR5cGUge3N0cmluZ30gKi9cbmNvbnN0IFBFTkRJTkdfVFJBTlNJVElPTl9LRVkgPSBcIl9zdGF0ZU1hY2hpbmVQZW5kaW5nVHJhbnNpdGlvblwiXG5cbi8qKlxuICogUmVnaXN0ZXJzIGEgc3RhdGUgbWFjaGluZSBvbiBhIFZlbG9jaW91cyBtb2RlbCBjbGFzcy5cbiAqXG4gKiBVc2FnZTpcbiAqIGBgYGpzXG4gKiBpbXBvcnQge3N0YXRlTWFjaGluZX0gZnJvbSBcInZlbG9jaW91cy9idWlsZC9zcmMvZGF0YWJhc2UvcmVjb3JkL3N0YXRlLW1hY2hpbmUuanNcIlxuICpcbiAqIGNsYXNzIEJ1aWxkIGV4dGVuZHMgQnVpbGRCYXNlIHt9XG4gKlxuICogc3RhdGVNYWNoaW5lKEJ1aWxkLCB7XG4gKiAgIGNvbHVtbjogXCJzdGF0dXNcIixcbiAqICAgaW5pdGlhbDogXCJuZXdcIixcbiAqICAgc3RhdGVzOiB7XG4gKiAgICAgbmV3OiB7fSxcbiAqICAgICBxdWV1ZWQ6IHtiZWZvcmVFbnRlcjogKGJ1aWxkKSA9PiB7IGJ1aWxkLnNldFF1ZXVlZEF0KG5ldyBEYXRlKCkpIH19LFxuICogICAgIHJ1bm5pbmc6IHtiZWZvcmVFbnRlcjogKGJ1aWxkKSA9PiB7IGJ1aWxkLnNldFN0YXJ0ZWRBdChuZXcgRGF0ZSgpKSB9fSxcbiAqICAgICBmYWlsZWQ6IHtiZWZvcmVFbnRlcjogKGJ1aWxkKSA9PiB7IGJ1aWxkLnNldEVuZGVkQXQobmV3IERhdGUoKSkgfX0sXG4gKiAgICAgc3VjY2VlZGVkOiB7YmVmb3JlRW50ZXI6IChidWlsZCkgPT4geyBidWlsZC5zZXRFbmRlZEF0KG5ldyBEYXRlKCkpIH19XG4gKiAgIH0sXG4gKiAgIGV2ZW50czoge1xuICogICAgIHF1ZXVlOiB7ZnJvbTogXCJuZXdcIiwgdG86IFwicXVldWVkXCJ9LFxuICogICAgIHJ1bjoge2Zyb206IFtcIm5ld1wiLCBcInF1ZXVlZFwiLCBcImNyYXNoZWRcIl0sIHRvOiBcInJ1bm5pbmdcIn0sXG4gKiAgICAgZmFpbDoge2Zyb206IFtcIm5ld1wiLCBcInF1ZXVlZFwiLCBcInJ1bm5pbmdcIl0sIHRvOiBcImZhaWxlZFwifSxcbiAqICAgICBzdWNjZWVkOiB7ZnJvbTogXCJydW5uaW5nXCIsIHRvOiBcInN1Y2NlZWRlZFwifSxcbiAqICAgICBjYW5jZWw6IHtmcm9tOiBbXCJuZXdcIiwgXCJxdWV1ZWRcIiwgXCJydW5uaW5nXCJdLCB0bzogXCJjYW5jZWxsZWRcIiwgZ3VhcmQ6IChidWlsZCkgPT4gIWJ1aWxkLmlzTmV3UmVjb3JkKCl9XG4gKiAgIH1cbiAqIH0pXG4gKiBgYGBcbiAqIEBwYXJhbSB7dHlwZW9mIGltcG9ydChcIi4vaW5kZXguanNcIikuZGVmYXVsdH0gTW9kZWxDbGFzcyAtIFRoZSBtb2RlbCBjbGFzcyB0byBhZGQgc3RhdGUgbWFjaGluZSBiZWhhdmlvciB0by5cbiAqIEBwYXJhbSB7U3RhdGVNYWNoaW5lRGVmaW5pdGlvbn0gZGVmaW5pdGlvbiAtIFRoZSBzdGF0ZSBtYWNoaW5lIGRlZmluaXRpb24uXG4gKiBAcmV0dXJucyB7dm9pZH1cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHN0YXRlTWFjaGluZShNb2RlbENsYXNzLCBkZWZpbml0aW9uKSB7XG4gIGNvbnN0IGNvbHVtbiA9IGRlZmluaXRpb24uY29sdW1uIHx8IFwic3RhdGVcIlxuICBjb25zdCBzdGF0ZU5hbWVzID0gT2JqZWN0LmtleXMoZGVmaW5pdGlvbi5zdGF0ZXMpXG5cbiAgLy8gU3RvcmUgZGVmaW5pdGlvbiBvbiB0aGUgbW9kZWwgY2xhc3MgZm9yIGludHJvc3BlY3Rpb25cbiAgLyoqXG4gICAqIER5bmFtaWMgY2xhc3MuXG4gICAqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi9cbiAgY29uc3QgZHluYW1pY0NsYXNzID0gTW9kZWxDbGFzc1xuXG4gIC8vIElkZW1wb3RlbnQ6IHJlLWRlY2xhcmluZyBvbiB0aGUgc2FtZSBjbGFzcyAob3IgYSByZS1ldmFsdWF0ZWQgbW9kdWxlKSBtdXN0IG5vdFxuICAvLyByZWdpc3RlciB0aGUgYmVmb3JlL2FmdGVyLXNhdmUgdHJhbnNpdGlvbiBob29rcyB0d2ljZS4gR3VhcmQgb24gYW4gb3duIHByb3BlcnR5XG4gIC8vIHNvIGEgc3ViY2xhc3MgZGVjbGFyaW5nIGl0cyBvd24gbWFjaGluZSBpcyB1bmFmZmVjdGVkIGJ5IHRoZSBwYXJlbnQncyBmbGFnLlxuICBpZiAoT2JqZWN0LnByb3RvdHlwZS5oYXNPd25Qcm9wZXJ0eS5jYWxsKGR5bmFtaWNDbGFzcywgXCJfc3RhdGVNYWNoaW5lUmVnaXN0ZXJlZFwiKSAmJiBkeW5hbWljQ2xhc3MuX3N0YXRlTWFjaGluZVJlZ2lzdGVyZWQpIHtcbiAgICByZXR1cm5cbiAgfVxuXG4gIGR5bmFtaWNDbGFzcy5fc3RhdGVNYWNoaW5lUmVnaXN0ZXJlZCA9IHRydWVcbiAgZHluYW1pY0NsYXNzLl9zdGF0ZU1hY2hpbmVEZWZpbml0aW9uID0gZGVmaW5pdGlvblxuICBkeW5hbWljQ2xhc3MuX3N0YXRlTWFjaGluZUNvbHVtbiA9IGNvbHVtblxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHRoZSByZWdpc3RlcmVkIHN0YXRlIG1hY2hpbmUgZGVmaW5pdGlvbi5cbiAgICogQHJldHVybnMge1N0YXRlTWFjaGluZURlZmluaXRpb259IC0gVGhlIHJlZ2lzdGVyZWQgc3RhdGUgbWFjaGluZSBkZWZpbml0aW9uLlxuICAgKi9cbiAgZHluYW1pY0NsYXNzLmdldFN0YXRlTWFjaGluZURlZmluaXRpb24gPSBmdW5jdGlvbiAoKSB7XG4gICAgcmV0dXJuIGR5bmFtaWNDbGFzcy5fc3RhdGVNYWNoaW5lRGVmaW5pdGlvblxuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgdGhlIHN0YXRlIGNvbHVtbiBuYW1lLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFRoZSBjb2x1bW4gbmFtZSB1c2VkIGZvciBzdGF0ZSBzdG9yYWdlLlxuICAgKi9cbiAgZHluYW1pY0NsYXNzLmdldFN0YXRlTWFjaGluZUNvbHVtbiA9IGZ1bmN0aW9uICgpIHtcbiAgICByZXR1cm4gZHluYW1pY0NsYXNzLl9zdGF0ZU1hY2hpbmVDb2x1bW5cbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIGFsbCBkZWNsYXJlZCBzdGF0ZSBuYW1lcy5cbiAgICogQHJldHVybnMge3N0cmluZ1tdfSAtIEFsbCBkZWNsYXJlZCBzdGF0ZSBuYW1lcy5cbiAgICovXG4gIGR5bmFtaWNDbGFzcy5nZXRTdGF0ZU1hY2hpbmVTdGF0ZU5hbWVzID0gZnVuY3Rpb24gKCkge1xuICAgIHJldHVybiBzdGF0ZU5hbWVzXG4gIH1cblxuICAvLyBSZWdpc3RlciBldmVudCBtZXRob2RzIGFuZCBndWFyZCBtZXRob2RzIG9uIHRoZSBwcm90b3R5cGVcbiAgLyoqXG4gICAqIFByb3RvLlxuICAgKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovXG4gIGNvbnN0IHByb3RvID0gTW9kZWxDbGFzcy5wcm90b3R5cGVcblxuICBmb3IgKGNvbnN0IFtldmVudE5hbWUsIGV2ZW50RGVmXSBvZiBPYmplY3QuZW50cmllcyhkZWZpbml0aW9uLmV2ZW50cykpIHtcbiAgICBjb25zdCBmcm9tU3RhdGVzID0gQXJyYXkuaXNBcnJheShldmVudERlZi5mcm9tKSA/IGV2ZW50RGVmLmZyb20gOiBbZXZlbnREZWYuZnJvbV1cbiAgICBjb25zdCBjYXBpdGFsaXplZEV2ZW50ID0gZXZlbnROYW1lLmNoYXJBdCgwKS50b1VwcGVyQ2FzZSgpICsgZXZlbnROYW1lLnNsaWNlKDEpXG4gICAgY29uc3QgY2FuTWV0aG9kTmFtZSA9IGBjYW4ke2NhcGl0YWxpemVkRXZlbnR9YFxuICAgIGNvbnN0IHNldHRlck5hbWUgPSBjb2x1bW5TZXR0ZXJOYW1lKGNvbHVtbilcblxuICAgIC8vIEd1YXJkIG1ldGhvZDogY2FuUXVldWUoKSwgY2FuUnVuKCksIGV0Yy5cbiAgICBwcm90b1tjYW5NZXRob2ROYW1lXSA9IGZ1bmN0aW9uICgpIHtcbiAgICAgIGNvbnN0IGN1cnJlbnRTdGF0ZSA9IHRoaXMucmVhZEF0dHJpYnV0ZShjb2x1bW4pXG5cbiAgICAgIGlmICghZnJvbVN0YXRlcy5pbmNsdWRlcyhjdXJyZW50U3RhdGUpKSB7XG4gICAgICAgIHJldHVybiBmYWxzZVxuICAgICAgfVxuXG4gICAgICBpZiAoZXZlbnREZWYuZ3VhcmQpIHtcbiAgICAgICAgY29uc3QgZ3VhcmRSZXN1bHQgPSBldmVudERlZi5ndWFyZCh0aGlzKVxuXG4gICAgICAgIGlmIChndWFyZFJlc3VsdCBpbnN0YW5jZW9mIFByb21pc2UpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYEd1YXJkIGZvciBldmVudCBcIiR7ZXZlbnROYW1lfVwiIHJldHVybmVkIGEgUHJvbWlzZS4gVXNlIGF3YWl0IG1vZGVsLmNhbiR7Y2FwaXRhbGl6ZWRFdmVudH1Bc3luYygpIGluc3RlYWQuYClcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiBndWFyZFJlc3VsdFxuICAgICAgfVxuXG4gICAgICByZXR1cm4gdHJ1ZVxuICAgIH1cblxuICAgIC8vIEFzeW5jIGd1YXJkIG1ldGhvZDogY2FuUXVldWVBc3luYygpLCBjYW5SdW5Bc3luYygpLCBldGMuXG4gICAgcHJvdG9bYCR7Y2FuTWV0aG9kTmFtZX1Bc3luY2BdID0gYXN5bmMgZnVuY3Rpb24gKCkge1xuICAgICAgY29uc3QgY3VycmVudFN0YXRlID0gdGhpcy5yZWFkQXR0cmlidXRlKGNvbHVtbilcblxuICAgICAgaWYgKCFmcm9tU3RhdGVzLmluY2x1ZGVzKGN1cnJlbnRTdGF0ZSkpIHtcbiAgICAgICAgcmV0dXJuIGZhbHNlXG4gICAgICB9XG5cbiAgICAgIGlmIChldmVudERlZi5ndWFyZCkge1xuICAgICAgICByZXR1cm4gYXdhaXQgZXZlbnREZWYuZ3VhcmQodGhpcylcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIHRydWVcbiAgICB9XG5cbiAgICAvLyBUcmFuc2l0aW9uIG1ldGhvZDogcXVldWUoKSwgcnVuKCksIGV0Yy4g4oCUIGNoZWNrcyBndWFyZCwgc2V0cyB0aGUgc3RhdGUsIHN0YXNoZXMgZXZlbnQgbmFtZVxuICAgIHByb3RvW2V2ZW50TmFtZV0gPSBmdW5jdGlvbiAoKSB7XG4gICAgICAvKipcbiAgICAgICAqIFNlbGYuXG4gICAgICAgKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovXG4gICAgICBjb25zdCBzZWxmID0gdGhpc1xuICAgICAgY29uc3QgY3VycmVudFN0YXRlID0gc2VsZi5yZWFkQXR0cmlidXRlKGNvbHVtbilcblxuICAgICAgaWYgKCFmcm9tU3RhdGVzLmluY2x1ZGVzKGN1cnJlbnRTdGF0ZSkpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKFxuICAgICAgICAgIGBDYW5ub3QgdHJhbnNpdGlvbiBcIiR7ZXZlbnROYW1lfVwiIGZyb20gXCIke2N1cnJlbnRTdGF0ZX1cIiBvbiAke3NlbGYuZ2V0TW9kZWxDbGFzcygpLm5hbWV9LiBgICtcbiAgICAgICAgICBgQWxsb3dlZCBzb3VyY2Ugc3RhdGVzOiAke2Zyb21TdGF0ZXMuam9pbihcIiwgXCIpfWBcbiAgICAgICAgKVxuICAgICAgfVxuXG4gICAgICAvLyBFbmZvcmNlIHN5bmNocm9ub3VzIGd1YXJkIGJlZm9yZSBtdXRhdGluZyBzdGF0ZVxuICAgICAgaWYgKGV2ZW50RGVmLmd1YXJkKSB7XG4gICAgICAgIGNvbnN0IGd1YXJkUmVzdWx0ID0gZXZlbnREZWYuZ3VhcmQoc2VsZilcblxuICAgICAgICBpZiAoZ3VhcmRSZXN1bHQgaW5zdGFuY2VvZiBQcm9taXNlKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBHdWFyZCBmb3IgZXZlbnQgXCIke2V2ZW50TmFtZX1cIiByZXR1cm5lZCBhIFByb21pc2UuIFVzZSBhd2FpdCBtb2RlbC4ke2V2ZW50TmFtZX1BbmRTYXZlKCkgZm9yIGFzeW5jIGd1YXJkcy5gKVxuICAgICAgICB9XG5cbiAgICAgICAgaWYgKCFndWFyZFJlc3VsdCkge1xuICAgICAgICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgICAgICAgIGBHdWFyZCByZWplY3RlZCB0cmFuc2l0aW9uIFwiJHtldmVudE5hbWV9XCIgZnJvbSBcIiR7Y3VycmVudFN0YXRlfVwiIG9uICR7c2VsZi5nZXRNb2RlbENsYXNzKCkubmFtZX0uYFxuICAgICAgICAgIClcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICAvLyBTdGFzaCB0aGUgdHJhbnNpdGlvbiBzbyBiZWZvcmVTYXZlL2FmdGVyU2F2ZSBrbm93IHdoaWNoIGV2ZW50IHdhcyBpbnZva2VkXG4gICAgICBzZWxmW1BFTkRJTkdfVFJBTlNJVElPTl9LRVldID0ge2V2ZW50TmFtZSwgZnJvbTogY3VycmVudFN0YXRlLCB0bzogZXZlbnREZWYudG99XG4gICAgICBzZWxmW3NldHRlck5hbWVdKGV2ZW50RGVmLnRvKVxuICAgIH1cblxuICAgIC8vIEJhbmcgbWV0aG9kOiBxdWV1ZUFuZFNhdmUoKSwgcnVuQW5kU2F2ZSgpLCBldGMuIOKAlCB0cmFuc2l0aW9ucyBBTkQgc2F2ZXMgKHN1cHBvcnRzIGFzeW5jIGd1YXJkcylcbiAgICBwcm90b1tgJHtldmVudE5hbWV9QW5kU2F2ZWBdID0gYXN5bmMgZnVuY3Rpb24gKCkge1xuICAgICAgLyoqXG4gICAgICAgKiBTZWxmLlxuICAgICAgICogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqL1xuICAgICAgY29uc3Qgc2VsZiA9IHRoaXNcbiAgICAgIGNvbnN0IGN1cnJlbnRTdGF0ZSA9IHNlbGYucmVhZEF0dHJpYnV0ZShjb2x1bW4pXG5cbiAgICAgIGlmICghZnJvbVN0YXRlcy5pbmNsdWRlcyhjdXJyZW50U3RhdGUpKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgICAgICBgQ2Fubm90IHRyYW5zaXRpb24gXCIke2V2ZW50TmFtZX1cIiBmcm9tIFwiJHtjdXJyZW50U3RhdGV9XCIgb24gJHtzZWxmLmdldE1vZGVsQ2xhc3MoKS5uYW1lfS4gYCArXG4gICAgICAgICAgYEFsbG93ZWQgc291cmNlIHN0YXRlczogJHtmcm9tU3RhdGVzLmpvaW4oXCIsIFwiKX1gXG4gICAgICAgIClcbiAgICAgIH1cblxuICAgICAgLy8gRW5mb3JjZSBhc3luYyBndWFyZCBiZWZvcmUgbXV0YXRpbmcgc3RhdGVcbiAgICAgIGlmIChldmVudERlZi5ndWFyZCkge1xuICAgICAgICBjb25zdCBhbGxvd2VkID0gYXdhaXQgZXZlbnREZWYuZ3VhcmQoc2VsZilcblxuICAgICAgICBpZiAoIWFsbG93ZWQpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICAgICAgICBgR3VhcmQgcmVqZWN0ZWQgdHJhbnNpdGlvbiBcIiR7ZXZlbnROYW1lfVwiIGZyb20gXCIke2N1cnJlbnRTdGF0ZX1cIiBvbiAke3NlbGYuZ2V0TW9kZWxDbGFzcygpLm5hbWV9LmBcbiAgICAgICAgICApXG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgc2VsZltQRU5ESU5HX1RSQU5TSVRJT05fS0VZXSA9IHtldmVudE5hbWUsIGZyb206IGN1cnJlbnRTdGF0ZSwgdG86IGV2ZW50RGVmLnRvfVxuICAgICAgc2VsZltzZXR0ZXJOYW1lXShldmVudERlZi50bylcbiAgICAgIGF3YWl0IHNlbGYuc2F2ZSgpXG4gICAgfVxuICB9XG5cbiAgLy8gUmVnaXN0ZXIgYSBiZWZvcmVTYXZlIGNhbGxiYWNrIHRoYXQgZmlyZXMgc3RhdGUtZW50ZXIgaG9va3NcbiAgTW9kZWxDbGFzcy5iZWZvcmVTYXZlKGFzeW5jIGZ1bmN0aW9uIChtb2RlbCkge1xuICAgIC8qKlxuICAgICAqIER5bmFtaWMgbW9kZWwuXG4gICAgICogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqL1xuICAgIGNvbnN0IGR5bmFtaWNNb2RlbCA9IG1vZGVsXG4gICAgY29uc3QgcGVuZGluZyA9IGR5bmFtaWNNb2RlbFtQRU5ESU5HX1RSQU5TSVRJT05fS0VZXVxuXG4gICAgaWYgKCFwZW5kaW5nKSB7XG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBjb25zdCBldmVudERlZiA9IGRlZmluaXRpb24uZXZlbnRzW3BlbmRpbmcuZXZlbnROYW1lXVxuXG4gICAgLy8gUnVuIGV2ZW50LWxldmVsIGJlZm9yZSBjYWxsYmFja1xuICAgIGlmIChldmVudERlZj8uYmVmb3JlKSB7XG4gICAgICBhd2FpdCBldmVudERlZi5iZWZvcmUobW9kZWwpXG4gICAgfVxuXG4gICAgLy8gUnVuIHRoZSBleGl0ZWQgc3RhdGUncyBiZWZvcmVFeGl0LCB0aGVuIHRoZSBlbnRlcmVkIHN0YXRlJ3MgYmVmb3JlRW50ZXJcbiAgICBjb25zdCBmcm9tU3RhdGVEZWZpbml0aW9uID0gZGVmaW5pdGlvbi5zdGF0ZXNbcGVuZGluZy5mcm9tXVxuXG4gICAgaWYgKGZyb21TdGF0ZURlZmluaXRpb24/LmJlZm9yZUV4aXQpIHtcbiAgICAgIGF3YWl0IGZyb21TdGF0ZURlZmluaXRpb24uYmVmb3JlRXhpdChtb2RlbClcbiAgICB9XG5cbiAgICBjb25zdCBzdGF0ZURlZmluaXRpb24gPSBkZWZpbml0aW9uLnN0YXRlc1twZW5kaW5nLnRvXVxuXG4gICAgaWYgKHN0YXRlRGVmaW5pdGlvbj8uYmVmb3JlRW50ZXIpIHtcbiAgICAgIGF3YWl0IHN0YXRlRGVmaW5pdGlvbi5iZWZvcmVFbnRlcihtb2RlbClcbiAgICB9XG4gIH0pXG5cbiAgLy8gUmVnaXN0ZXIgYW4gYWZ0ZXJTYXZlIGNhbGxiYWNrIGZvciBhZnRlckVudGVyIGhvb2tzXG4gIE1vZGVsQ2xhc3MuYWZ0ZXJTYXZlKGFzeW5jIGZ1bmN0aW9uIChtb2RlbCkge1xuICAgIC8qKlxuICAgICAqIER5bmFtaWMgbW9kZWwuXG4gICAgICogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqL1xuICAgIGNvbnN0IGR5bmFtaWNNb2RlbCA9IG1vZGVsXG4gICAgY29uc3QgcGVuZGluZyA9IGR5bmFtaWNNb2RlbFtQRU5ESU5HX1RSQU5TSVRJT05fS0VZXVxuXG4gICAgaWYgKCFwZW5kaW5nKSB7XG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICAvLyBDbGVhciB0aGUgcGVuZGluZyB0cmFuc2l0aW9uIG5vdyB0aGF0IHNhdmUgaXMgY29tcGxldGVcbiAgICBkeW5hbWljTW9kZWxbUEVORElOR19UUkFOU0lUSU9OX0tFWV0gPSBudWxsXG5cbiAgICAvLyBSdW4gdGhlIGVudGVyZWQgc3RhdGUncyBhZnRlckVudGVyLCB0aGVuIHRoZSBleGl0ZWQgc3RhdGUncyBhZnRlckV4aXRcbiAgICBjb25zdCBzdGF0ZURlZmluaXRpb24gPSBkZWZpbml0aW9uLnN0YXRlc1twZW5kaW5nLnRvXVxuXG4gICAgaWYgKHN0YXRlRGVmaW5pdGlvbj8uYWZ0ZXJFbnRlcikge1xuICAgICAgYXdhaXQgc3RhdGVEZWZpbml0aW9uLmFmdGVyRW50ZXIobW9kZWwpXG4gICAgfVxuXG4gICAgY29uc3QgZnJvbVN0YXRlRGVmaW5pdGlvbiA9IGRlZmluaXRpb24uc3RhdGVzW3BlbmRpbmcuZnJvbV1cblxuICAgIGlmIChmcm9tU3RhdGVEZWZpbml0aW9uPy5hZnRlckV4aXQpIHtcbiAgICAgIGF3YWl0IGZyb21TdGF0ZURlZmluaXRpb24uYWZ0ZXJFeGl0KG1vZGVsKVxuICAgIH1cblxuICAgIC8vIFJ1biBldmVudC1sZXZlbCBhZnRlciBjYWxsYmFja1xuICAgIGNvbnN0IGV2ZW50RGVmID0gZGVmaW5pdGlvbi5ldmVudHNbcGVuZGluZy5ldmVudE5hbWVdXG5cbiAgICBpZiAoZXZlbnREZWY/LmFmdGVyKSB7XG4gICAgICBhd2FpdCBldmVudERlZi5hZnRlcihtb2RlbClcbiAgICB9XG4gIH0pXG59XG5cbi8qKlxuICogUmV0dXJucyB0aGUgc2V0dGVyIG1ldGhvZCBuYW1lIGZvciBhIGNvbHVtbiAoZS5nLiwgXCJzdGF0dXNcIiDihpIgXCJzZXRTdGF0dXNcIiwgXCJzdGF0ZVwiIOKGkiBcInNldFN0YXRlXCIpLlxuICogQHBhcmFtIHtzdHJpbmd9IGNvbHVtbiAtIFRoZSBjb2x1bW4gbmFtZS5cbiAqIEByZXR1cm5zIHtzdHJpbmd9IC0gVGhlIHNldHRlciBtZXRob2QgbmFtZS5cbiAqL1xuZnVuY3Rpb24gY29sdW1uU2V0dGVyTmFtZShjb2x1bW4pIHtcbiAgcmV0dXJuIGBzZXQke2NvbHVtbi5jaGFyQXQoMCkudG9VcHBlckNhc2UoKX0ke2NvbHVtbi5zbGljZSgxKX1gXG59XG4iXX0=