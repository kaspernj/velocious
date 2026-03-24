import DatabaseRecord from "../../../../src/database/record/index.js"

export default class BackgroundJobRecordBase extends DatabaseRecord {
  /**
   * @returns {typeof BackgroundJobRecordBase}
   */
  // @ts-ignore - override narrows return type for better IntelliSense in generated model bases
  getModelClass() { return /** @type {typeof BackgroundJobRecordBase} */ (this.constructor) }

  /**
   * @returns {string | null}
   */
  id() { return this.readAttribute("id") }

  /**
   * @param {string | null} newValue
   * @returns {void}
   */
  setId(newValue) { return this._setColumnAttribute("id", newValue) }

  /**
   * @returns {boolean}
   */
  hasId() { return this._hasAttribute(this.id()) }

  /**
   * @returns {string}
   */
  jobName() { return this.readAttribute("jobName") }

  /**
   * @param {string} newValue
   * @returns {void}
   */
  setJobName(newValue) { return this._setColumnAttribute("jobName", newValue) }

  /**
   * @returns {boolean}
   */
  hasJobName() { return this._hasAttribute(this.jobName()) }

  /**
   * @returns {string}
   */
  argsJson() { return this.readAttribute("argsJson") }

  /**
   * @param {string} newValue
   * @returns {void}
   */
  setArgsJson(newValue) { return this._setColumnAttribute("argsJson", newValue) }

  /**
   * @returns {boolean}
   */
  hasArgsJson() { return this._hasAttribute(this.argsJson()) }

  /**
   * @returns {boolean}
   */
  forked() { return this.readAttribute("forked") }

  /**
   * @param {boolean} newValue
   * @returns {void}
   */
  setForked(newValue) { return this._setColumnAttribute("forked", newValue) }

  /**
   * @returns {boolean}
   */
  hasForked() { return this._hasAttribute(this.forked()) }

  /**
   * @returns {number}
   */
  maxRetries() { return this.readAttribute("maxRetries") }

  /**
   * @param {number} newValue
   * @returns {void}
   */
  setMaxRetries(newValue) { return this._setColumnAttribute("maxRetries", newValue) }

  /**
   * @returns {boolean}
   */
  hasMaxRetries() { return this._hasAttribute(this.maxRetries()) }

  /**
   * @returns {number}
   */
  attempts() { return this.readAttribute("attempts") }

  /**
   * @param {number} newValue
   * @returns {void}
   */
  setAttempts(newValue) { return this._setColumnAttribute("attempts", newValue) }

  /**
   * @returns {boolean}
   */
  hasAttempts() { return this._hasAttribute(this.attempts()) }

  /**
   * @returns {string}
   */
  status() { return this.readAttribute("status") }

  /**
   * @param {string} newValue
   * @returns {void}
   */
  setStatus(newValue) { return this._setColumnAttribute("status", newValue) }

  /**
   * @returns {boolean}
   */
  hasStatus() { return this._hasAttribute(this.status()) }

  /**
   * @returns {number}
   */
  scheduledAtMs() { return this.readAttribute("scheduledAtMs") }

  /**
   * @param {number} newValue
   * @returns {void}
   */
  setScheduledAtMs(newValue) { return this._setColumnAttribute("scheduledAtMs", newValue) }

  /**
   * @returns {boolean}
   */
  hasScheduledAtMs() { return this._hasAttribute(this.scheduledAtMs()) }

  /**
   * @returns {number}
   */
  createdAtMs() { return this.readAttribute("createdAtMs") }

  /**
   * @param {number} newValue
   * @returns {void}
   */
  setCreatedAtMs(newValue) { return this._setColumnAttribute("createdAtMs", newValue) }

  /**
   * @returns {boolean}
   */
  hasCreatedAtMs() { return this._hasAttribute(this.createdAtMs()) }

  /**
   * @returns {number | null}
   */
  handedOffAtMs() { return this.readAttribute("handedOffAtMs") }

  /**
   * @param {number | null} newValue
   * @returns {void}
   */
  setHandedOffAtMs(newValue) { return this._setColumnAttribute("handedOffAtMs", newValue) }

  /**
   * @returns {boolean}
   */
  hasHandedOffAtMs() { return this._hasAttribute(this.handedOffAtMs()) }

  /**
   * @returns {number | null}
   */
  completedAtMs() { return this.readAttribute("completedAtMs") }

  /**
   * @param {number | null} newValue
   * @returns {void}
   */
  setCompletedAtMs(newValue) { return this._setColumnAttribute("completedAtMs", newValue) }

  /**
   * @returns {boolean}
   */
  hasCompletedAtMs() { return this._hasAttribute(this.completedAtMs()) }

  /**
   * @returns {number | null}
   */
  failedAtMs() { return this.readAttribute("failedAtMs") }

  /**
   * @param {number | null} newValue
   * @returns {void}
   */
  setFailedAtMs(newValue) { return this._setColumnAttribute("failedAtMs", newValue) }

  /**
   * @returns {boolean}
   */
  hasFailedAtMs() { return this._hasAttribute(this.failedAtMs()) }

  /**
   * @returns {number | null}
   */
  orphanedAtMs() { return this.readAttribute("orphanedAtMs") }

  /**
   * @param {number | null} newValue
   * @returns {void}
   */
  setOrphanedAtMs(newValue) { return this._setColumnAttribute("orphanedAtMs", newValue) }

  /**
   * @returns {boolean}
   */
  hasOrphanedAtMs() { return this._hasAttribute(this.orphanedAtMs()) }

  /**
   * @returns {string | null}
   */
  workerId() { return this.readAttribute("workerId") }

  /**
   * @param {string | null} newValue
   * @returns {void}
   */
  setWorkerId(newValue) { return this._setColumnAttribute("workerId", newValue) }

  /**
   * @returns {boolean}
   */
  hasWorkerId() { return this._hasAttribute(this.workerId()) }

  /**
   * @returns {string | null}
   */
  lastError() { return this.readAttribute("lastError") }

  /**
   * @param {string | null} newValue
   * @returns {void}
   */
  setLastError(newValue) { return this._setColumnAttribute("lastError", newValue) }

  /**
   * @returns {boolean}
   */
  hasLastError() { return this._hasAttribute(this.lastError()) }
}
