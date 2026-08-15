// @ts-check

import DatabaseRecord from "../../src/database/record/index.js"
import LocalMutationLog from "../../src/sync/local-mutation-log.js"
import Migration from "../../src/database/migration/index.js"
import SyncClient from "../../src/sync/sync-client.js"
import Tenant from "../../src/tenants/tenant.js"
import { buildFakeWebsocketClient } from "./sync-realtime-fakes.js"
import { buildFrontendMigrationContext } from "../helpers/frontend-tenant-migration-test-helper.js"
import { createTenantTestConfiguration } from "../helpers/tenant-test-helpers.js"
import { describe, expect, it } from "../../src/testing/test.js"

/** @returns {import("../../src/sync/local-mutation-log.js").LocalMutationLogStorage} In-memory row storage keyed exactly like a native row store. */
function buildMutationStorage() {
  /** @type {Map<string, import("../../src/sync/local-mutation-log.js").LocalMutationLogRecord[]>} */
  const rows = new Map()
  const records = (key) => rows.get(key) || []

  return {
    appendRecord: (key, record) => rows.set(key, [...records(key), structuredClone(record)]),
    deleteRecords: (key, ids) => rows.set(key, records(key).filter((record) => !ids.includes(record.id))),
    nextSequence: (key) => records(key).reduce((maximum, record) => Math.max(maximum, record.sequence + 1), 1),
    record: (key, id) => records(key).find((record) => record.id === id) || null,
    records: (key, options) => records(key).filter((record) => !options?.statuses || options.statuses.includes(record.status)),
    updateRecord: (key, record) => rows.set(key, records(key).map((candidate) => candidate.id === record.id ? structuredClone(record) : candidate))
  }
}

describe("tenant-scoped SyncClient", {databaseCleaning: {transaction: false, truncate: false}}, () => {
  it("isolates concurrent project queues, receipts, conflicts, cursors, pull applies, and reconnect catch-up", async () => {
    const websocketClient = buildFakeWebsocketClient()
    const mutationLog = new LocalMutationLog({storage: buildMutationStorage()})
    let online = false
    let pullPhase = "initial"
    let mutationSequence = 0
    /** @type {Array<Record<string, ReturnType<typeof JSON.parse>>>} */
    const replayPosts = []
    const transport = {
      post: async (path, payload) => {
        if (path.endsWith("/replay")) {
          replayPosts.push(payload)
          return {json: () => ({
            status: "success",
            syncs: payload.syncs.map((sync) => ({id: sync.id, serverVersion: 2, syncState: "successful"}))
          })}
        }

        const slug = String(payload.scope.conditions.project_slug)

        if (pullPhase === "subscription") return {json: () => ({nextCursor: null, status: "success", syncs: [], upToCursor: null})}

        const sequence = slug === "alpha" ? (pullPhase === "initial" ? 11 : 31) : (pullPhase === "initial" ? 22 : 42)
        const cursor = {id: `${slug}-${sequence}`, serverSequence: sequence, updatedAt: `2026-08-15T00:00:${String(sequence).padStart(2, "0")}.000Z`}

        return {json: () => ({
          nextCursor: cursor,
          status: "success",
          syncs: [{data: {name: `${pullPhase}-${slug}`}, id: cursor.id, resourceId: 1, resourceType: "TenantQueuedItem", syncType: "update"}],
          upToCursor: cursor
        })}
      }
    }
    const {cleanup, configuration} = await createTenantTestConfiguration("sync-client-tenant-isolation", {
      sync: {
        client: {
          authenticationToken: () => "shared-token",
          isOnline: () => online,
          transport,
          websocketClient
        }
      }
    })

    class TenantQueuedItem extends DatabaseRecord {
      static sync = {attributes: ({data}) => ({name: data.name})}
    }
    class TenantConflictItem extends DatabaseRecord {
      static sync = {
        conflictTracking: {
          actorDeviceId: "device-1",
          actorUserId: "user-1",
          clientMutationId: () => `mutation-${++mutationSequence}`,
          mutationLog,
          offlineGrantId: "grant-1",
          policyHash: "policy-1",
          versionAttribute: "version"
        }
      }
    }
    class TenantPendingSync extends DatabaseRecord {
      id() { return this.readAttribute("id") }
      resourceId() { return this.readAttribute("resourceId") }
      resourceType() { return this.readAttribute("resourceType") }
      syncType() { return this.readAttribute("syncType") }
      data() { return this.readAttribute("data") }
      state() { return this.readAttribute("state") }
      createdAt() { return this.readAttribute("createdAt") }
      updatedAt() { return this.readAttribute("updatedAt") }
    }
    class CreateTenantSyncTables extends Migration {
      async up() {
        await this.execute("CREATE TABLE tenant_queued_items(id integer PRIMARY KEY, name varchar(255) NOT NULL, project_slug varchar(255) NOT NULL)")
        await this.execute("CREATE TABLE tenant_conflict_items(id integer PRIMARY KEY, name varchar(255) NOT NULL, version integer NOT NULL)")
        await this.execute("CREATE TABLE tenant_pending_syncs(id integer PRIMARY KEY AUTOINCREMENT, resource_id varchar(255) NOT NULL, resource_type varchar(255) NOT NULL, sync_type varchar(255) NOT NULL, data text, state varchar(255) NOT NULL, created_at datetime, updated_at datetime)")
      }
    }

    for (const modelClass of [TenantQueuedItem, TenantConflictItem, TenantPendingSync]) {
      modelClass.switchesTenantDatabase("projectTenant")
      modelClass.registerRecordClass({configuration})
    }
    TenantQueuedItem.setTableName("tenant_queued_items")
    TenantConflictItem.setTableName("tenant_conflict_items")
    TenantPendingSync.setTableName("tenant_pending_syncs")
    TenantPendingSync.belongsTo("resource", {polymorphic: true})
    CreateTenantSyncTables.onDatabases(["projectTenant"])
    configuration.getDatabaseConfiguration().projectTenant.migrations = true

    const migrations = buildFrontendMigrationContext({"20260815091000-create-tenant-sync-tables.js": CreateTenantSyncTables})
    const alpha = Tenant.handle({slug: "alpha"}, configuration)
    const beta = Tenant.handle({slug: "beta"}, configuration)

    try {
      await Promise.all([
        alpha.initialize({databaseIdentifier: "projectTenant", migrations, schemaGeneration: "generation-1"}),
        beta.initialize({databaseIdentifier: "projectTenant", migrations, schemaGeneration: "generation-1"})
      ])

      const alphaClient = new SyncClient({configuration, databaseIdentifier: "projectTenant", syncModel: TenantPendingSync, tenantHandle: alpha})
      const betaClient = new SyncClient({configuration, databaseIdentifier: "projectTenant", syncModel: TenantPendingSync, tenantHandle: beta})

      await Promise.all([alphaClient.start(), betaClient.start()])

      try {
        /** @type {InstanceType<typeof TenantQueuedItem> | undefined} */
        let alphaQueuedItem
        /** @type {import("../../src/database/query/model-class-query.js").default<typeof TenantQueuedItem> | undefined} */
        let alphaScopeQuery
        /** @type {import("../../src/database/query/model-class-query.js").default<typeof TenantQueuedItem> | undefined} */
        let betaScopeQuery

        await Promise.all([
          alpha.databaseOperation({databaseIdentifier: "projectTenant"}, async (operation) => {
            alphaScopeQuery = operation.forModel(TenantQueuedItem).where({projectSlug: "alpha"})
          }),
          beta.databaseOperation({databaseIdentifier: "projectTenant"}, async (operation) => {
            betaScopeQuery = operation.forModel(TenantQueuedItem).where({projectSlug: "beta"})
          })
        ])
        if (!alphaScopeQuery || !betaScopeQuery) throw new Error("Expected tenant-bound scope queries")
        await expect(async () => await betaClient.sync(alphaScopeQuery)).toThrow(/another or unresolved physical tenant/u)
        await Promise.all([alphaClient.sync(alphaScopeQuery), betaClient.sync(betaScopeQuery)])
        await Promise.all([
          alpha.databaseOperation({databaseIdentifier: "projectTenant"}, async (operation) => {
            alphaQueuedItem = await operation.forModel(TenantQueuedItem).create({id: 1, name: "local-alpha", projectSlug: "alpha"})
            await operation.forModel(TenantConflictItem).create({id: 1, name: "conflict-alpha", version: 1})
          }),
          beta.databaseOperation({databaseIdentifier: "projectTenant"}, async (operation) => {
            await operation.forModel(TenantQueuedItem).create({id: 1, name: "local-beta", projectSlug: "beta"})
            await operation.forModel(TenantConflictItem).create({id: 1, name: "conflict-beta", version: 1})
          })
        ])

        if (!alphaQueuedItem) throw new Error("Expected the alpha queued item")
        await expect(async () => await betaClient.queue({resource: alphaQueuedItem})).toThrow(/another or unresolved physical tenant/u)

        const alphaConflictLog = alphaClient.config.resources.TenantConflictItem.conflictTracking?.mutationLog
        const betaConflictLog = betaClient.config.resources.TenantConflictItem.conflictTracking?.mutationLog

        expect((await alphaConflictLog?.records())?.map((record) => [record.sequence, record.mutation.attributes?.name])).toEqual([[1, "conflict-alpha"]])
        expect((await betaConflictLog?.records())?.map((record) => [record.sequence, record.mutation.attributes?.name])).toEqual([[1, "conflict-beta"]])

        online = true
        await Promise.all([alphaClient.replayPending(), betaClient.replayPending()])

        expect(replayPosts).toHaveLength(4)
        await alpha.databaseOperation({databaseIdentifier: "projectTenant"}, async (operation) => {
          expect(await operation.forModel(TenantPendingSync).pluck("state")).toEqual(["success"])
        })
        await beta.databaseOperation({databaseIdentifier: "projectTenant"}, async (operation) => {
          expect(await operation.forModel(TenantPendingSync).pluck("state")).toEqual(["success"])
        })

        await Promise.all([alphaClient.pull(), betaClient.pull()])

        const alphaScope = (await alphaClient.scopeStore().activeScopes())[0]
        const betaScope = (await betaClient.scopeStore().activeScopes())[0]

        await expect(async () => await betaClient.scopeStore().loadCursor(alphaScope)).toThrow(/another physical tenant database/u)
        expect(JSON.parse(String(await alphaClient.scopeStore().loadCursor(alphaScope))).serverSequence).toEqual(11)
        expect(JSON.parse(String(await betaClient.scopeStore().loadCursor(betaScope))).serverSequence).toEqual(22)

        pullPhase = "subscription"
        await Promise.all([alphaClient.subscribeRealtime(), betaClient.subscribeRealtime()])
        await Promise.all([alphaClient.waitForRealtimeApplied(), betaClient.waitForRealtimeApplied()])

        expect(websocketClient.subscriptions
          .map((subscription) => subscription.params.conditions.projectSlug)
          .sort()).toEqual(["alpha", "beta"])

        for (const subscription of websocketClient.subscriptions) {
          const slug = String(subscription.params.conditions.projectSlug)

          subscription.emitMessage({data: {name: `pushed-${slug}`}, resourceId: 1, resourceType: "TenantQueuedItem", syncType: "update"})
        }
        await Promise.all([alphaClient.waitForRealtimeApplied(), betaClient.waitForRealtimeApplied()])

        pullPhase = "catchup"
        for (const subscription of websocketClient.subscriptions) subscription.emitResume()
        await Promise.all([alphaClient.waitForRealtimeApplied(), betaClient.waitForRealtimeApplied()])

        await alpha.databaseOperation({databaseIdentifier: "projectTenant"}, async (operation) => {
          expect(await operation.forModel(TenantQueuedItem).pluck("name")).toEqual(["catchup-alpha"])
        })
        await beta.databaseOperation({databaseIdentifier: "projectTenant"}, async (operation) => {
          expect(await operation.forModel(TenantQueuedItem).pluck("name")).toEqual(["catchup-beta"])
        })

        await alphaClient.unsubscribeRealtime()
        await alpha.close({databaseIdentifier: "projectTenant"})
        await expect(async () => await alphaClient.replayPending()).toThrow(/generation is stale or not ready/u)
        await betaClient.replayPending()
      } finally {
        await Promise.all([alphaClient.unsubscribeRealtime(), betaClient.unsubscribeRealtime()])
        alphaClient.stop()
        betaClient.stop()
      }
    } finally {
      await cleanup()
    }
  })
})
