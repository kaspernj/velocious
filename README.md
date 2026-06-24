# README

* Concurrent multi threadded web server
* Database framework with familiar MVC concepts
* Database models with migrations and validations
* Database models that work almost the same in frontend and backend
* Declarative state machines for models (see [docs/state-machine.md](docs/state-machine.md))
* Migrations for schema changes and UTC datetime storage (see [docs/database-migrations.md](docs/database-migrations.md))
* Controllers and views for HTTP endpoints
* Frontend-model transport for creating, updating, querying, and subscribing to query-filtered lifecycle events over HTTP/WebSocket, with structured per-attribute validation error responses (see [docs/frontend-models.md](docs/frontend-models.md))
* Client-side offline sync mutation logs and frontend-model optimistic queueing primitives (see [docs/offline-sync.md](docs/offline-sync.md))
* Expo / Metro compatibility guidance and a real Expo export check (see [docs/expo-metro-compatibility.md](docs/expo-metro-compatibility.md))
* Gap-less positional lists with automatic reordering via `actsAsList` (see [docs/acts-as-list.md](docs/acts-as-list.md))
* Rails-style nested-attribute writes on frontend-model `save()` (see [docs/nested-attributes.md](docs/nested-attributes.md))
* Per-row association counts via `.withCount(...)` on frontend and backend queries (see [docs/with-count.md](docs/with-count.md))
* Consumer-defined per-row SQL aggregates/computations via `.queryData(...)` on frontend and backend queries (see [docs/query-data.md](docs/query-data.md))
* Per-record ability checks via `.abilities(...)` on frontend queries + `record.can(action)` (see [docs/abilities.md](docs/abilities.md))
* Translated model attributes with current-locale relationship sorting (see [docs/translations.md](docs/translations.md))
* Cross-process broadcast bus for `broadcastToChannel` via `velocious beacon`, including background job runner processes (see [docs/beacon.md](docs/beacon.md))
* Configurable HTTP server worker handlers for higher request and websocket throughput (see [docs/http-server.md](docs/http-server.md))
* Background jobs with failure events for production reporting (see [docs/background-jobs.md](docs/background-jobs.md))
* Rails-style request and database query logging (see [docs/logging.md](docs/logging.md))
* EJS-backed mailers with delivery, queueing, and payload rendering support (see [docs/mailers.md](docs/mailers.md))
* Trusted reverse proxy handling for `request.remoteAddress()` (see [docs/trusted-proxies.md](docs/trusted-proxies.md))
* In-process driver schema metadata caching (see [docs/schema-metadata-cache.md](docs/schema-metadata-cache.md))
* Named database connection checkouts, bounded pool waits, and debugging held connections (see [docs/database-connections.md](docs/database-connections.md))
* Optional built-in debug endpoint for inspecting server and database connection state (see [docs/debug-endpoint.md](docs/debug-endpoint.md))

# Setup

Make a new NPM project.
```bash
mkdir project
cd project
npm install velocious
npx velocious init
```

By default, Velocious looks for your configuration in `src/config/configuration.js`. If you keep the configuration elsewhere, make sure your app imports it early and calls `configuration.setCurrent()`.

# Development

When working on Velocious itself, npm scripts are cross-platform (Windows `cmd`/PowerShell and POSIX shells):

```bash
npm run build
npm run test
npm run test:expo
```

# Code quality (fallow)

[fallow](https://github.com/fallow-rs/fallow) analyzes the codebase for unused/dead code, duplication, and complexity. CI runs it as a **regression gate**: it fails only on findings beyond the committed baseline in `fallow-baselines/`, so existing backlog never blocks a PR but new issues do.

```bash
# Regression gate (what CI runs) — fails on new dead code / dupes / complexity beyond the baseline
npm run fallow

# Refresh the baseline after intentionally adding/removing code (commit the updated fallow-baselines/*.json)
npm run fallow:baseline
```

Baselines are generated against a fresh checkout (no generated dummy `configuration.js`), so the gate is deterministic in CI and locally. Tuning (entry points, ignores) lives in `.fallowrc.json`.

# Testing

Tag tests to filter runs.

```js
describe("Tasks", {tags: ["db"]}, () => {
  it("creates a task", {tags: ["fast"]}, async () => {})
})
```

```bash
# Only run tagged tests (focused tests still run)
npx velocious test --tag fast
npx velocious test --include-tag fast,api

# Exclude tagged tests (always wins)
npx velocious test --exclude-tag slow
```

Target a test by line number or description.

```bash
npx velocious test spec/path/to/test-spec.js:34
npx velocious test --example "filters on nested relationship attributes"
npx velocious test --example "/nested.*attributes/i"
npx velocious test --name "filters on nested relationship attributes"
```

Exclude tags via your testing config file.

```js
// src/config/testing.js
import {configureTests} from "velocious/build/src/testing/test.js"

export default async function configureTesting() {
  configureTests({excludeTags: ["mssql"]})
}
```

Retry flaky tests by setting a retry count on the test args.

```js
describe("Tasks", () => {
it("retries a flaky check", {retry: 2}, async () => {})
})
```

Velocious captures console output emitted while each test executes, but does not print passing-test output by default. When a test fails, Velocious prints a truncated `Console output:` block for that failed test and saves the full captured log under `tmp/screenshots` next to failure screenshots/browser logs/HTML. Each failed test summary prints the saved console log path.

Configure console output behavior in your testing config file.

```js
// src/config/testing.js
import {configureTests} from "velocious/build/src/testing/test.js"

export default async function configureTesting() {
  configureTests({
    consoleOutput: "failure", // default: print captured output only for failed tests
    failedConsoleOutputMaxLines: 200 // default: print the last 200 lines inline
  })
}
```

Use `consoleOutput: "live"` to preserve the previous passthrough behavior where test console output is printed while tests run.

Listen for attempt and retry events if you need to reset shared state after a failed attempt or log retry lifecycle details. `testAttemptFailed` fires after every failed attempt, including the final failed attempt when no retries remain. `testRetrying` only fires before a retry, and `testFailed` only fires after retries are exhausted.

```js
import {testEvents} from "velocious/build/src/testing/test.js"

testEvents.on("testAttemptFailed", async ({testDescription, attemptNumber, willRetry}) => {
  console.log(`Failed ${testDescription} attempt ${attemptNumber}`)

  if (willRetry) {
    await resetBrowserOrExternalServices()
  }
})

testEvents.on("testRetrying", ({testDescription, nextAttempt}) => {
  console.log(`Retrying ${testDescription} (attempt ${nextAttempt})`)
})

testEvents.on("testRetried", ({testDescription, attemptNumber}) => {
  console.log(`Retry attempt finished for ${testDescription} (attempt ${attemptNumber})`)
})
```

## Parallel test splitting

Split test files across parallel CI jobs using `--groups` and `--group-number`.

```bash
# Run group 1 of 4
npx velocious test --groups=4 --group-number=1

# Run group 2 of 4
npx velocious test --groups=4 --group-number=2

# Combine with tags
npx velocious test --groups=3 --group-number=1 --tag fast
```

Files are distributed using a greedy load-balancing algorithm. Each file is
weighted by its spec directory (`system/` = 20, `frontend-models/` = 10,
`controller/` = 3, default = 1) with a 2x multiplier for `.browser-spec.js`
files. The heaviest files are assigned first to the group with the least
accumulated weight, producing balanced wall-clock times across groups.

The algorithm is deterministic: the same file list always produces the same
group assignments.

## Browser system tests

Run browser compatibility tests via System Testing:

```bash
npm run test:browser
```

Browser system tests must be named `*.browser-test.js` or `*.browser-spec.js` (override with `VELOCIOUS_BROWSER_TEST_PATTERN`).

Use beforeAll/afterAll for suite-level setup/teardown.

```js
// src/config/testing.js
export default async function configureTesting() {
  beforeAll(async () => {
    // setup shared resources
  })

  afterAll(async () => {
    // teardown shared resources
  })
}
```

## Expectations

Common matchers:

```js
expect(value).toBeTruthy()
expect(value).toMatchObject({status: "success"})
expect({a: 1, b: 2}).toEqual(expect.objectContaining({a: 1}))
expect([1, 2, 3]).toEqual(expect.arrayContaining([2, 3]))
```

# Mailers

Mailers live under `src/mailers`, with a `mailer.js` and matching `.ejs` templates.

```js
import VelociousMailer, {deliveries, setDeliveryHandler} from "velocious/build/src/mailer.js"

class TasksMailer extends VelociousMailer {
  newNotification(task, user) {
    this.task = task
    this.user = user
    this.assignView({task, user})
    return this.mail({to: user.email(), subject: "New task"})
  }
}
```

Velocious infers the action name from the mailer action method when `this.mail(...)` is called from that method. Pass `actionName` explicitly when rendering a different action template or when a shared helper should override the inferred action.

```ejs
<b>Hello <%= mailer.user.name() %></b>
<p>
  Task <%= task.id() %> has just been created.
</p>
```

Deliver immediately or enqueue via background jobs:

```js
await new TasksMailer().newNotification(task, user).deliverNow()
await new TasksMailer().newNotification(task, user).deliverLater()
```

Build the rendered payload without sending when the app needs to store an audit copy or hand delivery to its own transport:

```js
const payload = await new TasksMailer().newNotification(task, user).buildPayload()
```

If your mailer needs async setup, keep the action sync and pass `actionPromise`:

```js
resetPassword(user) {
  return this.mail({
    to: user.email(),
    subject: "Reset your password",
    actionPromise: (async () => {
      this.token = await user.resetToken()
      this.assignView({user, token: this.token})
    })()
  })
}
```

Configure a delivery handler for non-test environments:

```js
setDeliveryHandler(async ({to, subject, html}) => {
  // send the email via your provider
})
```

Mailer backends can also be configured via your app configuration.

```js
import {SmtpMailerBackend} from "velocious/build/src/mailer.js"

export default new Configuration({
  mailerBackend: new SmtpMailerBackend({
    connectionOptions: {
      host: "smtp.example.com",
      port: 587,
      secure: false,
      auth: {user: "smtp-user", pass: "smtp-pass"}
    },
    defaultFrom: "no-reply@example.com"
  })
})
```

Install the SMTP peer dependency in your app:

```bash
npm install smtp-connection
```

When `connectionOptions.auth` is present, the SMTP backend authenticates before sending the message.

Test deliveries are stored in memory:

```js
const sent = deliveries()
```

# Translations

Velocious uses gettext-universal by default. Configure your locales and fallbacks in the app configuration:

```js
export default new Configuration({
  locale: () => "en",
  locales: ["en"],
  localeFallbacks: {en: ["en"]}
})
```

Load compiled translations for gettext-universal (for example, JS files generated from .po files):

```js
import gettextConfig from "gettext-universal/build/src/config.js"
import en from "./locales/en.js"

Object.assign(gettextConfig.getLocales(), {en})
```

Use translations in mailer views with `_`:

```ejs
<b><%= _("Hello %{userName}", {userName}) %></b>
```

If you want a different translation backend, set a custom translator:

```js
configuration.setTranslator((msgID, args) => {
  // return translated string
})
```

# Models

```bash
npx velocious g:model Account
npx velocious g:model Task
```

## Frontend models from backend resources

You can generate lightweight frontend model classes from resource definitions in your configuration.

```js
import FrontendModelBaseResource from "velocious/build/src/frontend-model-resource/base-resource.js"

class UserResource extends FrontendModelBaseResource {
  static resourceConfig() {
    return {
      attributes: ["id", "name", "email"],
      relationships: {
        projects: {type: "hasMany", model: "Project"}
      }
    }
  }
}

export default new Configuration({
  // ...
  backendProjects: [
    {
      path: "/path/to/backend-project",
      frontendModels: {
        User: UserResource
      }
    }
  ]
})
```

`frontendModels` entries must be `FrontendModelBaseResource` subclasses. Built-in CRUD/find/index/serialize behavior lives in the base class, and app resources override only the pieces they actually need.
Resource-level index customization should prefer `indexQuery()` or the pagination/search/sort hooks over replacing `records()`, so built-in pluck and aggregate count support can keep using the same query. See [`docs/frontend-model-resources.md`](docs/frontend-model-resources.md) for the resource extension points.

Custom class- and instance-level commands are declared via `collectionCommands` / `memberCommands`. Each entry is a plain camelCase method name, or a `{name, args?, returnType?}` object that types the command's arguments and response — e.g. `memberCommands: ["suspend", {name: "refresh", args: [{name: "age", type: "number"}], returnType: "string"}]`. Plain string commands derive args and return types from the backend resource method JSDoc; shared DTO `@import` types outside the backend `src` tree are preserved in generated frontend models, while backend-local helper types such as `ReturnType<typeof serializePayload>` are rejected. A command whose args are a single object literal with only optional fields generates an omittable parameter (`record.command()` works without passing `{}`); any required field keeps the argument mandatory. See [`docs/frontend-model-resources.md#custom-commands`](docs/frontend-model-resources.md#custom-commands).

Resources expose the full CRUD ability set (`create`, `destroy`, `read`, `update`) by default. To restrict the API surface — for example to a read-only resource — declare an explicit subset:

```js
class AuditLogResource extends FrontendModelBaseResource {
  static abilities = ["read"]
  static attributes = ["id", "message", "createdAt"]
}
```

Generate classes:

```bash
npx velocious g:frontend-models
```

Frontend-model attributes can usually be declared by name. The generator infers JSDoc typedefs and nullability from backend model columns and translated attribute columns. When an attribute entry needs resource-specific options such as `selectedByDefault: false`, keep only that option in the resource config, for example `{name: "archivedAt", selectedByDefault: false}`; the column type and nullability are still inferred. For computed resource attributes, add a typed `${attributeName}Attribute(model)` method with an `@returns` tag in the backend project's `src` tree. Resource attribute return types take precedence over column types because the resource method controls the serialized value. If Velocious cannot infer a read attribute from a column, generated model accessor, resource method JSDoc, or explicit metadata, generation fails with a clear error instead of emitting a broad fallback type.

This creates `src/frontend-models/user.js` (and one file per configured resource). Every generated file — the per-model files, `index.js`, and `setup.js` here, and the base-model files from `g:base-models` — starts with an auto-generated banner stating it must not be edited manually because changes are overwritten on the next regeneration, and naming the command that regenerates it. Apply changes at their source (resource/model definitions or the generator) and regenerate. Generated classes support:

- `await User.find(5)`
- `await User.findBy({email: "john@example.com"})`
- `await User.findByOrFail({email: "john@example.com"})`
- `await User.toArray()`
- `await User.create({name: "John"})`
- `await Task.sort("-createdAt").toArray()`
- `await Task.order("-createdAt").toArray()`
- `await Task.limit(10).offset(20).toArray()`
- `await Task.page(2).perPage(25).toArray()`
- `await Task.where({project: {creatingUser: {reference: "owner-b"}}}).toArray()`
- `await Task.joins({project: {creatingUser: true}}).where({project: {creatingUser: {reference: "owner-b"}}}).toArray()`
- `await Task.sort({project: {creatingUser: ["reference", "desc"]}}).toArray()`
- `await Task.sort({project: {account: [["name", "desc"], ["createdAt", "asc"]]}}).toArray()`
- `await Task.group({project: {account: ["id"]}}).toArray()`
- `await Task.sort({comments: ["body", "asc"]}).distinct().toArray()`
- `await Task.count()`
- `await Task.pluck("id")`
- `await Task.pluck({project: ["id"]})`
- `await User.preload({projects: ["tasks"]}).toArray()`
- `await Task.load()`
- `await Project`
  `.preload(["tasks"])`
  `.select({Project: ["id", "createdAt"], Task: ["updatedAt"]})`
  `.toArray()`
- `await user.update({...})`
- `await user.save()` (persists new records and updates existing records; also carries dirty nested children through the single request when the parent opts in — see [docs/nested-attributes.md](docs/nested-attributes.md))
- `await user.destroy()`
- `user.markForDestruction()` to queue a loaded child for destruction on the next parent save (see [docs/nested-attributes.md](docs/nested-attributes.md))
- State helpers like `user.isNewRecord()`, `user.isPersisted()`, `user.isChanged()`, and `user.changes()`
- Attribute methods like `user.name()` and `user.setName(...)`
- Relationship helpers (when `relationships` are configured), for example `task.project()`, `await task.projectOrLoad()`, `await project.tasks().toArray()`, `await project.tasks().load()`, and `project.tasks().build({...})`
- Preload relationships onto records you already have with `await record.preload(Model.preload({...}).select({...}))` (or `Preloader.preload(records, ...)` for arrays), including `selectsExtra(...)` and a `{force: true}` reload option — see [docs/frontend-models.md](docs/frontend-models.md#preloading-onto-loaded-records)
- Attachment helpers (when `attachments` are configured), for example `await task.descriptionFile().attach(file)`, `await task.descriptionFile().download()`, and `await task.update({descriptionFile: file})`

React components can subscribe to lifecycle broadcasts without manual cleanup code:

```js
import useModelClassEvent from "velocious/build/src/frontend-models/use-model-class-event.js"

useModelClassEvent(Subscription, ["create", "update"], () => {
  void loadSubscriptionStatus()
})
```

`useCreatedEvent`, `useUpdatedEvent`, and `useDestroyedEvent` are also available. `useUpdatedEvent` and `useDestroyedEvent` accept either a model class or model instance. Lifecycle subscriptions accept the same projection options as frontend-model queries for event records, including `select`, `preload`, `withCount`, `abilities`, and `queryData`.

Frontend-model `group(...)` is attribute/path based and does not accept raw SQL fragments. Use model/relationship shapes (for example `Task.group({project: {account: ["id"]}})`) so grouping resolves through known relationships and mapped columns.
Frontend-model `where(...)` supports nested relationship descriptors (for example `Task.where({project: {creatingUser: {reference: "owner-b"}}})`) and does not accept raw SQL fragments.
Frontend-model `joins(...)` supports relationship-object descriptors only (for example `Task.joins({project: {creatingUser: true}})`) and rejects raw SQL join strings.
Frontend-model `distinct(...)` only accepts booleans (`true` by default) and is applied server-side through the backend query API.
Frontend-model `pluck(...)` validates attribute/path descriptors against configured resource/model metadata and does not accept SQL fragments or hidden raw model columns when the resource declares an explicit attribute list.
Frontend-model query fields are limited to attributes exposed by the backend resource. Use `{name: "attributeName", selectedByDefault: false}` for fields that may be selected or filtered explicitly but should stay out of default payloads.

When backend payloads include `__preloadedRelationships`, nested frontend-model relationships are hydrated recursively. Relationship methods can use `getRelationshipByName("relationship").loaded()` and will throw when a relationship was not preloaded.

When queries include `select(...)`, backend frontend-model actions only serialize selected attributes for each model class. Reading a non-selected attribute on a frontend model raises `AttributeNotSelectedError`.

You do not need to manually define `frontend-index` / `frontend-find` / `frontend-create` / `frontend-update` / `frontend-destroy` routes for those resources. Velocious can auto-resolve frontend model command paths from `backendProjects.frontendModels`.

For backend models, you can declare attachment helpers directly:

```js
Task.hasManyAttachments("files")
Task.hasOneAttachment("descriptionFile")
Task.hasOneAttachment("archivedPdf", {driver: "s3"})
```

You can also pass a driver class or instance directly on the attachment:

```js
import NativeDriver from "./storage/native-driver.js"

Task.hasOneAttachment("mobileCache", {driver: NativeDriver})
// or:
Task.hasOneAttachment("mobileCache", {driver: new NativeDriver()})
```

Then use them from backend records:

```js
await task.descriptionFile().attach({
  content: "my file content",
  filename: "file.doc"
})
const descriptionFileUrl = await task.descriptionFile().url()
await task.update({
  descriptionFile: {
    contentBase64: Buffer.from("my file content").toString("base64"),
    filename: "my-doc.doc"
  }
})
```

Configure attachment storage drivers in `Configuration`:

```js
export default new Configuration({
  attachments: {
    defaultDriver: "filesystem",
    // Path-based attachment input is disabled by default.
    // Enable explicitly only when backend-side file ingestion is needed.
    allowPathInput: false,
    // Optional allowlist when allowPathInput is true.
    allowedPathPrefixes: ["/var/app/uploads"],
    drivers: {
      filesystem: {
        directory: "/tmp/velocious-attachments"
      },
      native: {
        write: async ({attachmentId, contentBase64, filename}) => {
          // Persist using your native file API and return a storage key
          return {storageKey: `${attachmentId}-${filename}`}
        },
        read: async ({storageKey}) => {
          // Return Buffer, Uint8Array, ArrayBuffer or base64 string
          return await readNativeFile(storageKey)
        },
        url: async ({storageKey}) => {
          return `file://${storageKey}`
        }
      },
      s3: {
        bucket: "my-bucket",
        region: "eu-west-1",
        signedUrlExpiresIn: 3600
      }
    }
  }
})
```

If you want backend-side path ingestion, enable it explicitly:

```js
new Configuration({
  attachments: {
    allowPathInput: true,
    allowedPathPrefixes: ["/var/app/uploads"]
  }
})
```

Then `{path: "..."}`
inputs are only accepted when the file resolves inside one of the allowed prefixes.

For frontend models, configure `resourceConfig().attachments` and use:

```js
await frontendTask.update({descriptionFile: file})
const descriptionFile = await frontendTask.descriptionFile().download()
const descriptionFileUrl = await frontendTask.descriptionFile().url()
const descriptionFileMetadata = await frontendTask.descriptionFile().first()
const filesMetadata = await frontendTask.files().toArray()
await frontendTask.attach(file)
```

Frontend model attachment input does not support `{path: ...}`.
Use `File`/`Blob`/bytes/`contentBase64` payloads instead.
Attachment metadata is exposed through the built-in `VelociousAttachment` frontend model with safe fields only: `id`, `recordType`, `recordId`, `name`, `position`, `filename`, `contentType`, `byteSize`, `createdAt`, and `updatedAt`. Storage internals such as `driver`, `storageKey`, and `contentBase64` remain hidden and non-queryable. Direct metadata queries require owner filters: `recordType`, `recordId`, and `name`.

When your frontend app calls a backend on another host/port (or under a path prefix), configure transport once:

```js
import FrontendModelBase from "velocious/build/src/frontend-models/base.js"

FrontendModelBase.configureTransport({
  url: "http://127.0.0.1:4501/frontend-models",
  timeZone: () => Intl.DateTimeFormat().resolvedOptions().timeZone
})
```

Available transport options:

- `url` (can also be a relative path like `"/frontend-models"` on web)
- `timeZone` (an IANA timezone string or a function returning one). Browser clients auto-detect this when it is not configured. Frontend-model datetime strings without an explicit timezone are interpreted in this request timezone and stored/queried as UTC instants.

Use `await FrontendModelBase.waitForIdle()` when a test harness or app lifecycle needs to wait for queued, scheduled, and active frontend-model transport requests to finish before resetting state.

Frontend-model HTTP requests always use `credentials: "include"` so shared custom commands can set session cookies without app-level transport overrides.

Unexpected frontend-model endpoint failures stay client-safe in production with `errorMessage: "Request failed."`.
Invalid client query descriptors, such as unknown `select`, `where`, `search`, `joins`, `group`, `sort`, `pluck`, or Ransack attributes, return the specific frontend-model query error message with `velocious.code: "frontend-model-query-error"` and are not emitted as framework errors.
In `development` and `test`, Velocious also includes `debugErrorClass`, `debugErrorMessage`, and `debugBacktrace` fields so browser/system-test failures are easier to diagnose without exposing those details in production.
Other non-production environments, such as `staging`, keep the same client-safe default unless you explicitly opt in with `exposeInternalErrorsToClients: true`:

```js
const configuration = new Configuration({
  environment: "staging",
  exposeInternalErrorsToClients: true
})
```

This opt-in is ignored in `production`; production frontend-model responses never include internal exception details.

Backends can append client-safe metadata to frontend-model error responses with `configuration.addClientErrorPayloadReporter(...)`. Reporters receive the caught `error`, the current `request`, a safe `requestDetails` snapshot, and a small `context` object, and should only return fields that are safe for clients to see. Frontend-model endpoint failures include `context.frontendModelEndpoint`, `action`, `commandType`, `model`, `requestId`, and `expectedError`. This is useful for attaching an error-reporting URL while keeping the normal production error message generic:

```js
configuration.addClientErrorPayloadReporter(async ({error, requestDetails, context}) => {
  const report = await reportErrorToService({error, requestDetails, context})

  return {bugReportUrl: report.url}
})
```

`requestDetails` includes `httpMethod`, `path`, and a parsed `body` snapshot when available. The body snapshot redacts common secret keys, truncates large strings and arrays, summarizes uploaded files and buffers without bytes, and compacts oversized frontend-model batches while preserving `requestId`, `model`, `commandType` / `customPath`, and payload shape.

For sqlite web databases, Velocious defaults to `https://sql.js.org/dist/<file>` for `sql.js` wasm loading. You can override wasm resolution per database config with `locateFile`:

```js
import SqliteDriver from "velocious/build/src/database/drivers/sqlite/index.web.js"

export default new Configuration({
  database: {
    test: {
      default: {
        driver: SqliteDriver,
        type: "sqlite",
        name: "app-db",
        locateFile: (file) => `/assets/sqljs/${file}`
      }
    }
  }
})
```

If you want to serve `sql.js` assets directly from your running Velocious backend, install the built-in sql.js asset route plugin and point `locateFile` to it:

```js
import installSqlJsWasmRoute, {sqlJsLocateFileFromBackend} from "velocious/build/src/plugins/sqljs-wasm-route.js"
import SqliteDriver from "velocious/build/src/database/drivers/sqlite/index.web.js"

const configuration = new Configuration({
  // ...
  database: {
    development: {
      default: {
        driver: SqliteDriver,
        type: "sqlite",
        name: "app-db",
        locateFile: sqlJsLocateFileFromBackend({
          backendBaseUrl: "http://127.0.0.1:4501",
          routePrefix: "/velocious/sqljs"
        })
      }
    }
  }
})

installSqlJsWasmRoute({
  configuration,
  routePrefix: "/velocious/sqljs"
})
```

Frontend-model command transport preserves `Date` and `undefined` by encoding them as marker objects in JSON and decoding them on the other side:
- `Date` -> `{__velocious_type: "date", value: "<ISO string>"}`
- `undefined` -> `{__velocious_type: "undefined"}`
- `bigint` -> `{__velocious_type: "bigint", value: "<decimal string>"}`
- `NaN` / `Infinity` / `-Infinity` -> `{__velocious_type: "number", value: "NaN" | "Infinity" | "-Infinity"}`

Frontend-model commands raise an `Error` when the backend responds with `{status: "error"}` (using `errorMessage` when present), so unauthorized or missing-record update/find/destroy responses fail fast in frontend code.

## Route resolver hooks

Libraries can hook unresolved routes and hijack them before Velocious falls back to the built-in 404 controller.

```js
export default new Configuration({
  // ...
  routeResolverHooks: [
    ({currentPath}) => {
      if (currentPath !== "/special-route") return null

      return {controller: "hijacked", action: "index"}
    }
  ]
})
```

Hook return value:

- `null` to skip
- `{controller, action}` to resolve the request
- Optional `controllerClass` to resolve without importing a controller path
- Optional `params` object to merge into request params
- Optional `controllerPath` string to resolve a controller file outside the app route directory
- Optional `viewPath` string override for view rendering lookups

## Plugin routes helper

For plugin-style integrations, you can register routes with a simple DSL:

```js
configuration.routes((routes) => {
  routes.get("/velocious/sqljs/:sqlJsAssetFileName", {
    to: [SqlJsController, "downloadSqlJs"]
  })
})
```

Supported route helpers:

- `routes.get(path, {to: [ControllerClass, "action"], params?})`
- `routes.post(path, {to: [ControllerClass, "action"], params?})`


```js
import Record from "velocious/build/src/database/record/index.js"

class Task extends Record {
}

Task.belongsTo("account")
Task.translates("description", "subTitle", "title")
Task.validates("name", {presence: true, uniqueness: true})

export default Task
```

Translated models also get a `currentTranslation` `hasOne` relationship scoped to the first available row in the current locale fallback order. See [docs/translations.md](docs/translations.md) for preloading and frontend-model sorting behavior.

Async class APIs initialize record metadata on first use when a model has not
already been initialized eagerly. See [docs/model-initialization.md](docs/model-initialization.md)
for the eager and lazy initialization behavior.

## Lifecycle callbacks

Register lifecycle callbacks with either a function or an instance method name. Registrations run in order, so you can stack multiple callbacks on the same lifecycle hook.

```js
class Task extends Record {
  async validateSomething() {
    await doSomethingElse()
  }
}

Task.beforeValidation(async (task) => {
  await doSomething(task)
})

Task.beforeValidation("validateSomething")
```

## Preloading relationships

```js
const tasks = await Task.preload({project: {translations: true}}).toArray()
const projectNames = tasks.map((task) => task.project().name())
```

## Load a relationship after init

```js
const task = await Task.find(5)

const project = await task.projectOrLoad()

await task.loadProject()

const sameProject = task.project()
```

```js
const project = await Project.find(4)
const tasks = await project.tasks().toArray()
const refreshedTasks = await project.tasks().load()

await project.loadTasks()

const tasks = project.tasks().loaded()
```

## Auto-batch-preload (cohort loading)

When records are loaded as part of a batch (e.g. `Task.where(...).toArray()`), the first lazy access to a relationship on any sibling batch-loads that relationship for every sibling record in one query — avoiding the classic N+1.

```js
const tasks = await Task.where({state: "open"}).toArray()

// First call issues ONE query to load the project for every task in the batch.
const firstProject = await tasks[0].projectOrLoad()

// Subsequent sibling accesses hit the preloaded cache — no extra query.
const secondProject = tasks[1].project()
```

Auto-load is triggered by the async access paths that already exist: `model.${name}OrLoad()`, `model.relationshipOrLoad("...")`, and `model.relationship().toArray()` / `model.relationship().load()` for hasMany. The synchronous accessor `model.relationship()` still throws when the relationship has not been loaded — call the async form if you want the lazy-load behavior.

Scoped queries opt out of cohort batching by design, because the filter is specific to the accessing record:

```js
// Triggers cohort batch — all cohort siblings get their comments preloaded in one query.
await firstTask.comments().load()

// Does NOT trigger cohort — scoped filter is unique to this call.
await firstTask.comments().query().where({isResolved: true}).load()
```

Disable auto-load per relationship:

```js
Task.belongsTo("project", {autoload: false})
```

Disable auto-load globally via the framework configuration:

```js
new Configuration({
  autoload: false,
  // ...
})
```

Both flags default to `true`. When disabled, lazy access falls back to a per-record load.

The same cohort auto-batch-preload applies to **frontend models**. When a batch is loaded from the backend (`Task.where(...).toArray()` or similar), the first async relationship access on any cohort sibling triggers one combined HTTP request that preloads that relationship for every sibling at once:

```js
const tasks = await Task.toArray()

// First call issues ONE request to preload the project for every task in the batch.
const firstProject = await tasks[0].projectOrLoad()

// Sibling has been populated from the same response — no extra request.
const secondProject = tasks[1].project()
```

The generator threads the per-relationship `autoload: false` flag through automatically, so `Task.belongsTo("project", {autoload: false})` on the backend also disables cohort batching on the generated frontend model.

Disable auto-batch-preload globally on the frontend:

```js
import FrontendModelBase from "velocious/frontend-models"

FrontendModelBase.setAutoload(false)
```

Scoped frontend queries (e.g. `Task.where(...).preload([name]).toArray()` from user code) bypass cohort batching by design, same as the backend. Siblings with locally set state from `.setRelationship()` / `.build()` are preserved across cohort batches.

## Through relationships

Use the `through` option on `hasMany` to define a relationship that traverses an intermediate (join) table:

```js
Invoice.hasMany("invoiceGroupLinks")
Invoice.hasMany("invoiceGroups", {through: "invoiceGroupLinks", className: "InvoiceGroup"})
```

Through relationships work with both instance-level loading and batch preloading:

```js
// Instance-level loading
const invoice = await Invoice.find(1)
const groups = await invoice.invoiceGroups().toArray()

// Batch preloading
const invoices = await Invoice.preload({invoiceGroups: true}).toArray()
const groups = invoices[0].invoiceGroupsLoaded()
```

The intermediate relationship (e.g. `invoiceGroupLinks`) must be defined as a separate `hasMany` on the same model. The `foreignKey` option on the through relationship specifies the column on the target table that points to the intermediate table (defaults to the conventional foreign key).

## Relationship scopes

You can pass a scope callback to `hasMany`, `hasOne`, or `belongsTo` to add custom filters. The callback receives the query and is also bound as `this`:

```js
Project.hasMany("acceptedTasks", (scope) => scope.where({state: "accepted"}), {className: "Task"})
Project.hasOne("activeDetail", function() { return this.where({isActive: true}) }, {className: "ProjectDetail"})
Comment.belongsTo("acceptedTask", (scope) => scope.where({state: "accepted"}), {className: "Task"})
```

### Join path table references

When joining relationships, use `getTableForJoin` to retrieve the table (or alias) for a join path:

```js
const query = Task.joins({project: {account: true}})
const accountTable = query.getTableForJoin("project", "account")
```

Inside relationship scopes, `getTableForJoin()` is relative to the current scope path:

```js
Project.hasMany("acceptedTasks", function() {
  return this.where(`${this.getTableForJoin()}.state = 'accepted'`)
}, {className: "Task"})
```

## Model scopes

Backend records and frontend models can define reusable named scopes with `defineScope(...)`.

```js
class Task extends TaskBase {
  static withAccepted = this.defineScope(({query}, accepted) => query.where({accepted}))
}

await Task.withAccepted(true).toArray()
await Task.where({projectId: 1}).scope(Task.withAccepted.scope(true)).toArray()
await Task.joins({project: {tasks: true}}).scope(["project", "tasks"], Task.withAccepted.scope(true)).toArray()
```

`Model.scopeName(args...)` starts a fresh query for that model. `Model.scopeName.scope(args...)` returns a reusable scope descriptor for `.scope(...)` on an existing query. Backend record queries also support `.scope(path, descriptor)` to apply a scope to a joined relationship path.

Backend record scopes receive alias-aware SQL context:

```js
class Task extends TaskBase {
  static nameLike = this.defineScope(({driver, query, table}, value) => query.where(
    `${driver.quoteTable(table)}.${driver.quoteColumn("name")} LIKE ${driver.quote(`%${value}%`)}`
  ))
}
```

The `table` value is the active table reference for the current query and may be an alias from `FROM ... AS ...`, not just `Task.tableName()`.

Joined-path scopes receive the joined path in `context.path` and may only add `where(...)` and `joins(...)` clauses.

### Finding records

`find()` and `findByOrFail()` throw an error when no record is found. `findBy()` returns `null`. These apply to records.

### Create records

```js
const task = new Task({identifier: "task-4"})

task.assign({name: "New task})

await task.save()
```

```js
const task = await Task.create({name: "Task 4"})
```

### Bulk insert

Use `insertMultiple` to insert many rows in one call:

```js
await Task.insertMultiple(
  ["project_id", "name", "created_at", "updated_at"],
  [
    [project.id(), "Task 1", new Date(), new Date()],
    [project.id(), "Task 2", new Date(), new Date()]
  ]
)
```

If a batch insert fails, you can retry each row and collect results:

```js
const results = await Task.insertMultiple(
  ["project_id", "name"],
  [
    [project.id(), "Task A"],
    [project.id(), "Task A"]
  ],
  {retryIndividuallyOnFailure: true, returnResults: true}
)

console.log(results.succeededRows, results.failedRows, results.errors)
```

### Find or create records

```js
const task = await Task.findOrInitializeBy({identifier: "task-5"})

if (task.isNewRecord()) {
  console.log("Task didn't already exist")

  await task.save()
}

if (task.isPersisted()) {
  console.log("Task already exist")
}
```

## User module

Use the user module to add password helpers to a record class. It attaches `setPassword()` and `setPasswordConfirmation()` to the model and stores encrypted values on the record. Your users table should include an `encryptedPassword` column for this to work.

```js
import Record from "velocious/build/src/database/record/index.js"
import UserModule from "velocious/build/src/database/record/user-module.js"

class User extends Record {
}

new UserModule({secretKey: process.env.USER_SECRET_KEY}).attachTo(User)

const user = new User()
user.setPassword("my-password")
user.setPasswordConfirmation("my-password")
```

```js
const task = await Task.findOrCreateBy({identifier: "task-5"}, (newTask) => {
  newTask.assign({description: "This callback only happens if not already existing"})
})
```

# Migrations

## Make a new migration from a template

```bash
npx velocious g:migration create-tasks
```

## Write a migration
Implicit `id` primary keys and `references(...)` columns use UUIDs by default. Set `primaryKeyType` on a database config to change the implicit type for that database, or pass an explicit `id` / reference `type` for legacy schemas and external compatibility.

```js
export default new Configuration({
  database: {
    production: {
      default: {
        type: "pgsql",
        primaryKeyType: "bigint"
      }
    }
  }
})
```

```js
import Migration from "velocious/build/src/database/migration/index.js"

export default class CreateEvents extends Migration {
  async up() {
    await this.createTable("tasks", (t) => {
      t.timestamps()
    })

    // Legacy numeric primary key
    await this.createTable("legacy_events", {id: {type: "bigint"}}, (t) => {
      t.references("task", {type: "bigint"})
      t.timestamps()
    })

    // Column helper examples
    await this.createTable("examples", (t) => {
      t.bigint("count")
      t.blob("payload")
      t.boolean("published")
      t.datetime("published_at")
      t.integer("position")
      t.json("metadata")
      t.string("name")
      t.text("body")
      t.tinyint("priority")
      t.uuid("uuid_column")
      t.references("user")
      t.timestamps()
    })

    await this.createTable("task_translations", (t) => {
      t.references("task", {foreignKey: true, null: false})
      t.string("locale", {null: false})
      t.string("name")
      t.timestamps()
    })

    await this.addIndex("task_translations", ["task_id", "locale"], {unique: true})
  }

  async down() {
    await this.dropTable("task_translations")
    await this.dropTable("examples")
    await this.dropTable("tasks")
  }
}
```

## Run migrations from the command line

```bash
npx velocious db:migrate
```

Run project seeds from `src/db/seed.js` (default export should be an async function):

```bash
npx velocious db:seed
```

You can chain multiple commands in one invocation:

```bash
npx velocious db:create db:migrate
```

Run script files with initialized app/database context:

```bash
npx velocious run-script src/scripts/my-task.js
```

Evaluate inline JavaScript (Rails-style runner) with initialized app/database context:

```bash
npx velocious runner "const users = await db.query('SELECT COUNT(*) AS count FROM users'); console.log(users[0].count)"
```

By default, migrations write `db/structure-<identifier>.sql` files for each database in non-test environments. Test skips these automatic writes unless you explicitly opt in. Configure allow/deny lists in your configuration:

```js
export default new Configuration({
  // ...
  structureSql: {
    enabledEnvironments: ["development"],
    disabledEnvironments: ["test"]
  }
})
```

If you only want automatic writes in one or two environments, prefer `enabledEnvironments`. `db:schema:dump` is an explicit schema-generation command and still writes missing structure files regardless of the current environment.

If you need to regenerate missing structure files without rerunning migrations, use:

```bash
npx velocious db:schema:dump
```

`db:schema:dump` only writes `db/structure-<identifier>.sql` files when one or more expected files are missing.

If you need to load the checked-in structure files for each configured database, use:

```bash
npx velocious db:schema:load
```

`db:schema:load` reads `db/structure-<identifier>.sql` for each configured database identifier and executes those statements against the current connections.

## Schema metadata cache

Velocious caches schema metadata on each database driver instance so repeated model initialization, table lookups, column introspection, and structure SQL generation can reuse the same database results. The cache is cleared automatically after schema-changing SQL runs through Velocious, such as migrations, `createTable`, `dropTable`, `renameColumn`, `ALTER TABLE`, `CREATE INDEX`, and `COMMENT ON`. See [docs/schema-metadata-cache.md](docs/schema-metadata-cache.md) for details.

If another process changes the schema outside Velocious while the current process is still running, clear the cache before reading metadata again:

```js
await configuration.ensureConnections(async (dbs) => {
  dbs.default.clearSchemaCache()
})
```

To disable schema metadata caching for a database connection, set `schemaCache: false` on that database config:

```js
export default new Configuration({
  database: {
    development: {
      default: {
        type: "mysql",
        schemaCache: false
      }
    }
  }
})
```

## Configure CLI commands (Node vs Browser)

Node loads CLI commands from disk automatically via the Node environment handler:

```js
import Configuration from "velocious/build/src/configuration.js"
import NodeEnvironmentHandler from "velocious/build/src/environment-handlers/node.js"

export default new Configuration({
  // ...
  environmentHandler: new NodeEnvironmentHandler()
})
```

Browser builds can still register commands, but only the browser-safe wrappers are bundled:

```js
import Configuration from "velocious/build/src/configuration.js"
import BrowserEnvironmentHandler from "velocious/build/src/environment-handlers/browser.js"

export default new Configuration({
  // ...
  environmentHandler: new BrowserEnvironmentHandler()
})
```

## Run CLI commands in the browser

Enable the browser CLI and run commands from devtools or app code:

```js
import BrowserCli from "velocious/build/src/cli/browser-cli.js"

const browserCli = new BrowserCli({configuration})
browserCli.enable()

await browserCli.run("db:migrate")
```

Once enabled, you can also run commands directly from the browser console:

```js
await globalThis.velociousCLI.run("db:migrate")
```

In React, you can use the hook which sets `globalThis.velociousCLI`:

```js
import useBrowserCli from "velocious/build/src/cli/use-browser-cli.js"

export default function App() {
  useBrowserCli({configuration})

  return null
}
```

## Run migrations from anywhere if you want to:

```js
const migrationsPath = `/some/dir/migrations`
const files = await new FilesFinder({path: migrationsPath}).findFiles()

await this.configuration.ensureConnections(async () => {
  const migrator = new Migrator({configuration: this.configuration})

  await migrator.prepare()
  await migrator.migrateFiles(files, async (path) => await import(path))
})
```

# Querying

Each query feature has its own focused example.

### Basic retrieval

```js
import {Task} from "@/src/models/task"

const tasks = await Task.all().toArray()
```

### Filtering

```js
const tasks = await Task.where({status: "open"}).toArray()

const tasksForActiveProjects = await Task.where({
  project: {projectDetail: {isActive: true}}
}).toArray()

const specificTask = await Task.where({
  id: 1,
  project: {nameEn: "Alpha"}
}).toArray()

const tasksWithRecentCreators = await Task.where({
  project: {creatingUser: [["createdAt", ">=", new Date("2026-01-01T00:00:00.000Z")]]}
}).toArray()
```

### Ransack-style filtering

Use `.ransack(...)` on record queries, record classes, frontend-model queries, and frontend-model classes when you want Rails/Ransack-style predicate keys without hand-writing nested `where(...)` or `search(...)` calls.

Supported predicates include `_eq`, `_not_eq`, `_gt`, `_gteq`, `_lt`, `_lteq`, `_cont`, `_start`, `_end`, `_in`, `_not_in`, and `_null`.

```js
const tasks = await Task.ransack({
  name_cont: "deploy",
  project_project_detail_is_active_eq: true
}).toArray()

const frontendTasks = await FrontendTask
  .ransack({name_cont: "deploy", id_in: ["1", "2"]})
  .toArray()
```

Simple OR predicates use Ransack's `_or_` shortcut:

```js
const matchingUsers = await User
  .ransack({email_or_reference_cont: "john"})
  .toArray()
```

Grouped Ransack hashes support `m` (`"and"` / `"or"`), `c` condition arrays, and nested `g` groups:

```js
const matchingUsers = await User
  .ransack({
    c: [
      {a: ["email"], p: "cont", v: ["jane"]}
    ],
    g: [
      {
        c: [
          {a: "reference", p: "cont", v: ["user-2"]},
          {a: "email", p: "cont", v: ["john"]}
        ],
        m: "and"
      }
    ],
    m: "or"
  })
  .limit(20)
  .offset(0)
  .toArray()
```

Frontend-model `.ransack(...)` filters run on the backend, so `count()`, `limit(...)`, `offset(...)`, and `toArray()` all share the same query scope instead of loading records into memory first.

### Raw where clauses

```js
const tasks = await Task.where("tasks.completed_at IS NULL").toArray()
```

### Joins

```js
const tasks = await Task
  .joins({project: true})
  .where({projects: {public: true}})
  .toArray()
```

### Preloading relationships

```js
const tasks = await Task.preload({project: {account: true}}).toArray()
const accountNames = tasks.map((task) => task.project().account().name())
```

### Selecting columns

```js
const tasks = await Task.select(["tasks.id", "tasks.name"]).toArray()
```

### Reselecting columns

`reselect` replaces any previously accumulated `SELECT` clauses — useful
when repurposing a shared base query for an aggregate or a column-
projected read. `reselect()` with no argument drops the projection so
the driver falls back to `SELECT *`.

```js
const baseQuery = Task.where({state: "open"})
const counts = await baseQuery.reselect("COUNT(*) AS count").results()
```

### Ordering

```js
const tasks = await Task.order("name").toArray()
const sortedTasks = await Task.order({tableName: "tasks", column: "name", direction: "ASC"}).toArray()
```

Use structured order descriptors for runtime-selected columns so identifiers are quoted by the active database driver. Plain string orders are still available for fixed SQL expressions that cannot be represented as a column descriptor.

### Reordering and reverse order

```js
const tasks = await Task.order("name").reorder("created_at").reverseOrder().toArray()
```

### Limiting and offsetting

```js
const tasks = await Task.limit(10).offset(20).toArray()
```

### Grouping

```js
const tasks = await Task.group("tasks.project_id").toArray()
```

### Distinct records

```js
const tasks = await Task.joins({project: true}).distinct().toArray()
```

### Paging

```js
const tasks = await Task.page(2).perPage(25).toArray()
```

### Counting

```js
const totalTasks = await Task.count()
const distinctProjects = await Task.joins({project: true}).distinct().count()
```

Frontend-model `count()` runs as a backend aggregate, so list UIs can request counts without loading and serializing every matching model.

### First and last

```js
const firstTask = await Task.first()
const lastTask = await Task.last()
```

### Find by attributes

```js
const task = await Task.findBy({identifier: "task-5"})
const taskOrFail = await Task.findByOrFail({identifier: "task-5"})
```

### Find or initialize/create

```js
const task = await Task.findOrInitializeBy({identifier: "task-5"})
const task2 = await Task.findOrCreateBy({identifier: "task-6"}, (newTask) => {
  newTask.assign({description: "Only runs when new"})
})
```

### Destroy all records

```js
await Task.where({tasks: {status: "archived"}}).destroyAll()
```

### Plucking columns

```js
const names = await Task.pluck("name")                     // ["Task A", "Task B"]
const idsAndNames = await Task.order("name").pluck("id", "name") // [[1, "Task A"], [2, "Task B"]]
```

# Global connections fallback

`AsyncTrackedMultiConnection` uses `AsyncLocalStorage` to pin a connection to the current async context. If you need to call `getCurrentConnection()` outside of `ensureConnections`/`withConnection`, ask the pool to create a global fallback connection for you:

```js
import AsyncTrackedMultiConnection from "velocious/build/src/database/pool/async-tracked-multi-connection.js"

const pool = configuration.getDatabasePool("default")

// Create (or reuse) a dedicated fallback connection.
await pool.ensureGlobalConnection()

// Later, outside an async context, this will return the ensured fallback connection:
const db = pool.getCurrentConnection()
```

To prime *all* configured pools at once, call `configuration.ensureGlobalConnections()`. It will invoke `ensureGlobalConnection()` on pools that support it and perform a `checkout` on simpler pools so `getCurrentConnection()` is safe everywhere.

When an async context exists, that connection is still preferred over the global one.

Checked-in `AsyncTrackedMultiConnection` connections are closed after 5 seconds of idle time by default. This keeps tenant-scoped and short-lived background-job connections from accumulating in long-running processes while still allowing immediate reuse by nearby async work. Configure `database.<environment>.<identifier>.pool.idleTimeoutMillis` to change the timeout, set it to `0` to close idle connections immediately unless a matching checkout is already waiting, or set it to `null` to disable idle reaping for that pool. A matching idle connection is reused before expired idle connections are reaped.

```js
database: {
  production: {
    default: {
      driver: MysqlDriver,
      poolType: AsyncTrackedMultiConnection,
      type: "mysql",
      pool: {
        idleTimeoutMillis: 10000,
        max: 25
      }
    }
  }
}
```

`pool.max` caps live async-tracked connections for that pool and defaults to `10` when omitted. When the cap is reached, new checkouts wait until a matching checked-in connection can be handed over or capacity is freed. Set `pool.max` to `null` only when a process is deliberately allowed to open an unbounded number of database connections. The built-in debug endpoint reports each in-use connection's `checkedOutForMs`, each idle connection's `idleForMs`, and queued `pendingCheckouts[].waitingForMs` so production diagnostics can distinguish long-held checkouts from pool-capacity waits.

# Websockets

Velocious includes a lightweight websocket entry point for API-style calls and server-side events.

## Connect and call a controller

```js
const socket = new WebSocket("ws://localhost:3006/websocket")

socket.addEventListener("open", () => {
  socket.send(JSON.stringify({
    id: "req-1",
    method: "POST",
    path: "/api/version",
    body: {extra: true},
    type: "request"
  }))
})

socket.addEventListener("message", (event) => {
  const msg = JSON.parse(event.data)

  if (msg.type === "response" && msg.id === "req-1") {
    console.log("Status", msg.statusCode, "Body", msg.body)
  }
})
```

## Attach WebSocket metadata

Clients can send session metadata over the shared WebSocket. Metadata is exposed to WebSocket-borne controller requests and frontend-model subscription authorization through `request.metadata(...)`; it is not merged into HTTP headers.

```js
socket.addEventListener("open", () => {
  socket.send(JSON.stringify({
    data: {locale: "da", sessionToken: "abc"},
    type: "metadata"
  }))

  socket.send(JSON.stringify({
    id: "req-2",
    method: "POST",
    path: "/api/version",
    type: "request"
  }))
})
```

```js
const sessionToken = this.getRequest().metadata("sessionToken")
```

# Logging

Velocious includes a lightweight logger that can write to both console and file and is environment-aware.

- **Defaults**: When no `logging` config is provided, Velocious sets up a console logger with `info`, `warn`, and `error` levels.
- **Configuration**: Supply a `logging` object when creating your configuration:

```js
const configuration = new Configuration({
  // ...
  logging: {
    console: false,            // disable console output
    file: true,                // enable file output
    directory: "/custom/logs", // optional, defaults to "<project>/log" in Node
    filePath: "/tmp/app.log"   // optional explicit path
  }
})
```

- **Custom logger list**: Configure an explicit list of logger instances with levels:

```js
import ConsoleLogger from "velocious/build/src/logger/console-logger.js"
import FileLogger from "velocious/build/src/logger/file-logger.js"

const configuration = new Configuration({
  // ...
  logging: {
    loggers: [
      new ConsoleLogger({levels: ["info", "warn", "error"]}),
      new FileLogger({path: `log/${environment}.log`, levels: ["debug", "info", "warn", "error"]})
    ]
  }
})
```

- **Base logger**: Custom loggers should extend `BaseLogger` and implement either `write(...)` or `toOutputConfig(...)`:

```js
import BaseLogger from "velocious/build/src/logger/base-logger.js"

class MyLogger extends BaseLogger {
  async write({message}) {
    console.log(message)
  }
}
```

- **Environment handlers**: File-path resolution and file writes are delegated to the environment handler so browser builds stay bundle-friendly.
  - Node handler writes to `<directory>/<environment>.log` by default.
  - Custom handlers can override `getDefaultLogDirectory`, `getLogFilePath`, and `writeLogToFile` if needed.

- **Debug logging**: When `configuration.debug` is true or a `Logger` is constructed with `{debug: true}`, messages are emitted regardless of environment.

- **Per-instance control**: You can create a `new Logger("Subject", {configuration, debug: false})` to honor the configuration defaults, or toggle `logger.setDebug(true)` for verbose output in specific cases.

- **Request completion logging**: HTTP and websocket-routed controller requests log a Rails-style completion line after the response is served:

```text
Completed 200 OK in 1603ms (Controller: 107.8ms | Views: 1097.4ms | DB: 381.8ms (2 queries) | Velocious: 16.0ms)
```

`Controller` measures before callbacks plus action work, excluding nested view rendering and database queries. `Views` measures JSON/view rendering and file-response setup. `DB` measures database driver query time and query count. `Velocious` is the remaining framework overhead, including routing, request setup, timeout handling, and response writing.

- **Query logging**: Database queries log at `info` level by default with Rails-style elapsed time:

```text
Task Load (1.9ms)  SELECT `tasks`.* FROM `tasks` WHERE `tasks`.`id` = 1 LIMIT 1
  ↳ src/routes/tasks/controller.js:12:in show
```

Model queries use operation names such as `Task Load`, `Task Count`, `Task Pluck`, `Task Create`, `Task Update`, and `Task Destroy`. Raw driver queries use `SQL`. The source arrow is included only when Velocious can identify an application frame; dependency and framework frames such as `node_modules` are omitted.

Query logging defaults to off in the `test` environment to keep CI output quiet and is skipped when no output emits `info`. Override it with `logging: {queryLogging: true}` when a test build should write SQL timing logs, and use the normal logging output settings to send those logs to console or file.

## Listen for framework errors

Velocious emits framework errors (including uncaught controller action errors) on the configuration error event bus:

```js
configuration.getErrorEvents().on("framework-error", ({error, request, response, context}) => {
  // Send to your error reporting tool of choice
  console.error("Framework error", error, context)
})

configuration.getErrorEvents().on("all-error", ({error, errorType}) => {
  console.error(`Velocious error (${errorType})`, error)
})
```

Genuinely unexpected frontend-model command failures reach this bus too. The frontend-model controller catches them to return a client-safe `Request failed.` response, but it also emits them as `framework-error`/`all-error` (with `context.frontendModelEndpoint === true`) so they are reported instead of being silently swallowed. Expected user-flow errors are excluded: validation failures are forwarded with their real message (for example `Name can't be blank`), invalid client query descriptors are returned as frontend-model query errors, and `error.velocious`-annotated / `safeToExpose` / `errorType`-marked errors keep their expected-error status — none of these reach the error bus.

## Use the Websocket client API (HTTP-like)

```js
import WebsocketClient from "velocious/build/src/http-client/websocket-client.js"

const client = new WebsocketClient({url: "ws://localhost:3006/websocket"})
await client.connect()

// Call controller actions like normal HTTP helpers
const response = await client.post("/api/version", {locale: "en"})
console.log(response.statusCode, response.json())

// Listen for broadcast events
const unsubscribe = client.on("projects", (payload) => {
  console.log("Project event", payload)
})

// Trigger a broadcast from another action
await client.post("/api/broadcast-event", {channel: "projects", payload: {id: 42}})

unsubscribe()
await client.close()
```

## Subscribe to events

```js
const socket = new WebSocket("ws://localhost:3006/websocket")

socket.addEventListener("open", () => {
  socket.send(JSON.stringify({type: "subscribe", channel: "projects"}))
})

socket.addEventListener("message", (event) => {
  const msg = JSON.parse(event.data)

  if (msg.type === "event" && msg.channel === "projects") {
    console.log("Got project event payload", msg.payload)
  }
})
```

If `websocketChannelResolver` is configured, subscribe messages are treated as channel identifiers (see below).

## Broadcast an event from backend code

Any backend code (controllers, services, jobs) can publish to subscribed websocket clients using the shared event bus on the configuration:

```js
// Inside a controller action
const {channel, payload} = this.getParams() // or compose your own payload
this.getConfiguration().getWebsocketEvents().publish(channel, payload)
this.renderJsonArg({status: "published"})
```

## Websocket channels

You can resolve websocket channel classes from subscribe messages and let them decide which streams to allow:

```js
import WebsocketChannel from "velocious/build/src/http-server/websocket-channel.js"

class NewsChannel extends WebsocketChannel {
  async subscribed() {
    if (this.params().token !== process.env.NEWS_TOKEN) return

    await this.streamFrom("news")
  }

  async unsubscribed() {
    // Optional: cleanup when the socket closes
  }
}

const configuration = new Configuration({
  // ...
  websocketChannelResolver: ({request, subscription}) => {
    const channel = subscription?.channel
    const params = subscription?.params || {}

    if (channel === "news") return NewsChannel

    const query = request?.path?.().split("?")[1]
    const legacyChannel = new URLSearchParams(query).get("channel")

    if (legacyChannel === "news") return NewsChannel
  }
})
```

Channel classes are the recommended place to authorize subscriptions and decide which streams a connection should receive. If authorization fails, simply return without calling `streamFrom` or close the socket in `subscribed()`.

Subscribe from the client using a channel identifier and params:

```js
socket.send(JSON.stringify({
  type: "subscribe",
  channel: "news",
  params: {token: "secret"}
}))
```

## Raw websocket handlers

If you need to accept custom websocket message formats (for example, a vendor that does not use the Velocious request/subscribe protocol), provide a `websocketMessageHandlerResolver` in your configuration. It receives the upgrade request and can return a handler object with `onOpen`, `onMessage`, `onClose`, and `onError` hooks:

```js
const configuration = new Configuration({
  // ...
  websocketMessageHandlerResolver: ({request, configuration}) => {
    const path = request.path().split("?")[0]

    if (path === "/custom/socket") {
      return {
        onOpen: ({session}) => {
          session.sendJson({event: "connected"})
        },
        onMessage: ({message}) => {
          console.log("Inbound message", message)
        }
      }
    }
  }
})
```

When a raw handler is attached, Velocious skips channel resolution and forwards parsed JSON messages directly to the handler.

## Combine: subscribe and invoke another action

You can subscribe first and then call another controller action over the same websocket connection to trigger broadcasts:

```js
socket.send(JSON.stringify({type: "subscribe", channel: "news"}))

socket.send(JSON.stringify({
  type: "request",
  id: "req-broadcast",
  method: "POST",
  path: "/api/broadcast-event",
  body: {channel: "news", payload: {headline: "breaking"}}
}))
```

# Testing

If you are using Velocious for an app, Velocious has a built-in testing framework. You can run your tests like this:
```bash
npx velocious test
```

If you are developing on Velocious, you can run the tests with:

```bash
./run-tests.sh
```

Tests default to a 60-second timeout. Override per test with `{timeoutSeconds: 5}` or set a suite-wide default via `configureTests({defaultTimeoutSeconds: 30})`.

# Writing a request test

First create a test file under something like the following path 'src/routes/accounts/create-test.js' with something like the following content:

```js
import {describe, expect, it} from "velocious/build/src/testing/test.js"
import Account from "../../models/account.js"

describe("accounts - create", {type: "request"}, async () => {
  it("creates an account", async ({client}) => {
    const response = await client.post("/accounts", {account: {name: "My event company"}})

    expect(response.statusCode()).toEqual(200)
    expect(response.contentType()).toEqual("application/json")

    const data = JSON.parse(response.body())

    expect(data.status).toEqual("success")

    const createdAccount = await Account.last()

    expect(createdAccount).toHaveAttributes({
      name: "My event company"
    })
  })
})
```

# Routes

Create or edit the file `src/config/routes.js` and do something like this:

```js
import Routes from "velocious/build/src/routes/index.js"

const routes = new Routes()

routes.draw((route) => {
  route.resources("projects")

  route.resources("tasks", (route) => {
    route.get("users")
  })

  route.namespace("testing", (route) => {
    route.post("truncate")
  })

  route.get("ping")
})

export default {routes}
```

# Controllers

Create the file `src/routes/testing/controller.js` and do something like this:

```js
import Controller from "velocious/build/src/controller.js"

export default class TestingController extends Controller {
  async truncate() {
    await doSomething()
    await this.render({json: {status: "database-truncated"}})
  }

  async anotherAction() {
    render("test-view")
  }
}
```

When `render({json: ...})` receives Velocious backend model instances, it now auto-serializes them with frontend-model transport markers. After transport deserialization on the client, registered frontend models hydrate automatically:

```js
import {deserializeFrontendModelTransportValue} from "velocious/build/src/frontend-models/transport-serialization.js"

const tasks = await Task.toArray()

await this.render({
  json: {
    tasks
  }
})

const response = await fetch("/tasks")
const result = deserializeFrontendModelTransportValue(await response.json())

result.tasks[0] instanceof Task //=> true
result.tasks[0].name() //=> frontend model accessor
```

## Cookies

Set cookies from controllers:

```js
this.setCookie("session_id", "abc123", {httpOnly: true, sameSite: "Lax"})
```

Read cookies from the request:

```js
const cookies = this.getCookies()
const sessionCookie = cookies.find((cookie) => cookie.name() === "session_id")
```

Encrypted cookies use `cookieSecret` from configuration:

```js
this.setCookie("user_token", "secret", {encrypted: true, httpOnly: true})
```

# Views

Create the file `src/routes/testing/another-action.ejs` and so something like this:

```ejs
<p>
  View for path: <%= controller.getRequest().path() %>
</p>
```

# Background jobs

Velocious includes a simple background jobs system inspired by Sidekiq.

Production apps can listen for `background-job-failed` or its `all-error` mirror to report accepted failed attempts, including retry and terminal state metadata. See [docs/background-jobs.md](docs/background-jobs.md#failure-events).

## Setup

Create a jobs directory in your app:

```
src/jobs/
```

Start the background jobs main process (the queue router):

```bash
npx velocious background-jobs-main
```

Start one or more workers:

```bash
npx velocious background-jobs-worker
```

## Configuration

You can configure the main host/port in your configuration:

```js
export default new Configuration({
  // ...
  backgroundJobs: {
    host: "127.0.0.1",
    port: 7331,
    databaseIdentifier: "default",
    maxConcurrentForkedJobs: 4,
    maxConcurrentInlineJobs: 4,
    dispatchStrategy: "beacon"
  }
})
```

Or via env vars:

```
VELOCIOUS_BACKGROUND_JOBS_HOST=127.0.0.1
VELOCIOUS_BACKGROUND_JOBS_PORT=7331
VELOCIOUS_BACKGROUND_JOBS_DATABASE_IDENTIFIER=default
VELOCIOUS_BACKGROUND_JOBS_MAX_CONCURRENT_FORKED_JOBS=4
VELOCIOUS_BACKGROUND_JOBS_MAX_CONCURRENT_INLINE_JOBS=4
VELOCIOUS_BACKGROUND_JOBS_DISPATCH_STRATEGY=beacon
VELOCIOUS_BACKGROUND_JOBS_POLL_INTERVAL_MS=1000
VELOCIOUS_BACKGROUND_JOBS_WORKER_SHUTDOWN_TIMEOUT_MS=indefinite
```

`VELOCIOUS_BACKGROUND_JOBS_WORKER_SHUTDOWN_TIMEOUT_MS` (default: `indefinite`) bounds how long a `background-jobs-worker` waits for in-flight jobs on `SIGTERM`/`SIGINT` before terminating any forked or spawned child runners still running, so they are not orphaned across a deploy. The default waits for jobs to finish and never interrupts a running job; set a positive number of milliseconds for a finite cap (keep it shorter than your process supervisor's graceful-stop window so the worker reaps its own runners first). See [docs/background-jobs.md](docs/background-jobs.md#worker-shutdown-and-process-job-draining).

`maxConcurrentInlineJobs` (default: `4`) caps how many `executionMode: "inline"` jobs a single `background-jobs-worker` process runs in parallel. Concurrency is at the JS event-loop level: every job in flight shares the worker's process and DB connection pool, so the cap should fit the pool, not the CPU count. Forking remains the right tool when you need memory isolation across long-running jobs or want to use more cores. The older `forked: false` option still maps to inline mode.

`maxConcurrentForkedJobs` (default: `4`) caps how many out-of-process `executionMode: "forked"` or `executionMode: "spawned"` jobs one worker may keep in flight. Forked jobs use `child_process.fork()` with an attached IPC channel and exit after the job runner closes its framework resources. Spawned jobs use the legacy `background-jobs-runner` CLI process via `child_process.spawn()` and are only for callers that intentionally want that spawned behavior.

### Dispatch strategy

`dispatchStrategy` controls how `background-jobs-main` detects new work.

- `"beacon"` (default): event-driven dispatch. `background-jobs-main` drains the queue when a job is enqueued (directly, or via a [Beacon](docs/beacon.md) broadcast from another process), when a worker comes up or reports ready, and at the exact `scheduled_at_ms` of the next future-scheduled job via a precise `setTimeout`. There is no fixed-interval polling. The `background_jobs` table is the durable log — on (re)connect to Beacon, the dispatcher does a one-shot catch-up drain so anything enqueued while the bus was unreachable is picked up.
- `"polling"`: legacy fixed-interval poll. `background-jobs-main` runs `SELECT … FROM background_jobs WHERE status='queued' AND scheduled_at_ms <= now` every `pollIntervalMs` (default `1000`). Use this if you want the previous behavior, or for environments where Beacon is unavailable and you don't want event-driven dispatch.

Beacon is opt-in for the rest of the framework, but the dispatcher uses event-driven dispatch even when Beacon is not configured — it falls back to direct in-process triggering from the enqueue/handoff paths plus `setTimeout` for scheduled jobs. Configure Beacon when you want cross-process enqueues (e.g. enqueue from an HTTP server process) to wake the main process immediately.

## Defining jobs

```js
import VelociousJob from "velocious/build/src/background-jobs/job.js"

/** @augments {VelociousJob<[string, string]>} */
export default class MyJob extends VelociousJob {
  /**
   * @param {string} arg1
   * @param {string} arg2
   * @returns {Promise<void>}
   */
  async perform(arg1, arg2) {
    await doWork(arg1, arg2)
  }
}
```

`VelociousJob` is generic over the tuple of arguments `perform` takes. Declaring it
with `@augments {VelociousJob<[...]>}` (or `extends VelociousJob<[...]>` in TypeScript)
lets a type-checked codebase declare `perform`'s parameters as required and typed.
Argument-less jobs use a bare `extends VelociousJob` with `async perform()` — the
default empty-tuple type argument keeps that working unchanged. Plain (unchecked)
JavaScript can ignore the annotation entirely.

Queue a job:

```js
await MyJob.performLater("a", "b")
```

Jobs use `executionMode: "forked"` by default. This runs the job in a separate attached Node child process. To run inline:

```js
await MyJob.performLaterWithOptions({
  args: ["a", "b"],
  options: {executionMode: "inline"}
})
```

The older `options: {forked: false}` form is still accepted as an alias for inline execution, and `options: {forked: true}` maps to forked execution. To use the previous spawned CLI runner behavior explicitly, pass `options: {executionMode: "spawned"}`.

Inline jobs share the worker process and run concurrently up to `maxConcurrentInlineJobs`, so a single slow inline job no longer blocks the queue. A single worker can also override the configured cap explicitly:

```js
new BackgroundJobsWorker({configuration, maxConcurrentInlineJobs: 8})
```

## Scheduled jobs

Velocious can enqueue recurring jobs from the `background-jobs-main` process. Configure them with `scheduledBackgroundJobs` using Sidekiq Scheduler-style `every` arrays:

```js
import BuildCleanupJob from "./src/jobs/build-cleanup-job.js"

export default new Configuration({
  // ...
  scheduledBackgroundJobs: {
    jobs: {
      buildCleanup: {
        class: BuildCleanupJob,
        every: ["1h", {first_in: "10s"}],
        options: {executionMode: "inline"}
      }
    }
  }
})
```

Supported schedule syntax:

- `every: "5m"`
- `every: ["1h", {first_in: "30s"}]`
- `every: ["1 day", {firstIn: "5 minutes"}]`

Or a 5-field POSIX crontab expression via `cron`:

```js
scheduledBackgroundJobs: {
  jobs: {
    nightlyDigest: {
      class: NightlyDigestJob,
      cron: "0 3 * * *" // every day at 03:00 server-local time
    },
    weekdayMornings: {
      class: WeekdayMorningJob,
      cron: "0 9 * * 1-5" // 09:00 Mon–Fri
    },
    everyHour: {
      class: HourlyCleanupJob,
      cron: "@hourly"
    }
  }
}
```

Cron fields are: `minute hour day-of-month month day-of-week`. Supported syntax:

- `*` (any), single values (`5`), ranges (`1-5`), lists (`1,3,5`).
- Step expressions: `*/15` (every 15 minutes), `0-30/5` (every 5 between 0 and 30).
- Month and weekday names: `jan`-`dec`, `sun`-`sat` (case-insensitive). Both `0` and `7` mean Sunday.
- POSIX shortcuts: `@hourly`, `@daily` / `@midnight`, `@weekly`, `@monthly`, `@yearly` / `@annually`.
- Day-of-month and day-of-week interaction follows POSIX/Vixie cron: when both are restricted (neither `*`), the job fires when **either** matches.

Each job must define exactly one of `every` or `cron`. Cron times are evaluated in the **server's local timezone**, at minute granularity.

`background-jobs-main` owns the schedule and enqueues the configured jobs into the normal Velocious background-jobs queue. The HTTP server does not run scheduled jobs itself.

## Persistence and retries

Jobs are persisted in the configured database (`backgroundJobs.databaseIdentifier`) in an internal `background_jobs` table. When a worker picks a job, the job is marked as handed off and the worker reports completion or failure back to the main process.

Failed jobs are re-queued with backoff and retried up to 10 times by default (10s, 1m, 10m, 1h, then +1h per retry). You can override the retry limit per job:

```js
await MyJob.performLaterWithOptions({
  args: ["a", "b"],
  options: {maxRetries: 3}
})
```

If a handed-off job does not report back within 2 hours, it is marked orphaned and re-queued if retries remain.

## Dashboard

Velocious ships a mountable read-only HTTP API for inspecting jobs (queued, running, completed, failed, orphaned and scheduled), similar in spirit to `sidekiq-web`. Mount it in your routes file the way `Sidekiq::Web` is mounted in Rails:

```js
import VelociousBackgroundJobsApi from "velocious/build/src/background-jobs/web/index.js"

routes.draw((route) => {
  route.mount(VelociousBackgroundJobsApi, {
    at: "/velocious/jobs",
    authorize: async ({request, ability}) => Boolean(ability?.can("manage", "BackgroundJobs")),
    accessTokens: [process.env.VELOCIOUS_JOBS_TOKEN]
  })
})
```

It exposes `GET /api/stats`, `/api/jobs`, `/api/jobs/:id`, `/api/schedule` and `/api/health` under the mount path, gated by a bearer token and/or an `authorize` callback (loopback-only when neither is configured). The dashboard UI is a separate Expo app. See [docs/background-jobs-dashboard.md](docs/background-jobs-dashboard.md).

# Running a server

```bash
npx velocious server --host 0.0.0.0 --port 8082
```

When the server runs in the `development` environment, Velocious watches application `src/` trees and hot-reloads by recycling HTTP workers after `.js`/`.mjs`/`.cjs`/`.json`/`.ejs` changes. That picks up edited controllers, models, resources, routes, and views without a manual server restart while keeping production/test behavior unchanged.

Starting the HTTP server creates `tmp/server.lock` under the configured application directory before Beacon, workers, or the TCP listener start. A second server for the same app fails fast with the lock owner details instead of partially starting. Normal shutdown removes the lock; stale locks with a dead local PID are reclaimed automatically, while locks from another host or unreadable metadata should be removed manually only after confirming no server is running. See [docs/http-server.md](docs/http-server.md#server-lock).

# Authorization (CanCan-style)

Define resource classes with an `abilities()` method and use `can` / `cannot` rules to constrain model access.

```js
import Ability from "velocious/build/src/authorization/ability.js"
import BaseResource from "velocious/build/src/authorization/base-resource.js"
import User from "@/src/models/user"

class UserResource extends BaseResource {
  static ModelClass = User

  abilities() {
    const currentUser = this.currentUser()

    if (currentUser) {
      this.can("read", {id: currentUser.id()})
    }
  }
}

export default new Configuration({
  // ...
  abilityResolver: ({configuration, params, request, response}) => {
    return new Ability({
      context: {
        configuration,
        currentUser: undefined, // set from your auth/session layer
        params,
        request,
        response
      },
      resources: [UserResource]
    })
  }
})
```

Then query through authorization rules:

```js
const users = await User.accessible().toArray()
```

`accessible()` reads from `Current.ability()` (request-scoped via AsyncLocalStorage on Node).

You can also pass an ability explicitly:

```js
const ability = new Ability({context: {currentUser}, resources: [UserResource]})
const users = await User.accessible(ability).toArray()
```

Or require explicit ability passing:

```js
const users = await User.accessibleBy(ability).toArray()
```

# Tenant / elevator support

Velocious can resolve a request-scoped tenant and override configured database identifiers per tenant for HTTP routes, websocket subscriptions, and websocket event delivery.

```js
import Configuration from "velocious/build/src/configuration.js"

export default new Configuration({
  // ...
  tenantResolver: async ({params, subscription}) => {
    const projectSlug = subscription?.params?.project_slug || params.project_slug

    if (!projectSlug) return

    return {
      databaseIdentifiers: ["auditTenant"],
      projectSlug
    }
  },
  tenantDatabaseResolver: ({databaseConfiguration, identifier, tenant}) => {
    if (identifier !== "auditTenant" || !tenant?.projectSlug) return

    return {name: `${databaseConfiguration.name}-${tenant.projectSlug}`}
  }
})
```

Use `configuration.runWithTenant(tenant, callback)` or `Current.tenant()` when custom model/database routing needs to read the active tenant manually. The tenant is an app-defined value — inputs (`runWithTenant`/`Current.setTenant`/`Current.withTenant`) accept any `object`, `Current.tenant()` returns `Record<string, unknown> | undefined`, and the `switchesTenantDatabase(...)` resolver callback receives `Record<string, unknown> | null | undefined`, so narrow before reading fields. See [tenant object typing](docs/tenant-databases.md#tenant-object-typing).

Tenant-switched model classes fail closed by default: if `switchesTenantDatabase(...)` cannot resolve a tenant database identifier for the current tenant, Velocious raises `TenantDatabaseScopeError` instead of running the query against the configured fallback database. Set `enforceTenantDatabaseScopes: false` only for legacy apps that still need the old fallback behavior during migration.

For Apartment-style project/account databases, mark the logical per-tenant identifier with `tenantOnly: true`, provide `tenantDatabaseProviders`, and run tenant lifecycle commands explicitly. One logical identifier can resolve to any number of physical tenant databases at runtime; provider `listTenants` is queried for every command run so added/removed tenants do not require configuration changes or redeploys.

```sh
npx velocious db:tenants:create projectTenant
npx velocious db:tenants:check projectTenant
npx velocious db:tenants:migrate projectTenant
npx velocious db:tenants:migrate projectTenant --parallel 20
```

`afterMigrateTenant` hooks run inside the active default and tenant database connection scope for the tenant being migrated.

See [docs/tenant-databases.md](docs/tenant-databases.md) for the full configuration and migration pattern.
