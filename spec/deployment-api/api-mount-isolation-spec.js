// @ts-check

import {beforeEach, describe, expect, it} from "../../src/testing/test.js"
import Dummy from "../dummy/index.js"
import fetch from "node-fetch"
import {otherTestDeploymentAdapter, testDeploymentAdapter, VALID_REVISION} from "../dummy/src/support/test-deployment-adapter.js"
import {waitFor} from "awaitery"

const PRIMARY_BASE = "http://localhost:3006/velocious/deployments"
const PRIMARY_TOKEN = "test-deployment-token"
const SECONDARY_BASE = "http://localhost:3006/velocious/other-deployments"
const SECONDARY_TOKEN = "other-test-deployment-token"

/**
 * @param {object} args - Options.
 * @param {string} args.base - Deployment API mount base URL.
 * @param {string} args.idempotencyKey - Idempotency key.
 * @param {string} args.token - Mount bearer token.
 * @returns {Promise<{body: Record<string, ?>, status: number}>} - Parsed response.
 */
async function postRun({base, idempotencyKey, token}) {
  const body = JSON.stringify({idempotencyKey, project: "dummy-project", revision: VALID_REVISION, stage: "production"})
  const response = await fetch(`${base}/runs`, {
    body,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Length": Buffer.byteLength(body).toString(),
      "Content-Type": "application/json"
    },
    method: "POST"
  })

  return {body: await response.json(), status: response.status}
}

describe("Deployment API - mount isolation", {databaseCleaning: {transaction: false, truncate: true}}, () => {
  beforeEach(() => {
    otherTestDeploymentAdapter.reset()
    testDeploymentAdapter.reset()
  })

  it("isolates reads, active runs, and identical idempotency keys between mounts sharing one database", async () => {
    await Dummy.run(async () => {
      testDeploymentAdapter.deployBehavior = "hold"

      const primary = await postRun({base: PRIMARY_BASE, idempotencyKey: "same-key-across-mounts", token: PRIMARY_TOKEN})

      expect(primary.status).toEqual(202)

      await waitFor(() => {
        if (testDeploymentAdapter.deployCalls.length === 1) return true
        throw new Error("Primary mount deploy not started")
      })

      const secondary = await postRun({base: SECONDARY_BASE, idempotencyKey: "same-key-across-mounts", token: SECONDARY_TOKEN})
      const primaryRun = /** @type {Record<string, ?>} */ (primary.body.run)
      const secondaryRun = /** @type {Record<string, ?>} */ (secondary.body.run)

      expect(secondary.status).toEqual(202)
      expect(secondaryRun.id).not.toEqual(primaryRun.id)

      await waitFor(() => {
        if (otherTestDeploymentAdapter.deployCalls.length === 1) return true
        throw new Error("Secondary mount deploy not started")
      })

      const crossMountRead = await fetch(`${SECONDARY_BASE}/runs/${String(primaryRun.id)}`, {
        headers: {Authorization: `Bearer ${SECONDARY_TOKEN}`}
      })

      expect(crossMountRead.status).toEqual(404)
      expect(testDeploymentAdapter.deployCalls.length).toEqual(1)
      expect(otherTestDeploymentAdapter.deployCalls.length).toEqual(1)

      testDeploymentAdapter.releaseHold()
    })
  })
})
