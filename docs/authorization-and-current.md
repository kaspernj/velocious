# Authorization, Current, and Accessible Scopes

## Ability source
- `.accessible()` should use the current ability from `Current` (AsyncLocal context based), not require passing ability every call.
- `.accessibleBy(ability)` should remain available for explicit ability scoping.

## Controller usage
- Controllers should load records through accessible scopes for index/find/update/destroy/create flows where applicable.
- Avoid frontend-specific controller code paths for model initialization.

## Current object behavior
- Ability context must be async-safe and request-scoped.
- Tenant context must be async-safe and request-scoped.
- Nested/parallel request execution must not leak ability state across contexts.
- Nested tenant overrides must not reuse pinned connections from a different tenant-resolved database config.

## Tenant and elevator hooks
- `configuration.tenantResolver(...)` can resolve a request-scoped tenant object from request params, websocket subscriptions, or other request metadata.
- `configuration.tenantDatabaseResolver(...)` can override a configured database identifier per resolved tenant.
- `configuration.runWithTenant(tenant, callback)` and `Current.tenant()` expose the active tenant for custom model/database routing.
- Model classes can declare tenant-aware database routing with `ModelClass.switchesTenantDatabase(...)` instead of overriding `getDatabaseIdentifier()` manually.
- HTTP routes and websocket subscriptions/events run inside the resolved tenant context before abilities and controller/channel code execute.

## Failure mode
- Calling accessible loaders without an available ability should raise clearly.
