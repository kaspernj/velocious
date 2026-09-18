# Route tenant test requests to their enrolled connections

`getCurrentConnection` now replaces a stale request async-context connection with a
matching context-aware test shared-connection provider selected from the live tenant
context. A pinned connection that already matches the tenant's resolved physical
database configuration remains authoritative, including an explicitly fresh
connection created from a suppressed context. A selected provider must return a
connection for that physical configuration or routing fails loudly. Unmatched
contexts and providers returning no connection keep the ordinary active connection
and do not adopt unrelated test-shared fallbacks, while production pools without
these test providers retain their existing behavior.
