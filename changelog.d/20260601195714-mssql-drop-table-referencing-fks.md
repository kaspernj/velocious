## Fixed

- MSSQL `dropTable` now drops the foreign-key constraints that reference a table before dropping the table itself. MSSQL refuses to drop a table that is still referenced by a FOREIGN KEY constraint even when constraints are disabled via `NOCHECK`, so dropping tables in an arbitrary order (for example wiping a whole schema before a fresh `db:migrate`) previously failed with `Could not drop object '<table>' because it is referenced by a FOREIGN KEY constraint` and left a partially-dropped schema behind.
