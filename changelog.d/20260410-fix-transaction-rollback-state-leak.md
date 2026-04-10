## Fixed

- MSSQL driver `_rollbackTransactionAction` now nulls `_currentTransaction` in a `finally` block so it is always cleared, even when `rollback()` throws on a dead SQL Server transaction. Previously a failed rollback left the reference dangling, causing the next caller on the same connection to see "A transaction is already running" or route through the savepoint path against a dead transaction.
- Base driver `rollbackTransaction` now decrements `_transactionsCount` in a `finally` block so the counter always returns to its pre-transaction value, even when the rollback action throws.
