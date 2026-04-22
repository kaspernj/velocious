## Fixed

- Background jobs now run inside an active database connection context. The inline worker (`forked: false`) and forked job runner both wrap `perform` in `Configuration#withConnections`, so DB calls from a job no longer fail with `Error: ID hasn't been set for this async context`.
