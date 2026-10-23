// @ts-check

import AdvisoryLockLockServerBackend from "../../src/database/advisory-lock-lock-server-backend.js"
import VelociousEnvironmentHandlerBrowser from "../../src/environment-handlers/browser.js"
import VelociousEnvironmentHandlerNode from "../../src/environment-handlers/node.js"
import {describe, expect, it} from "../../src/testing/test.js"

describe("Advisory lock lock-server environment handler", {databaseCleaning: {transaction: true}}, () => {
  it("creates the lock-server backend through the Node environment handler", async () => {
    const handler = new VelociousEnvironmentHandlerNode({})

    const backend = await handler.createAdvisoryLockLockServerBackend({
      authToken: "test-token",
      connectTimeoutMs: 1000,
      leaseMs: 30_000,
      reprobeCooldownMs: 1000,
      url: "ws://127.0.0.1:3006/websocket"
    })

    expect(backend).toBeInstanceOf(AdvisoryLockLockServerBackend)
    // The transport is created on first use, so this assertion proves no I/O happened
    // and the Node-only `ws` transport was bound through the Node-only path.
    expect(backend.client).toBeNull()

    await backend.close()
  })

  it("refuses the lock-server tier in the browser environment handler", async () => {
    const handler = new VelociousEnvironmentHandlerBrowser({})

    await expect(handler.createAdvisoryLockLockServerBackend({url: "ws://127.0.0.1:3006/websocket"})).rejects.toThrow(
      "The advisory-lock lock-server tier requires a Node environment handler"
    )
  })
})
