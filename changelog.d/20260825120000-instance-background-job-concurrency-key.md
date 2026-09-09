Background jobs can derive durable concurrency keys from a hydrated job instance by overriding `concurrencyKey()` and reading `backgroundJobContext()`; explicit enqueue options take precedence.
