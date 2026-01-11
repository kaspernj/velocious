# Changelog

- Fix base-model generation to use the current database connection when reading table columns, avoiding SQLite "No connection" errors.
- Fix base-model generation to honor the configured project directory instead of always using the current working directory.
- Fix background job status reporting timeout to use milliseconds so network round trips are not prematurely aborted.
- Avoid loading browser-incompatible CLI command modules unless a commands require-context callback is provided.
