# Sync upstream imports

A sync feed is *self-sustaining* when serving it also keeps it fresh: the server runs the upstream import (for example a slow legacy database import) as part of the changes pull, so clients never call a bespoke trigger endpoint before pulling. `SyncUpstreamImporter` (`src/sync/sync-upstream-importer.js`) owns the two generic mechanics that trigger needs — coalescing and throttling — so app code stays a one-line declaration inside the sync resource.

## Using it from a sync resource

`SyncResourceBase` exposes the configuration's shared importer as `syncUpstreamImporter()`. Call it from `authorizeChanges` (which runs on every changes pull and subscription) before the feed is served:

```js
class SyncResource extends SyncResourceBase {
  async authorizeChanges({params, scope}) {
    const event = await this.authorizedEventFor(params, scope) // app authorization as before

    await this.syncUpstreamImporter().import({
      key: `tickets:${event.id()}`,
      throttleMs: 60000,
      importer: async () => await new SyncTicketsFromLegacy().sync({event})
    })
  }
}
```

- **Coalescing**: concurrent calls for the same `key` share one in-flight run — a sign-in burst, a reconnect storm, or several devices pulling at once starts exactly one upstream import, and every caller awaits the same outcome.
- **Throttling**: with `throttleMs`, a call skips the run when the last successful import for the key finished inside the window — frequent background pulls (auto-resync, statistics screens) stay cheap because the feed already holds everything the last import found. Omit `throttleMs` for callers that must always import (for example a legacy explicit-sync endpoint kept for old clients); its successful run still freshens the shared timestamp, so throttled pulls right after it see the feed as fresh.
- **Failures**: a failed run rejects every awaiting caller and never starts the throttle window, so the next call retries the import.

The call resolves `{imported, result}` — `imported` is `false` only when the throttle window suppressed the run, and `result` carries the importer's return value (for example import counts a legacy endpoint must return).

## Sharing one importer

`syncUpstreamImporterForConfiguration(configuration)` returns the per-configuration shared instance, so the sync resource and any legacy trigger endpoint coalesce and throttle together as long as they use the same `key`.
