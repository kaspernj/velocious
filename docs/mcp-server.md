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

## Running it

```sh
npx velocious mcp
```

The command boots your application (config resolution, models, database
connections) without starting the HTTP server, then serves line-delimited
JSON-RPC over **stdin/stdout** — the primary MCP transport for local tool
servers. Supported methods: `initialize`, `ping`, `tools/list`, `tools/call`,
and `notifications/*` (protocol version `2025-03-26`).

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

- **Stdio only.** HTTP/SSE transport is out of scope for v1.
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
| JSON-RPC / stdio transport | `src/mcp/json-rpc-server.js` |
| CLI entry (`velocious mcp`) | `src/cli/commands/mcp.js`, `src/environment-handlers/node/cli/commands/mcp.js` |
| Specs | `spec/mcp/` |
