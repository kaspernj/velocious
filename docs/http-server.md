# HTTP Server

Velocious serves HTTP requests through worker handlers. The default is one
worker, which keeps development and small deployments predictable. Applications
that need more request or websocket throughput can opt into multiple workers.

## File Responses

Controllers can stream a file without loading it into memory:

```js
this.sendFile(reportPath, {
  contentType: "application/pdf",
  status: 200,
  onFinished: async (result) => {
    if (result === "completed") await removeTemporaryReport(reportPath)
  }
})
```

`onFinished` is optional and receives `"completed"` after the local socket
pipeline has accepted every file byte, or `"aborted"` when the socket closes,
the socket reports an error, the file cannot be read, or the server shuts down.
It runs once in the same worker or in-process context as the controller and may
return a promise. The response queue waits for that promise before advancing to
the next response. Callback exceptions and rejections are logged and reported
as framework errors, but cannot replace the response that was already committed
to the socket. Setting a response body or replacing the file response clears the
previous callback.

Worker-mode file responses cross the worker boundary as path descriptors only.
The main thread opens and streams the file with socket write/drain backpressure;
file contents are neither buffered in full nor sent as IPC byte chunks. Response
headers, file data, and later pipelined responses retain their original queue
order. Bodyless status responses preserve their existing no-body and
no-`Content-Length` behavior while still settling `onFinished` after the parent
acknowledges the response.

## Response Compression

Buffered HTTP responses can be compressed with Brotli (`br`) or gzip. Compression
is opt-in and disabled by default:

```js
const configuration = new Configuration({
  httpServer: {
    compression: true
  }
})
```

`true` enables compression with the documented defaults. An object enables it
with overrides; unknown keys and out-of-range values are rejected:

```js
const configuration = new Configuration({
  httpServer: {
    compression: {
      threshold: 1024, // Minimum buffered body size in bytes (default 1024)
      brotliQuality: 4, // Brotli quality 0-11 (default 4)
      gzipLevel: 6 // Gzip level 0-9 (default 6)
    }
  }
})
```

The normalized configuration is available via
`configuration.getHttpServerCompression()`.

### Negotiation

The server parses `Accept-Encoding` case-insensitively with q-values, wildcards,
and identity semantics. Q-values follow the RFC grammar strictly (`0` or `1`
with at most three fractional digits, only zeros after `1`); malformed values
such as `.5`, `01`, `1.001`, or `0.1234` count as `q=0`. Identity participates
in the same quality comparison as the supported codings: a higher-q identity
selects identity (for example `gzip;q=0.5, identity;q=1` sends uncompressed),
and equal-q ties break in server order `br`, `gzip`, `identity`. An explicit
coding entry beats the wildcard, and a missing or empty header selects identity.

When compression is enabled and the response does not already carry an
application-supplied `Content-Encoding`, the server never emits an identity
representation the client forbade. If no acceptable representation can be sent —
identity is forbidden (`identity;q=0`, or `*;q=0` without an identity entry) and
either no supported coding is acceptable or the transformation is skipped (see
Exclusions below) — the server answers with an empty `406 Not Acceptable`. When
identity is forbidden but a supported coding is acceptable and the response is a
compression candidate, the size threshold never forces an unacceptable identity
representation — the body is compressed regardless of size. Responses with an
application-supplied `Content-Encoding` are always passed through unchanged, and
a globally disabled compression configuration never negotiates (backward
compatible).

Compressed responses carry `Content-Encoding` and the exact compressed
`Content-Length`, and `Accept-Encoding` is merged into `Vary`
case-insensitively without duplicates (an existing `Vary: *` is preserved).
Bodies below `threshold` are sent as identity when identity is acceptable.
Compression uses only asynchronous `node:zlib` APIs, so event-loop ordering of
pipelined responses is preserved.

### Exclusions

Only buffered string and `Uint8Array` responses are candidates. Transformation
is skipped for:

- `sendFile` streamed responses (they are never buffered for compression)
- responses that already carry a `Content-Encoding`
- `Cache-Control: no-transform`
- `text/event-stream` (server-sent events)
- `206` partial responses, requests with a `Range` header, and responses with a
  `Content-Range` header
- bodyless statuses (1xx, 204, 304)
- responses without an allowlisted `Content-Type`

A skipped transformation is still sent as identity when the client accepts
identity. When the client forbids identity and the transformation is skipped
(other than for an application-supplied `Content-Encoding`, which always passes
through), the server answers with the same empty `406 Not Acceptable`, because
no acceptable representation can actually be sent.

The compressible content-type allowlist is conservative: `text/*` (except
`text/event-stream`), `application/json` and `*+json`, `application/xml` and
`*+xml`, JavaScript (`application/javascript`, `application/x-javascript`,
`application/ecmascript`), and `image/svg+xml`. Unknown binary types and
commonly pre-compressed media (images, video, archives) are never transformed.

Controllers can opt out per response:

```js
this.response().disableCompression()
```

### HEAD requests

HEAD responses select and compute the same representation headers as the
equivalent GET — including `Content-Length` and any negotiated
`Content-Encoding` — but emit no buffered or file body.

### Considerations

Compression buffers the whole body (which buffered responses already are) and
spends CPU per request; keep the default Brotli quality 4 / gzip level 6 unless
measurements say otherwise, and raise `threshold` if small responses dominate.
Representation validators (`ETag`, `Digest`) remain application-owned: the
server does not rewrite them when it compresses, so applications that set
validators must account for content codings themselves. Responses compressed
with `br`/`gzip` are safe against compression-oracle concerns only when the
application does not reflect secrets alongside attacker-controlled input —
use `disableCompression()` for such endpoints.

## CLI Workers

Start a server with a fixed worker count:

```bash
npx velocious server --host 127.0.0.1 --port 3006 --workers 4
```

`--workers` must be a positive integer. Each incoming socket is assigned to the
next worker in round-robin order. Websocket broadcasts still use the configured
cross-worker broadcast bus, so channels can publish from one worker and deliver
to subscribers hosted by another worker.

CLI arguments override `configuration.httpServer` values. When neither the CLI
nor the configuration supplies a value, the CLI defaults to `127.0.0.1:3006`.

## Configuration Workers

Applications can keep server defaults in their Velocious configuration:

```js
const configuration = new Configuration({
  httpServer: {
    host: "127.0.0.1",
    port: 3006,
    workers: 4
  }
})
```

This is the preferred place for application-owned defaults such as production
worker counts.

## Application Workers

Code that starts `Application` directly can pass the same option through the
HTTP server config. These values override `configuration.httpServer`:

```js
const application = new Application({
  configuration,
  httpServer: {
    host: "127.0.0.1",
    port: 3006,
    workers: 4
  },
  type: "server"
})
```

`maxWorkers` remains accepted as a compatibility alias when `workers` is not
provided, but new code should use `workers` because it describes the actual
number of handlers started.

## Server Lock

Starting an application HTTP server creates a lock directory at
`tmp/server.lock` under the configured application directory. The lock is
acquired before Beacon connects, before workers start, and before the TCP socket
binds, so a second server for the same app fails fast instead of partially
starting and then racing on the port.

The lock directory contains `owner.json` with the owning PID, host, port,
hostname, and acquisition time. Normal shutdown removes the lock. If a process
dies without cleanup, the next startup removes the stale lock when the metadata
names a dead local PID; locks owned by another host or locks without readable PID
metadata are left in place and should be removed manually only after confirming
no server is running.
