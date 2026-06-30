// @ts-check

import Configuration from "../../../src/configuration.js"
import Project from "../../dummy/src/models/project.js"
import Task from "../../dummy/src/models/task.js"

/**
 * AuditJson type.
 * @typedef {Record<string, string | number | boolean | null>} AuditJson
 */

/**
 * AuditRow type.
 * @typedef {object} AuditRow
 * @property {string} action
 * @property {AuditJson | null} auditedChanges
 * @property {number} auditableId
 * @property {string} auditableType
 * @property {AuditJson | null} params
 * @property {string} typeName
 */

/**
 * @param {string | AuditJson | null} value - JSON value from the database.
 * @returns {AuditJson | null} Parsed JSON.
 */
function parsedJson(value) {
  if (typeof value === "string") {
    return /** @type {AuditJson} */ (JSON.parse(value))
  }

  return value
}

/**
 * @param {AuditRow[]} rows - Audit rows.
 * @param {string} action - Audit action.
 * @param {number} auditableId - Audited record id.
 * @returns {AuditRow} Matching audit row.
 */
function auditRowFor(rows, action, auditableId) {
  const row = rows.find((auditRow) => auditRow.action === action && auditRow.auditableId === auditableId)

  expect(row).toBeDefined()

  return /** @type {AuditRow} */ (row)
}

/** @returns {Promise<AuditRow[]>} */
async function auditRows() {
  return await Configuration.current().ensureConnections(async (dbs) => {
    const db = dbs.default
    const rows = /** @type {Array<{action: string, audited_changes: string | AuditJson | null, auditable_id: number, auditable_type: string, params: string | AuditJson | null, type_name: string}>>} */ (await db.query(`
      SELECT
        audit_actions.action AS action,
        audits.audited_changes AS audited_changes,
        audits.auditable_id AS auditable_id,
        audits.auditable_type AS auditable_type,
        audits.params AS params,
        audit_auditable_types.name AS type_name
      FROM ${db.quoteTable("audits")}
      INNER JOIN ${db.quoteTable("audit_actions")} ON ${db.quoteTable("audit_actions")}.${db.quoteColumn("id")} = ${db.quoteTable("audits")}.${db.quoteColumn("audit_action_id")}
      INNER JOIN ${db.quoteTable("audit_auditable_types")} ON ${db.quoteTable("audit_auditable_types")}.${db.quoteColumn("id")} = ${db.quoteTable("audits")}.${db.quoteColumn("audit_auditable_type_id")}
    `))

    return rows.map((row) => ({
      action: row.action,
      auditedChanges: parsedJson(row.audited_changes),
      auditableId: row.auditable_id,
      auditableType: row.auditable_type,
      params: parsedJson(row.params),
      typeName: row.type_name
    }))
  })
}

describe("Record - auditing", {tags: ["dummy"]}, () => {
  it("records automatic and manual audits for audited models", async () => {
    /** @type {Array<{action: string, recordId: number}>} */
    const events = []
    const unsubscribe = Task.onAudit("create", ({action, record}) => {
      events.push({action, recordId: record.id()})
    })

    try {
      const project = await Project.create({name: "Audit project"})
      const taskWithCustomAudit = await Task.create({description: "Initial description", name: "Audited task", project})

      await taskWithCustomAudit.update({description: "Updated description", name: "Updated audited task"})
      await taskWithCustomAudit.createAudit({action: "custom", params: {source: "spec"}})

      const taskWithoutCustomAudit = await Task.create({name: "Task without custom audit", project})

      await taskWithCustomAudit.destroy()

      const rows = await auditRows()
      const rowSummaries = rows.map((row) => [row.action, row.auditableType, row.auditableId, row.typeName])
      const taskWithCustomAuditCreateRow = auditRowFor(rows, "create", taskWithCustomAudit.id())
      const taskWithCustomAuditUpdateRow = auditRowFor(rows, "update", taskWithCustomAudit.id())
      const taskWithCustomAuditCustomRow = auditRowFor(rows, "custom", taskWithCustomAudit.id())
      const taskWithCustomAuditDestroyRow = auditRowFor(rows, "destroy", taskWithCustomAudit.id())

      expect(rowSummaries).toHaveLength(5)
      expect(rowSummaries).toContainEqual(["create", "Task", taskWithCustomAudit.id(), "Task"])
      expect(rowSummaries).toContainEqual(["update", "Task", taskWithCustomAudit.id(), "Task"])
      expect(rowSummaries).toContainEqual(["custom", "Task", taskWithCustomAudit.id(), "Task"])
      expect(rowSummaries).toContainEqual(["create", "Task", taskWithoutCustomAudit.id(), "Task"])
      expect(rowSummaries).toContainEqual(["destroy", "Task", taskWithCustomAudit.id(), "Task"])
      expect(taskWithCustomAuditCreateRow.auditedChanges).toEqual({
        description: "Initial description",
        name: "Audited task",
        projectId: project.id()
      })
      expect(taskWithCustomAuditUpdateRow.auditedChanges).toEqual({
        description: "Updated description",
        name: "Updated audited task"
      })
      expect(taskWithCustomAuditCustomRow.params).toEqual({source: "spec"})
      expect(taskWithCustomAuditDestroyRow.auditedChanges).toMatchObject({
        id: taskWithCustomAudit.id(),
        name: "Updated audited task"
      })
      expect(events).toEqual([{action: "create", recordId: taskWithCustomAudit.id()}, {action: "create", recordId: taskWithoutCustomAudit.id()}])

      const withoutCustomAudit = await Task.withoutAudit("custom")
        .where({projectId: project.id()})
        .order({column: "name", direction: "ASC"})
        .toArray()

      expect(withoutCustomAudit.map((task) => task.id())).toEqual([taskWithoutCustomAudit.id()])
    } finally {
      unsubscribe()
    }
  })
})
