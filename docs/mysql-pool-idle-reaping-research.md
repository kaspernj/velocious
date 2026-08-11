# MySQL outer-pool idle reaping research

Run the reproducible benchmark with a dedicated MySQL/MariaDB database:

```sh
MYSQL_HOST=mariadb MYSQL_DATABASE=velocious_benchmark MYSQL_USER=benchmark MYSQL_PASSWORD=benchmark npm run benchmark:mysql-pool-idle-reaping
```

Set `MYSQL_PORT` when the benchmark server does not listen on `3306`; both the Velocious workload and the persistent status observer use that port.

The runner compares `pool.idleTimeoutMillis` values `5000`, `60000`, and `null` with the same `pool.max` cap (default `4`). Each variant is primed, then receives alternating 6-second and 61-second idle intervals for three rounds. This ensures the 5-second policy is exercised after both intervals, the 60-second policy is exercised after the long interval, and disabled reaping is the control. Override only the repeat count or cap with `BENCHMARK_ROUNDS` and `BENCHMARK_MAX_CONNECTIONS`; keep the idle schedule intact when comparing runs.

For each timeout variant, the runner reads a `Threads_created` baseline after priming and before the first idle interval. For each first query after an idle interval, it records checkout-plus-query latency. It then saturates the configured outer-pool cap, holds one additional checkout in the queue for 25 ms, and records its actual wait. It reports p50/p95 first-query latency, p95 checkout wait, outer-pool idle-reaper disposals, and MySQL `Threads_created`/`Threads_connected`; the thread delta includes the first sample even with `BENCHMARK_ROUNDS=1`. A persistent observer connection reads `SHOW GLOBAL STATUS`, avoiding one observer reconnect per sample. If the server does not grant access to global status, those fields are explicitly `null` rather than inferred.

`Threads_created` is server-global and can be changed by unrelated clients. Run against an otherwise quiet dedicated server, record the server/version and host topology, and compare repeated complete runs. The MySQL driver deliberately disposes its physical session at logical check-in to prevent raw session-state leakage; consequently outer logical-pool retention is not expected to eliminate all MySQL thread creation. The benchmark measures that interaction instead of assuming wrapper retention equals physical-session retention.

Tenant resource safety matters more than a small cold-query win. A longer or disabled outer timeout retains one logical connection per recently active tenant/database identity until capacity pressure evicts it. Under `pool.max`, this remains connection-count bounded, but retained wrappers can preserve per-tenant schema caches and other memory. Never extrapolate a single-tenant result to high-cardinality tenants: repeat with a representative tenant arrival rate and observe process memory, database limits, queue wait telemetry, and disposal counts. `null` is appropriate only when tenant cardinality and process lifetime are deliberately bounded.

## Recorded result and recommendation

On 2026-08-11, the implementation sandbox had no reachable MySQL/MariaDB service: the benchmark probe to `127.0.0.1:3306` measured an immediate `ECONNREFUSED`, and the `mariadb` service name did not resolve. Therefore real-server latency and status values could not be collected there. The automated control-flow spec records deterministic synthetic telemetry only; it is not presented as performance evidence. Because there is no measured evidence that 60 seconds or disabled reaping improves this driver's first-query behavior—and physical MySQL sessions are already disposed at every logical check-in—the safe recommendation is to retain the 5-second default. Run the command above in the dedicated benchmark environment before reconsidering the default, and attach its table verbatim to any follow-up proposal.
