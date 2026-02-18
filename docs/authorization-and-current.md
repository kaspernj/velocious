# Authorization, Current, and Accessible Scopes

## Ability source
- `.accessible()` should use the current ability from `Current` (AsyncLocal context based), not require passing ability every call.
- `.accessibleBy(ability)` should remain available for explicit ability scoping.

## Controller usage
- Controllers should load records through accessible scopes for index/find/update/destroy/create flows where applicable.
- Avoid frontend-specific controller code paths for model initialization.

## Current object behavior
- Ability context must be async-safe and request-scoped.
- Nested/parallel request execution must not leak ability state across contexts.

## Failure mode
- Calling accessible loaders without an available ability should raise clearly.
