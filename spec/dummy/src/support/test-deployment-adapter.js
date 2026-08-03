// @ts-check

const VALID_REVISION = "0123456789abcdef0123456789abcdef01234567"
const OTHER_REVISION = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"

/**
 * Controllable test double for the deployment integration adapter contract.
 * Mounted by the dummy app routes; each spec resets it to a deterministic
 * default behavior.
 */
class TestDeploymentAdapter {
  constructor() {
    this.reset()
  }

  /**
   * Restores deterministic defaults: every well-formed revision is reachable,
   * deploys succeed immediately, and readStatus reports a fixed active release.
   * @returns {void} - No return value.
   */
  reset() {
    /** @type {Array<Record<string, ?>>} */
    this.validateRevisionCalls = []
    /** @type {Array<Record<string, ?>>} */
    this.deployCalls = []
    this.reachableRevision = VALID_REVISION
    /** @type {"success" | "fail" | "hold"} */
    this.deployBehavior = "success"
    this.includeTokenInReport = false
    this._holdResolve = null
  }

  /**
   * Runs validate revision.
   * @param {object} args - Options.
   * @param {string} args.revision - Requested revision.
   * @returns {Promise<boolean>} - Whether the revision is reachable from the release branch.
   */
  async validateRevision(args) {
    this.validateRevisionCalls.push(args)

    return args.revision === this.reachableRevision
  }

  /**
   * Runs deploy.
   * @param {object} args - Options.
   * @param {string} args.project - Project identifier.
   * @param {string} args.revision - Requested revision.
   * @param {string} args.runId - Deployment run id.
   * @param {string} args.stage - Stage identifier.
   * @returns {Promise<Record<string, ?>>} - Deployment report.
   */
  async deploy(args) {
    this.deployCalls.push(args)

    if (this.deployBehavior === "hold") {
      await new Promise((resolve) => {
        this._holdResolve = resolve
      })
    }

    if (this.deployBehavior === "fail") {
      const error = new Error("health check failed: public edge returned 502 for token test-deployment-token")

      // @ts-expect-error - recovery metadata is part of the adapter failure contract.
      error.recovery = {activeRevision: OTHER_REVISION, restored: true}
      throw error
    }

    const report = {
      activeRevision: args.revision,
      health: [{name: "public-edge", ok: true}],
      previousRelease: {activeRevision: OTHER_REVISION, releaseId: "20260701000000"},
      publicEdge: {status: 200, url: "https://edge.example.com/health"},
      releaseId: "20260803000000"
    }

    if (this.includeTokenInReport) {
      report.releaseLog = `published with credential test-deployment-token`
    }

    return report
  }

  /**
   * Releases a held deploy started with the "hold" behavior.
   * @returns {void} - No return value.
   */
  releaseHold() {
    this._holdResolve?.()
  }

  /**
   * Runs read status.
   * @returns {Promise<Record<string, ?>>} - Current live status.
   */
  async readStatus() {
    return {activeRevision: VALID_REVISION, currentRelease: "20260803000000"}
  }
}

const testDeploymentAdapter = new TestDeploymentAdapter()

export {OTHER_REVISION, testDeploymentAdapter, VALID_REVISION}
