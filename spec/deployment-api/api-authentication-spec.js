// @ts-check

import {beforeEach, describe, expect, it} from "../../src/testing/test.js"
import Dummy from "../dummy/index.js"
import fetch from "node-fetch"
import {getDeploymentRun, postDeploymentRun} from "../helpers/deployment-api-helper.js"
import {testDeploymentAdapter, VALID_REVISION} from "../dummy/src/support/test-deployment-adapter.js"

const TOKEN = "test-deployment-token"

/**
 * @returns {Record<string, ?>} - A valid run creation payload.
 */
function validPayload() {
  return {
    idempotencyKey: `auth-spec-${Math.random().toString(36).slice(2)}`,
    project: "dummy-project",
    revision: VALID_REVISION,
    stage: "production"
  }
}

describe("Deployment API - authentication", {databaseCleaning: {transaction: false, truncate: true}}, () => {
  beforeEach(() => {
    testDeploymentAdapter.reset()
  })

  it("rejects requests without a token", async () => {
    await Dummy.run(async () => {
      const {body, status} = await postDeploymentRun({payload: validPayload()})

      expect(status).toEqual(401)
      expect(body.error).toEqual("unauthorized")
      expect(testDeploymentAdapter.validateRevisionCalls.length).toEqual(0)
    })
  })

  it("rejects an invalid token", async () => {
    await Dummy.run(async () => {
      const {body, status} = await postDeploymentRun({payload: validPayload(), token: "wrong-token"})

      expect(status).toEqual(401)
      expect(body.error).toEqual("unauthorized")
      expect(testDeploymentAdapter.deployCalls.length).toEqual(0)
    })
  })

  it("rejects a malformed authorization header", async () => {
    await Dummy.run(async () => {
      const response = await fetch("http://localhost:3006/velocious/deployments/runs/some-id", {
        headers: {Authorization: `Token ${TOKEN}`}
      })

      expect(response.status).toEqual(401)
    })
  })

  it("does not accept tokens through the URL", async () => {
    await Dummy.run(async () => {
      const response = await fetch(`http://localhost:3006/velocious/deployments/runs/some-id?access_token=${TOKEN}`)

      expect(response.status).toEqual(401)
    })
  })

  it("never echoes the token in responses", async () => {
    await Dummy.run(async () => {
      const createResult = await postDeploymentRun({payload: validPayload(), token: TOKEN})

      expect(createResult.status).toEqual(202)
      expect(JSON.stringify(createResult.body)).not.toContain(TOKEN)

      const runId = /** @type {Record<string, ?>} */ (createResult.body.run).id

      const showResult = await getDeploymentRun({id: /** @type {string} */ (runId), token: TOKEN})

      expect(showResult.status).toEqual(200)
      expect(JSON.stringify(showResult.body)).not.toContain(TOKEN)
    })
  })
})
