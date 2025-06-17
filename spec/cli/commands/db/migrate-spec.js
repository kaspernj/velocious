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
    })

    await cli.execute()

    let projectForeignKey, tablesResult

    await dbPool.withConnection(async (db) => {
      const tables = await db.getTables()

      tablesResult = tables.map((table) => table.getName())

      const table = await db.getTableByName("tasks")
      const foreignKeys = await table.getForeignKeys()

      projectForeignKey = foreignKeys.find((foreignKey) => foreignKey.getColumnName() == "project_id")
    })

    expect(tablesResult).toEqual(
      [
        "project_translations",
        "projects",
        "tasks"
      ]
    )

    expect(projectForeignKey.getTableName()).toEqual("tasks")
    expect(projectForeignKey.getColumnName()).toEqual("project_id")
    expect(projectForeignKey.getReferencedTableName()).toEqual("projects")
    expect(projectForeignKey.getReferencedColumnName()).toEqual("id")
  })
})
