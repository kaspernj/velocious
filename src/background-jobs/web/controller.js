// @ts-check

import Controller from "../../controller.js"
import BackgroundJobsStore from "../store.js"
import {authorizeJobsRequest} from "./authorization.js"
import {getJobsMount} from "./registry.js"

const DASHBOARD_STATUSES = ["queued", "handed_off", "completed", "failed", "orphaned"]
const SORTABLE_KEYS = ["attempts", "completedAtMs", "createdAtMs", "failedAtMs", "handedOffAtMs", "scheduledAtMs"]
const DEFAULT_PER_PAGE = 25
const MAX_PER_PAGE = 100

/**
 * Read-only HTTP API backing the background-jobs dashboard. Mounted by
 * {@link import("./index.js").default} as a route-resolver hook so it can ship
 * inside the velocious package. Every action is gated by {@link authorizeJobsRequest}.
 */
export default class VelociousBackgroundJobsWebController extends Controller {
  /** @returns {import("./registry.js").JobsMountOptions} - Options for the mount that matched this request. */
  _mountOptions() {
    const at = this.params().velociousJobsMountAt

    return getJobsMount(this.getConfiguration(), at) || {}
  }

  /** @returns {BackgroundJobsStore} - Jobs store scoped to the mount's database. */
  _store() {
    if (!this._jobsStore) {
      this._jobsStore = new BackgroundJobsStore({
        configuration: this.getConfiguration(),
        databaseIdentifier: this._mountOptions().databaseIdentifier
      })
    }

    return this._jobsStore
  }

  /**
   * Adds CORS headers when the request origin is allowed, so the standalone
   * browser dashboard can read the API cross-origin.
   * @param {import("./registry.js").JobsMountOptions} options - Mount options.
   * @returns {void} - No return value.
   */
  _applyCorsHeaders(options) {
    const allowedOrigins = Array.isArray(options.allowedOrigins) ? options.allowedOrigins : []

    if (allowedOrigins.length === 0) return

    const origin = this.request().origin()
    const allowAll = allowedOrigins.includes("*")

    if (!origin) return
    if (!allowAll && !allowedOrigins.includes(origin)) return

    const response = this.response()

    response.setHeader("Access-Control-Allow-Origin", allowAll ? "*" : origin)
    response.setHeader("Vary", "Origin")
    response.setHeader("Access-Control-Allow-Headers", "authorization, content-type")
    response.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
  }

  /**
   * Applies CORS headers, authorizes the request, and runs the action body only
   * when authorized. Renders a 401 otherwise. The base controller has no
   * before-action halting, so authorization is enforced here per action.
   * @param {() => Promise<void>} actionFn - Action body.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async _respond(actionFn) {
    const options = this._mountOptions()

    this._applyCorsHeaders(options)

    const authorized = await authorizeJobsRequest({
      ability: this.currentAbility(),
      configuration: this.getConfiguration(),
      options,
      request: this.request()
    })

    if (!authorized) {
      await this.render({json: {error: "unauthorized"}, status: 401})
      return
    }

    await actionFn()
  }

  /** @returns {Promise<void>} - Resolves when complete. */
  async health() {
    await this._respond(async () => {
      await this.render({json: {ok: true, service: "velocious-background-jobs"}})
    })
  }

  /** @returns {Promise<void>} - Resolves when complete. */
  async stats() {
    await this._respond(async () => {
      const counts = await this._store().countsByStatus()
      /** @type {Record<string, number>} */
      const byStatus = {}
      let total = 0

      for (const status of DASHBOARD_STATUSES) {
        byStatus[status] = counts[status] || 0
      }

      for (const value of Object.values(counts)) {
        total += value
      }

      await this.render({json: {counts: byStatus, generatedAtMs: Date.now(), total}})
    })
  }

  /** @returns {Promise<void>} - Resolves when complete. */
  async index() {
    await this._respond(async () => {
      const params = this.params()
      const status = this._sanitizeStatus(params.status)
      const jobName = typeof params.jobName === "string" && params.jobName.length > 0 ? params.jobName : undefined
      const page = this._positiveInt(params.page, 1)
      const perPage = Math.min(this._positiveInt(params.perPage, DEFAULT_PER_PAGE), MAX_PER_PAGE)
      const {sortColumn, sortDirection} = this._sanitizeSort(params.sort)
      const store = this._store()
      const jobs = await store.listJobs({jobName, limit: perPage, offset: (page - 1) * perPage, sortColumn, sortDirection, status})
      const total = await store.countJobs({jobName, status})

      await this.render({json: {
        jobs: jobs.map((job) => this._serializeJob(job)),
        pagination: {page, perPage, total, totalPages: perPage > 0 ? Math.ceil(total / perPage) : 0}
      }})
    })
  }

  /** @returns {Promise<void>} - Resolves when complete. */
  async show() {
    await this._respond(async () => {
      const job = await this._store().getJob(this.params().id)

      if (!job) {
        await this.render({json: {error: "not_found"}, status: 404})
        return
      }

      await this.render({json: {job: this._serializeJob(job)}})
    })
  }

  /** @returns {Promise<void>} - Resolves when complete. */
  async schedule() {
    await this._respond(async () => {
      const scheduled = await this.getConfiguration().getScheduledBackgroundJobsConfig()

      await this.render({json: {schedule: this._serializeSchedule(scheduled)}})
    })
  }

  /**
   * @param {import("../types.js").BackgroundJobRow} job - Job row.
   * @returns {Record<string, any>} - Serialized job for the API.
   */
  _serializeJob(job) {
    const redactArgs = Boolean(this._mountOptions().redactArgs)

    return {
      args: redactArgs ? undefined : job.args,
      argsRedacted: redactArgs,
      attempts: job.attempts,
      completedAtMs: job.completedAtMs,
      createdAtMs: job.createdAtMs,
      failedAtMs: job.failedAtMs,
      forked: job.forked,
      handedOffAtMs: job.handedOffAtMs,
      id: job.id,
      jobName: job.jobName,
      lastError: job.lastError,
      maxRetries: job.maxRetries,
      orphanedAtMs: job.orphanedAtMs,
      scheduledAtMs: job.scheduledAtMs,
      status: job.status,
      workerId: job.workerId
    }
  }

  /**
   * @param {import("../../configuration-types.js").ScheduledBackgroundJobsConfiguration | undefined} scheduled - Scheduled jobs config.
   * @returns {Array<Record<string, any>>} - Serialized recurring jobs.
   */
  _serializeSchedule(scheduled) {
    const jobs = scheduled?.jobs

    if (!jobs || typeof jobs !== "object") return []

    const redactArgs = Boolean(this._mountOptions().redactArgs)

    return Object.keys(jobs).map((name) => {
      const entry = jobs[name] || /** @type {any} */ ({})

      return {
        args: redactArgs ? undefined : (entry.args || []),
        cron: entry.cron,
        enabled: entry.enabled !== false,
        every: entry.every,
        jobName: typeof entry.class === "function" ? entry.class.name : undefined,
        name,
        options: entry.options || {}
      }
    })
  }

  /**
   * @param {unknown} value - Raw status param.
   * @returns {string | undefined} - Valid status or undefined.
   */
  _sanitizeStatus(value) {
    return typeof value === "string" && DASHBOARD_STATUSES.includes(value) ? value : undefined
  }

  /**
   * @param {unknown} value - Raw sort param (e.g. "createdAtMs" or "-failedAtMs").
   * @returns {{sortColumn: string, sortDirection: "ASC" | "DESC"}} - Normalized sort.
   */
  _sanitizeSort(value) {
    if (typeof value !== "string" || value.length === 0) {
      return {sortColumn: "createdAtMs", sortDirection: "DESC"}
    }

    const descending = value.startsWith("-")
    const key = descending ? value.slice(1) : value
    const sortColumn = SORTABLE_KEYS.includes(key) ? key : "createdAtMs"

    return {sortColumn, sortDirection: descending ? "DESC" : "ASC"}
  }

  /**
   * @param {unknown} value - Raw numeric param.
   * @param {number} fallback - Fallback when invalid.
   * @returns {number} - Positive integer.
   */
  _positiveInt(value, fallback) {
    const numeric = Number(Array.isArray(value) ? value[0] : value)

    if (!Number.isFinite(numeric) || numeric < 1) return fallback

    return Math.floor(numeric)
  }
}
