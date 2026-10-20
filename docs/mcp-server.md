# MCP Server (`velocious mcp`)

Velocious can expose every registered frontend-model command — built-in
collection/member commands (`index`, `find`, `create`, `update`, `destroy`) and
custom `collectionCommands`/`memberCommands` — as [Model Context Protocol
(MCP)](https://modelcontextprotocol.io) tools, so AI clients can discover and
invoke your application's frontend-model API directly.

The MCP layer is a thin adapter over the existing seams:

- Tool definitions are generated from the same API manifest that
  `apiManifest: true` publishes (see [docs/api-manifest-endpoint.md](api-manifest-endpoint.md))
  — one tool per exposed command, with JSON Schemas derived from the manifest's
  typed command arguments.
- Tool calls are dispatched through `FrontendModelController.frontendApi()` in
  process, exactly like the shared `/frontend-models` endpoint. Tenancy, the
  app's `abilityResolver`, validation, and error envelopes all apply unchanged
  — MCP never bypasses them.

## Transports

Velocious serves MCP over two transports that share the same tool generation
and dispatch layer:

- **stdio** via `npx velocious mcp` — the primary transport for local tool
  servers (Claude Desktop, Hermes, etc.).
- **HTTP** via the built-in endpoint `mcp: true` in your configuration — the
  same JSON-RPC methods served by your application's own HTTP server, no
  separate process.

### stdio: `velocious mcp`

```sh
npx velocious mcp
```

The command boots your application (config resolution, models, database
connections) without starting the HTTP server, then serves line-delimited
JSON-RPC over **stdin/stdout**. Supported methods: `initialize`, `ping`,
`tools/list`, `tools/call`, and `notifications/*` (protocol version
`2025-03-26`).

### HTTP: `mcp: true`

```js
// src/config/configuration.js
export default new Configuration({
  // ...
  mcp: true, // serves JSON-RPC at POST /mcp on the application's HTTP server
  // or: mcp: {path: "/internal/mcp", token: "<bearer-token>"}
})
```

Every MCP request is one `POST` with a JSON-RPC message body; the JSON-RPC
response is returned as `application/json` (notifications get `202` with an
empty body). When `token` is configured, requests must carry
`Authorization: Bearer <token>` or they are not routed at all (404), so the
endpoint stays hidden — same convention as `apiManifest` and `debugEndpoint`.

The request's `Authorization` header is forwarded as the request-context
`authorization` key into every tool call, so your app's `abilityResolver`
authenticates MCP-over-HTTP calls exactly like regular frontend-model calls.
Tenant and ability resolution still happen per command inside
`FrontendModelController.frontendApi()` — the HTTP transport never bypasses
them.

#### Request body handling

The HTTP transport reads the JSON-RPC envelope from **parsed** request params, so
the framework owns body parsing for this endpoint — apps need no MCP-specific
request-body configuration:

- The MCP path rejects `mode: "raw"` policies with an actionable configuration
  error. A raw-mode `httpServer.requestBodyPolicyResolver` entry skips JSON
  parsing, so `params` would be empty and every message would answer
  `-32600 Invalid Request`. Do not add one.
- When neither `httpServer.maxRequestBodyBytes` nor a resolver limit applies,
  MCP request bodies are capped at **1 MiB** by default. Raise
  `httpServer.maxRequestBodyBytes` if your tool arguments legitimately exceed
  that; the endpoint still requires parsed mode.

### Tool naming

Tools are named `<model>_<command>` in snake_case:

| Command                     | Tool name example              |
| --------------------------- | ------------------------------ |
| Collection `index`          | `task_index`                   |
| Collection `create`         | `composite_task_create`        |
| Member `find`               | `task_find_by_id`              |
| Member `update`             | `task_update_by_id`            |
| Member `destroy`            | `task_destroy_by_id`           |
| Custom command              | `user_lookup_by_email`         |

Member built-ins carry the `_by_id` suffix to keep names collision-free.
Additionally, the meta tool `frontend_model_api_manifest` returns the raw API
manifest so a client can discover the full API shape in one call.

### Authentication / request context

MCP tool calls carry no HTTP request, so the caller's identity is provided as
a **remote request context** that is forwarded into every dispatch and
resolved by your app's own `abilityResolver` (see
[docs/remote-request-context.md](remote-request-context.md)):

```sh
npx velocious mcp --request-context authorization="Bearer <service-token>"
```

or, for richer values, the `MCP_REQUEST_CONTEXT` environment variable with a
JSON object:

```sh
MCP_REQUEST_CONTEXT='{"authorization":"Bearer <service-token>"}' npx velocious mcp
```

When the context carries an `authorization` key, it is also forwarded as the
`Authorization` header of the synthetic in-process request, so apps whose
`abilityResolver` authenticates from request headers (Bearer service tokens or
personal access tokens) authenticate MCP tool calls exactly like HTTP calls.

Denied commands surface as MCP tool results with `isError: true` and the
dispatcher's error message — the same authorization behavior as the web app.

## Client configuration example

For any MCP client that supports stdio servers (Claude Desktop, Hermes, etc.):

```json
{
  "mcpServers": {
    "my-app": {
      "command": "npx",
      "args": ["velocious", "mcp"],
      "env": {"MCP_REQUEST_CONTEXT": "{\"authorization\":\"Bearer <token>\"}"}
    }
  }
}
```

Run it from your application directory so the CLI resolves your configuration.

## Scope notes (v1)

- **Transports.** stdio (`velocious mcp`) and HTTP (`mcp: true`) are both
  supported; SSE/streamable-HTTP transport is out of scope for v1.
- **Attachments.** `attach`/`download` commands are exposed as tools but
  binary payloads (base64) are a follow-up.
- **Errors.** Dispatcher and validation errors are surfaced faithfully as MCP
  error results (`isError: true` with the original error envelope in the text
  content) — nothing is swallowed.

## Implementation map

| Piece | Location |
| ----- | -------- |
| Manifest → MCP tool generation | `src/mcp/manifest-tools.js` |
| `tools/call` → `frontendApi` dispatch | `src/mcp/dispatcher.js` |
| JSON-RPC method handling | `src/mcp/json-rpc-server.js` |
| stdio transport | `src/mcp/json-rpc-server.js` (`startMcpStdioServer`) |
| HTTP transport (`mcp: true`) | `src/routes/built-in/mcp/controller.js`, route hook in `src/configuration.js` |
| CLI entry (`velocious mcp`) | `src/cli/commands/mcp.js`, `src/environment-handlers/node/cli/commands/mcp.js` |
| Specs | `spec/mcp/` |
