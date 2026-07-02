// @ts-check

import {describe, expect, it} from "../../src/testing/test.js"
import {scopeKey, serializedScopeFromQuery} from "../../src/sync/query-scope.js"
import Task from "../dummy/src/models/task.js"

describe("sync query scope", {tags: ["dummy"]}, () => {
  it("serializes plain attribute conditions into a resource scope", () => {
    const scope = serializedScopeFromQuery(Task.where({name: "Test task", projectId: 5}))

    expect(scope).toEqual({conditions: {name: "Test task", project_id: 5}, resourceType: "Task"})
  })

  it("merges chained where conditions into one scope", () => {
    const scope = serializedScopeFromQuery(Task.where({projectId: 5}).where({name: "Test task"}))

    expect(scope).toEqual({conditions: {name: "Test task", project_id: 5}, resourceType: "Task"})
  })

  it("produces a stable scope key regardless of condition order", () => {
    const scopeA = serializedScopeFromQuery(Task.where({name: "Test task", projectId: 5}))
    const scopeB = serializedScopeFromQuery(Task.where({projectId: 5}).where({name: "Test task"}))

    expect(scopeKey(scopeA)).toEqual(scopeKey(scopeB))
  })

  it("supports array conditions", () => {
    const scope = serializedScopeFromQuery(Task.where({projectId: [1, 2]}))

    expect(scope).toEqual({conditions: {project_id: [1, 2]}, resourceType: "Task"})
  })

  it("fails loudly on raw SQL conditions", async () => {
    await expect(() => serializedScopeFromQuery(Task.where("name = 'Test task'")))
      .toThrow(/only supports plain attribute conditions/u)
  })

  it("fails loudly on negated conditions", async () => {
    await expect(() => serializedScopeFromQuery(Task.where({projectId: 5}).whereNot({name: "Test task"})))
      .toThrow(/only supports plain attribute conditions/u)
  })

  it("fails loudly on joins, orders, limits and offsets", async () => {
    await expect(() => serializedScopeFromQuery(Task.where({projectId: 5}).joins({project: true})))
      .toThrow(/does not support joins/u)
    await expect(() => serializedScopeFromQuery(Task.where({projectId: 5}).order("name")))
      .toThrow(/does not support orders/u)
    await expect(() => serializedScopeFromQuery(Task.where({projectId: 5}).limit(10)))
      .toThrow(/does not support limit/u)
    await expect(() => serializedScopeFromQuery(Task.where({projectId: 5}).offset(10)))
      .toThrow(/does not support offset/u)
  })

  it("fails loudly on non-scalar condition values", async () => {
    await expect(() => serializedScopeFromQuery(Task.where({name: {nested: true}})))
      .toThrow(/must be scalar/u)
  })
})
