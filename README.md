# README

* Concurrent multi threadded web server
* Database framework with familiar MVC concepts
* Database models with migrations and validations
* Database models that work almost the same in frontend and backend
* Migrations for schema changes
* Controllers and views for HTTP endpoints

# Setup

Make a new NPM project.
```bash
mkdir project
cd project
npm install velocious
npx velocious init
```

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

Listen for retry events if you need to restart services between attempts.

```js
import {testEvents} from "velocious/build/src/testing/test.js"

testEvents.on("testRetrying", ({testDescription, nextAttempt}) => {
  console.log(`Retrying ${testDescription} (attempt ${nextAttempt})`)
})

testEvents.on("testRetried", ({testDescription, attemptNumber}) => {
  console.log(`Retry attempt finished for ${testDescription} (attempt ${attemptNumber})`)
})
```

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
    return this.mail({to: user.email(), subject: "New task", actionName: "newNotification"})
  }
}
```

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

If your mailer needs async setup, keep the action sync and pass `actionPromise`:

```js
resetPassword(user) {
  return this.mail({
    to: user.email(),
    subject: "Reset your password",
    actionName: "resetPassword",
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

```js
import Record from "velocious/build/src/database/record/index.js"

class Task extends Record {
}

Task.belongsTo("account")
Task.translates("description", "subTitle", "title")
Task.validates("name", {presence: true, uniqueness: true})

export default Task
```

## Preloading relationships

```js
const tasks = await Task.preload({project: {translations: true}}).toArray()
const projectNames = tasks.map((task) => task.project().name())
```

## Load a relationship after init

```js
const task = await Task.find(5)

await task.loadProject()

const projects = task.project()
```

```js
const project = await Project.find(4)

await project.loadTasks()

const tasks = project.tasks().loaded()
```

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
```js
import Migration from "velocious/build/src/database/migration/index.js"

export default class CreateEvents extends Migration {
  async up() {
    await this.createTable("tasks", (t) => {
      t.timestamps()
    })

    // UUID primary key
    await this.createTable("uuid_items", {id: {type: "uuid"}}, (t) => {
      t.string("title", {null: false})
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
```

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

### Ordering

```js
const tasks = await Task.order("name").toArray()
```

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

# Logging

Velocious includes a lightweight logger that can write to both console and file and is environment-aware.

- **Defaults**: In the `test` environment, console logging is disabled, but file logging still happens to `log/test.log` (created automatically). In other environments, console logging is enabled and file logging is enabled if a file path is available.
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

- **Environment handlers**: File-path resolution and file writes are delegated to the environment handler so browser builds stay bundle-friendly.
  - Node handler writes to `<directory>/<environment>.log` by default.
  - Custom handlers can override `getDefaultLogDirectory`, `getLogFilePath`, and `writeLogToFile` if needed.

- **Debug logging**: When `configuration.debug` is true or a `Logger` is constructed with `{debug: true}`, messages are emitted regardless of environment.

- **Per-instance control**: You can create a `new Logger("Subject", {configuration, debug: false})` to honor the configuration defaults, or toggle `logger.setDebug(true)` for verbose output in specific cases.

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
    this.renderJson({status: "database-truncated"})
  }

  async anotherAction() {
    render("test-view")
  }
}
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
    databaseIdentifier: "default"
  }
})
```

Or via env vars:

```
VELOCIOUS_BACKGROUND_JOBS_HOST=127.0.0.1
VELOCIOUS_BACKGROUND_JOBS_PORT=7331
VELOCIOUS_BACKGROUND_JOBS_DATABASE_IDENTIFIER=default
```

## Defining jobs

```js
import VelociousJob from "velocious/build/src/background-jobs/job.js"

export default class MyJob extends VelociousJob {
  async perform(arg1, arg2) {
    await doWork(arg1, arg2)
  }
}
```

Queue a job:

```js
await MyJob.performLater("a", "b")
```

Jobs are forked by default (detached from the worker). To run inline:

```js
await MyJob.performLaterWithOptions({
  args: ["a", "b"],
  options: {forked: false}
})
```

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

# Running a server

```bash
npx velocious server --host 0.0.0.0 --port 8082
```
