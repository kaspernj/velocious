Preserve Date-typed values in authoritative conflict responses

- `SyncEnvelopeReplayService.serializedRoutedConflictAttributes` now returns resource `<attribute>Attribute(model)` serializer / model accessor results raw instead of normalizing `Date` values to ISO strings, so the normal frontend-model transport serializer can emit its date marker and generated frontend accessors receive a `Date` rather than a string for Date-typed affected fields in the conflict `serverModel`. Only version values used for deterministic comparison (e.g. `serverVersion`) remain normalized to ISO strings.
