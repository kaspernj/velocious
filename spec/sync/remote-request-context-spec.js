// @ts-check

import {describe, expect, it} from "../../src/testing/test.js"
import {buildConfiguration, buildFakeSyncModel, buildMetadataModelClass, buildTransport, fakeQuery} from "./sync-client-fakes.js"
import {buildFakeWebsocketClient} from "./sync-realtime-fakes.js"
import SyncClient from "../../src/sync/sync-client.js"

const COLUMNS = [
  {attributeName: "id", name: "id", type: "uuid"},
  {attributeName: "name", name: "name", type: "varchar"}
]

/**
 * Builds a sync client and its recording transport.
 * @param {Record<string, string | number | boolean>} [requestContext] - Remote request context.
 * @returns {{client: SyncClient, transport: ReturnType<typeof buildTransport>}} Client harness.
 */
function buildClient(requestContext) {
  const Item = buildMetadataModelClass({columns: COLUMNS, modelName: "Item", sync: true})
  const transport = buildTransport()
  const configuration = buildConfiguration({modelClasses: [Item], transport})
  const client = new SyncClient({configuration, requestContext, syncModel: buildFakeSyncModel()})

  return {client, transport}
}

describe("sync remote request context", () => {
  it("captures immutable context for pull and replay without changing unscoped requests", async () => {
    const sourceContext = {projectId: "project-alpha", routingEpoch: 7}
    const scoped = buildClient(sourceContext)

    sourceContext.projectId = "project-mutated"
    sourceContext.routingEpoch = 8

    await scoped.client.config.postChanges({authenticationToken: "token-1", scope: {conditions: {}, resourceType: "Item"}})
    await scoped.client.config.postReplay({authenticationToken: "token-1", syncs: []})

    expect(scoped.transport.posts.map(({payload}) => payload)).toEqual([
      {authenticationToken: "token-1", projectId: "project-alpha", routingEpoch: 7, scope: {conditions: {}, resourceType: "Item"}},
      {authenticationToken: "token-1", projectId: "project-alpha", routingEpoch: 7, syncs: []}
    ])

    const unscoped = buildClient()

    await unscoped.client.config.postChanges({authenticationToken: "token-1", scope: {conditions: {}, resourceType: "Item"}})

    expect(unscoped.transport.posts[0].payload).toEqual({authenticationToken: "token-1", scope: {conditions: {}, resourceType: "Item"}})
  })

  it("keeps concurrent clients isolated across pulls and websocket subscriptions", async () => {
    const alpha = buildClient({projectId: "project-alpha", routingEpoch: 3})
    const beta = buildClient({projectId: "project-beta", routingEpoch: 4})

    await Promise.all([
      alpha.client.sync(fakeQuery("Item", {id: "item-alpha"})),
      beta.client.sync(fakeQuery("Item", {id: "item-beta"}))
    ])

    expect(alpha.transport.posts[0].payload.projectId).toEqual("project-alpha")
    expect(alpha.transport.posts[0].payload.routingEpoch).toEqual(3)
    expect(beta.transport.posts[0].payload.projectId).toEqual("project-beta")
    expect(beta.transport.posts[0].payload.routingEpoch).toEqual(4)
  })

  it("keeps captured context through websocket resume and resubscribe", async () => {
    const Item = buildMetadataModelClass({columns: COLUMNS, modelName: "Item", sync: true})
    const transport = buildTransport()
    const websocketClient = buildFakeWebsocketClient()
    const sourceContext = {projectId: "project-alpha", routingEpoch: 3}
    const configuration = buildConfiguration({
      modelClasses: [Item],
      sync: {
        client: {
          authenticationToken: () => "token-1",
          realtime: {createClient: () => websocketClient},
          transport
        }
      }
    })
    const scopeStore = {
      activeScopes: async () => [{conditions: {id: "item-alpha"}, resourceType: "Item"}],
      loadCursor: async () => null,
      saveCursor: async () => {}
    }
    const client = new SyncClient({configuration, requestContext: sourceContext, scopeStore, syncModel: buildFakeSyncModel()})

    await client.subscribeRealtime()
    await client.waitForRealtimeApplied()

    sourceContext.projectId = "project-mutated"
    sourceContext.routingEpoch = 4
    websocketClient.subscriptions[0].emitResume()

    await client.waitForRealtimeApplied()
    await client.unsubscribeRealtime()
    await client.subscribeRealtime()
    await client.waitForRealtimeApplied()

    expect(websocketClient.subscriptions.map(({params}) => params)).toEqual([
      {
        authenticationToken: "token-1",
        conditions: {id: "item-alpha"},
        projectId: "project-alpha",
        resourceType: "Item",
        routingEpoch: 3
      },
      {
        authenticationToken: "token-1",
        conditions: {id: "item-alpha"},
        projectId: "project-alpha",
        resourceType: "Item",
        routingEpoch: 3
      }
    ])
    expect(transport.posts.map(({payload}) => payload.projectId)).toEqual(["project-alpha", "project-alpha", "project-alpha"])

    await client.unsubscribeRealtime()
  })

  it("rejects malformed values and framework-reserved key collisions", async () => {
    // @ts-expect-error Exercises runtime rejection of a non-object context.
    await expect(() => buildClient([])).toThrow(/request context.*plain object/iu)
    // @ts-expect-error Exercises runtime rejection of a nested context value.
    await expect(() => buildClient({projectId: {nested: true}})).toThrow(/projectId.*scalar/iu)
    await expect(() => buildClient({authenticationToken: "shadowed"})).toThrow(/authenticationToken.*reserved/iu)
    await expect(() => buildClient({scope: "shadowed"})).toThrow(/scope.*reserved/iu)
  })
})
