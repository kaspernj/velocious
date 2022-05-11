const {Cli} = require("../../../index.cjs")

describe("Cli - generate - migration", () => {
  it("generates a new migration", async () => {
    const cli = new Cli()

    await cli.execute("g", "migration")
  })
})
