// @ts-check

import Controller from "../controller.js"
import DeploymentRunStore, {registerActiveDeploymentRun, unregisterActiveDeploymentRun} from "./run-store.js"
import {bearerToken, constantTimeEqual} from "../utils/bearer-token.js"
import {getDeploymentMount} from "./registry.js"
import {sanitizeAdapterValue, sanitizeErrorPayload} from "./sanitize.js"

const REVISION_PATTERN = /^[0-9a-f]{40}$/
const MAX_IDEMPOTENCY_KEY_LENGTH = 255

/**
 * Resolves allowlisted stage options with own-property checks only, so
 * request-controlled names like "__proto__" or "constructor" can never
 * resolve inherited values. The normalized maps are also null-prototype, so
 * this is defense in depth.
 * @param {import("./registry.js").DeploymentMountOptions} options - Mount options.
 * @param {string} project - Requested project identifier.
 * @param {string} stage - Requested stage identifier.
 * @returns {import("./registry.js").DeploymentStageOptions | undefined} - Stage options when allowlisted.
 */
function lookupStageOptions(options, project, stage) {
  if (!Object.hasOwn(options.projects, project)) return undefined

  const stages = options.projects[project].stages

  if (!Object.hasOwn(stages, stage)) return undefined

  return stages[stage]
}

/**
 * Authenticated HTTP API for callable deployments. Mounted by
 * {@link import("./index.js").default} as a route-resolver hook so it can ship
 * inside the velocious package. Every action is gated by a bearer-token check
 * against the configured access tokens; the API exposes only allowlisted
 * project/stage pairs and full immutable revisions, and delegates all
 * execution to the configured adapter. It never accepts commands, paths,
 * arbitrary refs, environment variables, or raw log output.
 */
export default class VelociousDeploymentApiController extends Controller {
  /**
   * Runs mount options.
   * @returns {import("./registry.js").DeploymentMountOptions} - Options for the mount that matched this request.
   */
  _mountOptions() {
    const at = /** @type {string} */ (this.params().velociousDeploymentMountAt)
    const options = getDeploymentMount(this.getConfiguration(), at)

    if (!options) throw new Error(`No deployment API mount registered at ${at}`)

    return options
  }

  /**
   * Runs store.
   * @returns {DeploymentRunStore} - Run store scoped to the mount's database.
   */
  _store() {
    if (!this._deploymentRunStore) {
      this._deploymentRunStore = new DeploymentRunStore({
        configuration: this.getConfiguration(),
        databaseIdentifier: this._mountOptions().databaseIdentifier,
        mountIdentifier: this._mountOptions().mountIdentifier,
        staleRunTimeoutMs: this._mountOptions().staleRunTimeoutMs
      })
    }

    return this._deploymentRunStore
  }

  /**
   * Reports one internally consumed framework failure on both documented
   * error channels so framework-specific and unified reporters see the same
   * payload.
   * @param {object} args - Options.
   * @param {string} args.context - Deployment API failure context.
   * @param {?} args.error - Consumed error.
   * @returns {void} - No return value.
   */
  _emitFrameworkError({context, error}) {
    const errorEvents = this.getConfiguration().getErrorEvents()
    const payload = {context, error, request: this.getRequest()}

    errorEvents.emit("framework-error", payload)
    errorEvents.emit("all-error", {...payload, errorType: "framework-error"})
  }

  /**
   * Authorizes the request with a constant-time bearer-token comparison and
   * runs the action body only when authorized. Renders a 401 otherwise. The
   * base controller has no before-action halting, so authorization is enforced
   * here per action. Tokens are only accepted through the Authorization header
   * — never through URLs — and are never rendered back.
   * @param {() => Promise<void>} actionFn - Action body.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async _respond(actionFn) {
    const token = bearerToken(this.request())
    let authorized = false

    if (token) {
      for (const accessToken of this._mountOptions().accessTokens) {
        if (constantTimeEqual(token, accessToken)) {
          authorized = true
          break
        }
      }
    }

    if (!authorized) {
      await this.render({json: {error: "unauthorized"}, status: 401})
      return
    }

    await actionFn()
  }

  /**
   * Creates a deployment run for an allowlisted project/stage and a full
   * immutable revision reachable from the approved release branch. Idempotent:
   * a retried idempotency key reads the original run, a reused key with a
   * different payload conflicts, and an active run for the same project/stage
   * returns a bounded conflict.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async create() {
    await this._respond(async () => {
      const params = this.params()
      const revision = typeof params.revision === "string" ? params.revision : null
      const idempotencyKey = typeof params.idempotencyKey === "string" ? params.idempotencyKey : null
      const invalidFields = []

      if (!revision || !REVISION_PATTERN.test(revision)) invalidFields.push("revision")
      if (!idempotencyKey || idempotencyKey.length === 0 || idempotencyKey.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
        invalidFields.push("idempotencyKey")
      }

      if (invalidFields.length > 0) {
        await this.render({json: {error: "invalid_params", fields: invalidFields}, status: 422})
        return
      }

      const options = this._mountOptions()
      const project = typeof params.project === "string" ? params.project : ""
      const stage = typeof params.stage === "string" ? params.stage : ""
      const stageOptions = lookupStageOptions(options, project, stage)

      if (!stageOptions) {
        await this.render({json: {error: "not_found"}, status: 404})
        return
      }

      const store = this._store()
      const validRevision = /** @type {string} */ (revision)
      const validIdempotencyKey = /** @type {string} */ (idempotencyKey)

      // Retries read the original run before anything else — a replay must
      // never re-validate or re-deploy.
      const existingRun = await store.findRunByKey(validIdempotencyKey)

      if (existingRun) {
        await this._renderExistingRun({existingRun, project, revision: validRevision, stage})
        return
      }

      const reachable = await options.adapter.validateRevision({
        configuration: this.getConfiguration(),
        project,
        releaseBranch: stageOptions.releaseBranch,
        revision: validRevision,
        stage
      })

      if (!reachable) {
        await this.render({json: {error: "revision_not_reachable"}, status: 422})
        return
      }

      const outcome = await store.createRunIfPossible({
        idempotencyKey: validIdempotencyKey,
        project,
        revision: validRevision,
        stage
      })

      if (outcome.outcome === "replay" || outcome.outcome === "conflict") {
        const existingFromStore = outcome.run

        if (!existingFromStore) throw new Error(`Deployment run store reported '${outcome.outcome}' without a run`)

        await this._renderExistingRun({existingRun: existingFromStore, project, revision: validRevision, stage})
        return
      }

      if (outcome.outcome === "in_progress") {
        const activeRun = outcome.run

        await this.render({json: {error: "deployment_in_progress", runId: activeRun ? activeRun.id : undefined}, status: 409})
        return
      }

      if (outcome.outcome === "reconciliation_required") {
        const blockedRun = outcome.run

        if (!blockedRun) throw new Error("Deployment run store reported 'reconciliation_required' without a run")

        await this.render({json: {error: "deployment_reconciliation_required", runId: blockedRun.id}, status: 409})
        return
      }

      const run = outcome.run

      if (!run) throw new Error("Deployment run store reported 'created' without a run")

      await this._audit({event: "run_requested", payload: {project, revision: validRevision, stage}, runId: run.id})

      // Execution is deliberately not awaited: the deploy runs under the
      // integration's own lock/build/health/rollback semantics and the caller
      // reads progress back through the show action.
      this._executeRun({options, run}).catch((error) => {
        this._emitFrameworkError({context: "deployment-api-execute-run", error})
      })

      await this.render({json: {run: this._serializeRun(run)}, status: 202})
    })
  }

  /**
   * Renders a previously created run for an idempotency-key hit: a replay when
   * the payload matches, a bounded conflict when it doesn't.
   * @param {object} args - Options.
   * @param {import("./run-store.js").DeploymentRunRow} args.existingRun - The stored run.
   * @param {string} args.project - Requested project.
   * @param {string} args.revision - Requested revision.
   * @param {string} args.stage - Requested stage.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async _renderExistingRun({existingRun, project, revision, stage}) {
    const samePayload = existingRun.project === project && existingRun.stage === stage && existingRun.revision === revision

    if (!samePayload) {
      await this.render({json: {error: "idempotency_conflict", runId: existingRun.id}, status: 409})
      return
    }

    await this.render({json: {replayed: true, run: this._serializeRun(existingRun)}, status: 200})
  }

  /**
   * Returns the bounded state of a single run, enriched with the adapter's
   * live status when the integration provides one.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async show() {
    await this._respond(async () => {
      const run = await this._store().findRunById(/** @type {string} */ (this.params().id))

      if (!run) {
        await this.render({json: {error: "not_found"}, status: 404})
        return
      }

      const options = this._mountOptions()
      /** @type {Record<string, ?>} */
      const body = {run: this._serializeRun(run)}

      if (options.adapter.readStatus) {
        const liveStatus = await options.adapter.readStatus({
          configuration: this.getConfiguration(),
          project: run.project,
          stage: run.stage
        })

        body.current = sanitizeAdapterValue(liveStatus, options.accessTokens) ?? null
      }

      await this.render({json: body, status: 200})
    })
  }

  /**
   * Executes a created run asynchronously: registers it as active in this
   * process, marks it running, heartbeats its ownership lease while the
   * adapter deploys, and records the sanitized outcome. A deployment failure
   * is an expected operational result — it is persisted with its sanitized
   * recovery information instead of being raised, so it stays visible through
   * readback and audit rather than crashing the worker.
   * @param {object} args - Options.
   * @param {import("./registry.js").DeploymentMountOptions} args.options - Mount options.
   * @param {import("./run-store.js").DeploymentRunRow} args.run - The created run.
   * @returns {Promise<void>} - Resolves when the outcome is recorded.
   */
  async _executeRun({options, run}) {
    const store = this._store()
    const secrets = options.accessTokens
    const stageOptions = lookupStageOptions(options, run.project, run.stage)

    if (!stageOptions) throw new Error(`Deployment run ${run.id} references non-allowlisted ${run.project}/${run.stage}`)
    if (!run.ownerToken) throw new Error(`Deployment run ${run.id} has no execution owner token`)

    const ownerToken = run.ownerToken

    registerActiveDeploymentRun(run.id)

    /** @type {ReturnType<typeof setInterval> | null} */
    let heartbeatTimer = null

    try {
      await store.markRunning({id: run.id, startedAtMs: Date.now()})

      // Renew the ownership lease while the deploy runs so reconciliation
      // never reclaims this genuinely active run; unref'd so the timer alone
      // keeps no process alive.
      const heartbeatIntervalMs = Math.max(1000, Math.floor(options.staleRunTimeoutMs / 4))

      heartbeatTimer = setInterval(() => {
        store.heartbeat({heartbeatAtMs: Date.now(), id: run.id}).catch((error) => {
          this._emitFrameworkError({context: "deployment-api-heartbeat", error})
        })
      }, heartbeatIntervalMs)
      heartbeatTimer.unref()

      await this._audit({event: "run_started", payload: {project: run.project, revision: run.revision, stage: run.stage}, runId: run.id})

      let report

      try {
        report = await options.adapter.deploy({
          configuration: this.getConfiguration(),
          project: run.project,
          releaseBranch: stageOptions.releaseBranch,
          revision: run.revision,
          runId: run.id,
          stage: run.stage
        })
      } catch (error) {
        const errorPayload = sanitizeErrorPayload(error, secrets)

        try {
          await store.markFailed({error: errorPayload, finishedAtMs: Date.now(), id: run.id, ownerToken})
          await this._audit({
            event: "run_failed",
            payload: {message: errorPayload.message, project: run.project, revision: run.revision, stage: run.stage},
            runId: run.id
          })
        } catch (storeError) {
          // Recording the failure itself failed — that is an unexpected bug
          // and must surface to process-level error reporters.
          this._emitFrameworkError({context: "deployment-api-record-failure", error: storeError})
        }

        return
      }

      try {
        const result = sanitizeAdapterValue(report ?? {}, secrets) ?? {}

        await store.markSucceeded({finishedAtMs: Date.now(), id: run.id, ownerToken, result})
        await this._audit({event: "run_succeeded", payload: {project: run.project, revision: run.revision, stage: run.stage}, runId: run.id})
      } catch (error) {
        // The adapter already returned success. Surface the recording error,
        // then fence the run in a durable non-retryable state rather than
        // falsely recording an external success as a deployment failure.
        this._emitFrameworkError({context: "deployment-api-record-success", error})

        const reconciliationError = {
          message: "Deployment activation succeeded, but its result could not be persisted; operator reconciliation is required"
        }

        try {
          await store.markReconciliationRequired({
            error: reconciliationError,
            finishedAtMs: Date.now(),
            id: run.id,
            ownerToken
          })
          await this._audit({
            event: "run_reconciliation_required",
            payload: {message: reconciliationError.message, project: run.project, revision: run.revision, stage: run.stage},
            runId: run.id
          })
        } catch (reconciliationErrorPersistenceError) {
          this._emitFrameworkError({
            context: "deployment-api-record-reconciliation-required",
            error: reconciliationErrorPersistenceError
          })
        }
      }
    } finally {
      if (heartbeatTimer) clearInterval(heartbeatTimer)
      unregisterActiveDeploymentRun(run.id)
    }
  }

  /**
   * Records a sanitized audit event. Audit persistence must never strand or
   * suppress a deployment, so a failure here is reported on the
   * framework-error and unified all-error channels (where process-level bug
   * reporters capture it), and execution continues.
   * @param {object} args - Options.
   * @param {string} args.event - Event name.
   * @param {Record<string, ?>} args.payload - Payload; sanitized and redacted before persistence.
   * @param {string | null} args.runId - Owning run id.
   * @returns {Promise<void>} - Resolves when recorded or reported.
   */
  async _audit({event, payload, runId}) {
    const sanitized = sanitizeAdapterValue(payload, this._mountOptions().accessTokens) ?? {}

    try {
      await this._store().addAuditEvent({event, payload: sanitized, runId})
    } catch (error) {
      this._emitFrameworkError({context: "deployment-api-audit", error})
    }
  }

  /**
   * Serializes a run for the API.
   * @param {import("./run-store.js").DeploymentRunRow} run - Run row.
   * @returns {Record<string, ?>} - Serialized run.
   */
  _serializeRun(run) {
    return {
      error: run.error,
      finishedAtMs: run.finishedAtMs,
      id: run.id,
      idempotencyKey: run.idempotencyKey,
      project: run.project,
      requestedAtMs: run.requestedAtMs,
      result: run.result,
      revision: run.revision,
      stage: run.stage,
      startedAtMs: run.startedAtMs,
      status: run.status
    }
  }
}
