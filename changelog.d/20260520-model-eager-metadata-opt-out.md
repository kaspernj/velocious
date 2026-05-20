## Model metadata eager-load opt-out

- Added `Record.setEagerLoadRecordMetadata(false)` so individual model classes can be registered during require-context initialization without loading table and column metadata until first use.
