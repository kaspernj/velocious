Add explicit `database: false` application support and optional byte limits for
request bodies and buffered responses. Oversized requests receive a
connection-closing 413 before routing, while oversized routed responses are
reported through framework error events and safely return an empty 500.
