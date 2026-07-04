// @ts-check

import {describe, expect, it} from "../../../src/testing/test.js"
import Project from "../../dummy/src/models/project.js"
import Task from "../../dummy/src/models/task.js"
import {ValidationError} from "../../../src/database/record/index.js"

/**
 * Removes the spec-registered description validators from Task again.
 * @returns {void}
 */
function removeDescriptionValidators() {
  if (Task._validators) delete Task._validators.description
}

describe("record validations - length", {databaseCleaning: {transaction: false, truncate: true}, tags: ["dummy"]}, () => {
  it("rejects values outside the length bounds with translated messages and skips absent values", async () => {
    await Task.validates("description", {length: {maximum: 10, minimum: 2}})

    try {
      const project = await Project.create({name: "Length validation project"})

      try {
        await Task.create({description: "12345678901", name: "Too long", projectId: project.id()})
        throw new Error("Expected create to fail")
      } catch (error) {
        if (!(error instanceof ValidationError)) throw error

        expect(error.message).toEqual("Description is too long (maximum is 10 characters)")
      }

      try {
        await Task.create({description: "1", name: "Too short", projectId: project.id()})
        throw new Error("Expected create to fail")
      } catch (error) {
        if (!(error instanceof ValidationError)) throw error

        expect(error.message).toEqual("Description is too short (minimum is 2 characters)")
      }

      const validTask = await Task.create({description: "1234567890", name: "Within bounds", projectId: project.id()})

      expect(validTask.description()).toEqual("1234567890")

      // Absent values are presence's concern, not length's.
      const blankTask = await Task.create({name: "No description", projectId: project.id()})

      expect(blankTask.description()).toEqual(null)
    } finally {
      removeDescriptionValidators()
    }
  })

  it("translates length messages through the configuration translator", async () => {
    await Task.validates("description", {length: {maximum: 3}})

    const configuration = Task._getConfiguration()
    const previousTranslator = configuration.getTranslator()

    configuration.setTranslator((msgID, args) => {
      if (msgID == "velocious.errors.messages.too_long") return "er for lang (maksimalt %{count} tegn)".replaceAll("%{count}", String(args?.count))

      return args?.defaultValue ?? msgID
    })

    try {
      const project = await Project.create({name: "Length translation project"})

      try {
        await Task.create({description: "1234", name: "Translated", projectId: project.id()})
        throw new Error("Expected create to fail")
      } catch (error) {
        if (!(error instanceof ValidationError)) throw error

        expect(error.message).toEqual("Description er for lang (maksimalt 3 tegn)")
      }
    } finally {
      configuration.setTranslator(previousTranslator)
      removeDescriptionValidators()
    }
  })
})
