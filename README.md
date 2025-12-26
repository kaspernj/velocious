# README

* Concurrent multi threadded web server
* Database framework ala Rails
* Database models ala Rails
* Database models that work almost the same in frontend and backend
* Migrations ala Rails
* Controllers and views ala Rails

# Setup

Make a new NPM project.
```bash
mkdir project
cd project
npm install velocious
npx velocious init
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

### Finding records

`find()` and `findByOrFail()` throw an error when no record is found. `findBy()` returns `null`.

### Create records

```js
const task = new Task({identifier: "task-4"})

task.assign({name: "New task})

await task.save()
```

```js
const task = await Task.create({name: "Task 4"})
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

```js
import {Task} from "@/src/models/task"

const tasks = await Task
  .preload({project: {account: true}})
  .joins({project: true})
  .where({projects: {public: true}})
  .joins("JOIN task_details ON task_details.task_id = tasks.id")
  .where("task_details.id IS NOT NULL")
  .order("name")
  .limit(5)
  .toArray()

// Efficiently pluck columns without instantiating models
const names = await Task.pluck("name")                     // ["Task A", "Task B"]
const idsAndNames = await Task.all().order("name").pluck("id", "name") // [[1, "Task A"], [2, "Task B"]]
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

## Broadcast an event from backend code

Any backend code (controllers, services, jobs) can publish to subscribed websocket clients using the shared event bus on the configuration:

```js
// Inside a controller action
const {channel, payload} = this.getParams() // or compose your own payload
this.getConfiguration().getWebsocketEvents().publish(channel, payload)
this.renderJsonArg({status: "published"})
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

# Views

Create the file `src/routes/testing/another-action.ejs` and so something like this:

```ejs
<p>
  View for path: <%= controller.getRequest().path() %>
</p>
```

# Running a server

```bash
npx velocious server --host 0.0.0.0 --port 8082
```
