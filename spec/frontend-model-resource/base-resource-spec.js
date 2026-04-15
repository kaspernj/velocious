// @ts-check

import {describe, expect, it} from "../../src/testing/test.js"
import FrontendModelBaseResource from "../../src/frontend-model-resource/base-resource.js"
import DatabaseRecord from "../../src/database/record/index.js"

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

    expect(resource.permittedParams({action: "create"})).toEqual([])
  })

  it("supports Rails-style flat arrays mixing strings and nested-attributes keys", () => {
    class ProjectResource extends FrontendModelBaseResource {
      permittedParams() {
        return [
          "name",
          "description",
          {tasksAttributes: ["id", "_destroy", "name"]}
        ]
      }
    }

    const resource = new ProjectResource({
      modelClass: class extends DatabaseRecord {},
      modelName: "Project",
      params: {},
      resourceConfiguration: /** @type {any} */ (undefined)
    })

    expect(resource.permittedParams()).toEqual([
      "name",
      "description",
      {tasksAttributes: ["id", "_destroy", "name"]}
    ])
  })

  it("supports subclass overrides that vary by action and locals", () => {
    class ProjectResource extends FrontendModelBaseResource {
      /** @param {{action?: string, locals?: {isAdmin?: boolean}}} [arg] */
      permittedParams(arg) {
        const attrs = ["name", "description"]

        if (arg?.locals?.isAdmin) attrs.push("internalNotes")

        if (arg?.action === "create") {
          return [...attrs, {tasksAttributes: ["name"]}]
        }

        return attrs
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

    expect(adminResource.permittedParams({action: "create", locals: {isAdmin: true}})).toEqual([
      "name",
      "description",
      "internalNotes",
      {tasksAttributes: ["name"]}
    ])
    expect(memberResource.permittedParams({action: "update", locals: {isAdmin: false}})).toEqual([
      "name",
      "description"
    ])
  })
})
