# Changelog

- Auto-merge resource classes discovered from the app and every registered package into the ability-resources list during `initialize()`, so a package-contributed model's abilities reach frontend-model subscription and per-record authorization automatically. Consuming apps no longer have to hand-register package resources for their websocket subscriptions to authorize.
