// @ts-check

import {describe, expect, it} from "../../src/testing/test.js"
import FrontendModelBaseResource from "../../src/frontend-model-resource/base-resource.js"
import DatabaseRecord from "../../src/database/record/index.js"

describe("FrontendModelBaseResource.nestedAttributes", () => {
  it("defaults to empty when not overridden", () => {
    class ProjectResource extends FrontendModelBaseResource {}

    const resource = new ProjectResource({
      modelClass: class extends DatabaseRecord {},
      modelName: "Project",
      params: {},
      resourceConfiguration: /** @type {any} */ ({attributes: [], abilities: {}})
    })

    expect(resource.nestedAttributes()).toEqual({})
  })

  it("supports subclass overrides as an instance method that can inspect arg", () => {
    class ProjectResource extends FrontendModelBaseResource {
      /** @param {{action?: string, locals?: {isAdmin?: boolean}}} [arg] */
      nestedAttributes(arg) {
        return {
          tasks: {allowDestroy: arg?.locals?.isAdmin === true, limit: 100}
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

    expect(adminResource.nestedAttributes({locals: {isAdmin: true}})).toEqual({tasks: {allowDestroy: true, limit: 100}})
    expect(memberResource.nestedAttributes({locals: {isAdmin: false}})).toEqual({tasks: {allowDestroy: false, limit: 100}})
  })
})

describe("FrontendModelBaseResource.permittedParams", () => {
  it("defaults attributes to static attributes minus auto-managed columns", () => {
    class ProjectResource extends FrontendModelBaseResource {
      static attributes = ["id", "name", "description", "createdAt", "updatedAt"]
    }

    const resource = new ProjectResource({
      modelClass: class extends DatabaseRecord {},
      modelName: "Project",
      params: {},
      resourceConfiguration: /** @type {any} */ ({attributes: [], abilities: {}})
    })

    const spec = resource.permittedParams({action: "create"})
    expect(spec.attributes).toEqual(["name", "description"])
    expect(spec.nestedAttributes).toEqual({})
  })

  it("delegates the nested permit set to nestedAttributes(arg)", () => {
    class ProjectResource extends FrontendModelBaseResource {
      static attributes = ["id", "name"]

      nestedAttributes() {
        return {tasks: {allowDestroy: true}}
      }
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

  it("supports subclass overrides that vary attributes by action and locals", () => {
    class ProjectResource extends FrontendModelBaseResource {
      static attributes = ["id", "name", "description"]

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
