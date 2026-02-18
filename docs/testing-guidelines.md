# Testing Guidelines

## Preferred strategy
- Prefer end-to-end/browser integration tests over stub-only tests for frontend-model behavior.
- Validate actual browser-to-backend HTTP behavior using Velocious browser test runner.

## Browser test runner hardening
- Ensure backend app startup/shutdown is guarded with `try/finally`.
- If test framework startup fails, backend server must still stop to avoid leaked open handles.

## Coverage focus for frontend models
- Command URL mapping behavior
- `findBy` and `findByOrFail` real HTTP flows
- Date normalization behavior
- Nested object matching
- Explicit null matching
- Validation rejection for unsupported condition values
