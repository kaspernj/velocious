// @ts-check

import TableData from "../database/table-data/index.js"
import TableIndex from "../database/table-data/table-index.js"
import {createHash, randomUUID} from "node:crypto"

/**
 * DeploymentRunRow type.
 * @typedef {object} DeploymentRunRow
 * @property {string} id - Run id (UUID).
 * @property {string} mountIdentifier - Stable identifier of the authenticated API mount that owns the run.
 * @property {string} project - Allowlisted project identifier.
 * @property {string} stage - Allowlisted stage identifier.
 * @property {string} revision - Full immutable requested Git revision.
 * @property {string} idempotencyKey - Caller-supplied idempotency key.
 * @property {string} status - Run status: pending, running, succeeded, failed, interrupted, or reconciliation_required.
 * @property {?} result - Sanitized adapter report, or null while unset.
 * @property {?} error - Sanitized failure payload, or null while unset.
 * @property {number} requestedAtMs - Creation time in ms epoch.
 * @property {number | null} startedAtMs - Execution start in ms epoch.
 * @property {number | null} finishedAtMs - Terminal time in ms epoch.
 * @property {string | null} ownerToken - Ownership token of the executing process.
 * @property {number | null} heartbeatAtMs - Last ownership lease heartbeat in ms epoch.
 */
/**
 * DeploymentAuditEventRow type.
 * @typedef {object} DeploymentAuditEventRow
 * @property {string} id - Event id (UUID).
 * @property {string | null} runId - Owning run id.
 * @property {string} event - Event name (e.g. run_requested, run_started, run_succeeded, run_failed).
 * @property {?} payload - Sanitized JSON payload.
 * @property {number} createdAtMs - Creation time in ms epoch.
 */
/**
 * CreateRunOutcome type.
 * @typedef {object} CreateRunOutcome
 * @property {"created" | "replay" | "conflict" | "in_progress" | "reconciliation_required"} outcome - What happened.
 * @property {DeploymentRunRow | null} run - The created, replayed, conflicting, or active run; null when the deployment lock was held mid-creation by another process.
 */
const RUNS_TABLE = "velocious_deployment_runs"
const AUDIT_TABLE = "velocious_deployment_api_audit_events"
const BLOCKING_STATUSES = ["pending", "running", "reconciliation_required"]
const DEFAULT_STALE_RUN_TIMEOUT_MS = 60000
const IDEMPOTENCY_INDEX_NAME = "index_deployment_runs_on_mount_and_key"
const LEGACY_UNSCOPED_MOUNT_IDENTIFIER = "legacy-unscoped"
const SCHEMA_LOCK_NAME = "velocious-deployment-api:schema-v2"

/**
 * Ownership token identifying runs executed by this process. Combined with the
 * heartbeat lease it lets reconciliation distinguish a genuinely active run
 * (fresh lease, or running in this process) from an interrupted one left
 * behind by a dead owner.
 */
const PROCESS_OWNER_TOKEN = randomUUID()

/**
 * Runs currently executing in this process. A genuinely active local run is
 * never reclaimed as stale, even if a blocked event loop delays its heartbeat.
 * @type {Set<string>}
 */
const activeRunIdsInProcess = new Set()

/**
 * Marks a run as executing in this process so lease reconciliation never
 * reclaims it.
 * @param {string} id - Run id.
 * @returns {void} - No return value.
 */
export function registerActiveDeploymentRun(id) {
  activeRunIdsInProcess.add(id)
}

/**
 * Removes a run from the in-process execution registry.
 * @param {string} id - Run id.
 * @returns {void} - No return value.
 */
export function unregisterActiveDeploymentRun(id) {
  activeRunIdsInProcess.delete(id)
}

/**
 * Parses a stored JSON text column.
 * @param {?} value - Raw column value.
 * @returns {?} - Parsed value or null.
 */
function parseJsonColumn(value) {
  if (typeof value !== "string" || value.length === 0) return null

  return JSON.parse(value)
}

/**
 * Persistence for deployment API runs and audit events. Owns its schema
 * lazily (the record-attachments store precedent) so the tables exist in the
 * consuming app's database without app-side migrations.
 */
export default class DeploymentRunStore {
  /**
   * Runs constructor.
   * @param {object} args - Options.
   * @param {import("../configuration.js").default} args.configuration - Configuration instance.
   * @param {string} [args.databaseIdentifier] - Database identifier; defaults to the primary database.
   * @param {string} args.mountIdentifier - Stable identifier of the authenticated API mount.
   * @param {number} [args.staleRunTimeoutMs] - Lease timeout after which an active run without a heartbeat counts as interrupted.
   */
  constructor({configuration, databaseIdentifier, mountIdentifier, staleRunTimeoutMs = DEFAULT_STALE_RUN_TIMEOUT_MS}) {
    if (typeof mountIdentifier !== "string" || mountIdentifier.length === 0) {
      throw new Error("DeploymentRunStore requires a mountIdentifier")
    }

    this.configuration = configuration
    this.databaseIdentifier = databaseIdentifier || "default"
    this.mountIdentifier = mountIdentifier
    this.staleRunTimeoutMs = staleRunTimeoutMs
    /** @type {Promise<void> | null} */
    this._readyPromise = null
  }

  /**
   * Ensures the run and audit tables exist.
   * @returns {Promise<void>} - Resolves when the schema is ready.
   */
  async ensureReady() {
    if (this._readyPromise) {
      await this._readyPromise
      return
    }

    this._readyPromise = this._withDb(async (db) => {
      const acquired = await db.acquireAdvisoryLock(SCHEMA_LOCK_NAME)

      if (!acquired) throw new Error("Failed to acquire deployment API schema lock")

      try {
        db.clearSchemaCache()

        if (!(await db.tableExists(RUNS_TABLE))) {
          const table = new TableData(RUNS_TABLE, {ifNotExists: true})

          table.string("id", {null: false, primaryKey: true})
          table.string("mount_identifier", {maxLength: 64, null: false})
          table.string("project", {null: false, index: true})
          table.string("stage", {null: false})
          table.string("revision", {null: false})
          table.string("idempotency_key", {null: false})
          table.string("status", {null: false, index: true})
          table.text("result_json", {null: true})
          table.text("error_json", {null: true})
          table.bigint("requested_at_ms", {null: false})
          table.bigint("started_at_ms", {null: true})
          table.bigint("finished_at_ms", {null: true})
          table.string("owner_token", {null: true})
          table.bigint("heartbeat_at_ms", {null: true})
          table.addIndex(new TableIndex(["mount_identifier", "idempotency_key"], {
            name: IDEMPOTENCY_INDEX_NAME,
            unique: true
          }))

          await db.createTable(table)
        }

        await this._ensureRunColumns(db)
        await this._ensureScopedIdempotencyIndex(db)

        if (!(await db.tableExists(AUDIT_TABLE))) {
          const table = new TableData(AUDIT_TABLE, {ifNotExists: true})

          table.string("id", {null: false, primaryKey: true})
          table.string("mount_identifier", {maxLength: 64, null: false})
          table.string("run_id", {null: true, index: true})
          table.string("event", {null: false, index: true})
          table.text("payload_json", {null: true})
          table.bigint("created_at_ms", {null: false})

          await db.createTable(table)
        }

        await this._ensureMountIdentifierColumn(db, AUDIT_TABLE)
      } finally {
        await db.releaseAdvisoryLock(SCHEMA_LOCK_NAME)
      }
    })

    try {
      await this._readyPromise
    } finally {
      this._readyPromise = null
    }
  }

  /**
   * Finds a run by id.
   * @param {string} id - Run id.
   * @returns {Promise<DeploymentRunRow | null>} - The run or null.
   */
  async findRunById(id) {
    await this.ensureReady()

    return await this._withDb(async (db) => await this._findRunById(db, id))
  }

  /**
   * Finds a run by idempotency key.
   * @param {string} idempotencyKey - Idempotency key.
   * @returns {Promise<DeploymentRunRow | null>} - The run or null.
   */
  async findRunByKey(idempotencyKey) {
    await this.ensureReady()

    return await this._withDb(async (db) => await this._findRunByKey(db, idempotencyKey))
  }

  /**
   * Creates a run fenced by two advisory locks taken in a consistent global
   * order — first the project/stage deployment lock, then the idempotency-key
   * lock — so concurrent requests get a deterministic outcome instead of
   * duplicate deployments or unique-constraint errors: an identical existing
   * key replays, a different payload for an existing key conflicts, and an
   * active run for the same project/stage blocks unless its ownership lease
   * expired, in which case it is terminally reconciled as interrupted first.
   * @param {object} args - Options.
   * @param {string} args.idempotencyKey - Idempotency key.
   * @param {string} args.project - Project identifier.
   * @param {string} args.revision - Requested revision.
   * @param {string} args.stage - Stage identifier.
   * @returns {Promise<CreateRunOutcome>} - The outcome and the relevant run.
   */
  async createRunIfPossible({idempotencyKey, project, revision, stage}) {
    await this.ensureReady()

    return await this._withDb(async (db) => {
      const lockName = this._deploymentLockName({project, stage})
      const acquired = await db.tryAcquireAdvisoryLock(lockName)

      if (!acquired) {
        // The lock being held proves another request is mid-creation for this
        // project/stage, so this is a bounded conflict even before the active
        // run row is visible.
        return {outcome: "in_progress", run: await this._findBlockingRun(db, {project, stage})}
      }

      try {
        // The key lock serializes this mount's idempotency key across different
        // project/stage pairs; always taken after the deployment lock so lock
        // ordering can never deadlock.
        const keyLockName = this._idempotencyLockName(idempotencyKey)

        await db.acquireAdvisoryLock(keyLockName)

        try {
          const existing = await this._findRunByKey(db, idempotencyKey)

          if (existing) {
            const samePayload = existing.project === project && existing.stage === stage && existing.revision === revision

            return {outcome: samePayload ? "replay" : "conflict", run: existing}
          }

          const activeRun = await this._findBlockingRun(db, {project, stage})

          if (activeRun) {
            if (activeRun.status === "reconciliation_required") {
              return {outcome: "reconciliation_required", run: activeRun}
            }

            if (!this._isRunInterrupted(activeRun)) return {outcome: "in_progress", run: activeRun}

            await this._reconcileExpiredRun(db, activeRun)

            if (activeRun.status === "running") {
              const reconciledRun = await this._findRunById(db, activeRun.id)

              if (!reconciledRun) throw new Error(`Reconciled deployment run ${activeRun.id} could not be found`)

              return {outcome: "reconciliation_required", run: reconciledRun}
            }
          }

          const id = randomUUID()

          await db.insert({
            tableName: RUNS_TABLE,
            data: {
              id,
              mount_identifier: this.mountIdentifier,
              project,
              stage,
              revision,
              idempotency_key: idempotencyKey,
              status: "pending",
              result_json: null,
              error_json: null,
              requested_at_ms: Date.now(),
              started_at_ms: null,
              finished_at_ms: null,
              owner_token: PROCESS_OWNER_TOKEN,
              heartbeat_at_ms: null
            }
          })

          const run = await this._findRunById(db, id)

          if (!run) throw new Error(`Deployment run ${id} was not found right after insertion`)

          return {outcome: "created", run}
        } finally {
          await db.releaseAdvisoryLock(keyLockName)
        }
      } finally {
        await db.releaseAdvisoryLock(lockName)
      }
    })
  }

  /**
   * Marks a run as running.
   * @param {object} args - Options.
   * @param {string} args.id - Run id.
   * @param {number} args.startedAtMs - Start time in ms epoch.
   * @returns {Promise<void>} - Resolves when updated.
   */
  async markRunning({id, startedAtMs}) {
    await this.ensureReady()
    await this._withDb(async (db) => {
      const affected = await db.affectedRows(db.updateSql({
        tableName: RUNS_TABLE,
        data: {heartbeat_at_ms: startedAtMs, started_at_ms: startedAtMs, status: "running"},
        conditions: {
          id,
          mount_identifier: this.mountIdentifier,
          owner_token: PROCESS_OWNER_TOKEN,
          status: "pending"
        }
      }))

      if (affected !== 1) {
        throw new Error(`Expected to mark exactly one pending deployment run with id ${id} as running for this process owner, but updated ${affected}`)
      }
    })
  }

  /**
   * Renews the ownership lease of a run executing in this process. A no-op
   * when the run already reached a terminal state.
   * @param {object} args - Options.
   * @param {string} args.id - Run id.
   * @param {number} args.heartbeatAtMs - Heartbeat time in ms epoch.
   * @returns {Promise<void>} - Resolves when updated.
   */
  async heartbeat({heartbeatAtMs, id}) {
    await this.ensureReady()
    await this._withDb(async (db) => {
      await db.affectedRows(db.updateSql({
        tableName: RUNS_TABLE,
        data: {heartbeat_at_ms: heartbeatAtMs},
        conditions: {id, mount_identifier: this.mountIdentifier, owner_token: PROCESS_OWNER_TOKEN, status: "running"}
      }))
    })
  }

  /**
   * Marks a run as succeeded with its sanitized result.
   * @param {object} args - Options.
   * @param {string} args.id - Run id.
   * @param {string} args.ownerToken - Expected execution owner token.
   * @param {number} args.finishedAtMs - Finish time in ms epoch.
   * @param {?} args.result - Sanitized adapter report.
   * @returns {Promise<void>} - Resolves when updated.
   */
  async markSucceeded({finishedAtMs, id, ownerToken, result}) {
    await this._transitionRunningRun({
      data: {finished_at_ms: finishedAtMs, result_json: JSON.stringify(result ?? null), status: "succeeded"},
      id,
      ownerToken
    })
  }

  /**
   * Marks a run as failed with its sanitized failure payload.
   * @param {object} args - Options.
   * @param {string} args.id - Run id.
   * @param {string} args.ownerToken - Expected execution owner token.
   * @param {number} args.finishedAtMs - Finish time in ms epoch.
   * @param {?} args.error - Sanitized failure payload.
   * @returns {Promise<void>} - Resolves when updated.
   */
  async markFailed({error, finishedAtMs, id, ownerToken}) {
    await this._transitionRunningRun({
      data: {error_json: JSON.stringify(error ?? null), finished_at_ms: finishedAtMs, status: "failed"},
      id,
      ownerToken
    })
  }

  /**
   * Fences a run after the adapter may have activated externally but its
   * successful result could not be durably recorded. This state blocks future
   * deployments until an operator reconciles the external outcome.
   * @param {object} args - Options.
   * @param {string} args.id - Run id.
   * @param {string} args.ownerToken - Expected execution owner token.
   * @param {number} args.finishedAtMs - Time reconciliation became necessary in ms epoch.
   * @param {?} args.error - Sanitized operator-facing explanation.
   * @returns {Promise<void>} - Resolves when updated.
   */
  async markReconciliationRequired({error, finishedAtMs, id, ownerToken}) {
    await this._transitionRunningRun({
      data: {error_json: JSON.stringify(error ?? null), finished_at_ms: finishedAtMs, status: "reconciliation_required"},
      id,
      ownerToken
    })
  }

  /**
   * Records a sanitized audit event.
   * @param {object} args - Options.
   * @param {string} args.event - Event name.
   * @param {?} args.payload - Sanitized payload.
   * @param {string | null} args.runId - Owning run id.
   * @returns {Promise<void>} - Resolves when recorded.
   */
  async addAuditEvent({event, payload, runId}) {
    await this.ensureReady()
    await this._withDb(async (db) => {
      await db.insert({
        tableName: AUDIT_TABLE,
        data: {
          id: randomUUID(),
          mount_identifier: this.mountIdentifier,
          run_id: runId,
          event,
          payload_json: payload === undefined ? null : JSON.stringify(payload ?? null),
          created_at_ms: Date.now()
        }
      })
    })
  }

  /**
   * Lists audit events for a run in creation order.
   * @param {object} args - Options.
   * @param {string} args.runId - Run id.
   * @returns {Promise<DeploymentAuditEventRow[]>} - Audit events.
   */
  async listAuditEvents({runId}) {
    await this.ensureReady()

    return await this._withDb(async (db) => {
      const rows = await db
        .newQuery()
        .from(AUDIT_TABLE)
        .where({mount_identifier: this.mountIdentifier, run_id: runId})
        .order("created_at_ms ASC")
        .results()

      return rows.map((row) => this._auditRowFromDb(row))
    })
  }

  /**
   * Builds the advisory-lock name for a project/stage pair. Hashed so the name
   * stays within driver limits (MySQL/MariaDB cap lock names at 64 chars)
   * regardless of identifier length.
   * @param {object} args - Options.
   * @param {string} args.project - Project identifier.
   * @param {string} args.stage - Stage identifier.
   * @returns {string} - Bounded advisory-lock name.
   */
  _deploymentLockName({project, stage}) {
    const hash = createHash("sha256").update(`${this.mountIdentifier}:${project}:${stage}`).digest("hex").slice(0, 32)

    return `velocious-deployment-api:${hash}`
  }

  /**
   * Builds the advisory-lock name serializing one idempotency key within this mount.
   * @param {string} idempotencyKey - Idempotency key.
   * @returns {string} - Bounded advisory-lock name.
   */
  _idempotencyLockName(idempotencyKey) {
    const hash = createHash("sha256").update(`${this.mountIdentifier}:${idempotencyKey}`).digest("hex").slice(0, 32)

    return `velocious-deployment-api:key:${hash}`
  }

  /**
   * Decides whether an active run counts as interrupted: its owner lease
   * (heartbeat, or the request time when it never started) is older than the
   * configured timeout and it is not executing in this process. A run with a
   * fresh lease owned by another worker is genuinely active and must never be
   * reclaimed here.
   * @param {DeploymentRunRow} run - Active run.
   * @returns {boolean} - Whether the run is interrupted.
   */
  _isRunInterrupted(run) {
    if (activeRunIdsInProcess.has(run.id)) return false

    const leaseReferenceMs = run.heartbeatAtMs ?? run.requestedAtMs

    return Date.now() - leaseReferenceMs > this.staleRunTimeoutMs
  }

  /**
   * Reconciles an expired ownership lease. Pending work is safely interrupted
   * because external activation never began. Running work requires operator
   * reconciliation because the external outcome may already have changed.
   * Runs inside the project/stage deployment lock, so exactly one reconciler
   * wins.
   * @param {import("../database/drivers/base.js").default} db - Database connection.
   * @param {DeploymentRunRow} run - Interrupted run.
   * @returns {Promise<void>} - Resolves when reconciled.
   */
  async _reconcileExpiredRun(db, run) {
    const finishedAtMs = Date.now()
    const reconciliationRequired = run.status === "running"
    const errorPayload = reconciliationRequired
      ? {message: "Deployment outcome requires operator reconciliation after the execution owner lease expired"}
      : {message: "Deployment run was interrupted before execution began (ownership lease expired)"}
    const status = reconciliationRequired ? "reconciliation_required" : "interrupted"
    const event = reconciliationRequired ? "run_reconciliation_required" : "run_interrupted"
    const data = {error_json: JSON.stringify(errorPayload), finished_at_ms: finishedAtMs, status}
    const affected = await db.affectedRows(db.updateSql({
      tableName: RUNS_TABLE,
      data,
      conditions: {id: run.id, mount_identifier: this.mountIdentifier, owner_token: run.ownerToken, status: run.status}
    }))

    if (affected !== 1) {
      throw new Error(`Expected to reconcile exactly one expired deployment run with id ${run.id}, but updated ${affected}`)
    }

    await db.insert({
      tableName: AUDIT_TABLE,
      data: {
        id: randomUUID(),
        mount_identifier: this.mountIdentifier,
        run_id: run.id,
        event,
        payload_json: JSON.stringify({project: run.project, revision: run.revision, stage: run.stage}),
        created_at_ms: Date.now()
      }
    })
  }

  /**
   * Adds the ownership lease columns to a runs table created before they
   * existed (the background-jobs store column-upgrade precedent).
   * @param {import("../database/drivers/base.js").default} db - Database connection.
   * @returns {Promise<void>} - Resolves when the columns exist.
   */
  async _ensureRunColumns(db) {
    const table = await db.getTableByNameOrFail(RUNS_TABLE)
    const missingMountIdentifier = !(await table.getColumnByName("mount_identifier"))
    const missingOwnerToken = !(await table.getColumnByName("owner_token"))
    const missingHeartbeat = !(await table.getColumnByName("heartbeat_at_ms"))

    if (missingMountIdentifier || missingOwnerToken || missingHeartbeat) {
      const tableData = new TableData(RUNS_TABLE)

      if (missingMountIdentifier) tableData.string("mount_identifier", {maxLength: 64, null: true})
      if (missingOwnerToken) tableData.string("owner_token", {null: true})
      if (missingHeartbeat) tableData.bigint("heartbeat_at_ms", {null: true})

      const sqls = await db.alterTableSQLs(tableData)

      for (const sql of sqls) {
        await db.query(sql)
      }

      db.clearSchemaCache()
    }

    await this._quarantineLegacyRows(db, RUNS_TABLE)
  }

  /**
   * Adds and safely backfills a mount identifier on an existing lazily-owned table.
   * Legacy rows were not attributable to an authenticated mount, so they are
   * quarantined in an unreachable scope instead of being exposed to whichever
   * mount happens to initialize first.
   * @param {import("../database/drivers/base.js").default} db - Database connection.
   * @param {string} tableName - Lazily-owned table name.
   * @returns {Promise<void>} - Resolves when the column exists.
   */
  async _ensureMountIdentifierColumn(db, tableName) {
    const table = await db.getTableByNameOrFail(tableName)

    if (!(await table.getColumnByName("mount_identifier"))) {
      const tableData = new TableData(tableName)

      tableData.string("mount_identifier", {maxLength: 64, null: true})

      for (const sql of await db.alterTableSQLs(tableData)) await db.query(sql)

      db.clearSchemaCache()
    }

    await this._quarantineLegacyRows(db, tableName)
  }

  /**
   * Assigns pre-scope rows to a reserved identifier no real mount can use.
   * @param {import("../database/drivers/base.js").default} db - Database connection.
   * @param {string} tableName - Table containing legacy rows.
   * @returns {Promise<void>} - Resolves when legacy rows are quarantined.
   */
  async _quarantineLegacyRows(db, tableName) {
    await db.affectedRows(db.updateSql({
      tableName,
      data: {mount_identifier: LEGACY_UNSCOPED_MOUNT_IDENTIFIER},
      conditions: {mount_identifier: null}
    }))
  }

  /**
   * Replaces the legacy global idempotency-key uniqueness with mount-scoped
   * uniqueness. The scoped index is created before the old one is removed, so
   * an interrupted lazy upgrade never leaves idempotency keys unfenced.
   * @param {import("../database/drivers/base.js").default} db - Database connection.
   * @returns {Promise<void>} - Resolves when index ownership is scoped.
   */
  async _ensureScopedIdempotencyIndex(db) {
    db.clearSchemaCache()

    const table = await db.getTableByNameOrFail(RUNS_TABLE)
    const indexes = await table.getIndexes()
    const scopedIndex = indexes.find((index) => {
      return index.isUnique() && index.getColumnNames().join(",") === "mount_identifier,idempotency_key"
    })

    if (!scopedIndex) {
      const sqls = await db.createIndexSQLs({
        columns: ["mount_identifier", "idempotency_key"],
        name: IDEMPOTENCY_INDEX_NAME,
        tableName: RUNS_TABLE,
        unique: true
      })

      for (const sql of sqls) await db.query(sql)

      db.clearSchemaCache()
    }

    const refreshedTable = await db.getTableByNameOrFail(RUNS_TABLE)
    const legacyIndexes = (await refreshedTable.getIndexes()).filter((index) => {
      return !index.isPrimaryKey() && index.isUnique() && index.getColumnNames().join(",") === "idempotency_key"
    })

    for (const legacyIndex of legacyIndexes) {
      const sqls = await db.removeIndexSQLs({name: legacyIndex.getName(), tableName: RUNS_TABLE})

      for (const sql of sqls) await db.query(sql)
    }

    if (legacyIndexes.length > 0) db.clearSchemaCache()
  }

  /**
   * Applies a terminal transition only while the expected execution owner
   * still owns a running row. A stale worker therefore cannot overwrite a
   * state already written by lease reconciliation.
   * @param {object} args - Options.
   * @param {Record<string, ?>} args.data - Terminal column values.
   * @param {string} args.id - Run id.
   * @param {string} args.ownerToken - Expected execution owner token.
   * @returns {Promise<void>} - Resolves when updated.
   */
  async _transitionRunningRun({data, id, ownerToken}) {
    await this.ensureReady()
    await this._withDb(async (db) => {
      const affected = await db.affectedRows(db.updateSql({
        tableName: RUNS_TABLE,
        data,
        conditions: {id, mount_identifier: this.mountIdentifier, owner_token: ownerToken, status: "running"}
      }))

      if (affected !== 1) {
        throw new Error(`Expected to transition exactly one running deployment run with id ${id} for its execution owner, but updated ${affected}`)
      }
    })
  }

  /**
   * Finds a run by id on an open connection.
   * @param {import("../database/drivers/base.js").default} db - Database connection.
   * @param {string} id - Run id.
   * @returns {Promise<DeploymentRunRow | null>} - The run or null.
   */
  async _findRunById(db, id) {
    const rows = await db
      .newQuery()
      .from(RUNS_TABLE)
      .where({id, mount_identifier: this.mountIdentifier})
      .limit(1)
      .results()

    return rows[0] ? this._runRowFromDb(rows[0]) : null
  }

  /**
   * Finds a run by idempotency key on an open connection.
   * @param {import("../database/drivers/base.js").default} db - Database connection.
   * @param {string} idempotencyKey - Idempotency key.
   * @returns {Promise<DeploymentRunRow | null>} - The run or null.
   */
  async _findRunByKey(db, idempotencyKey) {
    const rows = await db
      .newQuery()
      .from(RUNS_TABLE)
      .where({idempotency_key: idempotencyKey, mount_identifier: this.mountIdentifier})
      .limit(1)
      .results()

    return rows[0] ? this._runRowFromDb(rows[0]) : null
  }

  /**
   * Finds the run blocking another deployment for a project/stage.
   * @param {import("../database/drivers/base.js").default} db - Database connection.
   * @param {object} args - Options.
   * @param {string} args.project - Project identifier.
   * @param {string} args.stage - Stage identifier.
   * @returns {Promise<DeploymentRunRow | null>} - The blocking run or null.
   */
  async _findBlockingRun(db, {project, stage}) {
    const rows = await db
      .newQuery()
      .from(RUNS_TABLE)
      .where({mount_identifier: this.mountIdentifier, project, stage, status: BLOCKING_STATUSES})
      .order("requested_at_ms ASC")
      .limit(1)
      .results()

    return rows[0] ? this._runRowFromDb(rows[0]) : null
  }

  /**
   * Normalizes a raw run row.
   * @param {?} row - Raw database row.
   * @returns {DeploymentRunRow} - Normalized run row.
   */
  _runRowFromDb(row) {
    const record = /** @type {Record<string, ?>} */ (row)

    return {
      id: /** @type {string} */ (record.id),
      mountIdentifier: /** @type {string} */ (record.mount_identifier),
      project: /** @type {string} */ (record.project),
      stage: /** @type {string} */ (record.stage),
      revision: /** @type {string} */ (record.revision),
      idempotencyKey: /** @type {string} */ (record.idempotency_key),
      status: /** @type {string} */ (record.status),
      result: parseJsonColumn(record.result_json),
      error: parseJsonColumn(record.error_json),
      requestedAtMs: Number(record.requested_at_ms),
      startedAtMs: record.started_at_ms === null || record.started_at_ms === undefined ? null : Number(record.started_at_ms),
      finishedAtMs: record.finished_at_ms === null || record.finished_at_ms === undefined ? null : Number(record.finished_at_ms),
      ownerToken: record.owner_token === null || record.owner_token === undefined ? null : /** @type {string} */ (record.owner_token),
      heartbeatAtMs: record.heartbeat_at_ms === null || record.heartbeat_at_ms === undefined ? null : Number(record.heartbeat_at_ms)
    }
  }

  /**
   * Normalizes a raw audit event row.
   * @param {?} row - Raw database row.
   * @returns {DeploymentAuditEventRow} - Normalized audit event row.
   */
  _auditRowFromDb(row) {
    const record = /** @type {Record<string, ?>} */ (row)

    return {
      id: /** @type {string} */ (record.id),
      runId: record.run_id === null || record.run_id === undefined ? null : /** @type {string} */ (record.run_id),
      event: /** @type {string} */ (record.event),
      payload: parseJsonColumn(record.payload_json),
      createdAtMs: Number(record.created_at_ms)
    }
  }

  /**
   * Runs a callback with a pooled connection.
   * @template T
   * @param {(db: import("../database/drivers/base.js").default) => Promise<T>} callback - Callback.
   * @returns {Promise<T>} - Callback result.
   */
  async _withDb(callback) {
    const pool = this.configuration.getDatabasePool(this.databaseIdentifier)
    /** @type {T | undefined} */
    let result

    await pool.withConnection({name: "Deployment run store"}, async (db) => {
      result = await callback(db)
    })

    return /** @type {T} */ (result)
  }
}
