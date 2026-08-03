Add signed peer-forwarding provenance validation and routed replay conflict results

- `LocalMutationLog.append` rejects an envelope whose embedded `signedMutation.mutation` does not structurally match the outer `mutation`, preserving the original signer's certificate/provenance instead of re-signing with local credentials.
- `SyncEnvelopeReplayService` supports an optional `conflictStrategy` for routed upserts with `optimisticVersion` (default when `strategy` is omitted) and `serverWins`; unsupported strategies fail fast at construction time. Stale `baseVersion` mutations return a structured `syncState: "conflict"` result without persisting, broadcasting, or emitting change-feed events.
- Replay conflict checks and routed upsert saves are serialized per resource identity through a deterministic, MySQL-safe advisory-lock name using a dedicated lock connection to avoid same-session re-entrancy.
- Record advisory-lock helpers accept `{dedicatedConnection: true}` to acquire the lock on a spawned dedicated session while the callback runs on the caller/model connection.
- Authoritative field-level convergence remains a separate follow-up; these changes provide the server-side replay contract and atomicity needed for client conflict handling.
