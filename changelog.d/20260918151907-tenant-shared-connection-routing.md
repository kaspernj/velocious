# Route tenant test requests to their enrolled connections

`getCurrentConnection` now selects matching context-aware test shared-connection
providers from the live tenant context before using the request's ordinary async
connection. A matching provider must return a connection for the tenant's resolved
physical database configuration or routing fails loudly. Unmatched contexts and
providers returning no connection keep the ordinary active connection and do not
adopt unrelated test-shared fallbacks, while production pools without these test
providers retain their existing behavior.
