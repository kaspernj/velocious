# Websocket event log store: peak-shard timeout budget

`spec/http-server/websocket-event-log-store-spec.js`'s "appends and retrieves
events by sequence" example failed on the MS-SQL (6/8) peak CI shard with the
runner's default 60s per-test timeout (observed 67s; the same shard passed the
previous generation in 475s and needed 1605s on the failing run). The first
append lazily runs the store's schema bootstrap over the live driver, which is
the latency-sensitive step under loaded shards.

The example now carries an explicit `timeoutSeconds: 180` budget, the same
loaded-CI sizing approach used by the background-jobs startup specs in this PR.
No runtime behavior changed.
