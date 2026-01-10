# Changelog

## Unreleased
- Fix base-model generation to use the current database connection when reading table columns, avoiding SQLite "No connection" errors.
- Fix base-model generation to honor the configured project directory instead of always using the current working directory.
