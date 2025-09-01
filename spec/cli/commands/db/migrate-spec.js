import Cli from "../../../../src/cli/index.js"
import dummyDirectory from "../../../dummy/dummy-directory.js"

describe("Cli - Commands - db:migrate", () => {
  it("runs migrations", async () => {
    const directory = dummyDirectory()
    const cli = new Cli({
      directory,
      processArgs: ["db:migrate"],
      testing: true
    })

    await cli.loadConfiguration()

    const dbPool = cli.configuration.getDatabasePool()

    await dbPool.withConnection(async (db) => {
      await db.query("DROP TABLE IF EXISTS tasks")
      await db.query("DROP TABLE IF EXISTS project_translations")
      await db.query("DROP TABLE IF EXISTS projects")
      await db.query("DROP TABLE IF EXISTS schema_migrations")
    })

    await cli.execute()

    let projectForeignKey, schemaMigrations, tablesResult

    await dbPool.withConnection(async (db) => {
      const tables = await db.getTables()

      tablesResult = tables.map((table) => table.getName()).sort()

      const table = await db.getTableByName("tasks")
      const foreignKeys = await table.getForeignKeys()

      projectForeignKey = foreignKeys.find((foreignKey) => foreignKey.getColumnName() == "project_id")

      schemaMigrations = (await db.query("SELECT * FROM schema_migrations ORDER BY version")).map((schemaMigration) => schemaMigration.version)
    })

    expect(tablesResult).toEqual(
      [
        "project_translations",
        "projects",
        "schema_migrations",
        "tasks"
      ]
    )

    expect(projectForeignKey.getTableName()).toEqual("tasks")
    expect(projectForeignKey.getColumnName()).toEqual("project_id")
    expect(projectForeignKey.getReferencedTableName()).toEqual("projects")
    expect(projectForeignKey.getReferencedColumnName()).toEqual("id")

    expect(schemaMigrations).toEqual(["20230728075328", "20230728075329", "20250605133926"])
  })
})
