# Per-tenant test shared-connection lookup

`getCurrentConnection` now consults the per-tenant test shared-connection providers
(`registerTestSharedConnectionProvider`) before falling back to the async-context
connection. The provider `matches()` callback is evaluated against the live tenant
context, which is established during route resolution — after the request-runner
installs the async connection context. This lets a test run enroll more than one
tenant on a single database pool and route each tenant's in-request queries to its
own enrolled connection. When no per-tenant provider is registered (the production
case), behavior is unchanged.
