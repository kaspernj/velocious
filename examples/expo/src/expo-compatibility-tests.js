import {configuration, ExpoCompatibilityTask, SqliteDriver, useCreatedEvent} from "./velocious-runtime"

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  }
}

function assertTrue(value, message) {
  if (!value) {
    throw new Error(message)
  }
}

async function testSqliteDriverQueryPath() {
  const queries = []
  const connection = {
    close: async () => {
      queries.push("close")
    },
    query: async (sql) => {
      queries.push(sql)

      return [{answer: 42}]
    }
  }
  const driver = new SqliteDriver({
    getConnection: () => connection,
    name: "expo-compatibility-test",
    type: "sqlite"
  }, configuration)

  await driver.connect()
  const rows = await driver.query("select 42 as answer")
  await driver.close()

  assertEqual(rows.length, 1, "SQLite driver should return one row")
  assertEqual(rows[0].answer, 42, "SQLite driver should return query result")
  assertEqual(queries.join("|"), "select 42 as answer|close", "SQLite driver should use the configured Expo/web connection")
}

export default async function runExpoCompatibilityTests() {
  assertEqual(configuration.getEnvironment(), "development", "Configuration should initialize inside Expo")
  assertEqual(ExpoCompatibilityTask.getModelName(), "ExpoCompatibilityTask", "Frontend model should expose stable model name")
  assertEqual(ExpoCompatibilityTask.primaryKey(), "id", "Frontend model should expose primary key")
  assertTrue(typeof useCreatedEvent === "function", "Frontend model event hooks should import inside Expo")
  assertTrue(SqliteDriver.name.includes("Sqlite"), "Extensionless SQLite driver import should resolve to a SQLite driver")

  const task = new ExpoCompatibilityTask({id: 123, name: "Expo"})

  assertEqual(task.primaryKeyValue(), 123, "Frontend model instance should read primary key")
  assertEqual(task.readAttribute("name"), "Expo", "Frontend model instance should read assigned attributes")

  await testSqliteDriverQueryPath()

  return "configuration, frontend models, hooks, and SQLite query path passed"
}
