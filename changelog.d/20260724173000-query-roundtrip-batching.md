Reduce sequential database roundtrips by batching structurally compatible
`withCount` and `queryData` aggregates while preserving scopes, predicates,
alias overwrite order, transaction snapshots, and single-connection pool
behavior.
