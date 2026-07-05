# Changelog

- Add `DataCopier.deleteTenantRows(keyValue)` — deletes a tenant's rows from the target database (children-first, under disabled foreign keys, in one transaction) and returns the deleted rows keyed by table name, so apps can purge a tenant's global-DB rows without reimplementing the table-plan traversal.
- Stop generating the dead `src/frontend-models/index.js` barrel from `generate:frontend-models`; nothing imports it (models are imported by file path and `setup.js` performs the registration side-effects). A pre-existing `index.js` is removed on regeneration. `setup.js` is unchanged.
