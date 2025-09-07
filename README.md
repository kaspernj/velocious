# README

This is still work in progress.

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
import Record from "velocious/src/database/record/index.js"

class Task extends Record {
}

Task.belongsTo("account")
Task.translates("description", "subTitle", "title")

export default Task
```

# Migrations

Make a new migration from a template like this:

```bash
npx velocious g:migration create-tasks
```

```js
import Migration from "velocious/src/database/migration/index.js"

export default class CreateEvents extends Migration {
  async up() {
    await this.createTable("tasks", (t) => {
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
    await this.dropTable("tasks")
  }
}
```

Run migrations from the command line like this:
```bash
npx velocious db:migrate
```

Run migrations from anywhere if you want to:

```js
const migrationsPath = `/some/dir/migrations`
const files = await new FilesFinder({path: migrationsPath}).findFiles()

await this.configuration.withConnections(async () => {
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
  .where({projects: {public: true}})
  .order("name")
  .limit(5)
  .toArray()
```

# Testing

If you are using Velocious for an app, Velocious has a built-in testing framework. You can run your tests like this:
```bash
npx velocious test
```

If you are developing on Velocious, you can run the tests with:

```bash
npm run test
```

# Writing a request test

First create a test file under something like the following path 'src/routes/accounts/create-test.js' with something like the following content:

```js
import {describe, expect, it} from "velocious/src/testing/test.js"
import Account from "../../models/account.js"

await describe("accounts - create", {type: "request"}, async () => {
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

# Running a server

```bash
npx velocious server
```
