// @ts-check

/**
 * @typedef {{
 *   column?: string,
 *   initial: string,
 *   states: Record<string, StateDefinition>,
 *   events: Record<string, EventDefinition>
 * }} StateMachineDefinition
 *
 * @typedef {{
 *   beforeEnter?: (model: import("./index.js").default) => void | Promise<void>,
 *   afterEnter?: (model: import("./index.js").default) => void | Promise<void>
 * }} StateDefinition
 *
 * @typedef {{
 *   from: string | string[],
 *   to: string,
 *   guard?: (model: import("./index.js").default) => boolean | Promise<boolean>,
 *   before?: (model: import("./index.js").default) => void | Promise<void>,
 *   after?: (model: import("./index.js").default) => void | Promise<void>
 * }} EventDefinition
 */

/** @type {string} */
const PENDING_TRANSITION_KEY = "_stateMachinePendingTransition"

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
 *
 * @param {typeof import("./index.js").default} ModelClass - The model class to add state machine behavior to.
 * @param {StateMachineDefinition} definition - The state machine definition.
 * @returns {void}
 */
export function stateMachine(ModelClass, definition) {
  const column = definition.column || "state"
  const stateNames = Object.keys(definition.states)

  // Store definition on the model class for introspection
  /** @type {any} */
  const dynamicClass = ModelClass

  dynamicClass._stateMachineDefinition = definition
  dynamicClass._stateMachineColumn = column

  /** @returns {StateMachineDefinition} - The registered state machine definition. */
  dynamicClass.getStateMachineDefinition = function () {
    return dynamicClass._stateMachineDefinition
  }

  /** @returns {string} - The column name used for state storage. */
  dynamicClass.getStateMachineColumn = function () {
    return dynamicClass._stateMachineColumn
  }

  /** @returns {string[]} - All declared state names. */
  dynamicClass.getStateMachineStateNames = function () {
    return stateNames
  }

  // Register event methods and guard methods on the prototype
  /** @type {any} */
  const proto = ModelClass.prototype

  for (const [eventName, eventDef] of Object.entries(definition.events)) {
    const fromStates = Array.isArray(eventDef.from) ? eventDef.from : [eventDef.from]
    const capitalizedEvent = eventName.charAt(0).toUpperCase() + eventName.slice(1)
    const canMethodName = `can${capitalizedEvent}`
    const setterName = columnSetterName(column)

    // Guard method: canQueue(), canRun(), etc.
    proto[canMethodName] = function () {
      const currentState = this.readAttribute(column)

      if (!fromStates.includes(currentState)) {
        return false
      }

      if (eventDef.guard) {
        const guardResult = eventDef.guard(this)

        if (guardResult instanceof Promise) {
          throw new Error(`Guard for event "${eventName}" returned a Promise. Use await model.can${capitalizedEvent}Async() instead.`)
        }

        return guardResult
      }

      return true
    }

    // Async guard method: canQueueAsync(), canRunAsync(), etc.
    proto[`${canMethodName}Async`] = async function () {
      const currentState = this.readAttribute(column)

      if (!fromStates.includes(currentState)) {
        return false
      }

      if (eventDef.guard) {
        return await eventDef.guard(this)
      }

      return true
    }

    // Transition method: queue(), run(), etc. — checks guard, sets the state, stashes event name
    proto[eventName] = function () {
      /** @type {any} */
      const self = this
      const currentState = self.readAttribute(column)

      if (!fromStates.includes(currentState)) {
        throw new Error(
          `Cannot transition "${eventName}" from "${currentState}" on ${self.getModelClass().name}. ` +
          `Allowed source states: ${fromStates.join(", ")}`
        )
      }

      // Enforce synchronous guard before mutating state
      if (eventDef.guard) {
        const guardResult = eventDef.guard(self)

        if (guardResult instanceof Promise) {
          throw new Error(`Guard for event "${eventName}" returned a Promise. Use await model.${eventName}AndSave() for async guards.`)
        }

        if (!guardResult) {
          throw new Error(
            `Guard rejected transition "${eventName}" from "${currentState}" on ${self.getModelClass().name}.`
          )
        }
      }

      // Stash the transition so beforeSave/afterSave know which event was invoked
      self[PENDING_TRANSITION_KEY] = {eventName, from: currentState, to: eventDef.to}
      self[setterName](eventDef.to)
    }

    // Bang method: queueAndSave(), runAndSave(), etc. — transitions AND saves (supports async guards)
    proto[`${eventName}AndSave`] = async function () {
      /** @type {any} */
      const self = this
      const currentState = self.readAttribute(column)

      if (!fromStates.includes(currentState)) {
        throw new Error(
          `Cannot transition "${eventName}" from "${currentState}" on ${self.getModelClass().name}. ` +
          `Allowed source states: ${fromStates.join(", ")}`
        )
      }

      // Enforce async guard before mutating state
      if (eventDef.guard) {
        const allowed = await eventDef.guard(self)

        if (!allowed) {
          throw new Error(
            `Guard rejected transition "${eventName}" from "${currentState}" on ${self.getModelClass().name}.`
          )
        }
      }

      self[PENDING_TRANSITION_KEY] = {eventName, from: currentState, to: eventDef.to}
      self[setterName](eventDef.to)
      await self.save()
    }
  }

  // Register a beforeSave callback that fires state-enter hooks
  ModelClass.beforeSave(async function (model) {
    /** @type {any} */
    const dynamicModel = model
    const pending = dynamicModel[PENDING_TRANSITION_KEY]

    if (!pending) {
      return
    }

    const eventDef = definition.events[pending.eventName]

    // Run event-level before callback
    if (eventDef?.before) {
      await eventDef.before(model)
    }

    // Run state-level beforeEnter callback
    const stateDefinition = definition.states[pending.to]

    if (stateDefinition?.beforeEnter) {
      await stateDefinition.beforeEnter(model)
    }
  })

  // Register an afterSave callback for afterEnter hooks
  ModelClass.afterSave(async function (model) {
    /** @type {any} */
    const dynamicModel = model
    const pending = dynamicModel[PENDING_TRANSITION_KEY]

    if (!pending) {
      return
    }

    // Clear the pending transition now that save is complete
    dynamicModel[PENDING_TRANSITION_KEY] = null

    // Run state-level afterEnter callback
    const stateDefinition = definition.states[pending.to]

    if (stateDefinition?.afterEnter) {
      await stateDefinition.afterEnter(model)
    }

    // Run event-level after callback
    const eventDef = definition.events[pending.eventName]

    if (eventDef?.after) {
      await eventDef.after(model)
    }
  })
}

/**
 * Returns the setter method name for a column (e.g., "status" → "setStatus", "state" → "setState").
 * @param {string} column - The column name.
 * @returns {string} - The setter method name.
 */
function columnSetterName(column) {
  return `set${column.charAt(0).toUpperCase()}${column.slice(1)}`
}
