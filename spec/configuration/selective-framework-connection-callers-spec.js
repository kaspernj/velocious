// @ts-check

import ServerChangeFeedStore from "../../src/sync/server-change-feed.js"
import ServerSequenceAllocator from "../../src/sync/server-sequence-allocator.js"
import SyncScopeStore from "../../src/sync/sync-scope-store.js"
import VelociousHttpServerWebsocketEventLogStore from "../../src/http-server/websocket-event-log-store.js"
import {ConnectionCountingSqliteDriver, createMultiDatabaseConfiguration} from "../helpers/selective-connections-helper.js"
import {describe, expect, it} from "../../src/testing/test.js"

describe("framework-owned selective database connections", () => {
  it("opens only the configured database for framework persistence stores", async () => {
    const {cleanup, configuration} = await createMultiDatabaseConfiguration()

    try {
      const eventLogStore = new VelociousHttpServerWebsocketEventLogStore({configuration, databaseIdentifier: "default"})
      const scopeStore = new SyncScopeStore({configuration, databaseIdentifier: "default"})
      const sequenceAllocator = new ServerSequenceAllocator({configuration, databaseIdentifier: "default", tableName: "selective_server_sequences"})
      const changeFeedStore = new ServerChangeFeedStore({configuration, databaseIdentifier: "default"})

      await eventLogStore.appendEvent({channel: "selective-test", payload: {ok: true}})
      await scopeStore.findOrCreateScope({conditions: {project_id: 1}, resourceType: "Project"})
      await sequenceAllocator.next()
      await changeFeedStore.append({
        actorDeviceId: null,
        actorUserId: null,
        attributes: null,
        idempotencyKey: "selective-test",
        model: "Project",
        operation: "update",
        payload: null,
        recordId: "1",
        response: null,
        scope: null
      })

      expect(ConnectionCountingSqliteDriver.connectionAttempts).toEqual(0)
    } finally {
      await cleanup()
    }
  })
})
