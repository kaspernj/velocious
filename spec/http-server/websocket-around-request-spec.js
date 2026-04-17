// @ts-check

import {describe, expect, it} from "../../src/testing/test.js"
import Dummy from "../dummy/index.js"
import WebsocketClient from "../../src/http-client/websocket-client.js"
import dummyConfiguration from "../dummy/src/config/configuration.js"

/** @param {number} ms */
function wait(ms) { return new Promise((resolve) => setTimeout(resolve, ms)) }

/**
 * @param {() => boolean} predicate
 * @param {number} [timeoutMs]
 */
async function waitFor(predicate, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    if (predicate()) return
    await wait(20)
  }

  throw new Error(`waitFor timeout after ${timeoutMs}ms`)
}

describe("Configuration.setWebsocketAroundRequest (Phase 2)", () => {
  it("wraps every WS-borne message through the registered around-request hook", async () => {
    /** @type {string[]} */
    const callLog = []
    const originalWrapper = dummyConfiguration.getWebsocketAroundRequest()

    dummyConfiguration.setWebsocketAroundRequest(async (session, next) => {
      callLog.push(`before:${session.sessionId?.slice(0, 4) || "none"}`)
      await next()
      callLog.push("after")
    })

    try {
      await Dummy.run(async () => {
        const client = new WebsocketClient()

        try {
          await client.connect()

          /** @type {any[]} */
          const received = []
          const connection = client.openConnection("Echo", {
            params: {name: "aroundTest"},
            onMessage: (body) => received.push(body)
          })

          await connection.ready
          await waitFor(() => received.length >= 1)

          // One "before" + "after" pair from the connection-open message.
          expect(callLog.some((entry) => entry.startsWith("before:"))).toBe(true)
          expect(callLog.includes("after")).toBe(true)

          callLog.length = 0
          connection.sendMessage({ping: 1})
          await waitFor(() => received.some((m) => m?.echo?.ping === 1))

          // Another pair from the connection-message.
          expect(callLog.some((entry) => entry.startsWith("before:"))).toBe(true)
          expect(callLog.includes("after")).toBe(true)
        } finally {
          await client.close()
        }
      })
    } finally {
      dummyConfiguration.setWebsocketAroundRequest(originalWrapper)
    }
  })
})
