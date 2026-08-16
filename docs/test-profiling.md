# Test profiling

Velocious test profiling is opt-in. A normal `npx velocious test` run does not
create a collector or write profile files.

## CLI flags

Profiling flags must appear before the `--` argument separator. Paths may use a
separate argument or `=` syntax, and relative paths resolve from the command's
current working directory.

```bash
# Compact Benchmark-style console summary only
npx velocious test --profile spec/models/task-spec.js

# Console summary plus rich JSON; this flag implies --profile
npx velocious test --profile-json tmp/test-profile.json spec/models/task-spec.js

# Generate weights for the existing duration-aware shard splitter
npx velocious test \
  --profile-json=tmp/test-profile.json \
  --timing-manifest-output=tmp/test-timings.json

# Consume the generated map unchanged on a later run
npx velocious test \
  --groups=4 \
  --group-number=1 \
  --timing-manifest=tmp/test-timings.json
```

`--timing-manifest-output` also implies `--profile`. Velocious validates missing
values, duplicate output destinations, and an output that aliases the
`--timing-manifest` input before test discovery. Requested files are written via
a same-directory temporary file and atomic rename. A write failure fails the
command. Profiles are finalized when possible for passing, failing, focused,
no-test, import-error, and handled interruption outcomes.

## Console and rich JSON

The console output is deliberately compact: a fixed-width table reports count,
wall-clock milliseconds, and process CPU milliseconds for discovery, imports,
testing configuration/global setup, hooks, test bodies, bounded custom
activities, runner overhead, and total time. A low-cardinality pool summary and
requested output paths follow the table. It never prints individual queries or
every test.

Rich output is identified by:

```json
{
  "schema": "velocious.test-profile",
  "schemaVersion": 1
}
```

Schema version 1 includes the run status, aggregate selection and shard data,
counts, phase aggregates, file weights, opaque scopes and tests, every retry
attempt, hook/test/custom spans, database and transaction aggregates, pool
lifecycle aggregates, an unattributed late-event count, and the embedded timing
manifest. Durations are finite, non-negative milliseconds rounded to three
decimal places.

Nested hooks have distinct invocation spans with declaration scope/index and
execution order. Every retry remains present with its complete cost. Async work
that outlives its attempt retains that attempt's closed async context; it cannot
be attributed to the next test and instead increments
`unattributedLateEventCount` when it emits profiled activity.

Database metrics count successful and failed physical query attempts and
physical start/commit/rollback actions. Query fingerprints contain only a hash
and a fixed-allowlist operation plus aggregate count/failed/total/max values;
unrecognized leading tokens are reported as `UNKNOWN`, and at most 50 distinct
fingerprints are retained. Pool metrics contain logical pool identifiers and
aggregate connection-creation, checkout-wait/timeout, idle-reap, and peak-live
connection values.

## Privacy boundary

The profile contains project-relative source paths, logical pool identifiers,
aggregate numeric values, and hashes. Test and scope descriptions become opaque
hashes.

Velocious does not serialize SQL, bind values, credentials, database names,
hosts, usernames, tenant values, checkout names, connection reuse keys, error
messages or stacks. Application data must not be placed in custom activity
labels. Labels are restricted to lowercase identifiers of at most 64 characters
using letters, digits, `.`, `_`, `:`, or `-`, and the profile retains at most 20
distinct labels before aggregating new labels as `other`.

## Application-defined setup and cleanup spans

Use `Configuration#profileTestActivity(name, callback)` around app-owned work
whose cost is otherwise hidden inside a broader hook or test body:

```js
await configuration.profileTestActivity("search-index.reset", async () => {
  await resetSearchIndex()
})
```

The callback always runs. Outside an active opt-in profile, the method adds no
span and otherwise behaves as a pass-through.

## Timing-manifest ownership

The plain timing manifest is a sorted, two-space JSON object with a trailing
newline. Each key is a project-relative entry test file and each value is its
measured total milliseconds. Its weight includes that entry's import, file-owned
`beforeAll`/`afterAll`, and every attempt of its tests. Complete attempt time
includes inherited `beforeEach`/`afterEach` work and retry cost. Shard-global
fixed setup is excluded.

When an entry imports a helper that registers tests or hooks, those registrations
belong deterministically to the importing entry file. This keeps helper source
paths out of the manifest and makes the generated file directly consumable by
[`--timing-manifest`](testing-guidelines.md#duration-aware-parallel-sharding).
