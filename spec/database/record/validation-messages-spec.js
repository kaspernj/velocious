// @ts-check

import {describe, expect, it} from "../../../src/testing/test.js"
import Project from "../../dummy/src/models/project.js"
import Task from "../../dummy/src/models/task.js"
import validationMessage from "../../../src/database/record/validation-messages.js"
import {ValidationError} from "../../../src/database/record/index.js"

describe("record validation messages", () => {
  it("interpolates the English default without a translator", () => {
    expect(validationMessage({type: "blank"})).toEqual("can't be blank")
    expect(validationMessage({type: "taken"})).toEqual("has already been taken")
    expect(validationMessage({type: "too_long", variables: {count: 255}})).toEqual("is too long (maximum is 255 characters)")
  })

  it("routes messages through the given translator with defaults and variables", () => {
    /** @type {Array<string>} */
    const msgIDs = []

    /** @type {import("../../../src/database/record/validation-messages.js").ValidationMessageTranslator} */
    const translator = (msgID, args) => {
      msgIDs.push(msgID)

      if (msgID == "velocious.errors.messages.blank") return "skal udfyldes"

      let message = args?.defaultValue ?? msgID

      for (const [variableName, variableValue] of Object.entries(args ?? {})) {
        if (variableName == "defaultValue") continue

        message = message.replaceAll(`%{${variableName}}`, String(variableValue))
      }

      return message
    }

    expect(validationMessage({translator, type: "blank"})).toEqual("skal udfyldes")
    expect(validationMessage({translator, type: "too_long", variables: {count: 10}})).toEqual("is too long (maximum is 10 characters)")
    expect(msgIDs).toEqual(["velocious.errors.messages.blank", "velocious.errors.messages.too_long"])
  })

  it("fails loudly on unknown message types", () => {
    expect(() => validationMessage({type: /** @type {?} */ ("nope")})).toThrow(/Unknown validation message type/u)
  })
})

describe("record validation messages - model validations", {databaseCleaning: {transaction: false, truncate: true}, tags: ["dummy"]}, () => {
  it("translates presence and uniqueness validation messages through the configuration translator", async () => {
    const configuration = Task._getConfiguration()
    const previousTranslator = configuration.getTranslator()

    configuration.setTranslator((msgID, args) => {
      if (msgID == "velocious.errors.messages.blank") return "skal udfyldes"
      if (msgID == "velocious.errors.messages.taken") return "er allerede taget"

      return args?.defaultValue ?? msgID
    })

    try {
      const project = await Project.create({name: "Validation messages project"})

      try {
        await Task.create({name: "", projectId: project.id()})
        throw new Error("Expected create to fail")
      } catch (error) {
        if (!(error instanceof ValidationError)) throw error

        expect(error.message).toEqual("Name skal udfyldes")
      }

      await Task.create({name: "Duplicate name", projectId: project.id()})

      try {
        await Task.create({name: "Duplicate name", projectId: project.id()})
        throw new Error("Expected create to fail")
      } catch (error) {
        if (!(error instanceof ValidationError)) throw error

        expect(error.message).toEqual("Name er allerede taget")
      }
    } finally {
      configuration.setTranslator(previousTranslator)
    }
  })
})
