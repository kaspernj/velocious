// @ts-check

import {describe, expect, it} from "../../src/testing/test.js"
import FrontendModelWebsocketChannel from "../../src/frontend-models/websocket-channel.js"

describe("FrontendModelWebsocketChannel", {databaseCleaning: {transaction: true}}, () => {
  it("exposes websocket metadata separately from upgrade request headers", () => {
    const channel = new FrontendModelWebsocketChannel({
      params: {model: "Task"},
      session: /** @type {any} */ ({
        getMetadata: () => ({
          cookie: "session=metadata-token",
          origin: "https://metadata.example",
          "X-Session-Token": "metadata-token",
          locale: "da"
        }),
        upgradeRequest: {
          headers: () => ({
            Cookie: "session=upgrade-token",
            Origin: "https://upgrade.example",
            "X-Session-Token": "upgrade-token"
          }),
          remoteAddress: () => "127.0.0.1"
        }
      }),
      subscriptionId: "test-subscription"
    })

    const request = channel._syntheticRequest()

    expect(request.header("cookie")).toEqual("session=upgrade-token")
    expect(request.header("origin")).toEqual("https://upgrade.example")
    expect(request.header("x-session-token")).toEqual("upgrade-token")
    expect(request.header("locale")).toEqual(undefined)
    expect(request.metadata()).toEqual({
      cookie: "session=metadata-token",
      origin: "https://metadata.example",
      "X-Session-Token": "metadata-token",
      locale: "da"
    })
    expect(request.metadata("locale")).toEqual("da")
    expect(request.metadata("X-Session-Token")).toEqual("metadata-token")
    expect(request.origin()).toEqual("https://upgrade.example")
    expect(request.remoteAddress()).toEqual("127.0.0.1")
  })

  it("keeps metadata-only values out of synthetic headers", () => {
    const channel = new FrontendModelWebsocketChannel({
      params: {model: "Task"},
      session: /** @type {any} */ ({
        getMetadata: () => ({
          "X-Session-Token": "metadata-token"
        }),
        upgradeRequest: {
          headers: () => ({
            Cookie: "session=upgrade-token"
          })
        }
      }),
      subscriptionId: "test-subscription"
    })

    const request = channel._syntheticRequest()

    expect(request.header("cookie")).toEqual("session=upgrade-token")
    expect(request.header("x-session-token")).toEqual(undefined)
    expect(request.metadata("X-Session-Token")).toEqual("metadata-token")
  })

  it("skips projected lifecycle events when the record cannot be reloaded", async () => {
    /** @type {Array<{body?: object, type?: string}>} */
    const sentFrames = []
    const channel = new FrontendModelWebsocketChannel({
      params: {model: "Task", select: {Task: ["id", "name"]}},
      // @ts-expect-error Minimal sendJson-only session stub for direct channel delivery.
      session: {
        sendJson: (/** @type {{body?: object, type?: string}} */ frame) => sentFrames.push(frame)
      },
      subscriptionId: "projected-missing-record"
    })

    channel._projectedRecordForEventId = async () => null

    await channel.deliverBroadcast({
      action: "update",
      id: "missing-task",
      record: {id: "missing-task", name: "Raw fallback"}
    })

    expect(sentFrames).toEqual([])
  })
})
