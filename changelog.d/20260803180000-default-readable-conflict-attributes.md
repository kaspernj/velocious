Support default-readable attributes in server-wins routed conflict projection

- When a routed resource declares `writableAttributes` but omits `static attributes`, the routed conflict projection now derives the effective readable set from the model's full database-backed attribute map rather than producing an empty set. This matches the framework's default "expose all" contract for resources without an `attributes` declaration.
- A `serverWins` conflict on an `attributes`-less resource now carries the authoritative values of every affected writable field in `serverModel` (plus identity and version), enabling `keep_server` convergence without a separate backend read.
