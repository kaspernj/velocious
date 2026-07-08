# API Manifest Endpoint

Velocious can expose a built-in endpoint that describes every registered
frontend-model resource: attributes, relationships, attachments, abilities,
commands (built-in and custom with typed arguments and return types), sync
metadata, and resource paths. It is disabled by default and must be enabled
explicitly in configuration:

```js
const configuration = new Configuration({
  apiManifest: true
})
```

The default endpoint is `GET /api/manifest`. It returns pretty-printed JSON
that is both human-readable and machine-parseable:

```json
{
  "formatVersion": 1,
  "resources": {
    "Build": {
      "modelName": "Build",
      "path": "/builds",
      "primaryKey": "id",
      "attributes": ["commitSha", "createdAt", "durationLabel", "id", "name", "status"],
      "abilities": { ... },
      "builtInCommands": {
        "collection": { "create": "create", "index": "index" },
        "member": { "destroy": "destroy", "find": "find", "update": "update" }
      },
      "commands": {
        "member": [
          {
            "methodName": "restart",
            "scope": "member",
            "path": "/builds/<id>/restart",
            "args": [],
            "returnType": "{build: Build, status: \"ok\"}"
          }
        ]
      }
    }
  }
}
```

## Custom command metadata

Custom commands declared as `{name, args?, returnType?}` objects include their
typed arguments and declared return type in the manifest:

```json
{
  "methodName": "searchByEmail",
  "scope": "collection",
  "path": "/users/search-by-email",
  "args": [{"name": "email", "type": "string"}],
  "returnType": "{found: boolean}"
}
```

## Custom path

```js
const configuration = new Configuration({
  apiManifest: {path: "/internal/api-manifest"}
})
```

## Token protection

When the manifest should be hidden from public traffic, configure an
unguessable bearer token:

```js
const configuration = new Configuration({
  apiManifest: {token: "unguessable-secret-token"}
})
```

Requests without a matching `Authorization: Bearer <token>` header receive
404, so the endpoint's existence stays hidden. The token is never included
in the manifest payload or debug snapshots.

## Manifest contents

The manifest is deterministic — models are sorted alphabetically, attributes
are sorted, and commands are sorted by method name. It includes only
frontend-safe metadata. Backend-only details such as server callbacks,
backend project paths, and secrets are never included.

- **formatVersion** — manifest schema version (currently `1`)
- **resources** — one entry per registered frontend-model resource model:
  - `modelName` — frontend model name
  - `path` — kebab-case resource path used in `commandType` / `customPath` requests
  - `primaryKey` — primary key attribute name (defaults to `"id"`)
  - `attributes` — sorted list of exposed attribute names
  - `relationships` — declared relationship names (when any)
  - `attachments` — attachment definitions with cardinality (when any)
  - `abilities` — per-resource ability map including default CRUD actions
  - `builtInCommands` — collection and member built-in command slugs
  - `commands` — custom collection and member command entries (method name, scope, path, typed args, return type)
  - `sync` — sync policy metadata when the resource is sync-enabled

## Common use cases

- API documentation: humans can read `GET /api/manifest` to discover all
  available frontend-model commands, relationships, and attributes.
- Tooling / AI workers: clients can fetch the manifest at startup to
  discover resource paths and command contracts before building requests.
