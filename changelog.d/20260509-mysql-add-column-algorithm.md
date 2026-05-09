Fix MySQL/MariaDB add-column migrations to use an in-place alter algorithm so adding nullable columns to parent tables with child foreign keys does not fall back to a copy/rebuild path.
