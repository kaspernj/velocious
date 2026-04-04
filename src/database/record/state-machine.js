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
 * This adds to the model class:
 * - Instance methods for each event: `queue()`, `run()`, `fail()`, etc. — these set the state column
 * - Guard methods: `canQueue()`, `canRun()`, `canFail()`, etc. — return boolean
 * - A beforeSave callback that runs beforeEnter/afterEnter hooks on state transitions
 * - Static `getStateMachineDefinition()` for introspection
 *
 * @param {typeof import("./index.js").default} ModelClass
 * @param {StateMachineDefinition} definition
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

  /** @returns {StateMachineDefinition} */
  dynamicClass.getStateMachineDefinition = function () {
    return dynamicClass._stateMachineDefinition
  }

  /** @returns {string} */
  dynamicClass.getStateMachineColumn = function () {
    return dynamicClass._stateMachineColumn
  }

  /** @returns {string[]} */
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

      // Synchronous guard check — if async guard, use canTransitionToAsync instead
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

    // Transition method: queue(), run(), etc. — sets the state but does NOT save
    proto[eventName] = function () {
      const currentState = this.readAttribute(column)

      if (!fromStates.includes(currentState)) {
        throw new Error(
          `Cannot transition "${eventName}" from "${currentState}" on ${this.getModelClass().name}. ` +
          `Allowed source states: ${fromStates.join(", ")}`
        )
      }

      /** @type {any} */ (this)[setterName](eventDef.to)
    }

    // Bang method: queueAndSave(), runAndSave(), etc. — transitions AND saves
    proto[`${eventName}AndSave`] = async function () {
      /** @type {any} */ (this)[eventName]()
      await this.save()
    }
  }

  // Register a beforeSave callback that fires state-enter hooks
  ModelClass.beforeSave(async function (model) {
    const changes = model.changes()
    const stateChange = changes[column]

    if (!stateChange) {
      return
    }

    const [previousState, newState] = stateChange

    // Find which event triggered this transition (if any)
    const matchingEvent = findMatchingEvent(definition, previousState, newState)

    // Run event-level before callback
    if (matchingEvent?.before) {
      await matchingEvent.before(model)
    }

    // Run event-level guard (async-safe in beforeSave)
    if (matchingEvent?.guard) {
      const allowed = await matchingEvent.guard(model)

      if (!allowed) {
        throw new Error(
          `Guard rejected transition from "${previousState}" to "${newState}" on ${model.getModelClass().name}.`
        )
      }
    }

    // Run state-level beforeEnter callback
    const stateDefinition = definition.states[newState]

    if (stateDefinition?.beforeEnter) {
      await stateDefinition.beforeEnter(model)
    }
  })

  // Register an afterSave callback for afterEnter hooks
  ModelClass.afterSave(async function (model) {
    const changes = model.changes()
    const stateChange = changes[column]

    if (!stateChange) {
      return
    }

    const [previousState, newState] = stateChange

    // Run state-level afterEnter callback
    const stateDefinition = definition.states[newState]

    if (stateDefinition?.afterEnter) {
      await stateDefinition.afterEnter(model)
    }

    // Run event-level after callback
    const matchingEvent = findMatchingEvent(definition, previousState, newState)

    if (matchingEvent?.after) {
      await matchingEvent.after(model)
    }
  })
}

/**
 * Finds the event definition that matches a state transition.
 * @param {StateMachineDefinition} definition
 * @param {string} fromState
 * @param {string} toState
 * @returns {EventDefinition | null}
 */
function findMatchingEvent(definition, fromState, toState) {
  for (const eventDef of Object.values(definition.events)) {
    const fromStates = Array.isArray(eventDef.from) ? eventDef.from : [eventDef.from]

    if (eventDef.to === toState && fromStates.includes(fromState)) {
      return eventDef
    }
  }

  return null
}

/**
 * Returns the setter method name for a column (e.g., "status" → "setStatus", "state" → "setState").
 * @param {string} column
 * @returns {string}
 */
function columnSetterName(column) {
  return `set${column.charAt(0).toUpperCase()}${column.slice(1)}`
}
