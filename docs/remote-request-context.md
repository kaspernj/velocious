# Remote request context

Velocious can attach a small immutable request context to client transport operations so an application can resolve a remote tenant before it opens tenant-scoped database connections. This is intended for opaque routing facts such as a project id and routing epoch; it is not authentication or authorization.

## Frontend-model operations

Configure a synchronous context resolver on the frontend-model transport:

```js
FrontendModelBase.configureTransport({
  requestContext: () => ({
    projectId: currentProjectRoute.projectId,
    routingEpoch: currentProjectRoute.routingEpoch
  }),
  url: "https://api.example.test"
})
```

Velocious invokes `requestContext` synchronously when each CRUD or custom command begins and when each frontend-model event or public `subscribeWebsocketChannel(...)` subscription is created. It copies, validates, sorts, and freezes the returned scalar object immediately. Changing the source object or switching the active project afterward cannot retarget that operation.

Shared frontend-model batches retain a separate captured context on every entry. The backend validates each entry, merges its context into that entry's command params, and resolves the tenant and ability inside that context. Two project operations queued in the same microtask therefore remain independent. Frontend-model event subscriptions are partitioned by model and captured context; reconnect and framework resubscribe reuse the original snapshot instead of consulting a later active-project value.

## Sync clients

Pass fixed context when constructing each project-owned sync client:

```js
const client = SyncClient.fromConfiguration(configuration, {
  databaseIdentifier: "projectTenant",
  requestContext: {
    projectId: route.projectId,
    routingEpoch: route.routingEpoch
  },
  tenantHandle
})
```

The constructor captures one frozen snapshot for that client. Velocious adds it to every `/changes` pull, `/replay` request, derived framework sync-channel subscription, reconnect catch-up pull, and later unsubscribe/resubscribe cycle. Concurrent clients never read a shared mutable context, so they cannot exchange tenant routing params.

## Validation and ownership

Context must be a plain object. Keys must be non-blank and may not be `__proto__`, `constructor`, or `prototype`. Values must be strings, finite numbers, or booleans; arrays, nested objects, functions, `null` values, `NaN`, and infinities fail closed. Context keys may not collide with framework fields or operation payload keys. Velocious validates on the client and validates untrusted frontend-model batch context again on the server.

The application tenant resolver receives context as ordinary top-level params. It must authenticate the caller and validate routing facts against its authoritative control plane before returning a tenant descriptor. A client-supplied project id or epoch is routing input, never proof of access.

Applications that omit `requestContext` keep the existing wire shapes and unscoped behavior. This contract does not enable tenant routing, migrate data, select a fallback database, or change the application's tenant resolver configuration.
