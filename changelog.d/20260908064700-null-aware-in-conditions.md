Add explicit `{in: [...]}` ORM column conditions with null-aware membership,
local AND-safe grouping, empty-list falsehood, complete negation, model type
normalization and MSSQL text casting. Preserve direct-array behavior and nested
relationship/table ambiguity boundaries; reject malformed descriptors without
mutating caller inputs. See `docs/query-filtering.md`.
