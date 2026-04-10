## Fixed

- MSSQL driver `_rollbackTransactionAction` now issues a raw `IF @@TRANCOUNT > 0 ROLLBACK` directly on the underlying connection instead of going through the `mssql.Transaction` object. This handles both the normal case (transaction is alive, ROLLBACK succeeds) and the aborted case (SQL Server already killed the transaction, `@@TRANCOUNT` is 0, the IF guard makes it a no-op). Previously the `mssql.Transaction.rollback()` wrapper would throw a `TransactionError` when the server-side transaction was already dead, leaving the connection poisoned for the next caller.
- Base driver `rollbackTransaction` now decrements `_transactionsCount` in a `finally` block so the counter always returns to its pre-transaction value, even when the rollback action throws.
- MSSQL driver `_rollbackTransactionAction` now nulls `_currentTransaction` in a `finally` block so the reference is always cleared.
