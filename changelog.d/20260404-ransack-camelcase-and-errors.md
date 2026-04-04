## Changed

- Frontend-model `ransack(...)` now accepts both snake_case (`created_at_gteq`) and camelCase (`createdAtGteq`) predicate keys.
- Unknown ransack keys now fail fast with an explicit `Unknown ransack attribute` error when resolving the query key, including for model-level `User.ransack(...)`.
