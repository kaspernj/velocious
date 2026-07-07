// @ts-check

import Configuration from "../../../src/configuration.js"
import {AuditEvents} from "../../../src/database/record/auditing.js"
import DatabaseRecord from "../../../src/database/record/index.js"
import Migration from "../../../src/database/migration/index.js"

const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/**
 * AuditJson type.
 * @typedef {Record<string, string | number | boolean | null>} AuditJson
 */

/**
 * AuditRow type.
 * @typedef {object} AuditRow
 * @property {string} action
 * @property {AuditJson | null} auditedChanges
 * @property {number | string} auditableId
 * @property {string} auditableType
 * @property {AuditJson | null} params
 * @property {string} typeName
 */

/**
 * DedicatedAuditRow type.
 * @typedef {object} DedicatedAuditRow
 * @property {string} action
 * @property {AuditJson | null} auditedChanges
 * @property {AuditJson | null} params
 * @property {number | string} widgetId
 */

/**
 * AuditScratchContext type.
 * @typedef {object} AuditScratchContext
 * @property {import("../../../src/database/drivers/base.js").default} driver
 * @property {typeof DatabaseRecord} SharedAuditWidget
 * @property {typeof DatabaseRecord} Widget
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
 * @param {number | string} auditableId - Audited record id.
 * @returns {AuditRow} Matching audit row.
 */
function auditRowFor(rows, action, auditableId) {
  const row = rows.find((auditRow) => auditRow.action === action && auditRow.auditableId === auditableId)

  expect(row).toBeDefined()

  return /** @type {AuditRow} */ (row)
}

/**
 * @param {import("../../../src/database/drivers/base.js").default} db - Database driver.
 * @returns {Promise<AuditRow[]>}
 */
async function auditRows(db) {
  const rows = /** @type {Array<{action: string, audited_changes: string | AuditJson | null, auditable_id: number | string, auditable_type: string, params: string | AuditJson | null, type_name: string}>>} */ (await db.query(`
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
}

/**
 * @param {import("../../../src/database/drivers/base.js").default} db - Database driver.
 * @param {number | string} widgetId - Widget id.
 * @returns {Promise<DedicatedAuditRow[]>}
 */
async function widgetAuditRows(db, widgetId) {
  const rows = /** @type {Array<{action: string, audited_changes: string | AuditJson | null, params: string | AuditJson | null, widget_id: number | string}>>} */ (await db.query(`
    SELECT
      audit_actions.action AS action,
      widget_audits.audited_changes AS audited_changes,
      widget_audits.params AS params,
      widget_audits.widget_id AS widget_id
    FROM ${db.quoteTable("widget_audits")}
    INNER JOIN ${db.quoteTable("audit_actions")} ON ${db.quoteTable("audit_actions")}.${db.quoteColumn("id")} = ${db.quoteTable("widget_audits")}.${db.quoteColumn("audit_action_id")}
    WHERE widget_audits.widget_id = ${db.quote(widgetId)}
  `))

  return rows.map((row) => ({
    action: row.action,
    auditedChanges: parsedJson(row.audited_changes),
    params: parsedJson(row.params),
    widgetId: row.widget_id
  }))
}

/**
 * @param {(context: AuditScratchContext) => Promise<void>} callback - Callback to run with scratch audit tables.
 * @returns {Promise<void>}
 */
async function withAuditScratchTables(callback) {
  await Configuration.current().ensureConnections(async (dbs) => {
    const configuration = Configuration.current()
    const driver = dbs.default
    const migration = new Migration({configuration, databaseIdentifier: "default", db: driver})
    const modelClasses = configuration.getModelClasses()
    /** @type {Record<string, typeof DatabaseRecord | undefined>} */
    const previousModelClasses = {
      Audit: modelClasses.Audit,
      SharedAuditWidget: modelClasses.SharedAuditWidget,
      Widget: modelClasses.Widget,
      WidgetAudit: modelClasses.WidgetAudit
    }

    class SharedAuditWidget extends DatabaseRecord {
      /** @returns {string} - Table name. */
      static tableName() { return "shared_audit_widgets" }
    }

    class Widget extends DatabaseRecord {
      /** @returns {string} - Table name. */
      static tableName() { return "widgets" }
    }

    try {
      await dropAuditScratchTables(driver)
      await migration.createTable("shared_audit_widgets", (table) => {
        table.string("name")
        table.timestamps()
      })
      await migration.createTable("widgets", (table) => {
        table.string("name")
        table.timestamps()
      })
      await migration.createDedicatedAuditTable("widgets")

      SharedAuditWidget.audited()
      Widget.audited()
      await SharedAuditWidget.initializeRecord({configuration})
      await Widget.initializeRecord({configuration})

      await callback({driver, SharedAuditWidget, Widget})
    } finally {
      restoreModelClass(modelClasses, "Audit", previousModelClasses.Audit)
      restoreModelClass(modelClasses, "SharedAuditWidget", previousModelClasses.SharedAuditWidget)
      restoreModelClass(modelClasses, "Widget", previousModelClasses.Widget)
      restoreModelClass(modelClasses, "WidgetAudit", previousModelClasses.WidgetAudit)
      await dropAuditScratchTables(driver)
    }
  })
}

/**
 * @param {Record<string, typeof DatabaseRecord>} modelClasses - Model classes registry.
 * @param {string} modelName - Model name.
 * @param {typeof DatabaseRecord | undefined} previousModelClass - Previous class.
 * @returns {void}
 */
function restoreModelClass(modelClasses, modelName, previousModelClass) {
  if (previousModelClass) {
    modelClasses[modelName] = previousModelClass
  } else {
    delete modelClasses[modelName]
  }
}

/**
 * @param {import("../../../src/database/drivers/base.js").default} driver - Database driver.
 * @returns {Promise<void>}
 */
async function dropAuditScratchTables(driver) {
  await driver.dropTable("widget_audits", {cascade: true, ifExists: true})
  await driver.dropTable("widgets", {cascade: true, ifExists: true})
  await driver.dropTable("shared_audit_widgets", {cascade: true, ifExists: true})
  await driver.query(`DELETE FROM ${driver.quoteTable("audits")} WHERE ${driver.quoteColumn("auditable_type")} = ${driver.quote("SharedAuditWidget")}`)
}

/**
 * @param {import("../../../src/database/drivers/base.js").default} driver - Database driver.
 * @param {string} tableName - Table name.
 * @param {string} columnName - Column name.
 * @returns {Promise<void>}
 */
async function expectUuidColumn(driver, tableName, columnName) {
  const table = await driver.getTableByNameOrFail(tableName)
  const column = await table.getColumnByNameOrFail(columnName)
  const type = column.getType()?.toLowerCase()

  expect(["uuid", "varchar"].includes(type || "")).toEqual(true)
}

describe("Record - auditing", {tags: ["dummy"]}, () => {
  it("registers audit relationships during model initialization", async () => {
    await withAuditScratchTables(async ({SharedAuditWidget, Widget}) => {
      expect("audits" in SharedAuditWidget.getRelationshipsMap()).toEqual(true)
      expect("audits" in Widget.getRelationshipsMap()).toEqual(true)
    })
  })

  it("records automatic and manual audits for audited models", async () => {
    await withAuditScratchTables(async ({driver, SharedAuditWidget}) => {
      /** @type {Array<{action: string, recordId: number | string}>} */
      const events = []
      const unsubscribe = SharedAuditWidget.onAudit("create", ({action, record}) => {
        events.push({action, recordId: record.id()})
      })

      try {
        const widgetWithCustomAudit = await SharedAuditWidget.create({name: "Audited shared widget"})

        expect(widgetWithCustomAudit.id()).toMatch(uuidRegex)

        await widgetWithCustomAudit.update({name: "Updated shared widget"})
        await widgetWithCustomAudit.createAudit({action: "custom", params: {source: "spec"}})

        const widgetWithoutCustomAudit = await SharedAuditWidget.create({name: "Shared widget without custom audit"})

        await widgetWithCustomAudit.destroy()

        const rows = (await auditRows(driver)).filter((row) => row.auditableType === "SharedAuditWidget")
        const rowSummaries = rows.map((row) => [row.action, row.auditableType, row.auditableId, row.typeName])
        const widgetWithCustomAuditCreateRow = auditRowFor(rows, "create", widgetWithCustomAudit.id())
        const widgetWithCustomAuditUpdateRow = auditRowFor(rows, "update", widgetWithCustomAudit.id())
        const widgetWithCustomAuditCustomRow = auditRowFor(rows, "custom", widgetWithCustomAudit.id())
        const widgetWithCustomAuditDestroyRow = auditRowFor(rows, "destroy", widgetWithCustomAudit.id())

        expect(rowSummaries).toHaveLength(5)
        expect(rowSummaries).toContainEqual(["create", "SharedAuditWidget", widgetWithCustomAudit.id(), "SharedAuditWidget"])
        expect(rowSummaries).toContainEqual(["update", "SharedAuditWidget", widgetWithCustomAudit.id(), "SharedAuditWidget"])
        expect(rowSummaries).toContainEqual(["custom", "SharedAuditWidget", widgetWithCustomAudit.id(), "SharedAuditWidget"])
        expect(rowSummaries).toContainEqual(["create", "SharedAuditWidget", widgetWithoutCustomAudit.id(), "SharedAuditWidget"])
        expect(rowSummaries).toContainEqual(["destroy", "SharedAuditWidget", widgetWithCustomAudit.id(), "SharedAuditWidget"])
        expect(widgetWithCustomAuditCreateRow.auditedChanges).toEqual({name: "Audited shared widget"})
        expect(widgetWithCustomAuditUpdateRow.auditedChanges).toEqual({name: "Updated shared widget"})
        expect(widgetWithCustomAuditCustomRow.params).toEqual({source: "spec"})
        expect(widgetWithCustomAuditDestroyRow.auditedChanges).toMatchObject({
          id: widgetWithCustomAudit.id(),
          name: "Updated shared widget"
        })
        expect(events).toEqual([
          {action: "create", recordId: widgetWithCustomAudit.id()},
          {action: "create", recordId: widgetWithoutCustomAudit.id()}
        ])

        const withoutCustomAudit = await SharedAuditWidget.withoutAudit("custom")
          .order({column: "name", direction: "ASC"})
          .toArray()

        expect(withoutCustomAudit.map((widget) => widget.id())).toEqual([widgetWithoutCustomAudit.id()])
      } finally {
        unsubscribe()
      }
    })
  })

  it("records audits in a dedicated widget_audits table", async () => {
    await withAuditScratchTables(async ({driver, Widget}) => {
      await expectUuidColumn(driver, "widget_audits", "widget_id")
      await expectUuidColumn(driver, "widget_audits", "audit_action_id")

      const widget = await Widget.create({name: "Dedicated audit widget"})

      expect(widget.id()).toMatch(uuidRegex)

      const widgetRows = await widgetAuditRows(driver, widget.id())

      expect(widgetRows.length).toBeGreaterThanOrEqual(1)

      const createRow = widgetRows.find((row) => row.action === "create")

      expect(createRow).toBeDefined()
      expect(createRow).toMatchObject({
        action: "create",
        widgetId: widget.id()
      })
    })
  })

  it("auto-registers audits relationship on dedicated-table model", async () => {
    await withAuditScratchTables(async ({Widget}) => {
      const widget = await Widget.create({name: "Relationship widget"})

      const audits = await widget.audits().toArray()

      expect(audits.length).toBeGreaterThanOrEqual(1)
      expect(audits[0].readAttribute("widget_id")).toEqual(widget.id())
    })
  })

  it("calls global audit events on audit creation", async () => {
    await withAuditScratchTables(async ({SharedAuditWidget}) => {
      let called = false
      /** @type {import("../../../src/database/record/auditing.js").AuditEventPayload | null} */
      let receivedPayload = null
      const unsubscribe = AuditEvents.connect("SharedAuditWidget", "test_event", (args) => {
        called = true
        receivedPayload = args
      })

      try {
        const widget = await SharedAuditWidget.create({name: "Events widget"})

        await widget.createAudit({action: "test_event", params: {key: "value"}})

        expect(called).toEqual(true)
        expect(receivedPayload).not.toEqual(null)
        expect(/** @type {Record<string, ?>} */ (receivedPayload).params).toEqual({key: "value"})
      } finally {
        unsubscribe()
      }
    })
  })
})
