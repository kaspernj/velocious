# Factories

Velocious ships a first-class, async-aware test-data **Factory** framework inspired by
[factory_bot](https://github.com/thoughtbot/factory_bot) but built around explicit
JavaScript APIs and native Velocious model construction/persistence. It gives you named
factories, literal/lazy/dependent attributes, traits, sequences, inheritance, aliases,
associations, callbacks, transient attributes, `build`/`create`/`attributesFor`
strategies, list/pair helpers, and linting.

The public name is **`Factory`** (not `FactoryBot`): it communicates the inspiration
without claiming Ruby API compatibility. See the
[FactoryBot compatibility](#factorybot-compatibility) table for the exact differences.

## Importing

The browser/Metro-safe core lives at `velocious/src/testing/factory/index.js`:

```js
import Factory, {createFactoryRegistry} from "velocious/src/testing/factory/index.js"
```

- `Factory` is a convenient default singleton registry.
- `createFactoryRegistry()` returns a fresh, isolated registry that shares no state with
  the singleton (use it for libraries or spec groups that must not leak global factory
  state).

Node-only definition loading (filesystem discovery + dynamic import) is kept out of the
browser-safe core in a separate module:

```js
import {loadDefinitions, reloadDefinitions} from "velocious/src/testing/factory/node/load-definitions.js"
```

Never import `node/load-definitions.js` from browser/Metro bundles; static-import your
definition files there instead.

## Defining factories

```js
import Factory from "velocious/src/testing/factory/index.js"
import Project from "../models/project.js"
import Task from "../models/task.js"
import User from "../models/user.js"

Factory.define(({factory, sequence, trait}) => {
  sequence("userEmail", ({value}) => `user${value}@example.com`)
  sequence("projectName", ({value}) => `Project ${value}`)

  trait("archived", ({attribute}) => {
    attribute("archivedAt", () => new Date())
  })

  factory("user", User, ({attribute}) => {
    attribute("email", ({generate}) => generate("userEmail"))
    attribute("encryptedPassword", "test-encrypted-password")
  })

  factory("project", Project, ({after, attribute, transient}) => {
    attribute("name", ({generate}) => generate("projectName"))
    transient("tasksCount", 0)

    after("create", async ({context, record}) => {
      await Factory.createList("task", context.tasksCount, {project: record})
    })
  })

  factory("task", Task, ({association, attribute}) => {
    attribute("name", "Test task")
    association("project")
  })
})
```

The `define` builder exposes `factory`, `trait`, `sequence`, `before`, `after`,
`initializeWith`, `toCreate`, and `skipCreate` (the last five are registry-level defaults).

### Factory declarations

Inside `factory(name, ModelClass, (builder) => {…})` the builder exposes:

| Method | Purpose |
| --- | --- |
| `attribute(name, value)` | A literal (or, if a function, lazy) attribute. |
| `transient(name, value)` | A transient value — available to dependencies/callbacks but never assigned to the record or returned by `attributesFor`. |
| `association(name, ...traits, options?)` | A declared association (see [Associations](#associations)). |
| `before(phase, fn)` / `after(phase, fn)` | Lifecycle callbacks (`phase` is `all`, `build`, or `create`). |
| `initializeWith(fn)` | Custom constructor. |
| `toCreate(fn)` | Custom persistence. |
| `skipCreate()` | Disable persistence for `create`. |
| `sequence(name, …)` | A factory-scoped sequence. |
| `trait(name, fn?)` | With a function: define a factory-local trait. Without: include a base trait. |
| `factory(name, options?, fn)` | A nested child factory (inherits this factory's model/declarations). |

### Model class, parent, aliases and base traits

The second argument is either a model class or an options object:

```js
// Explicit model class:
factory("user", User, ({attribute}) => { /* … */ })

// Options object — inheritance, aliases and default (base) traits:
factory("adminUser", {parent: "user", aliases: ["administrator"], traits: ["archived"]}, ({attribute}) => {
  attribute("admin", true)
})
```

- `parent` — inherit another factory's model and declarations. Child declarations win.
- `model` / `class` — the model class (when using the options form).
- `aliases` — additional names that reference the same immutable definition.
- `traits` — base traits applied to every run of this factory.

Compilation is lazy, so a child factory may be declared **before** its parent.

### Literal, lazy and dependent attributes

Unlike factory_bot, Velocious intentionally accepts a **literal** value in
`attribute(name, value)` as a JavaScript ergonomic. A **function** is the lazy form and
receives a named evaluator context:

```js
factory("project", Project, ({attribute}) => {
  attribute("name", "Static name")                       // literal
  attribute("slug", ({get}) => slugify(get("name")))     // lazy + dependent (get returns a Promise)
  attribute("code", ({generate}) => generate("projectCode")) // sequence
  attribute("owner", ({association}) => association("user")) // explicit association
})
```

The evaluator context exposes only named methods (no Proxy / `method_missing`):

- `get(attributeName)` — resolves another attribute/transient lazily (returns a Promise).
- `generate(sequenceName)` — advances a sequence (returns a Promise).
- `association(factoryName, ...traitsAndOverrides)` — evaluates another factory.

All lazy functions and callbacks may return Promises. Lazy values (including `false`,
`null`, and in-flight Promises) are memoized exactly once per run.

## Strategies

Every strategy returns a Promise, even when all attributes are synchronous. Invocation is
`strategy(factoryName, ...traitNames, overrides?)` — the final plain object is always the
overrides.

```js
const builtProject = await Factory.build("project")                 // constructs, persists nothing
const savedProject = await Factory.create("project", "archived", {tasksCount: 3}) // constructs + saves
const attributes  = await Factory.attributesFor("project", {name: "Explicit"})    // plain attribute object

const tasks = await Factory.createList("task", 3, {project: savedProject})
const pair  = await Factory.buildPair("task")
const rows  = await Factory.attributesForList("project", 5)
```

- **`build`** constructs the model with `new ModelClass(attributes)` and recursively builds
  associated models, but persists nothing.
- **`create`** builds the graph, wires associations through relationship reflection and
  generated public setters, then saves the root record. Velocious's native autosave
  persists loaded `belongsTo` records before the root and loaded `hasOne`/`hasMany` records
  afterwards. Factory code never writes foreign keys or touches private relationship caches.
- **`attributesFor`** resolves scalar/lazy attributes (and any transients they depend on)
  but **omits transients and declared associations**, and never initializes the model,
  runs lifecycle callbacks, or builds associations.

List creation is deterministic and sequential. To run independent singular calls
concurrently, call them yourself with `Promise.all`.

## Associations

```js
factory("task", Task, ({association, attribute}) => {
  attribute("name", "A task")
  association("project")                                  // runs the "project" factory
  association("reviewer", {factory: "user", strategy: "build"}) // explicit factory + strategy
  association("owner", "archived", {name: "Owner project"})     // traits + overrides
})
```

- The association factory name defaults to the relationship name; override it with
  `{factory: "…"}`.
- Association strategy follows the **parent strategy** by default (`build` → build,
  `create` → create), or set `{strategy: "build" | "create"}` explicitly.
- An explicit **object or `null` override** suppresses nested factory execution and is
  assigned directly, e.g. `Factory.create("task", {project: existingProject})` reuses the
  passed record and `{project: null}` clears it. Custom foreign/primary keys, scoped, and
  `belongsTo`/`hasOne`/`hasMany` relationships are wired through relationship reflection —
  never guessed names like `projectId`.
- Only **declared** associations are constructed; the factory never fabricates
  required-looking relationships. Polymorphic/through relationships that can't be resolved
  safely require explicit factory/class information.

## Transient attributes

Transient values participate in dependent attributes, associations, callbacks, and
`toCreate`, but are never assigned to the record or returned by `attributesFor`:

```js
factory("project", Project, ({after, attribute, transient}) => {
  attribute("name", "Project")
  transient("tasksCount", 0)

  after("create", async ({context, record}) => {
    // Evaluated transients are exposed as plain properties on the callback context.
    await Factory.createList("task", context.tasksCount, {project: record})
  })
})
```

## Callbacks

Supported events: `beforeAll`, `beforeBuild`, `afterBuild`, `beforeCreate`, `afterCreate`,
`afterAll`. Declare them as `before(phase, fn)` / `after(phase, fn)` where `phase` is
`all`, `build`, or `create`. Each callback receives `{record, context, strategy}`; the
`context` exposes evaluated transients as plain properties plus `get`/`generate`/
`association`.

**Ordering** (normative): global registry defaults, inherited parent(s) oldest-first, the
factory itself, then requested traits in call order — preserving declaration order within
each level. The **same** callback declaration reached repeatedly through composed/aliased
traits runs **once** per record; independently declared callbacks all run.

**`afterAll` is a deliberate safety improvement over factory_bot:** Velocious always runs
it as cleanup in a `finally`, even when evaluation, a callback, construction, or persistence
fails. When both the body and the `afterAll` cleanup fail, the primary error is preserved
and the cleanup failure is attached on `error.factoryCleanupErrors` rather than masking the
original.

## Custom construction and persistence

```js
factory("user", User, ({attribute, initializeWith, toCreate, skipCreate}) => {
  attribute("email", "a@example.com")

  // Custom constructor. Attributes read via get(name) are "consumed" and are not
  // assigned a second time; the remaining public attributes are assigned afterwards.
  initializeWith(async ({get}) => new User({email: await get("email")}))

  // Custom persistence (receives the evaluator context). Replaces the default save().
  toCreate(async ({record}) => { await record.save() })

  // …or skip persistence entirely:
  // skipCreate()
})
```

Undeclared call-site override keys remain assignable when the model contract accepts them
(they flow through the model's normal setters).

## Sequences

Global and factory-scoped numeric sequences with optional aliases, custom initial values,
and sync/async formatters:

```js
Factory.define(({sequence}) => {
  sequence("counter")                                     // yields 1, 2, 3 …
  sequence("email", ({value}) => `user${value}@x.com`)    // formatted
  sequence("code", {initial: 1000, aliases: ["altCode"]}, ({value}) => value)
})

await Factory.generate("counter")       // 1
await Factory.generateList("counter", 3) // [2, 3, 4]
Factory.peekSequence("counter")          // next raw value, without consuming
Factory.setSequence("counter", 100)      // set the next value
Factory.rewindSequence("counter")        // reset one sequence to its initial value
Factory.rewindSequences()                // reset every sequence
```

- A sequence value is **allocated and consumed synchronously before** awaiting the
  formatter, so a rejected formatter still advances the counter and concurrent `Promise.all`
  allocation never yields duplicate values.
- Scope resolution: a factory-scoped sequence resolves before a global one of the same name.

## Modifying, resetting and loading

```js
Factory.modify(({factory}) => {
  factory("user", ({attribute}) => attribute("admin", true)) // recompiles immutably
})

Factory.reset()             // drop all factories, traits, sequences, callbacks, defaults
Factory.rewindSequences()   // reset only sequence counters, keeping definitions

// Node-only, opt-in loading:
await loadDefinitions(registry, "/abs/path/to/factories")   // directory, file, or list
await reloadDefinitions(registry, "/abs/path/to/factories") // reset + cache-busting re-import
```

Registry mutation (`define`, `modify`, `reset`, sequence `set`/`rewind`) is setup-time only
and is rejected with a `RegistryBusyError` while evaluations are active.

## Linting

```js
await Factory.lint()                                   // every factory, create strategy
await Factory.lint({factories: ["user", "project"]})   // a subset
await Factory.lint({traits: true})                     // also lint each factory's local traits
await Factory.lint({strategy: "build"})                // a different strategy
```

`lint` executes the selected factories/traits and throws a single aggregated
`FactoryLintError` listing every failing case. For the `create` strategy each case runs
inside the model's ambient `Model.transaction` and is rolled back, so no rows remain in the
supported single-connection case. External callback side effects are **not** reversible, and
one model transaction cannot make multi-database writes globally atomic.

## Debug events

```js
Factory.on("start",   ({invocationId, factory, strategy, traits}) => { /* … */ })
Factory.on("success", ({invocationId, factory, strategy, durationMs}) => { /* … */ })
Factory.on("failure", ({invocationId, factory, error}) => { /* … */ })
```

Events carry the factory name, strategy, requested traits, a per-invocation correlation id,
and (on completion) a duration. They deliberately never emit resolved attribute values,
which may contain secrets.

## Precedence

For attributes/associations the **last applicable declaration wins**, applied in this order:

1. global registry defaults
2. inherited parent factories, oldest first
3. base/configured traits at each level
4. the factory's own declarations
5. requested (invocation-time) traits, left to right
6. explicit call-site overrides (highest precedence)

An explicit override suppresses the original lazy thunk entirely, and an override for an
association or transient keeps that slot's nature (associations/transients stay omitted from
`attributesFor`).

## Concurrency

- Sequences allocate unique values even under `Promise.all`; the registry never promises
  which concurrent caller receives which number.
- Evaluations are isolated per run; lists are sequential by default.
- Registry mutation is setup-time only.
- Shared external side effects in callbacks remain the callback author's responsibility.
- Velocious deadlock/transaction retries may re-run user hooks, so keep callbacks
  idempotent. Tenant/configuration context is always ambient and is never cached by the
  registry.

## Browser and Node specs

Core factory modules are browser-safe (no Node built-ins, no raw `import.meta`, no
non-literal dynamic imports). Cover persistence/relationship behavior with real dummy-app
models in `*.browser-spec.js` files so they run across the supported database matrix in CI;
browser specs should static-import their factory definitions. Node-only conventional loading
lives in `node/load-definitions.js`.

## Migrating repeated `Model.create(...)` setup

Before:

```js
const user = await User.create({email: "a@example.com", encryptedPassword: "x"})
const project = await Project.create({name: "P", creatingUser: user})
const task = await Task.create({name: "T", project})
```

After:

```js
const task = await Factory.create("task") // builds user → project → task via the factory graph
```

Keep scenario-specific values explicit — pass them as overrides
(`Factory.create("task", {name: "A specific task"})`) rather than pushing every value into
the factory.

## FactoryBot compatibility

| Area | factory_bot (confirmed upstream) | Velocious `Factory` |
| --- | --- | --- |
| Attribute syntax | Lazy blocks only (`name { … }`) | Lazy functions **and** literal values (`attribute("name", "x")`) — a deliberate JS addition |
| DSL surface | Implicit method-name DSL / `method_missing` | Explicit builder methods; no Proxy |
| Strategies | `build`, `create`, `attributes_for`, `build_stubbed` | `build`, `create`, `attributesFor` (async); `buildStubbed` deferred |
| Association strategy | Follows parent strategy | Same; explicit `{strategy}` honored (no legacy `use_parent_strategy = false` mode) |
| `after_all` on failure | Skipped when a run raises | **Always** runs as `finally` cleanup; primary error preserved |
| Enum traits | Generated from ActiveRecord enums | Not supported (no portable enum metadata yet) |
| Definition loading | Rails path conventions + reload | Opt-in Node loader; browser definitions static-imported |
| Sequences | Numeric + custom iterators, URIs, rewind semantics | Numeric counters; aliases, generate/list/peek/set/rewind |
| Model classes | ActiveRecord | Initialized backend `DatabaseRecord` subclasses only; frontend models rejected in V1 |
| Persistence | ActiveRecord callbacks | Native Velocious `save()`; `ValidationError` propagates unchanged |
| Global state | Not thread-safe | Scoped per registry; sequence mutation serialized; setup mutation rejected during runs |

Deferred for later parity: `buildStubbed`, user-defined strategies, FactoryBot-style custom
callback names, enum-derived traits, and richer sequence sources.

See also: [Testing Guidelines](testing-guidelines.md), [Relationships](relationships.md),
[Model initialization](model-initialization.md).
