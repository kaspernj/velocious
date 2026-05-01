# WebSocket Channels (Phase 1B)

A `WebsocketChannel` is a **1:N pub/sub topic** multiplexed over the shared session socket. One named channel can have many subscribers across many sessions; publishers emit one broadcast and the framework routes it to the matching subscribers.

For per-client state / 1:1 back-and-forth, use `WebsocketConnection` instead (documented in `websocket-connections.md`).

## Distinct from today's `FrontendModelWebsocketChannel`

The existing `{type: "subscribe"}` wire message + `FrontendModelWebsocketChannel` class stay in place untouched. This doc describes a separate, general-purpose Channel primitive under a different message namespace (`channel-*`). Phase 3 will migrate frontend-model events onto the new primitive and retire the old one.

## Wire protocol

```json
// client → server
{"type": "channel-subscribe",   "subscriptionId": "s1", "channelType": "GameChat", "params": {"gameId": "abc"}}
{"type": "channel-unsubscribe", "subscriptionId": "s1"}

// server → client
{"type": "channel-subscribed",  "subscriptionId": "s1"}
{"type": "channel-message",     "subscriptionId": "s1", "body": {...}}
{"type": "channel-unsubscribed","subscriptionId": "s1"}
{"type": "channel-error",       "subscriptionId": "s1", "message": "..."}
```

- `subscriptionId` is client-generated and unique within the session.
- `channelType` is the name the server registered the class under.

## Backend API

```js
import WebsocketChannel from "velocious/websocket/channel.js"

export default class GameChatChannel extends WebsocketChannel {
  /** Subscribe-time auth. Default is `return false`. */
  async canSubscribe() {
    return Boolean(this.session.currentUser) && Boolean(this.params.gameId)
  }

  /** Optional — called once after canSubscribe resolves true. */
  async subscribed() {
    // Could send an initial snapshot via this.sendMessage(...)
  }

  /** Optional — called once when the subscription ends (unsubscribe or session-destroyed). */
  async unsubscribed() {}

  /** Required for broadcasts: decide whether THIS subscription should receive a given broadcast. */
  matches(broadcastParams) {
    return broadcastParams.gameId === this.params.gameId
  }

  /** Send a message to THIS subscriber only (server → client). */
  sendMessage(body) { /* inherited */ }
}
```

Register:

```js
configuration.registerWebsocketChannel("GameChat", GameChatChannel)
```

Publish:

```js
configuration.broadcastToChannel("GameChat", {gameId: "abc"}, {from: "alice", text: "gg"})
```

- `broadcastToChannel(name, broadcastParams, body)` iterates all active subscriptions to `name`, calls `instance.matches(broadcastParams)` on each, and sends the body to those that match. Routing, not authorization.
- By default the broadcast only reaches subscribers in the *current* process. To deliver broadcasts across processes (HTTP server, background-jobs worker, sidecars, etc.) run a [Beacon broker](beacon.md) daemon and configure each peer to connect to it.

## Auth model — locked in

**At subscribe time**, once:
- Custom channels: `canSubscribe()` runs, default `false`. Return true to allow.
- Frontend-model channels (Phase 3): the framework runs the resource's `can("read")` ability against the filtered scope from the subscriber's params. Allowed → subscription granted.

**At broadcast time**, zero auth:
- No per-row scope re-check. If a subscriber was allowed at subscribe time, they continue receiving matching broadcasts.
- Routing uses the subscription's `params` and the channel's `matches()` method.
- Tradeoff: a subscriber whose access changes mid-session keeps receiving broadcasts until they unsubscribe or the session ends. Channels that need tighter enforcement can run their own per-broadcast filter inside `matches()`.

## Frontend API

```js
const subscription = client.subscribeChannel("GameChat", {
  lastEventId: "evt-42",
  params: {gameId: "abc"},
  onMessage: (body) => console.log(body),
  onClose: (reason) => console.log("sub ended:", reason)
})

await client.connect()             // default: autoReconnect on, waitForOnline on when a network monitor is configured
await subscription.ready           // resolves once the server sends channel-subscribed
subscription.close()                // client-initiated unsubscribe
```

Subscription handle exposes:
- `subscriptionId: string`
- `lastEventId?: string`
- `ready: Promise<void>` — resolves on `channel-subscribed`, rejects on `channel-error`
- `waitForReady({timeoutMs?: number})` — waits for the current ready cycle with a timeout
- `close()`
- `isClosed()`
- `isReady()`
- User-supplied `onMessage(body)` / `onClose(reason)`

Client behavior:
- `subscribeChannel(...)` may be called before the socket is open. The client queues the subscription and sends `channel-subscribe` after `connect()` succeeds.
- Queued subscriptions preserve `lastEventId`, so replay checkpoints survive delayed initial connects as well as later reconnects.
- `connect()` is the normal public entrypoint. By default it enables auto-reconnect, and when a `networkMonitor` is configured it waits for the monitor to report online before opening or re-opening the socket.
- Callers that need lower-level behavior can still override `connect({autoReconnect: false})` or `connect({waitForOnline: false})`, but those are opt-outs rather than the normal app path.

## Lifecycle guarantees (Phase 1B)

- `canSubscribe()` → `subscribed()` is the order on the server. `channel-subscribed` is sent AFTER `subscribed()` resolves.
- Client's `subscription.ready` resolves after `channel-subscribed` arrives.
- `subscription.waitForReady()` is the higher-level helper for app code. It resolves after the initial subscribe, then resets on disconnect and resolves again after `session-resumed`.
- `unsubscribed()` fires exactly once: on client-initiated `channel-unsubscribe` OR on session teardown (socket drop, Phase 2 covers grace-period resumption).
- No persistent event log, no replay, no cross-reconnect survival in Phase 1B. Publish-and-forget; subscribers who missed events while disconnected don't see them.
