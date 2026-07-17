# Changelog

- Fix a background-jobs worker wedge that could silently freeze the whole queue: a forked child's slot is now freed as soon as the child exits, independent of reporting its result, and the worker's result reports are now bounded (they previously retried forever). Together these stop a slow/unreachable main from leaking forked slots until the worker stopped accepting jobs.
- Add worker↔main liveness: workers send periodic heartbeats and the sockets use TCP keepalive; the main drops a worker that goes silent past `workerStaleTimeoutMs` and releases its leases, so a wedged or half-open worker self-heals instead of stalling the queue until a human intervenes.
