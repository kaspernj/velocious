# Changelog

- Fixed app boot for `SyncResourceBase` subclasses on 1.0.494: the new `quickSearchColumns`/`writableAttributes` statics are now registered in the declarative resource-config key allowlist, so `assertKnownResourceStaticConfigProperties` no longer rejects them ("Unknown arguments: quickSearchColumns, writableAttributes").
