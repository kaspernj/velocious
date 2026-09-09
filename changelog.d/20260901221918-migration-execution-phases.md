## Added

- Added fixed `pre-runtime` and `post-publication` migration execution phases,
  with class metadata, optional migrator selection, `db:migrate --phase`, and
  matching tenant migrate/pending selection. Plain migration calls continue to
  run all pending migrations.
