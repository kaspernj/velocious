Add default tenant-database provisioning so `db:tenants:create`, `db:tenants:drop`
and `Tenant.drop` work without each app reimplementing it. When a tenant-database
provider does not define `createDatabase`/`dropDatabase`, the framework now uses a
built-in driver-agnostic default (`src/tenants/default-tenant-database-provisioning.js`):
file-backed drivers (sqlite) create the database by ensuring the tenant connection
and treat drop as a no-op, while server drivers (mysql, pgsql, …) connect to the
configured maintenance database (`useDatabase`) and run the driver's own
`createDatabaseSql`/`dropDatabaseSql` after validating the tenant database name.
Providers can still override either hook for custom provisioning.
