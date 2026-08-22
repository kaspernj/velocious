// @ts-check

import {describe, expect, it} from "../../src/testing/test.js"
import FrontendModelBase from "../../src/frontend-models/base.js"
import {resetFrontendModelTransport, stubFrontendModelFetch} from "../helpers/frontend-model-test-helpers.js"

class ScopedTask extends FrontendModelBase {
  /** @returns {{attributes: string[], builtInCollectionCommands: string[], collectionCommands: string[], primaryKey: string}} Resource configuration. */
  static resourceConfig() {
    return {
      attributes: ["id", "name"],
      builtInCollectionCommands: ["index"],
      collectionCommands: ["refresh"],
      primaryKey: "id"
    }
  }
}

describe("frontend-model remote request context", () => {
  it("captures independent immutable context for entries sharing one batch", async () => {
    const stub = stubFrontendModelFetch({status: "success"})
    const sourceContext = {projectId: "project-alpha", routingEpoch: 3}
    let activeContext = sourceContext

    FrontendModelBase.configureTransport({
      requestContext: () => activeContext,
      url: "https://example.test"
    })

    try {
      const alphaRequest = ScopedTask.executeCommand("index", {where: {id: "task-alpha"}})

      sourceContext.projectId = "project-mutated"
      activeContext = {projectId: "project-beta", routingEpoch: 4}

      const betaRequest = ScopedTask.executeCustomCommand({
        commandName: "refresh",
        commandType: "refresh",
        payload: {id: "task-beta"},
        resourcePath: ScopedTask.resourcePath()
      })

      await Promise.all([alphaRequest, betaRequest])

      expect(stub.calls.length).toEqual(1)
      expect(stub.calls[0].body.requests.map((request) => request.requestContext)).toEqual([
        {projectId: "project-alpha", routingEpoch: 3},
        {projectId: "project-beta", routingEpoch: 4}
      ])
    } finally {
      stub.restore()
      resetFrontendModelTransport()
    }
  })

  it("preserves the ordinary unscoped batch envelope", async () => {
    const stub = stubFrontendModelFetch({status: "success"})

    FrontendModelBase.configureTransport({url: "https://example.test"})

    try {
      await ScopedTask.executeCommand("index", {where: {id: "task-1"}})

      expect(stub.calls[0].body).toEqual({where: {id: "task-1"}})
    } finally {
      stub.restore()
      resetFrontendModelTransport()
    }
  })

  it("rejects malformed context and collisions before transport", async () => {
    const stub = stubFrontendModelFetch({status: "success"})

    try {
      // @ts-expect-error Exercises runtime rejection of a non-object context.
      FrontendModelBase.configureTransport({requestContext: () => [], url: "https://example.test"})
      await expect(async () => await ScopedTask.executeCommand("index", {})).toThrow(/request context.*plain object/iu)

      FrontendModelBase.configureTransport({requestContext: () => ({where: "shadowed"}), url: "https://example.test"})
      await expect(async () => await ScopedTask.executeCommand("index", {where: {id: "task-1"}})).toThrow(/where.*reserved/iu)

      FrontendModelBase.configureTransport({requestContext: () => ({model: "Shadowed"}), url: "https://example.test"})
      await expect(async () => await ScopedTask.executeCommand("index", {})).toThrow(/model.*reserved/iu)

      expect(stub.calls).toEqual([])
    } finally {
      stub.restore()
      resetFrontendModelTransport()
    }
  })
})
