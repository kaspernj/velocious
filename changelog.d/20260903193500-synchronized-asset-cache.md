- Add a platform-neutral synchronized asset cache with SHA-256 verification,
  persistent retry and interrupted-download recovery, digest deduplication,
  account isolation, eager/on-demand fetching, and durable-aware LRU eviction.
- Keep synchronization readiness scoped to the reconciled descriptor set,
  recover metadata persistence after transient adapter failures, and delete
  unreferenced blobs after concurrent downloads finish.
- Hash attachment bytes in fixed-size blocks and persist unconfirmed blob
  deletions so transient adapter failures are retried.
- Reject immutable descriptor conflicts before mutating cache state and protect
  blobs from deletion or eviction throughout active cache lookup and download
  operations.
- Serialize per-digest deletion with new cache activity, recheck live retention
  before eviction, and count shared download failures once per network attempt.
- Retain digest protection through eager synchronization and release every
  incoming digest when one pending-deletion finalizer fails.
- Preserve deletion markers added concurrently while another marker's
  persistence rollback is pending.
