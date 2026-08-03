// @ts-check

import {beforeEach, describe, expect, it} from "../../src/testing/test.js"
import Dummy from "../dummy/index.js"
import {postDeploymentRun} from "../helpers/deployment-api-helper.js"
import {testDeploymentAdapter, VALID_REVISION} from "../dummy/src/support/test-deployment-adapter.js"

const TOKEN = "test-deployment-token"

/**
 * @param {Record<string, ?>} overrides - Field overrides.
 * @returns {Record<string, ?>} - A valid run creation payload with overrides applied.
 */
function payload(overrides = {}) {
  return {
    idempotencyKey: `validation-spec-${Math.random().toString(36).slice(2)}`,
    project: "dummy-project",
    revision: VALID_REVISION,
    stage: "production",
    ...overrides
  }
}

describe("Deployment API - request validation", {databaseCleaning: {transaction: false, truncate: true}}, () => {
  beforeEach(() => {
    testDeploymentAdapter.reset()
  })

  it("rejects an unknown project without calling the adapter", async () => {
    await Dummy.run(async () => {
      const {body, status} = await postDeploymentRun({payload: payload({project: "other-project"}), token: TOKEN})

      expect(status).toEqual(404)
      expect(body.error).toEqual("not_found")
      expect(testDeploymentAdapter.validateRevisionCalls.length).toEqual(0)
      expect(testDeploymentAdapter.deployCalls.length).toEqual(0)
    })
  })

  it("rejects an unknown stage without calling the adapter", async () => {
    await Dummy.run(async () => {
      const {status} = await postDeploymentRun({payload: payload({stage: "qa"}), token: TOKEN})

      expect(status).toEqual(404)
      expect(testDeploymentAdapter.validateRevisionCalls.length).toEqual(0)
    })
  })

  it("rejects path-traversal project identifiers without calling the adapter", async () => {
    await Dummy.run(async () => {
      const {status} = await postDeploymentRun({payload: payload({project: "../../etc/passwd"}), token: TOKEN})

      expect(status).toEqual(404)
      expect(testDeploymentAdapter.validateRevisionCalls.length).toEqual(0)
      expect(testDeploymentAdapter.deployCalls.length).toEqual(0)
    })
  })

  it("rejects shell-injection stage identifiers without calling the adapter", async () => {
    await Dummy.run(async () => {
      const {status} = await postDeploymentRun({payload: payload({stage: "production; rm -rf /"}), token: TOKEN})

      expect(status).toEqual(404)
      expect(testDeploymentAdapter.validateRevisionCalls.length).toEqual(0)
      expect(testDeploymentAdapter.deployCalls.length).toEqual(0)
    })
  })

  it("rejects a branch name instead of a full revision", async () => {
    await Dummy.run(async () => {
      const {body, status} = await postDeploymentRun({payload: payload({revision: "master"}), token: TOKEN})

      expect(status).toEqual(422)
      expect(body.error).toEqual("invalid_params")
      expect(testDeploymentAdapter.validateRevisionCalls.length).toEqual(0)
    })
  })

  it("rejects a revision with shell metacharacters", async () => {
    await Dummy.run(async () => {
      const {status} = await postDeploymentRun({payload: payload({revision: "0123456789abcdef0123456789abcdef0123456;"}), token: TOKEN})

      expect(status).toEqual(422)
      expect(testDeploymentAdapter.validateRevisionCalls.length).toEqual(0)
    })
  })

  it("rejects a short revision", async () => {
    await Dummy.run(async () => {
      const {status} = await postDeploymentRun({payload: payload({revision: "0123456"}), token: TOKEN})

      expect(status).toEqual(422)
      expect(testDeploymentAdapter.validateRevisionCalls.length).toEqual(0)
    })
  })

  it("rejects a well-formed revision that is not reachable from the release branch", async () => {
    await Dummy.run(async () => {
      const unreachable = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
      const {body, status} = await postDeploymentRun({payload: payload({revision: unreachable}), token: TOKEN})

      expect(status).toEqual(422)
      expect(body.error).toEqual("revision_not_reachable")
      expect(testDeploymentAdapter.validateRevisionCalls.length).toEqual(1)
      expect(testDeploymentAdapter.deployCalls.length).toEqual(0)
    })
  })

  it("rejects a missing idempotency key", async () => {
    await Dummy.run(async () => {
      const {body, status} = await postDeploymentRun({
        payload: {project: "dummy-project", revision: VALID_REVISION, stage: "production"},
        token: TOKEN
      })

      expect(status).toEqual(422)
      expect(body.error).toEqual("invalid_params")
      expect(testDeploymentAdapter.deployCalls.length).toEqual(0)
    })
  })

  it("does not resolve inherited object properties as allowlisted projects", async () => {
    await Dummy.run(async () => {
      for (const project of ["__proto__", "constructor", "toString"]) {
        const {body, status} = await postDeploymentRun({payload: payload({project}), token: TOKEN})

        expect(status).toEqual(404)
        expect(body.error).toEqual("not_found")
      }

      expect(testDeploymentAdapter.validateRevisionCalls.length).toEqual(0)
      expect(testDeploymentAdapter.deployCalls.length).toEqual(0)
    })
  })

  it("does not resolve inherited object properties as allowlisted stages", async () => {
    await Dummy.run(async () => {
      for (const stage of ["__proto__", "constructor", "toString"]) {
        const {body, status} = await postDeploymentRun({payload: payload({stage}), token: TOKEN})

        expect(status).toEqual(404)
        expect(body.error).toEqual("not_found")
      }

      expect(testDeploymentAdapter.validateRevisionCalls.length).toEqual(0)
      expect(testDeploymentAdapter.deployCalls.length).toEqual(0)
    })
  })
})
