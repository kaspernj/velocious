export type StateMachineDefinition = {
    column?: string;
    initial: string;
    states: Record<string, StateDefinition>;
    events: Record<string, EventDefinition>;
};
export type StateDefinition = {
    beforeEnter?: (model: import("./index.js").default) => void | Promise<void>;
    afterEnter?: (model: import("./index.js").default) => void | Promise<void>;
    beforeExit?: (model: import("./index.js").default) => void | Promise<void>;
    afterExit?: (model: import("./index.js").default) => void | Promise<void>;
};
export type EventDefinition = {
    from: string | string[];
    to: string;
    guard?: (model: import("./index.js").default) => boolean | Promise<boolean>;
    before?: (model: import("./index.js").default) => void | Promise<void>;
    after?: (model: import("./index.js").default) => void | Promise<void>;
};
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
export declare function stateMachine(ModelClass: typeof import("./index.js").default, definition: StateMachineDefinition): void;
//# sourceMappingURL=state-machine.d.ts.map