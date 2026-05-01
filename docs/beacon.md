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

`connectBeacon()` is idempotent. The first call opens the JsonSocket
and resolves once the broker accepts the hello handshake — or, if the
broker is unreachable, logs a warning and returns the client anyway so
publishing can keep falling back to local-only delivery while
reconnects continue in the background.

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
