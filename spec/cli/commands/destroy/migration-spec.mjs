import Cli from "../../../../src/cli/index.mjs"
import dummyDirectory from "../../../dummy/dummy-directory.mjs"

describe("Cli - destroy - migration", () => {
  it("destroys an existing migration", async () => {
    const cli = new Cli({
      directory: dummyDirectory(),
      processArgs: ["d:migration", "create-tasks"],
      testing: true
    })
    const result = await cli.execute()

    expect(result.destroyed).toEqual(["create-tasks"])
  })
})
