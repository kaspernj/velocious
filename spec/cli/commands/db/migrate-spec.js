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

    const db = cli.configuration.getDatabasePool()

    await db.withConnection(async () => {
      await db.query("DROP TABLE IF EXISTS tasks")
      await db.query("DROP TABLE IF EXISTS projects")
      await db.query("DROP TABLE IF EXISTS project_translations")
    })

    await cli.execute()

    let tablesResult

    await db.withConnection(async () => {
      tablesResult = await db.query("SHOW TABLES")
    })

    expect(tablesResult).toEqual(
      [
        {Tables_in_velocious_test: "project_translations"},
        {Tables_in_velocious_test: "projects"},
        {Tables_in_velocious_test: "tasks"}
      ]
    )
  })
})
