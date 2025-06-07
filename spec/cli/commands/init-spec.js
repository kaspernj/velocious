import Cli from "../../../src/cli/index.js"
import dummyDirectory from "../../dummy/dummy-directory.js"

describe("Cli - Commands - init", () => {
  it("inits files and dirs", async () => {
    const cli = new Cli({
      directory: dummyDirectory(),
      processArgs: ["init"],
      testing: true
    })
    const result = await cli.execute()

    expect(result.fileMappings.length).toEqual(2)
    expect(result.fileMappings[0].source).toContain("/src/templates/configuration.js")
    expect(result.fileMappings[0].target).toContain("/spec/dummy/src/config/configuration.js")
    expect(result.fileMappings[1].source).toContain("/src/templates/routes.js")
    expect(result.fileMappings[1].target).toContain("/spec/dummy/src/config/routes.js")
  })
})
