# changeTable: Recorded Column, Index, and Reference Changes

`Migration#changeTable` applies several schema changes to one table from a single callback, instead of calling the individual `addColumn`, `addIndex`, and `removeColumn` helpers one per line:

```js
import Migration from "velocious"

export default class AddGithubDeliveryJournalColumns extends Migration {
  async up() {
    await this.changeTable("github_delivery_journal_entries", {bulk: true}, (table) => {
      table.datetime("correlated_at", {null: true})
      table.datetime("first_github_check_created_at", {null: true})
      table.string("first_github_check_run_id", {null: true})
      table.string("first_github_check_url", {null: true})
      table.index(["first_github_check_created_at", "received_at"], {name: "index_github_delivery_journal_on_first_check_received"})
      table.index(["first_github_check_run_id"], {name: "index_github_delivery_journal_on_first_check_run"})
      table.index(["received_at"], {name: "index_github_delivery_journal_on_received"})
      table.index(["commit_sha"], {name: "index_github_delivery_journal_on_commit_sha"})
    })
  }

  async down() {
    await this.changeTable("github_delivery_journal_entries", {bulk: true}, (table) => {
      table.removeIndex("index_github_delivery_journal_on_first_check_received")
      table.removeIndex("index_github_delivery_journal_on_first_check_run")
      table.removeIndex("index_github_delivery_journal_on_received")
      table.removeIndex("index_github_delivery_journal_on_commit_sha")
      table.remove("correlated_at", "first_github_check_created_at", "first_github_check_run_id", "first_github_check_url")
    })
  }
}
```

The callback records the operations synchronously, then `changeTable` executes them, so you can omit the `{bulk: true}` options object and pass the callback as the only argument:

```js
await this.changeTable("github_delivery_journal_entries", (table) => {
  table.datetime("correlated_at", {null: true})
})
```

Both forms accept an async callback; `changeTable` awaits it before executing the recorded operations.

## Recorded operations

The recorder exposes the column helpers (`bigint`, `blob`, `boolean`, `column`, `datetime`, `decimal`, `integer`, `json`, `string`, `text`, `tinyint`, `uuid`), `timestamps` / `removeTimestamps`, `index` / `removeIndex`, `references` / `removeReferences`, `belongsTo`, `remove`, and `rename` / `changeNull`. Indexes and references dispatch to the same helpers used by `addIndex`, `addReference`, and friends, so names, options, and error handling match those helpers exactly.

## Bulk vs. sequential execution

Drivers declare their alter capabilities, and `changeTable` stays driven by them rather than by driver type names:

* **Bulk alter support** (`supportsBulkAlter`): MySQL, MariaDB, and PostgreSQL combine compatible consecutive column changes (and column drops) into a single `ALTER TABLE` statement. On MySQL/MariaDB, compatible `index(...)` additions are carried inside that same bulk `ALTER` — including an index-only batch with no column changes — because those drivers implement `supportsBulkAlterIndexes`. PostgreSQL does not, so its indexes are always issued as their own `CREATE INDEX`.
* **No bulk alter support** (SQLite and SQL Server): every recorded operation executes sequentially against the real schema through the existing single-change helpers, so the final schema is identical to the bulk result.

Compatible commands stay in the current batch; incompatible commands flush the pending batch first and run through their normal helper path, preserving the recorded order. `index(...)` with `ifNotExists` is always flushed and executed standalone because the combined form cannot express that guard. `removeIndex`, `addReference`, `removeReference`, `rename`, and `changeNull` each flush and run alone.

`bulk` controls DDL grouping only, not transactional atomicity: each flushed statement is issued separately, and a failure partway through leaves the earlier statements applied. Bulk and sequential runs must produce the same schema, including index names — an unnamed index in a batch resolves to the same `addIndex` default name a standalone call would use.

## Reversibility

Use `table.remove(...)` with multiple column names to drop several columns in one reversal, and remove indexes first so a rebuild (SQLite) or a re-indexed column drop does not fail. Original columns and their data are preserved: SQLite rebuilds the table when columns are removed and copies existing rows, and the other drivers drop columns while keeping the rest of the row data intact.