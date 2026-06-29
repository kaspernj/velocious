## Changed

- `Tenant.with` and `Current.withTenant` are now generic (`@template T`): they infer and return the callback's resolved value type instead of `Promise<unknown>`. Consumers that switch into a tenant and return a typed value from the callback no longer need a cast at the call site.
