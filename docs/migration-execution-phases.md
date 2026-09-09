# Migration execution phases

Velocious migrations can declare one of two execution phases:

- `pre-runtime`
- `post-publication`

Existing migrations and new migrations without an explicit declaration use
`pre-runtime`.

Declare a post-publication migration on the migration class:

```js
import Migration from "velocious/build/src/database/migration/index.js"

class BackfillPublishedProjects extends Migration {
  async up() {
    await this.execute("UPDATE projects SET published = 1 WHERE published IS NULL")
  }
}

BackfillPublishedProjects.runInPhase("post-publication")

export default BackfillPublishedProjects
```

`Migration.getExecutionPhase()` returns the declared phase, or `pre-runtime`
when no phase was declared. `runInPhase(...)` accepts exactly the two values
above; missing and unknown values fail immediately.

## Selecting a phase

Run one declared set from the command line:

```sh
npx velocious db:migrate --phase pre-runtime
npx velocious db:migrate --phase post-publication
```

Omitting `--phase` preserves the existing behavior and runs every pending
migration, regardless of its declaration:

```sh
npx velocious db:migrate
```

Programmatic callers can make the same selection:

```js
const migrator = new Migrator({
  configuration,
  executionPhase: "post-publication"
})
```

The selector applies to filesystem migrations and to both the ambient and
captured-physical-database require-context entry points on `Migrator`. A
migration outside the selected phase is not executed and is not recorded in
`schema_migrations`. Within the selected phase, migrations keep their normal
timestamp ordering. Package migrations remain interleaved with application
migrations, and `Migration.onDatabases(...)` targeting still applies
independently.

Tenant commands that use the same migration catalog accept the selector too:

```sh
npx velocious db:tenants:migrate projectTenant --phase post-publication
npx velocious db:tenants:migrations:pending projectTenant --phase post-publication
```

The pending command compares only migrations in the selected phase. Without
`--phase`, both tenant commands retain their existing run-all/catalog behavior.

Execution phases are selection metadata only. Velocious does not infer a phase
from filenames or schema operations, observe application publication state, or
choose invocation timing. The application or deployment caller chooses which
declared set to invoke and when; Velocious continues to own migration discovery,
timestamp ordering, execution, and ledger updates.

See [database migrations](database-migrations.md) for migration helpers and
[packages](packages.md) for package-contributed migration discovery.
