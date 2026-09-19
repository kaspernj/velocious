import { configuration, ExpoCompatibilityRecord, ExpoCompatibilityTask, runFrontendTenantDatabaseProof, SqliteDriver, useCreatedEvent } from "./velocious-runtime"

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

export default async function runExpoCompatibilityTests() {
  assertEqual(configuration.getEnvironment(), "development", "Configuration should initialize inside Expo")
  assertEqual(ExpoCompatibilityRecord.getModelName(), "ExpoCompatibilityRecord", "Database record should import inside Expo")
  assertEqual(ExpoCompatibilityTask.getModelName(), "ExpoCompatibilityTask", "Frontend model should expose stable model name")
  assertEqual(ExpoCompatibilityTask.primaryKey(), "id", "Frontend model should expose primary key")
  assertTrue(typeof useCreatedEvent === "function", "Frontend model event hooks should import inside Expo")
  assertTrue(SqliteDriver.name.includes("Sqlite"), "Extensionless SQLite driver import should resolve to a SQLite driver")

  const task = new ExpoCompatibilityTask({id: 123, name: "Expo"})

  assertEqual(task.primaryKeyValue(), 123, "Frontend model instance should read primary key")
  assertEqual(task.readAttribute("name"), "Expo", "Frontend model instance should read assigned attributes")

  const tenantProof = await runFrontendTenantDatabaseProof()

  assertTrue(tenantProof.distinctDatabaseIdentities, "Project replicas should use distinct physical database identities")
  assertEqual(tenantProof.alphaNames.join("|"), "alpha-only", "Alpha should reload only alpha records")
  assertEqual(tenantProof.betaNames.join("|"), "beta-only", "Beta should reload only beta records")

  return "configuration, frontend models, hooks, and two real tenant SQLite replicas passed"
}
