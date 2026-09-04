- Add a platform-neutral synchronized asset cache with SHA-256 verification,
  persistent retry and interrupted-download recovery, digest deduplication,
  account isolation, eager/on-demand fetching, and durable-aware LRU eviction.
- Keep synchronization readiness scoped to the reconciled descriptor set,
  recover metadata persistence after transient adapter failures, and delete
  unreferenced blobs after concurrent downloads finish.
- Hash attachment bytes in fixed-size blocks and persist unconfirmed blob
  deletions so transient adapter failures are retried.
- Reject immutable descriptor digest, byte-size, and content-type conflicts
  before mutating cache state and protect blobs from deletion or eviction
  throughout active cache lookup and download operations.
- Serialize per-digest deletion with new cache activity, recheck live retention
  and LRU metadata before eviction, and keep late callers on the same failed
  download while persisting retry metadata for every participating descriptor.
- Retain each digest's protection through its eager processing, enforce cleanup
  between digest groups, and release every remaining incoming digest when one
  pending-deletion finalizer fails.
- Persist descriptor reconciliation before exposing it through shared cache
  state, retaining the last committed descriptors after a rejected write while
  preserving queued deletion work across an earlier persistence rollback.
- Return `null` instead of a deleted local URI when concurrent synchronization
  removes the requested descriptor's final scope reference during resolution.
- Attempt each eager digest once per synchronization, propagate its result to
  every grouped descriptor, and reject conflicting byte sizes for shared
  digests before committing descriptor state.
- Re-enforce the cache byte budget after concurrent on-demand downloads release
  their digest guards, revalidate selected blobs before returning resolved
  URIs, rerun cleanup after cached-resolution guards release, and reject
  conflicting content types for shared digests. Follow protected on-demand
  cleanup with an unprotected pass so durable bytes cannot leave a newly
  downloaded evictable blob over the combined budget, and evict cached
  all-evictable digests that individually exceed the budget.
