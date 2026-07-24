Reduce sequential database roundtrips by batching structurally compatible
`withCount` and `queryData` aggregates while preserving scopes, predicates,
aliases, transaction snapshots, and single-connection pool behavior.
