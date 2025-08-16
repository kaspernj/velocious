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

# Migrations

```bash
npx velocious g:migration create_tasks
```

```bash
npx velocious db:migrate
```

# Models

```bash
npx velocious g:model Task
```

# Migrations
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

# Querying

```js
import {Task} from "@/src/models/task"

const tasks = await Task
  .preload({project: {account: true}})
  .where({projects: {public: true}})
  .toArray()
```

# Testing

```bash
npm run test
```

# Running a server

```bash
npx velocious server
```
