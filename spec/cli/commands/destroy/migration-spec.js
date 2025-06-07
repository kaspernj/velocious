import Cli from "../../../../src/cli/index.js"
import dummyDirectory from "../../../dummy/dummy-directory.js"

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
