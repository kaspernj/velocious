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
      resourceConfiguration: /** @type {any} */ (undefined)
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
      resourceConfiguration: /** @type {any} */ (undefined)
    })
    const memberResource = new ProjectResource({
      locals: {isAdmin: false},
      modelClass: class extends DatabaseRecord {},
      modelName: "Project",
      params: {},
      resourceConfiguration: /** @type {any} */ (undefined)
    })

    expect(adminResource.nestedAttributes({locals: {isAdmin: true}})).toEqual({tasks: {allowDestroy: true, limit: 100}})
    expect(memberResource.nestedAttributes({locals: {isAdmin: false}})).toEqual({tasks: {allowDestroy: false, limit: 100}})
  })
})

describe("FrontendModelBaseResource.permittedParams", () => {
  it("defaults to permitting nothing — subclasses must override to enable writes", () => {
    class ProjectResource extends FrontendModelBaseResource {
      static attributes = ["id", "name", "description"]
    }

    const resource = new ProjectResource({
      modelClass: class extends DatabaseRecord {},
      modelName: "Project",
      params: {},
      resourceConfiguration: /** @type {any} */ (undefined)
    })

    const spec = resource.permittedParams({action: "create"})
    expect(spec.attributes).toEqual([])
    expect(spec.nestedAttributes).toEqual({})
  })

  it("supports subclass overrides that declare explicit attribute and nested permits", () => {
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
      resourceConfiguration: /** @type {any} */ (undefined)
    })
    const memberResource = new ProjectResource({
      locals: {isAdmin: false},
      modelClass: class extends DatabaseRecord {},
      modelName: "Project",
      params: {},
      resourceConfiguration: /** @type {any} */ (undefined)
    })

    expect(adminResource.permittedParams({action: "create", locals: {isAdmin: true}}).attributes).toEqual(["name", "description", "internalNotes"])
    expect(memberResource.permittedParams({action: "create", locals: {isAdmin: false}}).attributes).toEqual(["name", "description"])
    expect(memberResource.permittedParams({action: "update", locals: {isAdmin: false}}).nestedAttributes).toEqual({})
  })

  it("allows subclasses to delegate the nested permit set to this.nestedAttributes(arg)", () => {
    class ProjectResource extends FrontendModelBaseResource {
      nestedAttributes() {
        return {tasks: {allowDestroy: true}}
      }

      /** @param {{action?: string}} [arg] */
      permittedParams(arg) {
        return {
          attributes: ["name"],
          nestedAttributes: this.nestedAttributes(arg)
        }
      }
    }

    const resource = new ProjectResource({
      modelClass: class extends DatabaseRecord {},
      modelName: "Project",
      params: {},
      resourceConfiguration: /** @type {any} */ (undefined)
    })

    expect(resource.permittedParams({action: "update"}).nestedAttributes).toEqual({tasks: {allowDestroy: true}})
  })
})
