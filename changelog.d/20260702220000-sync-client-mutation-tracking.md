# Changelog

- Add automatic mutation tracking to `SyncClient`: resources with `track` enabled register model lifecycle callbacks on `start()` so local creates/updates/destroys queue pending sync rows (with the declared local-only stripping, boolean coercion, and syncType/trackedData mapping) and schedule an immediate online-gated replay — no app-side queue calls. Records written by pull-apply are excluded via echo suppression, and `stop()` unregisters all tracking callbacks.
- Add `VelociousDatabaseRecord.unregisterLifecycleCallback(callbackName, callback)`.
- `SyncApiClient.resourceApplier`/`applyResourceSync`/`destroySyncedResource` accept an optional `onRecord` hook tagging records for the duration of a remote apply.
