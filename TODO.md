# TODO

- Document frontend vs backend model API differences:
  - Frontend models use `sort(...)` for ordering; backend models use `order(...)`.
  - Frontend models expose a narrower query surface (mainly `find`, `findBy`, `findByOrFail`, `toArray`, `where`, `sort`, `count`) and do not expose the full backend query API (`joins`, `group`, `limit`, `distinct`, `findOrCreateBy`, etc.).
  - Frontend model commands are resource-mapped; `toArray()` calls the configured `index` command, which may map to a backend command name like `list` instead of literal `index`.
  - Frontend models are HTTP/resource-transport based; backend models run against direct database model/query APIs.
