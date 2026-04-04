# State Machine

Velocious includes a declarative state machine module for models. It covers the same patterns as Ruby's AASM and state_machine gems.

## Setup

```js
import {stateMachine} from "velocious/build/src/database/record/state-machine.js"

class Build extends BuildBase {}

stateMachine(Build, {
  column: "status",   // defaults to "state"
  initial: "new",
  states: {
    new: {},
    queued: {
      beforeEnter: (build) => { build.setQueuedAt(new Date()) }
    },
    running: {
      beforeEnter: (build) => { build.setStartedAt(new Date()) }
    },
    failed: {
      beforeEnter: (build) => { build.setEndedAt(new Date()) },
      afterEnter: (build) => { console.log("Build failed:", build.id()) }
    },
    succeeded: {
      beforeEnter: (build) => { build.setEndedAt(new Date()) }
    }
  },
  events: {
    queue: {from: "new", to: "queued"},
    run: {from: ["new", "queued", "crashed"], to: "running"},
    fail: {from: ["new", "queued", "running"], to: "failed"},
    succeed: {from: "running", to: "succeeded"},
    cancel: {
      from: ["new", "queued", "running"],
      to: "cancelled",
      guard: (build) => !build.isNewRecord()
    }
  }
})
```

## What gets registered

The `stateMachine()` call adds the following to the model class:

### Instance methods (per event)

| Method | Description |
|--------|-------------|
| `build.queue()` | Sets the state column to `"queued"`. Does not save. |
| `build.queueAndSave()` | Sets the state and persists. Supports async guards. |
| `build.canQueue()` | Returns `true` if the current state allows the transition. |
| `build.canQueueAsync()` | Async version of `canQueue()` for async guards. |

Every event in the definition gets its own set of these four methods.

### Static methods

| Method | Description |
|--------|-------------|
| `Build.getStateMachineDefinition()` | Returns the full definition object. |
| `Build.getStateMachineColumn()` | Returns the column name (e.g., `"status"`). |
| `Build.getStateMachineStateNames()` | Returns all declared state names as an array. |

## States

Each state can have optional callbacks:

```js
states: {
  running: {
    beforeEnter: async (model) => { /* runs in beforeSave when entering this state */ },
    afterEnter: async (model) => { /* runs in afterSave when entering this state */ }
  }
}
```

- `beforeEnter` fires during the Velocious `beforeSave` lifecycle, before the record is persisted. Good for setting timestamps, validating preconditions, or modifying attributes.
- `afterEnter` fires during the Velocious `afterSave` lifecycle, after the record is persisted. Good for side effects like sending notifications, queuing jobs, or pushing status updates.

## Events

Each event defines a transition:

```js
events: {
  queue: {from: "new", to: "queued"},
  run: {from: ["new", "queued", "crashed"], to: "running"},
  cancel: {
    from: ["new", "queued", "running"],
    to: "cancelled",
    guard: (build) => !build.isNewRecord(),
    before: (build) => { build.setCancelledAt(new Date()) },
    after: (build) => { console.log("Build cancelled") }
  }
}
```

| Property | Required | Description |
|----------|----------|-------------|
| `from` | Yes | Source state or array of source states. |
| `to` | Yes | Target state. |
| `guard` | No | Predicate function. If it returns `false`, the transition is rejected. |
| `before` | No | Runs during `beforeSave`, after the guard passes. |
| `after` | No | Runs during `afterSave`, after the record is persisted. |

### Multiple source states

Pass an array to `from` when an event can fire from several states:

```js
fail: {from: ["new", "queued", "running"], to: "failed"}
```

### Guards

Guards prevent transitions when a condition is not met:

```js
cancel: {
  from: ["new", "queued", "running"],
  to: "cancelled",
  guard: (build) => !build.isNewRecord()
}
```

- In `build.cancel()`: the guard is evaluated synchronously. If it returns `false`, the method throws and the state is **not** mutated.
- In `build.canCancel()`: the guard is evaluated and the result is returned as a boolean.
- In `build.cancelAndSave()`: the guard is evaluated asynchronously before mutating state.
- Async guards (returning a Promise) must use `canCancelAsync()` or `cancelAndSave()` — calling `cancel()` or `canCancel()` with an async guard throws.

## Callback execution order

When `build.queueAndSave()` is called:

1. Event `guard` is evaluated (rejects before any mutation)
2. State column is set on the in-memory model
3. **beforeSave** lifecycle:
   - Event `before` callback
   - State `beforeEnter` callback
4. Record is persisted to the database
5. **afterSave** lifecycle:
   - State `afterEnter` callback
   - Event `after` callback

## Transition tracking

The state machine tracks which event was invoked on the model instance. This means:

- Multiple events can share the same `from → to` edge with different callbacks, and the correct event's callbacks fire.
- The `afterSave` hooks work correctly even though Velocious clears `model.changes()` before `afterSave` runs — the transition info is stashed independently.

## Column configuration

The `column` option defaults to `"state"`. Override it for models that use a different column name:

```js
stateMachine(Build, {
  column: "status",
  // ...
})
```

The state machine calls the model's setter method by convention: column `"status"` calls `setStatus()`, column `"state"` calls `setState()`.

## Error handling

| Scenario | Error |
|----------|-------|
| Transition from invalid state | `Cannot transition "queue" from "failed" on Build. Allowed source states: new` |
| Guard rejects | `Guard rejected transition "cancel" from "new" on Build.` |
| Async guard in sync method | `Guard for event "cancel" returned a Promise. Use await model.cancelAndSave() for async guards.` |

## Introspection

```js
const definition = Build.getStateMachineDefinition()

console.log(definition.initial)          // "new"
console.log(definition.states)           // {new: {}, queued: {...}, ...}
console.log(definition.events)           // {queue: {...}, run: {...}, ...}
console.log(Build.getStateMachineColumn())     // "status"
console.log(Build.getStateMachineStateNames()) // ["new", "queued", "running", ...]
```

## Comparison with Ruby gems

| Ruby (AASM / state_machine) | Velocious |
|------------------------------|-----------|
| `aasm do; state :new, initial: true; end` | `states: {new: {}}, initial: "new"` |
| `state :queued, before_enter: :set_queued_at` | `states: {queued: {beforeEnter: (m) => m.setQueuedAt(new Date())}}` |
| `event :queue do; transitions from: :new, to: :queued; end` | `events: {queue: {from: "new", to: "queued"}}` |
| `before_transition any => :failed, :set_ended_at` | `events: {fail: {before: (m) => m.setEndedAt(new Date()), ...}}` |
| `after_transition any => :succeeded, :push_status` | `events: {succeed: {after: (m) => pushStatus(m), ...}}` |
| `build.may_queue?` | `build.canQueue()` |
| `build.queue!` | `build.queue()` (set only) or `build.queueAndSave()` (set + persist) |
| Transition guard | `events: {cancel: {guard: (m) => !m.isNewRecord(), ...}}` |
