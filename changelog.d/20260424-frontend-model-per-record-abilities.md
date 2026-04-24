# Per-record ability checks via `.abilities(...)`

- Add `FrontendModelQuery#abilities(spec)` so the frontend can ask the
  backend to evaluate one or more ability actions against each
  returned record, and ship the per-record results back for
  `record.can(action)` reads. Supports the flat-array shorthand
  (applies to the query's own model class) and the keyed
  `{ModelName: [action, ...]}` form — the keyed form also walks
  preloaded relationships of any depth, so a single
  `.preload("timelogs").abilities({Timelog: ["update", "destroy"]})`
  request attaches results to every preloaded child without per-row
  round trips. The backend evaluates each (modelClass, action) pair
  as a single `accessibleFor(action).where({id: IN (ids)}).pluck("id")`
  batched check, regardless of how many records were loaded.
- Available on `find`, `findBy`, and `toArray` — the spec rides the
  same wire format used by `withCount` and `queryData`. Results are
  read on the frontend via `record.can(action)`, and default to
  `false` for actions that weren't requested (so UI code can branch
  on `record.can("update")` without guarding against an unloaded
  value).
- Backend enforcement is unchanged: the existing
  `abilities.update/destroy/...` resource config still gates the
  underlying commands. `.abilities(...)` is purely a read-side API
  for the UI to know which buttons to show; the actual
  authorization still runs on every mutation.
