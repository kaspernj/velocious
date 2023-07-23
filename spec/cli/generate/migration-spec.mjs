import Cli from "../../../src/cli/index.mjs"

describe("Cli - generate - migration", () => {
  it("generates a new migration", async () => {
    const cli = new Cli()

    await cli.execute({args: ["g:migration", "create_tasks"]})
  })
})
