// @ts-check

import {describe, expect, it} from "../../src/testing/test.js"
import SyncReplayUpsertApplier from "../../src/sync/sync-replay-upsert-applier.js"

/**
 * Builds a fake model class with an in-memory row store.
 * @returns {?} Fake model class.
 */
function buildFakeModelClass() {
  /** @type {Array<?>} */
  const rows = []

  /**
   * @param {Record<string, ?>} attributes - Row attributes.
   * @returns {?} Fake record.
   */
  const buildRecord = (attributes) => {
    const record = {
      attributes: {...attributes},
      /** @param {Record<string, ?>} newAttributes - Assigned attributes. @returns {void} */
      assign(newAttributes) {
        Object.assign(record.attributes, newAttributes)
      },
      destroyed: false,
      /** @returns {Promise<void>} */
      async destroy() {
        record.destroyed = true
        rows.splice(rows.indexOf(record), 1)
      },
      /** @returns {Promise<void>} */
      async save() {
        record.saved = true
      },
      saved: false
    }

    return record
  }

  return {
    /** @param {Record<string, ?>} attributes - Attributes. @returns {Promise<?>} Created record. */
    create: async (attributes) => {
      const record = buildRecord(attributes)

      rows.push(record)

      return record
    },
    /** @param {Record<string, ?>} conditions - Conditions. @returns {Promise<?>} Found record. */
    findBy: async (conditions) => rows.find((row) => Object.entries(conditions).every(([key, value]) => row.attributes[key] === value)) || null,
    rows
  }
}

/**
 * Builds a normalized replay mutation.
 * @param {Record<string, ?>} [overrides] - Mutation overrides.
 * @returns {?} Replay mutation.
 */
function buildMutation(overrides = {}) {
  return {
    clientUpdatedAt: new Date("2026-07-03T10:00:00.000Z"),
    data: {},
    id: 1,
    resourceId: "row-1",
    resourceType: "Task",
    serializedData: "{}",
    syncType: "update",
    ...overrides
  }
}

describe("sync replay upsert applier", () => {
  it("creates a record with mapped fields when none exists", async () => {
    const modelClass = buildFakeModelClass()
    const applier = new SyncReplayUpsertApplier({
      fields: {
        position: "integerOrNull",
        startsAt: "dateOrNull",
        title: "stringOrNull",
        visible: "booleanOrNull"
      },
      modelClass
    })

    const result = await applier.apply({
      actor: null,
      context: {},
      existingSync: null,
      mutation: buildMutation({data: {position: 3, startsAt: "2026-07-03T10:00:00.000Z", title: "Hello", visible: 1}})
    })

    expect(modelClass.rows.length).toEqual(1)
    expect(result.record.attributes.id).toEqual("row-1")
    expect(result.record.attributes.title).toEqual("Hello")
    expect(result.record.attributes.position).toEqual(3)
    expect(result.record.attributes.visible).toEqual(true)
    expect(result.record.attributes.startsAt.toISOString()).toEqual("2026-07-03T10:00:00.000Z")
    expect(result.created).toEqual(true)
  })

  it("updates an existing record and only maps present keys", async () => {
    const modelClass = buildFakeModelClass()
    const existingRecord = await modelClass.create({id: "row-1", position: 7, title: "Old"})
    const applier = new SyncReplayUpsertApplier({
      fields: {position: "integerOrNull", title: "stringOrNull"},
      modelClass
    })

    const result = await applier.apply({
      actor: null,
      context: {},
      existingSync: null,
      mutation: buildMutation({data: {title: "New"}})
    })

    expect(result.record).toEqual(existingRecord)
    expect(existingRecord.attributes.title).toEqual("New")
    expect(existingRecord.attributes.position).toEqual(7)
    expect(existingRecord.saved).toEqual(true)
    expect(result.created).toEqual(false)
  })

  it("maps null values through nullable field types", async () => {
    const modelClass = buildFakeModelClass()

    await modelClass.create({id: "row-1", startsAt: new Date(), title: "Old"})

    const applier = new SyncReplayUpsertApplier({
      fields: {startsAt: "dateOrNull", title: "stringOrNull"},
      modelClass
    })

    await applier.apply({
      actor: null,
      context: {},
      existingSync: null,
      mutation: buildMutation({data: {startsAt: null, title: null}})
    })

    expect(modelClass.rows[0].attributes.title).toEqual(null)
    expect(modelClass.rows[0].attributes.startsAt).toEqual(null)
  })

  it("fails loudly on unknown data keys by default", async () => {
    const applier = new SyncReplayUpsertApplier({
      fields: {title: "stringOrNull"},
      modelClass: buildFakeModelClass()
    })

    await expect(async () => await applier.apply({
      actor: null,
      context: {},
      existingSync: null,
      mutation: buildMutation({data: {evil: true, title: "x"}})
    })).toThrow(/evil/u)
  })

  it("ignores unknown data keys when configured", async () => {
    const modelClass = buildFakeModelClass()
    const applier = new SyncReplayUpsertApplier({
      fields: {title: "stringOrNull"},
      modelClass,
      restArgs: "ignore"
    })

    await applier.apply({
      actor: null,
      context: {},
      existingSync: null,
      mutation: buildMutation({data: {ignored: true, title: "x"}})
    })

    expect(modelClass.rows[0].attributes.title).toEqual("x")
    expect("ignored" in modelClass.rows[0].attributes).toEqual(false)
  })

  it("destroys records on delete sync types", async () => {
    const modelClass = buildFakeModelClass()
    const record = await modelClass.create({id: "row-1"})
    const applier = new SyncReplayUpsertApplier({fields: {}, modelClass})

    const result = await applier.apply({
      actor: null,
      context: {},
      existingSync: null,
      mutation: buildMutation({syncType: "delete"})
    })

    expect(record.destroyed).toEqual(true)
    expect(result.deleted).toEqual(true)
    expect(modelClass.rows.length).toEqual(0)
  })

  it("treats deletes of missing records as already applied", async () => {
    const applier = new SyncReplayUpsertApplier({fields: {}, modelClass: buildFakeModelClass()})

    const result = await applier.apply({
      actor: null,
      context: {},
      existingSync: null,
      mutation: buildMutation({syncType: "delete"})
    })

    expect(result.deleted).toEqual(false)
    expect(result.record).toEqual(null)
  })

  it("uses custom findRecord resolvers and runs afterApply domain tails", async () => {
    const modelClass = buildFakeModelClass()
    const customRecord = await modelClass.create({id: "custom", title: "Old"})
    /** @type {Array<Record<string, ?>>} */
    const afterApplyCalls = []
    const applier = new SyncReplayUpsertApplier({
      afterApply: async ({mappedAttributes, mutation, record}) => {
        afterApplyCalls.push({mappedAttributes, mutation, record})

        return {domainEventId: "event-9"}
      },
      fields: {title: "stringOrNull"},
      findRecord: async () => customRecord,
      modelClass
    })

    const result = await applier.apply({
      actor: null,
      context: {},
      existingSync: null,
      mutation: buildMutation({data: {title: "New"}})
    })

    expect(customRecord.attributes.title).toEqual("New")
    expect(afterApplyCalls.length).toEqual(1)
    expect(result.domainEventId).toEqual("event-9")
    expect(result.record).toEqual(customRecord)
  })

  it("serializes the applied record into the apply result when configured", async () => {
    const modelClass = buildFakeModelClass()
    const applier = new SyncReplayUpsertApplier({
      fields: {title: "stringOrNull"},
      modelClass,
      serialize: async ({record}) => ({id: record.attributes.id, title: record.attributes.title})
    })

    const result = await applier.apply({
      actor: null,
      context: {},
      existingSync: null,
      mutation: buildMutation({data: {title: "Snapshot"}})
    })

    expect(result.serializedData).toEqual({id: "row-1", title: "Snapshot"})
  })

  it("supports custom function coercers and ignored fields", async () => {
    const modelClass = buildFakeModelClass()
    const applier = new SyncReplayUpsertApplier({
      fields: {
        createdAt: "ignored",
        pytId: (value) => value === null || value === undefined ? null : String(value),
        startsAt: (value) => {
          const dateValue = value ? new Date(String(value)) : null

          return dateValue && !Number.isNaN(dateValue.getTime()) ? dateValue : null
        }
      },
      modelClass
    })

    await applier.apply({
      actor: null,
      context: {},
      existingSync: null,
      mutation: buildMutation({data: {createdAt: "2020-01-01", pytId: 88051, startsAt: "not-a-date"}})
    })

    expect(modelClass.rows[0].attributes.pytId).toEqual("88051")
    expect(modelClass.rows[0].attributes.startsAt).toEqual(null)
    expect("createdAt" in modelClass.rows[0].attributes).toEqual(false)
  })

  it("fails loudly on invalid field types and field values", async () => {
    await expect(() => new SyncReplayUpsertApplier({fields: {title: "nope"}, modelClass: buildFakeModelClass()}))
      .toThrow(/Unknown sync field type: nope/u)

    const applier = new SyncReplayUpsertApplier({fields: {startsAt: "dateOrNull"}, modelClass: buildFakeModelClass()})

    await expect(async () => await applier.apply({
      actor: null,
      context: {},
      existingSync: null,
      mutation: buildMutation({data: {startsAt: "not-a-date"}})
    })).toThrow(/startsAt/u)
  })
})
