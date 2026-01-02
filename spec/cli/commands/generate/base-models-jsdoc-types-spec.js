// @ts-check

import Configuration from "../../../../src/configuration.js"
import EnvironmentHandlerNode from "../../../../src/environment-handlers/node.js"
import BaseModelsCommand from "../../../../src/environment-handlers/node/cli/commands/generate/base-models.js"
import {describe, expect, it} from "../../../../src/testing/test.js"

function buildCommand() {
  const environmentHandler = new EnvironmentHandlerNode()
  const configuration = new Configuration({
    database: {test: {}},
    directory: process.cwd(),
    environment: "test",
    environmentHandler,
    initializeModels: async () => {},
    locale: "en",
    localeFallbacks: {en: ["en"]},
    locales: ["en"]
  })

  return new BaseModelsCommand({args: {configuration}, cli: {}})
}

describe("Base-models JSDoc types", () => {
  it("maps pgsql character varying to string", async () => {
    const command = buildCommand()
    const column = {getType: () => "character varying"}

    expect(command.jsDocTypeFromColumn(column)).toEqual("string")
  })

  it("maps pgsql timestamp without time zone to Date", async () => {
    const command = buildCommand()
    const column = {getType: () => "timestamp without time zone"}

    expect(command.jsDocTypeFromColumn(column)).toEqual("Date")
    expect(command.jsDocSetterTypeFromColumn(column)).toEqual("Date | string")
  })
})
