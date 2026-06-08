# HTTP Server

Velocious serves HTTP requests through worker handlers. The default is one
worker, which keeps development and small deployments predictable. Applications
that need more request or websocket throughput can opt into multiple workers.

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
