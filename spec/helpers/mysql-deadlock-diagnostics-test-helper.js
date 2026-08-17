// @ts-check

import Configuration from "../../src/configuration.js"
import EnvironmentHandlerNode from "../../src/environment-handlers/node.js"
import MysqlDriver from "../../src/database/drivers/mysql/index.js"

export const SECRET_SQL = "UPDATE `accounts` SET `token` = 'secret-token-91827' WHERE `email` = 'owner@example.test' AND `balance` = 12345"

/**
 * @param {import("../../src/logger/outputs/array-output.js").default} [loggingOutput] - Optional captured logging output.
 * @returns {Configuration} - Test configuration.
 */
export function configuration(loggingOutput) {
  return new Configuration({
    database: {test: {}},
    directory: process.cwd(),
    environment: "test",
    environmentHandler: new EnvironmentHandlerNode(),
    initializeModels: async () => {},
    locale: "en",
    localeFallbacks: {en: ["en"]},
    locales: ["en"],
    logging: loggingOutput
      ? {console: false, file: false, outputs: [{levels: ["warn"], output: loggingOutput}]}
      : undefined
  })
}

export class DiagnosticMysqlDriver extends MysqlDriver {
  attempts = 0
  captureCalls = 0
  captureFailure = false
  clockMs = 100
  contentionCode = "ER_LOCK_DEADLOCK"
  diagnosticPipelineFailure = false
  diagnosticReturnsNonPromise = false
  failedAttempts = 1
  /** @type {Error | undefined} */
  lastQueryError
  parserFailure = false
  /** @type {Promise<string> | undefined} */
  statusCapturePromise
  status = `LATEST DETECTED DEADLOCK
*** (1) TRANSACTION:
TRANSACTION 123, ACTIVE 1 sec
${SECRET_SQL}
*** (1) WAITING FOR THIS LOCK TO BE GRANTED:
RECORD LOCKS space id 8 page no 4 n bits 72 index \`email\` of table \`app\`.\`accounts\` trx id 123 lock_mode X waiting
Record lock, heap no 2 PHYSICAL RECORD: n_fields 2; compact format
 0: len 30; hex 7365637265742d746f6b656e2d3931383237; asc secret-token-91827;;
*** WE ROLL BACK TRANSACTION (1)
${"ignored status line\n".repeat(500)}`

  /** @returns {number} - Deterministic transaction-attempt clock. */
  // Base-driver hook invoked through the transaction retry contract.
  // fallow-ignore-next-line unused-class-member
  _nowMs() {
    const current = this.clockMs

    this.clockMs += 17

    return current
  }

  /** @returns {Promise<void>} - Resolves without a real retry delay. */
  // Base-driver hook invoked through the transaction retry contract.
  // fallow-ignore-next-line unused-class-member
  async _waitMs() {}

  /**
   * @param {import("../../src/database/drivers/base.js").DeadlockRetryDiagnosticSnapshot} snapshot - Immutable retry snapshot.
   * @returns {Promise<Record<string, ReturnType<typeof JSON.parse>>>} - Safe diagnostic context.
   */
  _deadlockDiagnosticContext(snapshot) {
    if (this.diagnosticPipelineFailure) throw new Error("simulated diagnostic pipeline failure")
    if (this.diagnosticReturnsNonPromise) {
      // @ts-expect-error Simulates a runtime driver that violates the documented Promise contract.
      return {statusCapture: "malformed-non-promise"}
    }

    return super._deadlockDiagnosticContext(snapshot)
  }

  /** @returns {Promise<import("../../src/database/drivers/base.js").QueryResultType>} - Query result. */
  async _queryActual(sql) {
    if (sql.endsWith("START TRANSACTION") || sql.endsWith("ROLLBACK") || sql.endsWith("COMMIT")) return []

    this.attempts++
    if (this.attempts <= this.failedAttempts) {
      const message = this.contentionCode == "ER_LOCK_WAIT_TIMEOUT"
        ? "Lock wait timeout exceeded; try restarting transaction"
        : "Deadlock found when trying to get lock"
      const mysqlError = new Error(message)
      // @ts-expect-error MySQL attaches its symbolic error code at runtime.
      mysqlError.code = this.contentionCode
      const queryError = new Error("Query failed", {cause: mysqlError})

      this.lastQueryError = queryError
      throw queryError
    }

    return []
  }

  /** @returns {Promise<string>} - Simulated InnoDB status. */
  async _captureInnodbDeadlockStatus() {
    this.captureCalls++
    if (this.captureFailure) throw new Error("diagnostic connection password=do-not-report")
    if (this.statusCapturePromise) return await this.statusCapturePromise

    return this.status
  }

  /**
   * @param {string} status - Simulated InnoDB status.
   * @returns {ReturnType<MysqlDriver["_innodbDeadlockSummary"]>} - Parsed summary.
   */
  _innodbDeadlockSummary(status) {
    if (this.parserFailure) throw new Error("simulated deadlock parser failure")

    return super._innodbDeadlockSummary(status)
  }
}
