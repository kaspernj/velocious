// @ts-check

import {describe, expect, it} from "../../src/testing/test.js"
import FrontendModelBaseResource from "../../src/frontend-model-resource/base-resource.js"
import DatabaseRecord from "../../src/database/record/index.js"

describe("FrontendModelBaseResource.permittedParams", () => {
  it("defaults to null attributes and empty nestedAttributes when no statics are set", () => {
    class ProjectResource extends FrontendModelBaseResource {}

    const resource = new ProjectResource({
      modelClass: class extends DatabaseRecord {},
      modelName: "Project",
      params: {},
      resourceConfiguration: /** @type {any} */ ({attributes: [], abilities: {}})
    })

    const spec = resource.permittedParams({action: "create"})
    expect(spec.attributes).toEqual(null)
    expect(spec.nestedAttributes).toEqual({})
  })

  it("defaults nestedAttributes from static nestedAttributes on the resource class", () => {
    class ProjectResource extends FrontendModelBaseResource {
      static nestedAttributes = {tasks: {allowDestroy: true}}
    }

    const resource = new ProjectResource({
      modelClass: class extends DatabaseRecord {},
      modelName: "Project",
      params: {},
      resourceConfiguration: /** @type {any} */ ({attributes: [], abilities: {}})
    })

    const spec = resource.permittedParams({action: "update"})
    expect(spec.nestedAttributes).toEqual({tasks: {allowDestroy: true}})
  })

  it("supports subclass overrides that inspect action and ability", () => {
    class ProjectResource extends FrontendModelBaseResource {
      /** @param {{action?: string, locals?: {isAdmin?: boolean}}} arg */
      permittedParams(arg) {
        const baseAttributes = ["name", "description"]

        if (arg?.locals?.isAdmin) baseAttributes.push("internalNotes")

        return {
          attributes: baseAttributes,
          nestedAttributes: arg?.action === "create" ? {tasks: {allowDestroy: true}} : {}
        }
      }
    }

    const adminResource = new ProjectResource({
      locals: {isAdmin: true},
      modelClass: class extends DatabaseRecord {},
      modelName: "Project",
      params: {},
      resourceConfiguration: /** @type {any} */ ({attributes: [], abilities: {}})
    })
    const memberResource = new ProjectResource({
      locals: {isAdmin: false},
      modelClass: class extends DatabaseRecord {},
      modelName: "Project",
      params: {},
      resourceConfiguration: /** @type {any} */ ({attributes: [], abilities: {}})
    })

    expect(adminResource.permittedParams({action: "create", locals: {isAdmin: true}}).attributes).toEqual(["name", "description", "internalNotes"])
    expect(memberResource.permittedParams({action: "create", locals: {isAdmin: false}}).attributes).toEqual(["name", "description"])
    expect(memberResource.permittedParams({action: "update", locals: {isAdmin: false}}).nestedAttributes).toEqual({})
  })
})
