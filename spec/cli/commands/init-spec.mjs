import Cli from "../../../src/cli/index.mjs"
import dummyDirectory from "../../dummy/dummy-directory.mjs"

describe("Cli - Commands - init", () => {
  it("inits files and dirs", async () => {
    const cli = new Cli({
      directory: dummyDirectory(),
      processArgs: ["init"],
      testing: true
    })
    const result = await cli.execute()

    expect(result.fileMappings.length).toEqual(2)
    expect(result.fileMappings[0].source).toContain("/src/templates/configuration.mjs")
    expect(result.fileMappings[0].target).toContain("/spec/dummy/src/config/configuration.mjs")
    expect(result.fileMappings[1].source).toContain("/src/templates/routes.mjs")
    expect(result.fileMappings[1].target).toContain("/spec/dummy/src/config/routes.mjs")
  })
})
