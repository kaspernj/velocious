// @ts-check

import {describe, expect, it} from "../../src/testing/test.js"
import Dummy from "../dummy/index.js"
import dummyConfiguration from "../dummy/src/config/configuration.js"
import FrontendModelBase from "../../src/frontend-models/base.js"
import {resetFrontendModelTransport} from "../helpers/frontend-model-test-helpers.js"

class RemoteContextProject extends FrontendModelBase {
  /** @returns {{attributes: string[], builtInCollectionCommands: string[], modelName: string, primaryKey: string}} Resource configuration. */
  static resourceConfig() {
    return {
      attributes: ["id"],
      builtInCollectionCommands: ["index"],
      modelName: "Project",
      primaryKey: "id"
    }
  }
}

describe("frontend-model remote request context HTTP integration", {databaseCleaning: {transaction: false, truncate: true}}, () => {
  it("resolves each entry through the real shared endpoint with its captured context", async () => {
    const originalTenantResolver = dummyConfiguration.getTenantResolver()
    const resolvedProjectIds = []
    const sourceContext = {projectId: "project-alpha", routingEpoch: 3}
    let activeContext = sourceContext

    dummyConfiguration.setTenantResolver(({params}) => {
      if (typeof params.projectId !== "string") return

      resolvedProjectIds.push(params.projectId)

      return {projectId: params.projectId, routingEpoch: params.routingEpoch}
    })
    FrontendModelBase.configureTransport({
      requestContext: () => activeContext,
      url: "http://127.0.0.1:3006"
    })

    try {
      await Dummy.run(async () => {
        const alphaRequest = RemoteContextProject.executeCommand("index", {})

        sourceContext.projectId = "project-mutated"
        activeContext = {projectId: "project-beta", routingEpoch: 4}

        await Promise.all([
          alphaRequest,
          RemoteContextProject.executeCommand("index", {})
        ])
      })

      expect(resolvedProjectIds).toEqual(["project-alpha", "project-beta"])
    } finally {
      dummyConfiguration.setTenantResolver(originalTenantResolver)
      resetFrontendModelTransport()
    }
  })
})
