// @ts-check

import EventEmitter from "../../src/utils/event-emitter.js"
import WebsocketChannel from "../../src/http-server/websocket-channel.js"
import WebsocketRequest from "../../src/http-server/client/websocket-request.js"
import WebsocketSession from "../../src/http-server/client/websocket-session.js"
import dummyConfiguration from "../dummy/src/config/configuration.js"
import {describe, expect, it} from "../../src/testing/test.js"

class ResumableOwnershipChannel extends WebsocketChannel {
  /** @returns {boolean} */
  canSubscribe() { return true }
}

/** @returns {WebsocketSession} */
function buildSession() {
  return new WebsocketSession({
    client: /** @type {any} */ ({events: new EventEmitter(), remoteAddress: "127.0.0.1"}),
    configuration: dummyConfiguration,
    upgradeRequest: new WebsocketRequest({method: "GET", path: "/websocket", remoteAddress: "127.0.0.1"})
  })
}

describe("WebSocket session ownership lifecycle", {databaseCleaning: {transaction: true}}, () => {
  it("claims established sessions and releases non-resumable closes", () => {
    const session = buildSession()
    const ownershipEvents = []

    session.events.on("ownershipClaimed", ({sessionId}) => ownershipEvents.push(`claimed:${sessionId}`))
    session.events.on("ownershipReleased", ({sessionId}) => ownershipEvents.push(`released:${sessionId}`))
    session.sendSessionEstablished()
    session._handleClose({allowResume: false})

    expect(ownershipEvents).toEqual([
      `claimed:${session.sessionId}`,
      `released:${session.sessionId}`
    ])
  })

  it("retains ownership while paused and releases it on grace expiry", () => {
    const session = buildSession()
    const ownershipEvents = []

    session.events.on("ownershipClaimed", ({sessionId}) => ownershipEvents.push(`claimed:${sessionId}`))
    session.events.on("ownershipReleased", ({sessionId}) => ownershipEvents.push(`released:${sessionId}`))
    session._channelSubscriptions.set("subscription-1", {
      channelType: "ownership",
      subscription: new ResumableOwnershipChannel({params: {}, session, subscriptionId: "subscription-1"})
    })

    session.sendSessionEstablished()
    session._handleClose()

    expect(ownershipEvents).toEqual([`claimed:${session.sessionId}`])

    dummyConfiguration._clearPausedWebsocketSession(session.sessionId)
    session._finalizeGraceExpiry()

    expect(ownershipEvents).toEqual([
      `claimed:${session.sessionId}`,
      `released:${session.sessionId}`
    ])
  })
})
