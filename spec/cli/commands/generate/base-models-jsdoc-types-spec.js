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

/**
 * Builds a stub column plus a stub model class whose effective type equals the
 * column's introspected type unless an explicit cast is provided.
 * @param {string} type - Introspected column type.
 * @param {string} [cast] - Optional declared cast type to override the effective type.
 * @returns {{column: object, modelClass: object}} - Stub column and model class.
 */
function buildColumnAndModelClass(type, cast) {
  const column = {getName: () => "value", getType: () => type}
  const modelClass = {getColumnTypeByName: (name) => name === "value" ? (cast ?? type) : type}

  return {column, modelClass}
}

describe("Base-models JSDoc types", () => {
  it("maps pgsql character varying to string", async () => {
    const command = buildCommand()
    const {column, modelClass} = buildColumnAndModelClass("character varying")

    expect(command.jsDocTypeFromColumn(column, modelClass)).toEqual("string")
  })

  it("maps pgsql timestamp without time zone to Date", async () => {
    const command = buildCommand()
    const {column, modelClass} = buildColumnAndModelClass("timestamp without time zone")

    expect(command.jsDocTypeFromColumn(column, modelClass)).toEqual("Date")
    expect(command.jsDocSetterTypeFromColumn(column, modelClass)).toEqual("Date | string")
  })

  it("maps mysql mediumtext and tinytext to string", async () => {
    const command = buildCommand()
    const mediumtext = buildColumnAndModelClass("mediumtext")
    const tinytext = buildColumnAndModelClass("tinytext")

    expect(command.jsDocTypeFromColumn(mediumtext.column, mediumtext.modelClass)).toEqual("string")
    expect(command.jsDocTypeFromColumn(tinytext.column, tinytext.modelClass)).toEqual("string")
  })

  it("emits boolean for a column declared with a boolean attribute cast", async () => {
    const command = buildCommand()
    const {column, modelClass} = buildColumnAndModelClass("bit", "boolean")

    expect(command.jsDocTypeFromColumn(column, modelClass)).toEqual("boolean")
    expect(command.jsDocSetterTypeFromColumn(column, modelClass)).toEqual("boolean")
  })

  it("emits number for a non-declared bit column (no behaviour change)", async () => {
    const command = buildCommand()
    const {column, modelClass} = buildColumnAndModelClass("bit")

    expect(command.jsDocTypeFromColumn(column, modelClass)).toEqual("number")
  })

  it("maps pgsql json to Record<string, unknown>", async () => {
    const command = buildCommand()
    const {column, modelClass} = buildColumnAndModelClass("json")

    expect(command.jsDocTypeFromColumn(column, modelClass)).toEqual("Record<string, unknown>")
  })
})
