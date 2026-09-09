// @ts-check

import { describe, expect, it } from "../../../../src/testing/test.js"
import AsyncTrackedMultiConnection from "../../../../src/database/pool/async-tracked-multi-connection.js"
import Cli from "../../../../src/cli/index.js"
import Configuration from "../../../../src/configuration.js"
import EnvironmentHandlerNode from "../../../../src/environment-handlers/node.js"
import fs from "fs/promises"
import os from "os"
import path from "path"
import SqliteDriver from "../../../../src/database/drivers/sqlite/index.js"

describe("Cli - Commands - db:migrate execution phases", () => {
  /**
   * Builds a CLI for an isolated application directory.
   * @param {object} args - Builder arguments.
   * @param {string} args.directory - Application directory.
   * @param {string[]} args.processArgs - CLI process arguments.
   * @param {boolean} [args.withPackage] - Whether to register the test package.
   * @returns {{cli: Cli, configuration: Configuration}} - CLI context.
   */
  function buildCli({directory, processArgs, withPackage = false}) {
    const configuration = new Configuration({
      database: {
        test: {
          analytics: {
            driver: SqliteDriver,
            migrations: true,
            name: "migration-phase-analytics",
            poolType: AsyncTrackedMultiConnection,
            type: "sqlite"
          },
          default: {
            driver: SqliteDriver,
            migrations: true,
            name: "migration-phase-default",
            poolType: AsyncTrackedMultiConnection,
            type: "sqlite"
          }
        }
      },
      directory,
      environment: "test",
      environmentHandler: new EnvironmentHandlerNode(),
      initializeModels: async () => {},
      locale: "en",
      localeFallbacks: {en: ["en"]},
      locales: ["en"],
      packages: withPackage ? [{name: "phase-package", path: path.join(directory, "phase-package")}] : []
    })
    const cli = new Cli({configuration, processArgs, testing: true})

    return {cli, configuration}
  }

  /**
   * Writes one migration module.
   * @param {object} args - Migration source arguments.
   * @param {string} args.body - Migration change body.
   * @param {string} args.className - Migration class name.
   * @param {string[]} [args.databaseIdentifiers] - Explicit database targets.
   * @param {string} args.directory - Migrations directory.
   * @param {string} args.file - Migration filename.
   * @param {"post-publication" | "pre-runtime"} [args.phase] - Explicit execution phase.
   * @returns {Promise<void>} - Resolves after writing.
   */
  async function writeMigration({body, className, databaseIdentifiers, directory, file, phase}) {
    const migrationModuleUrl = new URL("../../../../src/database/migration/index.js", import.meta.url).href
    const databaseDeclaration = databaseIdentifiers ? `${className}.onDatabases(${JSON.stringify(databaseIdentifiers)})` : ""
    const phaseDeclaration = phase ? `${className}.runInPhase(${JSON.stringify(phase)})` : ""

    await fs.mkdir(directory, {recursive: true})
    await fs.writeFile(path.join(directory, file), `
import Migration from ${JSON.stringify(migrationModuleUrl)}

class ${className} extends Migration {
  async change() {
    ${body}
  }
}

${databaseDeclaration}
${phaseDeclaration}

export default ${className}
`, "utf8")
  }

  it("selects app and package migrations by phase while preserving ordering and database targets", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "velocious-db-migrate-phase-"))
    const appMigrations = path.join(directory, "src", "database", "migrations")
    const packageMigrations = path.join(directory, "phase-package", "src", "database", "migrations")
    const {cli, configuration} = buildCli({directory, processArgs: ["db:migrate", "--phase", "post-publication"], withPackage: true})

    await writeMigration({
      body: "await this.execute(\"CREATE TABLE pre_runtime_only(id integer PRIMARY KEY)\")",
      className: "CreatePreRuntimeOnly",
      directory: appMigrations,
      file: "20260901010100-create-pre-runtime-only.js"
    })
    await writeMigration({
      body: "await this.execute(\"CREATE TABLE phase_order(position integer NOT NULL, name varchar(255) NOT NULL)\"); await this.execute(\"INSERT INTO phase_order(position, name) VALUES (1, 'package')\")",
      className: "CreatePackagePhaseOrder",
      directory: packageMigrations,
      file: "20260901010200-create-package-phase-order.js",
      phase: "post-publication"
    })
    await writeMigration({
      body: "await this.execute(\"INSERT INTO phase_order(position, name) VALUES (2, 'application')\")",
      className: "AppendApplicationPhaseOrder",
      directory: appMigrations,
      file: "20260901010300-append-application-phase-order.js",
      phase: "post-publication"
    })
    await writeMigration({
      body: "await this.execute(\"CREATE TABLE analytics_post_publication(id integer PRIMARY KEY)\")",
      className: "CreateAnalyticsPostPublication",
      databaseIdentifiers: ["analytics"],
      directory: appMigrations,
      file: "20260901010400-create-analytics-post-publication.js",
      phase: "post-publication"
    })

    try {
      await cli.execute()
      await configuration.ensureConnections(async (dbs) => {
        expect(await dbs.default.tableExists("pre_runtime_only")).toEqual(false)
        expect(await dbs.default.query("SELECT name FROM phase_order ORDER BY position")).toEqual([
          {name: "package"},
          {name: "application"}
        ])
        expect(await dbs.analytics.tableExists("phase_order")).toEqual(false)
        expect(await dbs.analytics.tableExists("analytics_post_publication")).toEqual(true)
        expect(await dbs.default.query("SELECT version FROM schema_migrations ORDER BY version")).toEqual([
          {version: "20260901010200"},
          {version: "20260901010300"}
        ])
        expect(await dbs.analytics.query("SELECT version FROM schema_migrations ORDER BY version")).toEqual([
          {version: "20260901010400"}
        ])
      })

      const runAllCli = new Cli({configuration, processArgs: ["db:migrate"], testing: true})

      await runAllCli.execute()
      await configuration.ensureConnections(async (dbs) => {
        expect(await dbs.default.tableExists("pre_runtime_only")).toEqual(true)
        expect(await dbs.default.query("SELECT version FROM schema_migrations ORDER BY version")).toEqual([
          {version: "20260901010100"},
          {version: "20260901010200"},
          {version: "20260901010300"}
        ])
      })
    } finally {
      await configuration.closeDatabaseConnections()
      await fs.rm(directory, {force: true, recursive: true})
    }
  })

  it("rejects missing and unknown phase values", async () => {
    for (const [processArgs, errorPattern] of [
      [["db:migrate", "--phase"], /Missing value for --phase/],
      [["db:migrate", "--phase", "during-runtime"], /Unknown migration execution phase.*during-runtime.*pre-runtime.*post-publication/]
    ]) {
      const directory = await fs.mkdtemp(path.join(os.tmpdir(), "velocious-db-migrate-phase-error-"))
      const {cli, configuration} = buildCli({directory, processArgs: /** @type {string[]} */ (processArgs)})

      try {
        await expect(async () => await cli.execute()).toThrow(/** @type {RegExp} */ (errorPattern))
      } finally {
        await configuration.closeDatabaseConnections()
        await fs.rm(directory, {force: true, recursive: true})
      }
    }
  })
})
