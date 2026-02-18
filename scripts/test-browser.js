// @ts-check

import fs from "node:fs/promises"
import path from "node:path"
import {pathToFileURL} from "node:url"
import {build} from "esbuild"
import initSqlJs from "sql.js"
import SystemTest from "system-testing/build/system-test.js"
import Application from "../src/application.js"
import Configuration from "../src/configuration.js"
import BrowserEnvironmentHandler from "../src/environment-handlers/browser.js"
import NodeEnvironmentHandler from "../src/environment-handlers/node.js"
import SqliteWebDriver from "../src/database/drivers/sqlite/index.web.js"
import SingleMultiUsePool from "../src/database/pool/single-multi-use.js"
import queryWeb from "../src/database/drivers/sqlite/query.web.js"
import Migrator from "../src/database/migrator.js"
import TestFilesFinder from "../src/testing/test-files-finder.js"
import TestRunner from "../src/testing/test-runner.js"
import {normalizeExamplePatterns, parseFilters} from "../src/testing/test-filter-parser.js"
import dummyDirectory from "../spec/dummy/dummy-directory.js"

const rootDir = process.cwd()
const distDir = path.join(rootDir, "dist")
const entryFile = path.join(rootDir, "src/testing/browser-test-app.js")
const defaultBrowserPattern = /\.browser-(spec|test)\.(m|)js$/
const shared = {
  sqlJsDatabase: null,
  sqlJsConnection: null,
  migrationsPrepared: false,
  modelsPrepared: false
}

/**
 * @returns {RegExp} - Browser test file regex.
 */
function browserTestPattern() {
  const customPattern = process.env.VELOCIOUS_BROWSER_TEST_PATTERN
  return customPattern ? new RegExp(customPattern) : defaultBrowserPattern
}

/**
 * @param {string} filePath - File path.
 * @returns {boolean} - Whether file matches browser test pattern.
 */
function isBrowserTestFile(filePath) {
  return browserTestPattern().test(path.basename(filePath))
}

/**
 * @returns {Promise<void>} - Resolves when the browser test app is built.
 */
async function buildBrowserTestApp() {
  await fs.rm(distDir, {recursive: true, force: true})
  await fs.mkdir(distDir, {recursive: true})

  await build({
    entryPoints: [entryFile],
    bundle: true,
    define: {
      "process.env.EXPO_PUBLIC_SYSTEM_TEST": JSON.stringify(process.env.EXPO_PUBLIC_SYSTEM_TEST || ""),
      "process.env.EXPO_PUBLIC_SYSTEM_TEST_HOST": JSON.stringify(process.env.EXPO_PUBLIC_SYSTEM_TEST_HOST || "")
    },
    format: "esm",
    outdir: distDir,
    platform: "browser",
    target: "es2020",
    logLevel: "silent",
    sourcemap: true
  })

  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Velocious Browser Tests</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/browser-test-app.js"></script>
  </body>
</html>
`

  await fs.writeFile(path.join(distDir, "index.html"), html, "utf8")
}

/**
 * @returns {Promise<import("sql.js").Database>} - The SQL.js database instance.
 */
async function getSqlJsDatabase() {
  if (shared.sqlJsDatabase) return shared.sqlJsDatabase

  const SQL = await initSqlJs({
    locateFile: (file) => path.join(rootDir, "node_modules/sql.js/dist", file)
  })

  shared.sqlJsDatabase = new SQL.Database()

  return shared.sqlJsDatabase
}

/**
 * @param {import("sql.js").Database} database - SQL.js database instance.
 * @returns {{query: (sql: string) => Promise<Record<string, unknown>[]>, close: () => Promise<void>}} - Connection wrapper.
 */
function createSqlJsConnection(database) {
  return {
    query: async (sql) => await queryWeb(database, sql),
    close: async () => {
      database.close()
    }
  }
}

/**
 * @param {import("../src/configuration.js").default} configuration - Configuration instance.
 * @returns {Promise<void>} - Resolves when prepared.
 */
async function runDummyMigrations(configuration) {
  if (shared.migrationsPrepared) return

  const nodeEnvironmentHandler = new NodeEnvironmentHandler()
  nodeEnvironmentHandler.setConfiguration(configuration)

  const migrator = new Migrator({configuration})

  await configuration.ensureConnections(async () => {
    await migrator.prepare()
    const migrations = await nodeEnvironmentHandler.findMigrations()
    await migrator.migrateFiles(migrations, async (filePath) => await nodeEnvironmentHandler.requireMigration(filePath))
  })

  shared.migrationsPrepared = true
}

/**
 * @param {import("../src/configuration.js").default} configuration - Configuration instance.
 * @returns {Promise<void>} - Resolves when models are initialized.
 */
async function initializeDummyModels(configuration) {
  if (shared.modelsPrepared) return

  const modelsPath = path.join(dummyDirectory(), "src/models")
  const modelFiles = await findFiles(modelsPath)

  await configuration.ensureConnections(async (dbs) => {
    const db = dbs.default

    for (const modelFile of modelFiles) {
      const modelImport = await import(pathToFileURL(modelFile).href)
      const modelClass = modelImport.default

      if (!modelClass?.initializeRecord) {
        throw new Error(`Model wasn't exported from: ${modelFile}`)
      }

      if (typeof modelClass.getDatabaseIdentifier === "function" && modelClass.getDatabaseIdentifier() !== "default") {
        continue
      }

      const tableName = modelClass.tableName()

      if (!db || !await db.tableExists(tableName)) {
        continue
      }

      await modelClass.initializeRecord({configuration})

      if (await modelClass.hasTranslationsTable()) {
        const translationClass = modelClass.getTranslationClass()
        const translationTableName = translationClass.tableName()

        if (db && await db.tableExists(translationTableName)) {
          await translationClass.initializeRecord({configuration})
        }
      }
    }
  })

  shared.modelsPrepared = true
}

/**
 * @param {string} directory - Directory path.
 * @returns {Promise<string[]>} - Resolved file paths.
 */
async function findFiles(directory) {
  const entries = await fs.readdir(directory, {withFileTypes: true})
  const files = []

  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name)

    if (entry.isDirectory()) {
      const nestedFiles = await findFiles(fullPath)
      files.push(...nestedFiles)
    } else if (entry.isFile() && entry.name.endsWith(".js")) {
      files.push(fullPath)
    }
  }

  return files
}

/**
 * @returns {Promise<import("../src/configuration.js").default>} - The configuration.
 */
async function resolveConfiguration({testFilesRequireContextCallback} = {}) {
  const sqlJsDatabase = await getSqlJsDatabase()

  if (!shared.sqlJsConnection) {
    shared.sqlJsConnection = createSqlJsConnection(sqlJsDatabase)
  }

  const configuration = new Configuration({
    database: {
      test: {
        default: {
          driver: SqliteWebDriver,
          poolType: SingleMultiUsePool,
          type: "sqlite",
          name: "browser-test-db",
          migrations: true,
          getConnection: () => shared.sqlJsConnection
        }
      }
    },
    debug: false,
    directory: dummyDirectory(),
    environment: "test",
    environmentHandler: new BrowserEnvironmentHandler({
      testFilesRequireContextCallback
    }),
    locale: () => "en",
    localeFallbacks: {
      de: ["de", "en"],
      en: ["en", "de"]
    },
    locales: ["de", "en"]
  })

  configuration.setCurrent()

  await runDummyMigrations(configuration)
  await initializeDummyModels(configuration)

  return configuration
}

/**
 * @param {string[]} processArgs - Process args.
 * @returns {Promise<{directory: string, testFiles: string[], lineFilters: Record<string, number[]>, includeTags: string[], excludeTags: string[], examplePatterns: RegExp[]}>} - Test data.
 */
async function resolveTests(processArgs) {
  const directory = process.env.VELOCIOUS_TEST_DIR
    ? path.resolve(process.env.VELOCIOUS_TEST_DIR)
    : rootDir
  const directories = process.env.VELOCIOUS_TEST_DIR
    ? [directory]
    : [`${rootDir}/__tests__`, `${rootDir}/tests`, `${rootDir}/spec`]

  const {includeTags, excludeTags, examplePatterns, filteredProcessArgs} = parseFilters(processArgs)
  const testFilesFinder = new TestFilesFinder({
    directory,
    directories,
    processArgs: filteredProcessArgs
  })
  const testFiles = await testFilesFinder.findTestFiles()
  const browserTestFiles = testFiles.filter((file) => isBrowserTestFile(file))

  if (browserTestFiles.length === 0) {
    throw new Error("No browser tests matched. Use *.browser-test.js or *.browser-spec.js (override with VELOCIOUS_BROWSER_TEST_PATTERN).")
  }

  return {
    directory,
    testFiles: browserTestFiles,
    lineFilters: testFilesFinder.getLineFiltersByFile(),
    includeTags,
    excludeTags,
    examplePatterns: normalizeExamplePatterns(examplePatterns)
  }
}

/**
 * @param {string[]} testFiles - Test files to import.
 * @returns {{(key: string): Promise<unknown> | unknown, keys: () => string[], id: string}} - Require context for test files.
 */
function createTestFilesRequireContext(testFiles) {
  const cachedImports = new Map()
  const keys = [...testFiles]

  const context = (key) => {
    if (!cachedImports.has(key)) {
      cachedImports.set(key, import(pathToFileURL(key).href))
    }

    return cachedImports.get(key)
  }

  context.keys = () => keys
  context.id = "velocious-test-files"

  return context
}

/**
 * @param {import("../src/configuration.js").default} configuration - Configuration instance.
 * @param {number} port - Backend server port.
 * @returns {Promise<Application>} - Started backend app instance.
 */
async function startBrowserBackendServer(configuration, port) {
  const application = new Application({
    configuration,
    httpServer: {
      host: "127.0.0.1",
      port
    },
    type: "server"
  })

  await application.initialize()
  await application.startHttpServer()

  return application
}

async function main() {
  const processArgs = ["test:browser", ...process.argv.slice(2)]

  process.env.VELOCIOUS_BROWSER_TESTS = "true"
  process.env.VELOCIOUS_DISABLE_MSSQL ||= "1"
  process.env.SYSTEM_TEST_HOST ||= "dist"
  const browserBackendPort = process.env.VELOCIOUS_BROWSER_BACKEND_PORT ? Number(process.env.VELOCIOUS_BROWSER_BACKEND_PORT) : 4501
  const systemTestHttpHost = process.env.SYSTEM_TEST_HTTP_HOST || "127.0.0.1"
  const systemTestHttpPort = process.env.SYSTEM_TEST_HTTP_PORT ? Number(process.env.SYSTEM_TEST_HTTP_PORT) : 1984

  if (!Number.isFinite(browserBackendPort)) {
    throw new Error(`VELOCIOUS_BROWSER_BACKEND_PORT must be a number. Got: ${String(process.env.VELOCIOUS_BROWSER_BACKEND_PORT)}`)
  }

  if (!Number.isFinite(systemTestHttpPort)) {
    throw new Error(`SYSTEM_TEST_HTTP_PORT must be a number. Got: ${String(process.env.SYSTEM_TEST_HTTP_PORT)}`)
  }

  await buildBrowserTestApp()

  const {testFiles, lineFilters, includeTags, excludeTags, examplePatterns} = await resolveTests(processArgs)
  const configuration = await resolveConfiguration({
    testFilesRequireContextCallback: async () => createTestFilesRequireContext(testFiles)
  })
  const testRunner = new TestRunner({
    configuration,
    excludeTags,
    includeTags,
    testFiles,
    lineFilters,
    examplePatterns
  })
  const systemTest = SystemTest.current({
    debug: process.env.SYSTEM_TEST_DEBUG === "true",
    httpHost: systemTestHttpHost,
    httpPort: systemTestHttpPort
  })
  /** @type {Application | undefined} */
  let backendApplication
  let systemTestStarted = false

  try {
    const backendConfiguration = await loadBrowserBackendConfiguration()
    backendApplication = await startBrowserBackendServer(backendConfiguration, browserBackendPort)
    await systemTest.start()
    systemTestStarted = true

    await testRunner.prepare()

    if (testRunner.getTestsCount() === 0) {
      throw new Error(`${testRunner.getTestsCount()} tests was found in ${testFiles.length} file(s)`)
    }

    await testRunner.run()

    const executedTests = testRunner.getExecutedTestsCount()
    const hasLineFilters = Object.keys(testRunner.getLineFilters()).length > 0
    const hasExampleFilters = examplePatterns.length > 0
    const hasTagFilters = includeTags.length > 0 || excludeTags.length > 0

    if ((hasTagFilters || hasLineFilters || hasExampleFilters) && executedTests === 0) {
      console.error("\nNo tests matched the provided filters")
      process.exitCode = 1
      return
    }

    if (testRunner.isFailed()) {
      const failedTests = testRunner.getFailedTestDetails()

      if (failedTests.length > 0) {
        console.error("\nFailed tests:")

        for (const failed of failedTests) {
          const location = failed.filePath && failed.line
            ? ` (${failed.filePath}:${failed.line})`
            : ""
          console.error(`- ${failed.fullDescription}${location}`)
        }
      }

      console.error(`\nTest run failed with ${testRunner.getFailedTests()} failed tests and ${testRunner.getSuccessfulTests()} successfull`)
      process.exitCode = 1
    } else if (testRunner.areAnyTestsFocussed()) {
      console.error(`\nFocussed run with ${testRunner.getFailedTests()} failed tests and ${testRunner.getSuccessfulTests()} successfull`)
      process.exitCode = 1
    } else {
      console.log(`\nTest run succeeded with ${testRunner.getSuccessfulTests()} successful tests`)
    }
  } finally {
    if (systemTestStarted) {
      await systemTest.stop()
    }

    if (backendApplication) {
      await backendApplication.stop()
    }
  }
}

/**
 * @returns {Promise<import("../src/configuration.js").default>} - Backend configuration for browser tests.
 */
async function loadBrowserBackendConfiguration() {
  const dummyConfigurationPath = path.join(dummyDirectory(), "src/config/configuration.js")

  try {
    await fs.access(dummyConfigurationPath)
  } catch {
    throw new Error(`Missing dummy backend configuration for browser tests: ${dummyConfigurationPath}`)
  }

  const dummyConfigurationImport = await import(pathToFileURL(dummyConfigurationPath).href)

  return dummyConfigurationImport.default
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
