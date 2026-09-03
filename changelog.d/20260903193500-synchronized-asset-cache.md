- Add a platform-neutral synchronized asset cache with SHA-256 verification,
  persistent retry and interrupted-download recovery, digest deduplication,
  account isolation, eager/on-demand fetching, and durable-aware LRU eviction.
- Keep synchronization readiness scoped to the reconciled descriptor set,
  recover metadata persistence after transient adapter failures, and delete
  unreferenced blobs after concurrent downloads finish.
