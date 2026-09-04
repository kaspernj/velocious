import DatabaseQuery from "../../../src/database/query/index.js"
import ModelClassQuery from "../../../src/database/query/model-class-query.js"

describe("Database query AbortSignal", () => {
  it("forwards the signal after query cloning", async () => {
    const calls = []
    const handler = {
      clone() {
        return handler
      }
    }
    const driver = {
      async query(sql, options) {
        calls.push({options, sql})

        return []
      },
      queryToSql() {
        return "SELECT 1"
      }
    }
    const signal = new AbortController().signal
    const query = new DatabaseQuery({
      driver: /** @type {import("../../../src/database/drivers/base.js").default} */ (driver),
      handler: /** @type {import("../../../src/database/handler.js").default} */ (handler)
    })

    await query.signal(signal).clone().results()

    expect(calls).toEqual([{options: {logName: "SQL", signal}, sql: "SELECT 1"}])
  })

  it("preserves the signal when a model query operation clones the query", async () => {
    const calls = []
    const handler = {
      clone() {
        return handler
      }
    }
    const driver = {
      async query(sql, options) {
        calls.push({options, sql})

        return []
      },
      quoteColumn(columnName) {
        return `\`${columnName}\``
      },
      quoteTable(tableName) {
        return `\`${tableName}\``
      },
      queryToSql() {
        return "SELECT model"
      }
    }
    class TestModel {
      static primaryKey() {
        return "id"
      }

      static orderableColumn() {
        return "id"
      }

      static tableName() {
        return "test_models"
      }
    }
    const signal = new AbortController().signal
    const query = new ModelClassQuery({
      driver: /** @type {import("../../../src/database/drivers/base.js").default} */ (driver),
      handler: /** @type {import("../../../src/database/handler.js").default} */ (handler),
      modelClass: /** @type {typeof import("../../../src/database/record/index.js").default} */ (TestModel)
    })

    await query.signal(signal).first()

    expect(calls).toEqual([{options: {logName: "TestModel Load", signal}, sql: "SELECT model"}])
  })
})
