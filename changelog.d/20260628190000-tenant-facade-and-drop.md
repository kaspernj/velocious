## Added

- Added the apartment-style `Tenant` runtime façade (`src/tenants/tenant.js`): `Tenant.with(tenant, callback)` / `Tenant.current()` for switching into and reading a tenant context, `Tenant.each({identifier, callback, parallel?, filter?})` for running a callback within every provider-listed tenant, and `Tenant.drop({identifier, tenant})` for dropping one tenant's database through the provider's `dropDatabase` hook (with an active-database guard so an unresolved tenant can never drop the base/template database).
- Added the `db:tenants:drop` CLI command, wiring the previously-unused `dropDatabase` tenant database provider hook.
- Extracted the shared `TenantIterator` so the `db:tenants:*` commands and the `Tenant` façade run per-tenant work through one implementation.
