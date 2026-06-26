// @ts-check

import {describe, expect, it} from "../../src/testing/test.js"
import EventEmitter from "../../src/utils/event-emitter.js"
import WebsocketChannel from "../../src/http-server/websocket-channel.js"
import WebsocketRequest from "../../src/http-server/client/websocket-request.js"
import WebsocketSession from "../../src/http-server/client/websocket-session.js"
import dummyConfiguration from "../dummy/src/config/configuration.js"
import waitFor from "../helpers/wait-for.js"

const WEBSOCKET_PING_FRAME_FIRST_BYTE = 0x89

class ResumableChannel extends WebsocketChannel {
  /** @returns {boolean} */
  canSubscribe() { return true }
}

/**
 * Builds a websocket session backed by a fake client whose emitted
 * output frames are captured for assertions.
 * @returns {{output: Buffer[], session: WebsocketSession}}
 */
function buildSession() {
  const clientEvents = new EventEmitter()
  /** @type {Buffer[]} */
  const output = []

  clientEvents.on("output", (buffer) => output.push(buffer))

  const session = new WebsocketSession({
    client: /** @type {any} */ ({events: clientEvents, remoteAddress: "127.0.0.1"}),
    configuration: dummyConfiguration,
    upgradeRequest: new WebsocketRequest({method: "GET", path: "/websocket", remoteAddress: "127.0.0.1"})
  })

  return {output, session}
}

describe("WebsocketSession heartbeat", () => {
  it("pings the client on a heartbeat tick", () => {
    const {output, session} = buildSession()

    session._heartbeatTick()

    expect(output.length).toEqual(1)
    expect(output[0][0]).toEqual(WEBSOCKET_PING_FRAME_FIRST_BYTE)

    session.destroy()
  })

  it("stays alive when the client answers with a pong frame", () => {
    const {session} = buildSession()

    session._heartbeatTick()
    session.onData(Buffer.from([0x8A, 0x00]))
    session._heartbeatTick()

    expect(session.isPaused()).toEqual(false)
    expect(dummyConfiguration._websocketSessions.has(session)).toEqual(true)

    session.destroy()
  })

  it("stays alive while a large frame is still being uploaded across ticks", () => {
    const {session} = buildSession()

    session._heartbeatTick()
    // Incomplete binary frame: header declares a 4096-byte payload but
    // no payload bytes have arrived yet, so _processBuffer returns early.
    session.onData(Buffer.from([0x82, 0x7E, 0x10, 0x00]))
    session._heartbeatTick()

    expect(session.isPaused()).toEqual(false)
    expect(dummyConfiguration._websocketSessions.has(session)).toEqual(true)

    session.destroy()
  })

  it("reaps a silent resumable session whose ping went unanswered and removes it on grace expiry", async () => {
    const {session} = buildSession()
    const subscription = new ResumableChannel({params: {}, session, subscriptionId: "s1"})

    session._channelSubscriptions.set("s1", {channelType: "frontend-models", subscription})
    dummyConfiguration._registerWebsocketChannelSubscription("frontend-models", subscription)

    session._heartbeatTick()
    session._heartbeatTick()

    expect(session.isPaused()).toEqual(true)
    expect(dummyConfiguration._websocketSessions.has(session)).toEqual(true)

    dummyConfiguration._expireWebsocketSession(session.sessionId)

    expect(dummyConfiguration._websocketSessions.has(session)).toEqual(false)
    await waitFor(() => !dummyConfiguration._websocketChannelSubscriptions.has("frontend-models"))
  })

  it("fully tears down a silent session that has no resumable state", () => {
    const {session} = buildSession()

    session._heartbeatTick()
    session._heartbeatTick()

    expect(session.isPaused()).toEqual(false)
    expect(dummyConfiguration._websocketSessions.has(session)).toEqual(false)
  })

  it("removes the session from the configuration registry on grace expiry", () => {
    const {session} = buildSession()

    expect(dummyConfiguration._websocketSessions.has(session)).toEqual(true)

    session._finalizeGraceExpiry()

    expect(dummyConfiguration._websocketSessions.has(session)).toEqual(false)
  })
})
