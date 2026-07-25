# WebSocket Connections (Phase 1A)

A `WebsocketConnection` is a **1:1, session-scoped handler** multiplexed over the shared WebSocket between a client and the server. One `open()` call creates one instance on each side. Use it whenever you need per-client state that reacts to per-client messages.

For the broadcast / pub-sub case, use `WebsocketChannel` instead (documented separately).

## Wire protocol

All messages are JSON objects sent over the shared WebSocket. Connection-related messages use a `type` prefix of `connection-`.

Velocious buffers TCP-fragmented WebSocket input as chunks and assembles each frame once it is complete. A single final client data frame is limited to 16 MiB, matching the existing cap for a fragmented message; a frame declaring a larger payload is rejected before its payload is buffered. Applications that need to send more data should split it at the application level.

Server-to-client frames are also bounded per live client. The delivery queue retains at most 256 complete frames or 16 MiB by default, including the frame currently waiting for its socket write callback. FIFO order is exact while both limits are respected. If either next-frame admission would exceed its high-water mark, Velocious reports a `framework-error` and `all-error` with `context.websocketOutboundQueueOverflow === true`, then destroys only that client. It does not silently discard or coalesce protocol events.

Configure both positive safe-integer limits at the configuration boundary:

```js
const configuration = new Configuration({
  // ...
  httpServer: {
    websocketOutboundQueue: {
      maxPendingFrames: 128,
      maxPendingBytes: 8 * 1024 * 1024
    }
  }
})
```

Byte accounting uses serialized output bytes, not JavaScript string length. Queued and in-flight buffers remain charged until the socket callback settles; socket close, error, or overflow teardown explicitly releases the queue. Limits are per client, so a stalled consumer cannot consume another client's allowance.

### Client → server

```json
{"type": "connection-open",    "connectionId": "abc", "connectionType": "Locale", "params": {}}
{"type": "connection-message", "connectionId": "abc", "body": {...}}
{"type": "connection-close",   "connectionId": "abc"}
```

- `connectionId` is a client-generated string unique within the session. The session rejects `connection-open` for an id that is already in use.
- `connectionType` is the name the server registered the class under.
- `params` is an opaque object passed to the server-side instance's constructor.

### Server → client

```json
{"type": "connection-opened",  "connectionId": "abc"}
{"type": "connection-message", "connectionId": "abc", "body": {...}}
{"type": "connection-closed",  "connectionId": "abc", "reason": "server_close" | "error" | "session_destroyed"}
{"type": "connection-error",   "connectionId": "abc", "message": "..."}
```

- `connection-opened` confirms `onConnect()` has returned (or resolved, if async). The client-side `onConnect()` fires after receiving it.
- `connection-closed` is the server's final word on that id. After sending it the server drops all state for that instance.

## Backend API

Register a connection class on the configuration:

```js
configuration.registerWebsocketConnection("Locale", LocaleConnection)
```

The class:

```js
import WebsocketConnection from "velocious/websocket/connection.js"

export default class LocaleConnection extends WebsocketConnection {
  /** Called once when the client opens the connection. May be async. */
  async onConnect() {
    this.session.data.locale = this.params?.locale || "en"
    this.sendMessage({locale: this.session.data.locale})
  }

  /** Client sent a message scoped to this connection. May be async. */
  async onMessage(body) {
    if (typeof body?.locale === "string") {
      this.session.data.locale = body.locale
    }
  }

  /** Client or server closed the connection. Grace-period resumption
   *  is NOT in Phase 1A — this is always final. */
  async onClose(reason) {}
}
```

Instance properties available to the class:

- `this.session` — the owning `WebsocketSession`. Long-lived `session.data` bag for persistent per-client state.
- `this.params` — the `params` object the client sent in `connection-open`.
- `this.connectionId` — the client-assigned id.
- `this.sendMessage(body)` — serializes `{type: "connection-message", connectionId, body}` and flushes.

## Frontend API

```js
import {openConnection} from "velocious/websocket-client/connection.js"

const connection = openConnection("Locale", {
  params: {locale: "da"},
  onConnect() {
    connection.sendMessage({locale: "de"})
  },
  onMessage(body) { console.log("server:", body) },
  onClose(reason) {}
})

connection.sendMessage({...})
connection.close()
```

`openConnection` returns an instance with:
- `connectionId: string`
- `sendMessage(body)`
- `close()`
- `onConnect`, `onMessage`, `onClose` (settable)

## Lifecycle guarantees (Phase 1A)

- `onConnect()` fires exactly once before any `onMessage()` on either side.
- `onMessage()` only fires after `onConnect()` has resolved and before `onClose()` has started.
- `onClose()` fires exactly once, final. No resumption.
- If the WebSocket drops, every live connection's `onClose({reason: "session_destroyed"})` fires. (Grace-period resumption is Phase 2.)

## Non-goals for Phase 1A

- Grace-period resumption after WS drop.
- Message acks / deliverability guarantees.
- Client-side outbound queues.
- Authorization hooks (`canOpen`) — app enforces via the current-user check inside `onConnect()` for now.
- Typed `connection-request`/`connection-response` round-trips. Use `sendMessage` + your own correlation id for V1.
