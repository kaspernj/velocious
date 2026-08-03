Add AwesomeTasks offline sync proof

- Generic offline Task create/update and Comment create via routed frontend-model resources and `writableAttributes` permit lists.
- Domain-command dispatch in `SyncEnvelopeReplayService`, with a `TaskBoard.moveCard` proof that resolves column ordering safely and emits a change-feed row.
- `SignedSyncEnvelopeReplayService` for long-offline and peer-forwarded signed mutations authenticated by device certificates and offline grants, enforcing the current sync manifest policy hash and actor/grant-scoped authorization (fail-closed without an `abilityFactory`).
- Member-command envelopes keep the envelope resource id authoritative over a payload `id`.
- MSSQL explicit primary-key inserts (client-generated offline sync ids) through `SET IDENTITY_INSERT` wrapping.
