// @ts-check

import Configuration from "../../../src/configuration.js"
import Project from "../../dummy/src/models/project.js"
import Task from "../../dummy/src/models/task.js"

/**
 * AuditJson type.
 * @typedef {Record<string, string | number | boolean | null>} AuditJson
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

/** @returns {Promise<Array<{action: string, auditedChanges: AuditJson | null, auditableId: number, auditableType: string, params: AuditJson | null, typeName: string}>>} */
async function auditRows() {
  return await Configuration.current().ensureConnections(async (dbs) => {
    const db = dbs.default
    const rows = /** @type {Array<{action: string, auditedChanges: string | AuditJson | null, auditableId: number, auditableType: string, params: string | AuditJson | null, typeName: string}>>} */ (await db.query(`
      SELECT
        audit_actions.action AS action,
        audits.audited_changes AS auditedChanges,
        audits.auditable_id AS auditableId,
        audits.auditable_type AS auditableType,
        audits.params AS params,
        audit_auditable_types.name AS typeName
      FROM ${db.quoteTable("audits")}
      INNER JOIN ${db.quoteTable("audit_actions")} ON ${db.quoteTable("audit_actions")}.${db.quoteColumn("id")} = ${db.quoteTable("audits")}.${db.quoteColumn("audit_action_id")}
      INNER JOIN ${db.quoteTable("audit_auditable_types")} ON ${db.quoteTable("audit_auditable_types")}.${db.quoteColumn("id")} = ${db.quoteTable("audits")}.${db.quoteColumn("audit_auditable_type_id")}
      ORDER BY ${db.quoteTable("audits")}.${db.quoteColumn("id")} ASC
    `))

    return rows.map((row) => ({
      ...row,
      auditedChanges: parsedJson(row.auditedChanges),
      params: parsedJson(row.params)
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

      expect(rows.map((row) => [row.action, row.auditableType, row.auditableId, row.typeName])).toEqual([
        ["create", "Task", taskWithCustomAudit.id(), "Task"],
        ["update", "Task", taskWithCustomAudit.id(), "Task"],
        ["custom", "Task", taskWithCustomAudit.id(), "Task"],
        ["create", "Task", taskWithoutCustomAudit.id(), "Task"],
        ["destroy", "Task", taskWithCustomAudit.id(), "Task"]
      ])
      expect(rows[0].auditedChanges).toEqual({
        description: "Initial description",
        name: "Audited task",
        projectId: project.id()
      })
      expect(rows[1].auditedChanges).toEqual({
        description: "Updated description",
        name: "Updated audited task"
      })
      expect(rows[2].params).toEqual({source: "spec"})
      expect(rows[4].auditedChanges?.id).toEqual(taskWithCustomAudit.id())
      expect(rows[4].auditedChanges?.name).toEqual("Updated audited task")
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
