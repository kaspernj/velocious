# API manifest endpoint

Add an opt-in `apiManifest` configuration that exposes a built-in endpoint
describing every registered frontend-model resource as human- and
machine-readable JSON (`GET /api/manifest` or a custom path, optionally
hidden behind a bearer token). The manifest includes model names, resource
paths, attributes, relationships, attachments, abilities, built-in commands,
custom commands with typed arguments and return types, and sync metadata.

The endpoint is disabled by default. Enable with `apiManifest: true`,
protect with a custom path (`apiManifest: {path: "/internal/manifest"}`),
or hide behind a bearer token (`apiManifest: {token: "secret"}`).
