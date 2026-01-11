# Changelog

- Fix base-model generation to use the current database connection when reading table columns, avoiding SQLite "No connection" errors.
- Fix base-model generation to honor the configured project directory instead of always using the current working directory.
- Fix background job status reporting timeout to use milliseconds so network round trips are not prematurely aborted.
- Move background job CLI commands into the Node environment handler so browser builds avoid Node-only imports.
- Add README examples for configuring CLI command loading in Node and browser environments.
- Add browser system test runner and browser-safe test app harness for System Testing.
- Add dummy-tag handling for browser tests with a SQLite web driver setup.
- Add a Peakflow build step for browser system tests.
- Fix dummy helper path resolution when running tests from spec/dummy.
- Normalize dummy helper path resolution to avoid trailing-slash mismatches.
- Run dummy migrations for browser tests instead of loading structure SQL.
- Enable browser coverage for preloader belongs-to and has-many record specs.
- Enable browser coverage for database query specs.
- Enable browser coverage for migration specs that use dummy models.
- Enable browser coverage for utility specs.
