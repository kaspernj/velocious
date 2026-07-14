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
