// @ts-check

import {describe, expect, it} from "../../src/testing/test.js"
import Dummy from "../dummy/index.js"
import WebsocketClient from "../../src/http-client/websocket-client.js"
import dummyConfiguration from "../dummy/src/config/configuration.js"
import waitFor from "../helpers/wait-for.js"

function expectAroundRequestPair(callLog) {
  expect(callLog.some((entry) => entry.startsWith("before:"))).toBe(true)
  expect(callLog.includes("after")).toBe(true)
}

describe("Configuration.setWebsocketAroundRequest (Phase 2)", {databaseCleaning: {transaction: true}}, () => {
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
          expectAroundRequestPair(callLog)

          callLog.length = 0
          connection.sendMessage({ping: 1})
          await waitFor(() => received.some((m) => m?.echo?.ping === 1))

          // Another pair from the connection-message.
          expectAroundRequestPair(callLog)
        } finally {
          await client.close()
        }
      })
    } finally {
      dummyConfiguration.setWebsocketAroundRequest(originalWrapper)
    }
  })
})
