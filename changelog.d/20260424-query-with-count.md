# Association count support via `.withCount(...)`

- Add `ModelClassQuery#withCount(spec)` and the matching
  `FrontendModelQuery#withCount(spec)` so frontend code can ask the
  backend index query to attach per-row association counts without
  building a custom collection command on the resource. Accepts a
  relationship name, an array of names, or an object form with custom
  attribute names and per-association `where` filters. Counts land on
  each loaded record and are read via a dedicated
  `record.readCount("<name>Count")` helper — kept separate from the
  record's attributes so a virtual count can't silently shadow a real
  column of the same name (e.g. a counter_cache). Has-many only in
  this release; polymorphic has-many is supported.
- Fix pagination chaining: `.page(n).perPage(pp)` and
  `.perPage(pp).page(n)` both now compute LIMIT/OFFSET from the latest
  values of each. Previously only the latter worked — calling
  `page()` before `perPage()` applied a stale default perPage of 30.
