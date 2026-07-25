# Changelog

- Add real in-flight query cancellation to the MySQL/MariaDB driver: raw `query(sql, {signal})`, model-query `.signal(signal)`, and `Tenant.aggregateAcross({signal})` run on a dedicated pooled connection and, when the `AbortSignal` fires, issue `KILL QUERY` to release the statement's server-side resources immediately, destroy the client connection (discarding it from the pool), and reject with a new `QueryAbortedError`. Cancellation also covers pool-checkout waits, resets connection-scoped state, and is terminal so a deliberately-cancelled query is never retried.
