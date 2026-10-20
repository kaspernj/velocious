// @ts-check

import {describe, expect, it} from "../../src/testing/test.js"
import FrontendModelBaseResource from "../../src/frontend-model-resource/base-resource.js"
import Task from "../dummy/src/models/task.js"
import Project from "../dummy/src/models/project.js"
import VelociousError from "../../src/velocious-error.js"

/**
 * @typedef {import("../../src/frontend-model-resource/base-resource.js").FrontendModelResourceController} ResourceController
 */

/**
 * Builds a resource instance without the frontend-model pipeline.
 * @param {typeof FrontendModelBaseResource} ResourceClass - Resource class to instantiate.
 * @returns {FrontendModelBaseResource} Resource instance.
 */
function buildResource(ResourceClass) {
  return /** @type {FrontendModelBaseResource} */ (Object.assign(Object.create(ResourceClass.prototype), {
    params: () => ({})
  }))
}

/**
 * Builds a fake frontend-model controller recording delegated searches and
 * applying join paths like the real controller does.
 * @param {Array<Record<string, ReturnType<typeof JSON.parse>>>} searchCalls - Recorded search calls.
 * @returns {ResourceController} Fake controller.
 */
function buildSearchController(searchCalls) {
  return /** @type {ResourceController} */ (/** @type {unknown} */ ({
    applyFrontendModelSearch: (/** @type {Record<string, ReturnType<typeof JSON.parse>>} */ args) => searchCalls.push(args),
    ensureFrontendModelJoinPath: ({path, query}) => {
      if (path.length < 1) return

      let joinObject = /** @type {Record<string, ReturnType<typeof JSON.parse>>} */ ({})
      let currentNode = joinObject

      for (const relationshipName of path) {
        currentNode[relationshipName] = {}
        currentNode = currentNode[relationshipName]
      }

      query.joins(joinObject)
    }
  }))
}

/**
 * Creates a project and returns its id (tasks have a foreign key to projects).
 * @param {string} name - Project name marker.
 * @returns {Promise<number>} - Created project id.
 */
async function createProject(name) {
  const project = await Project.create({name})

  return project.id()
}

class TextQuickSearchResource extends FrontendModelBaseResource {
  static ModelClass = Task
  static quickSearchColumns = ["name", "description"]
}

class NumericQuickSearchResource extends FrontendModelBaseResource {
  static ModelClass = Task
  static quickSearchColumns = ["name"]
  static quickSearchNumericColumns = ["id"]
}

class PathQuickSearchResource extends FrontendModelBaseResource {
  static ModelClass = Task
  static quickSearchColumns = [{path: ["project"], column: "creating_user_reference"}]
}

class ContractQuickSearchResource extends FrontendModelBaseResource {
  static ModelClass = Task
  static quickSearchColumns = ["name"]

  quickSearchErrorLabel() {
    return "Legacy contract quick search"
  }

  quickSearchErrorCode() {
    return "legacy-contract-invalid-quick-search"
  }
}

describe("frontend model base resource quick search", {tags: ["dummy"], databaseCleaning: {transaction: false, truncate: true}}, () => {
  it("expands quickSearch searches to LIKE conditions over the declared columns", async () => {
    const matchingTask = await Task.create({description: "needle in the description", name: "untitled", projectId: await createProject("qs-project-x")})

    await Task.create({description: "nothing here", name: "other", projectId: await createProject("qs-project-x")})

    /** @type {Array<Record<string, ReturnType<typeof JSON.parse>>>} */
    const searchCalls = []
    const resource = buildResource(TextQuickSearchResource)
    const query = Task.where({})

    resource.applyFrontendModelIndexSearch({
      controller: buildSearchController(searchCalls),
      query,
      search: {column: "quickSearch", operator: "like", path: [], value: " needle "}
    })

    const foundTasks = await query.toArray()

    expect(searchCalls).toEqual([])
    expect(foundTasks.map((foundTask) => foundTask.id())).toEqual([matchingTask.id()])
  })

  it("matches LIKE across every declared text column", async () => {
    const nameMatch = await Task.create({description: "plain", name: "needle name", projectId: await createProject("qs-project-x")})

    await Task.create({description: "plain", name: "other name", projectId: await createProject("qs-project-x")})

    const query = Task.where({})

    buildResource(TextQuickSearchResource).applyFrontendModelIndexSearch({
      controller: buildSearchController([]),
      query,
      search: {column: "quickSearch", operator: "like", path: [], value: "needle name"}
    })

    expect((await query.toArray()).map((task) => task.id())).toEqual([nameMatch.id()])
  })

  it("adds exact numeric conditions for integer quick-search values", async () => {
    const numericTask = await Task.create({description: "plain", name: "plain", projectId: await createProject("qs-project-x")})

    await Task.create({description: "plain", name: "plain two", projectId: await createProject("qs-project-x")})

    const query = Task.where({})

    buildResource(NumericQuickSearchResource).applyFrontendModelIndexSearch({
      controller: buildSearchController([]),
      query,
      search: {column: "quickSearch", operator: "like", path: [], value: String(numericTask.id())}
    })

    expect((await query.toArray()).map((task) => task.id())).toEqual([numericTask.id()])
  })

  it("keeps LIKE-only behavior for non-integer quick-search values", async () => {
    // "12abc" must not be parsed as the number 12: no LIKE column matches it
    // and no numeric exact match may fire, so nothing matches.
    await Task.create({description: "plain", name: "plain", projectId: await createProject("qs-project-x")})

    const query = Task.where({})

    buildResource(NumericQuickSearchResource).applyFrontendModelIndexSearch({
      controller: buildSearchController([]),
      query,
      search: {column: "quickSearch", operator: "like", path: [], value: "12abc"}
    })

    expect((await query.toArray()).length).toEqual(0)
  })

  it("treats blank quick-search values as handled without filtering", async () => {
    await Task.create({description: "plain", name: "plain", projectId: await createProject("qs-project-x")})

    /** @type {Array<Record<string, ReturnType<typeof JSON.parse>>>} */
    const searchCalls = []
    const query = Task.where({})

    buildResource(TextQuickSearchResource).applyFrontendModelIndexSearch({
      controller: buildSearchController(searchCalls),
      query,
      search: {column: "quickSearch", operator: "like", path: [], value: "   "}
    })

    expect(searchCalls).toEqual([])
    expect((await query.toArray()).length).toEqual(1)
  })

  it("searches joined relationship path columns", async () => {
    const joinedProject = await Project.create({creatingUserReference: "quick-search-user-ref"})
    const otherProject = await Project.create({creatingUserReference: "someone-else"})

    const joinedTask = await Task.create({description: "plain", name: "plain", projectId: joinedProject.id()})

    await Task.create({description: "plain", name: "plain", projectId: otherProject.id()})

    const query = Task.where({})

    buildResource(PathQuickSearchResource).applyFrontendModelIndexSearch({
      controller: buildSearchController([]),
      query,
      search: {column: "quickSearch", operator: "like", path: [], value: "quick-search-user"}
    })

    expect((await query.toArray()).map((task) => task.id())).toEqual([joinedTask.id()])
  })

  it("rejects invalid quickSearch operators and values with client-safe errors", () => {
    const resource = buildResource(TextQuickSearchResource)
    const controller = buildSearchController([])

    try {
      resource.applyFrontendModelIndexSearch({controller, query: Task.where({}), search: {column: "quickSearch", operator: "eq", path: [], value: "abc"}})
      throw new Error("Expected quick search to fail")
    } catch (error) {
      if (!(error instanceof VelociousError)) throw error

      expect(error.message).toEqual("Quick search must use the like operator.")
      expect(error.code).toEqual("invalid-quick-search")
      expect(error.safeToExpose).toEqual(true)
    }

    try {
      resource.applyFrontendModelIndexSearch({controller, query: Task.where({}), search: {column: "quickSearch", operator: "like", path: [], value: 5}})
      throw new Error("Expected quick search to fail")
    } catch (error) {
      if (!(error instanceof VelociousError)) throw error

      expect(error.message).toEqual("Quick search must be a string.")
      expect(error.code).toEqual("invalid-quick-search")
    }
  })

  it("lets owners override the quick-search error label and code", () => {
    const resource = buildResource(ContractQuickSearchResource)

    try {
      resource.applyFrontendModelIndexSearch({controller: buildSearchController([]), query: Task.where({}), search: {column: "quickSearch", operator: "eq", path: [], value: "abc"}})
      throw new Error("Expected quick search to fail")
    } catch (error) {
      if (!(error instanceof VelociousError)) throw error

      expect(error.message).toEqual("Legacy contract quick search must use the like operator.")
      expect(error.code).toEqual("legacy-contract-invalid-quick-search")
    }
  })

  it("delegates non-quickSearch searches and quickSearch without declared columns to the controller", () => {
    /** @type {Array<Record<string, ReturnType<typeof JSON.parse>>>} */
    const searchCalls = []
    const controller = buildSearchController(searchCalls)
    const query = Task.where({})
    const columnSearch = {column: "name", operator: /** @type {const} */ ("like"), path: [], value: "abc"}

    buildResource(TextQuickSearchResource).applyFrontendModelIndexSearch({controller, query, search: columnSearch})

    class UndeclaredResource extends FrontendModelBaseResource {
      static ModelClass = Task
    }

    const quickSearch = {column: "quickSearch", operator: /** @type {const} */ ("like"), path: [], value: "abc"}

    buildResource(UndeclaredResource).applyFrontendModelIndexSearch({controller, query, search: quickSearch})

    expect(searchCalls).toEqual([{query, search: columnSearch}, {query, search: quickSearch}])
  })

  it("delegates quickSearch searches that carry a relationship path to the controller", () => {
    /** @type {Array<Record<string, ReturnType<typeof JSON.parse>>>} */
    const searchCalls = []
    const controller = buildSearchController(searchCalls)
    const query = Task.where({})
    const pathSearch = {column: "quickSearch", operator: /** @type {const} */ ("like"), path: ["project"], value: "abc"}

    buildResource(TextQuickSearchResource).applyFrontendModelIndexSearch({controller, query, search: pathSearch})

    expect(searchCalls).toEqual([{query, search: pathSearch}])
  })
})
