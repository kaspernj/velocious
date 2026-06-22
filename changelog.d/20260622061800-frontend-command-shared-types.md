## Frontend Model Command Shared Types

- Preserved frontend-resolvable shared DTO imports when generating custom command return and argument types from backend resource method JSDoc.
- Rejected backend-local `ReturnType<typeof helper>` command types with a clear generator error so resources publish a real shared command contract.
