// @ts-check

import DatabaseRecord from "../database/record/index.js"
import { evaluateBackgroundJobOwnerLiveness } from "./owner-liveness.js"

export default class BackgroundJobRecord extends DatabaseRecord {
  static tableName() {
    return "background_jobs"
  }

  static primaryKey() {
    return "id"
  }

  /**
   * Evaluates whether the process that accepted this job is still alive.
   *
   * Local ownership is answered from the recorded runner hostname and OS pid.
   * Jobs accepted on another host, or jobs recorded before runner hostnames
   * existed, answer `unknown`: remote liveness needs a heartbeat or instance
   * registry, which this helper deliberately does not invent.
   * @param {object} [args] - Options.
   * @param {string} [args.hostname] - Hostname to compare against, defaults to this process's hostname.
   * @param {(pid: number) => boolean} [args.probe] - Process probe, injectable for tests.
   * @returns {import("./owner-liveness.js").BackgroundJobOwnerLivenessResult} - Liveness verdict.
   */
  ownerIsAlive({hostname, probe} = {}) {
    return evaluateBackgroundJobOwnerLiveness({
      childInstanceId: /** @type {string | null} */ (this.readAttribute("childInstanceId")),
      childPid: /** @type {number | null} */ (this.readAttribute("childPid")),
      currentHostname: hostname,
      probe,
      runnerHostname: /** @type {string | null} */ (this.readAttribute("runnerHostname"))
    })
  }
}
