Add AwesomeTasks offline sync proof

- Generic offline Task create/update and Comment create via routed frontend-model resources and `writableAttributes` permit lists.
- Domain-command dispatch in `SyncEnvelopeReplayService`, with a `TaskBoard.moveCard` proof that resolves column ordering safely and emits a change-feed row.
- `SignedSyncEnvelopeReplayService` for long-offline and peer-forwarded signed mutations authenticated by device certificates and offline grants.
