import Configuration from "../../src/configuration.js"
import EnvironmentHandlerBrowser from "../../src/environment-handlers/browser.js"
import SyncClient from "../../src/sync/sync-client.js"
import UuidItem from "../dummy/src/models/uuid-item.js"
import {buildFakeSyncModel} from "./fake-sync-model.js"
import {buildFakeWebsocketClient} from "./sync-realtime-fakes.js"

const DELETED_ITEM_ID = "42e3c0d6-8f7a-4b9c-8d1e-9a4b5c6d7e8f"
const LOCAL_ITEM_ID = "e902893a-9d22-3c7e-a7b8-d6e313b71d9f"
const PUSHED_ITEM_ID = "7d444840-9dc0-11d1-b245-5ffdce74fad2"

/**
 * Builds a sync client wired to a fake websocket client and transport while the
 * registered UuidItem model applies against the real dummy-app database.
 * @returns {{client: SyncClient, fakeWebsocketClient: ?, syncModel: ?}} Realtime harness against the dummy database.
 */
function buildDummyRealtimeHarness() {
  const fakeWebsocketClient = buildFakeWebsocketClient()
  const syncModel = buildFakeSyncModel()
  const configuration = new Configuration({
    environment: "test",
    environmentHandler: new EnvironmentHandlerBrowser(),
    locale: "en",
    locales: ["en"],
    sync: {
      client: {
        authenticationToken: () => "token-1",
        realtime: {
          channels: () => [{channel: "uuid-items", resourceType: "UuidItem"}],
          createClient: () => fakeWebsocketClient,
          pullOnReconnect: false
        },
        transport: {post: async () => ({json: () => ({status: "success", syncs: []})})}
      }
    }
  })

  configuration.registerModelClass(UuidItem)

  return {client: new SyncClient({configuration, syncModel}), fakeWebsocketClient, syncModel}
}

describe("sync realtime bridge - dummy database", {databaseCleaning: {transaction: true}, tags: ["dummy"]}, () => {
  it("applies pushed creates and updates to real records with tracked echo suppression", async () => {
    const {client, fakeWebsocketClient, syncModel} = buildDummyRealtimeHarness()

    await client.start()

    try {
      await client.subscribeRealtime()

      fakeWebsocketClient.subscriptions[0].emitMessage({
        data: {title: "Pushed title"},
        resourceId: PUSHED_ITEM_ID,
        syncType: "create"
      })

      await client.waitForRealtimeApplied()

      const createdUuidItem = await UuidItem.find(PUSHED_ITEM_ID)

      expect(createdUuidItem.title()).toEqual("Pushed title")

      fakeWebsocketClient.subscriptions[0].emitMessage({
        data: {title: "Updated title"},
        resourceId: PUSHED_ITEM_ID,
        syncType: "update"
      })

      await client.waitForRealtimeApplied()

      const updatedUuidItem = await UuidItem.find(PUSHED_ITEM_ID)

      expect(updatedUuidItem.title()).toEqual("Updated title")
      expect(syncModel.rows.length).toEqual(0)

      await UuidItem.create({id: LOCAL_ITEM_ID, title: "Local title"})
      await client.waitForScheduledReplay()

      expect(syncModel.rows.length).toEqual(1)
      expect(syncModel.rows[0].attributes.resourceType).toEqual("UuidItem")
      expect(syncModel.rows[0].attributes.resourceId).toEqual(LOCAL_ITEM_ID)
      expect(syncModel.rows[0].attributes.data).toEqual({title: "Local title"})
    } finally {
      await client.unsubscribeRealtime()
      client.stop()
    }
  })

  it("applies pushed deletes to real records", async () => {
    const {client, fakeWebsocketClient} = buildDummyRealtimeHarness()

    await UuidItem.create({id: DELETED_ITEM_ID, title: "Doomed title"})

    try {
      await client.subscribeRealtime()

      fakeWebsocketClient.subscriptions[0].emitMessage({
        resourceId: DELETED_ITEM_ID,
        syncType: "delete"
      })

      await client.waitForRealtimeApplied()

      expect(await UuidItem.findBy({id: DELETED_ITEM_ID})).toEqual(null)
    } finally {
      await client.unsubscribeRealtime()
    }
  })
})
