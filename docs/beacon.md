# Beacon — cross-process broadcast bus

`velocious broadcastToChannel(...)` fans an event out to subscribers in
the *current* process. That's enough when the HTTP server is the only
thing publishing, but as soon as a separate process (background-jobs
worker, a sidecar, a CLI tool) needs to push events to subscribers
attached to the HTTP server, the broadcast falls into a void: each
process holds its own subscription registry, and there is no built-in
bridge.

Beacon is that bridge — a small daemon that every Velocious process
opens a JsonSocket connection to. When any peer publishes a broadcast,
the daemon fans it back out to every connected peer (including the
sender, so all peers follow a single delivery path).

## Topology

```
┌──────────────┐       ┌──────────────────┐       ┌──────────────┐
│   server     │ ←───→ │ velocious        │ ←───→ │  jobs-worker │
│  (HTTP+WS)   │       │   beacon         │       │              │
└──────────────┘       │  (broker daemon) │       └──────────────┘
                       └──────────────────┘
                              ↑↓
                       ┌──────────────┐
                       │  jobs-main   │
                       └──────────────┘
```

Every peer with a `Configuration` calls `connectBeacon()` once during
startup. From then on, `configuration.broadcastToChannel(...)` ships
the message to the daemon and the daemon delivers it to every peer's
local websocket subscribers.

## Running the daemon

```bash
npx velocious beacon
```

Bound port and host can be set explicitly via the `beacon`
configuration block, env vars, or both:

```js
new Configuration({
  // ...
  beacon: {
    host: "127.0.0.1",
    port: 7330
  }
})
```

```bash
VELOCIOUS_BEACON_HOST=127.0.0.1
VELOCIOUS_BEACON_PORT=7330
```

The defaults are `127.0.0.1` and port `7330`. Beacon is **opt-in** —
unless `host`, `port`, or one of the env vars is set, `connectBeacon()`
returns `undefined` and `broadcastToChannel` keeps using its existing
local-only path. Set `beacon: {enabled: false}` to disable explicitly
when env vars are present (useful in tests).

## Connecting a peer

Peers shipped by Velocious connect automatically:

- `application.startHttpServer()` calls `connectBeacon({peerType: "server"})`.
- `BackgroundJobsMain.start()` calls `connectBeacon({peerType: "background-jobs-main"})`.
- `BackgroundJobsWorker.start()` calls `connectBeacon({peerType: "background-jobs-worker"})`.

Custom processes that maintain their own `Configuration` lifecycle
should call `connectBeacon` themselves:

```js
import configuration from "./src/config/configuration.js"

await configuration.connectBeacon({peerType: "my-sidecar"})
// ...
await configuration.disconnectBeacon()
```

`connectBeacon()` is idempotent. In TCP mode it is **non-blocking**:
the call kicks off the TCP connect and returns immediately, without
waiting for the handshake to complete. A broker that silently drops
SYNs (firewall/NACL DROP rules) would otherwise block startup on the
OS TCP connect timeout (tens of seconds), defeating the documented
"fall back to local-only and reconnect in the background" contract.
Initial-connect failures surface asynchronously on the framework-error
channel (see *Error reporting* below); the BeaconClient's reconnect
loop keeps trying. If a caller needs to wait for connectivity, poll
`configuration.getBeaconClient()?.isConnected()`.

In-process mode (`beacon: {inProcess: true}`) **does** await `connect()`
— that path is synchronous, cannot fail, and gives callers predictable
readiness on the very next line.

## In-process mode

`beacon: {inProcess: true}` runs Beacon entirely in-memory: a
module-level broker singleton inside Velocious replaces the TCP daemon,
and every `Configuration` with `inProcess: true` registers itself as a
peer.

```js
new Configuration({
  // ...
  beacon: {inProcess: true}
})
```

Use cases:

- **Tests.** Multiple `Configuration` instances in one process can
  exchange broadcasts without spinning up a TCP daemon or allocating a
  port. The in-process broker preserves "publish, then receive"
  ordering by scheduling each fan-out via `queueMicrotask`.
- **Single-process deployments.** Apps that don't need cross-process
  delivery still get the same `broadcastToChannel` ergonomics — useful
  if a future deployment topology might add a worker, since flipping
  `inProcess: true` off and pointing at a daemon is a no-op for call
  sites.

`inProcess: true` is **mutually exclusive** with `host` / `port` —
`getBeaconConfig()` throws if both are set. When `inProcess: true` is
set, the `VELOCIOUS_BEACON_HOST` / `VELOCIOUS_BEACON_PORT` env vars are
ignored (code-level config wins).

## Broadcast semantics

When a Beacon client is connected, `broadcastToChannel(name, broadcastParams, body)`:

1. Sends a `broadcast` message to the daemon.
2. The daemon fans it out to every connected peer, including the
   sender.
3. Each peer's `_deliverBroadcastFromBeacon` either hands the
   broadcast to its `websocketEvents.broadcastV2(...)` (when the peer
   hosts an HTTP server with worker threads) or runs the
   per-process `_broadcastToChannelLocal` fallback. Either way the
   delivery code path is the same one used for purely-local
   broadcasts.

When no Beacon client is connected, `broadcastToChannel` keeps its
existing in-process behaviour (worker-thread broadcastV2, parentPort
publishV2Broadcast, or local fallback) unchanged.

## Reconnect and durability

Beacon is **in-memory pub/sub**, not a queue. Mirrors the default Redis
pubsub posture:

- Broadcasts are not persisted on the bus. If the daemon restarts,
  any in-flight broadcasts are lost.
- Clients reconnect with exponential backoff (1s initial, capped at
  30s). While disconnected, `publish(...)` returns `false` and the
  caller falls back to local-only delivery.
- For client-reconnect *replay*, use the existing
  websocket-event-log-store — Beacon is the cross-process bus, the
  event log is the resume buffer.

## Error reporting

When Beacon is configured but the broker is unreachable or the
connection drops mid-session, the failure is surfaced on
`configuration.getErrorEvents()` — the same channel
`request-runner.js` uses for HTTP errors:

```js
configuration.getErrorEvents().on("framework-error", ({context, error}) => {
  if (context.stage === "beacon-connect") {
    // Broker unreachable on initial connect (or during reconnect attempts).
  } else if (context.stage === "beacon-disconnect") {
    // An established connection dropped.
  }

  Sentry.captureException(error, {tags: {component: "beacon", stage: context.stage}})
})
```

Stages emitted today:

- `"beacon-connect"` — fired when the initial TCP connect fails or the
  broker rejects the handshake. Reconnect attempts continue in the
  background; further failures fire the same event again.
- `"beacon-disconnect"` — fired once when an established connection
  drops. The `error` is the underlying socket error if there was one,
  or `Error("Beacon broker disconnected")` otherwise. Explicit
  `disconnectBeacon()` calls do **not** fire this event.

A parallel `"all-error"` event mirrors the framework-error channel
with `errorType: "framework-error"` for apps that prefer one
listener.

**Unhandled-rejection safety net.** When neither `"framework-error"`
nor `"all-error"` has any listeners, Beacon also schedules a
`Promise.reject(error)` for each failure so process-level bug
reporters (which subscribe to Node's `unhandledRejection` by default)
still pick the failure up. Apps that wire either listener won't see
the unhandled rejection — wire one to suppress it.

`broadcastToChannel` keeps falling back to local-only delivery while
disconnected: surfacing the error doesn't replace the fallback, the
two are independent.

## Security

The daemon binds to `127.0.0.1` by default and has no authentication
on the wire. Operate it on a loopback interface or a private network.
A future iteration may add a shared-secret HMAC handshake; until
then, do not expose Beacon to untrusted networks.

## Manual usage

The `BeaconServer` and `BeaconClient` classes are exported and may be
used directly when you need a programmatic broker (tests, embedded
deployments, or single-binary tools):

```js
import BeaconServer from "velocious/beacon/server.js"
import BeaconClient from "velocious/beacon/client.js"

const server = new BeaconServer({configuration, host: "127.0.0.1", port: 0})
await server.start()

const client = new BeaconClient({host: "127.0.0.1", port: server.getPort(), peerType: "test"})
await client.connect()

client.onBroadcast((message) => console.log("received:", message))
client.publish({channel: "frontend-models", broadcastParams: {model: "Build"}, body: {action: "create", id: "1"}})

await client.close()
await server.stop()
```
