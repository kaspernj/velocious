## Added

- `request.onClientDisconnect(callback)` and `request.clientDisconnected` on HTTP server requests: fired from the socket-teardown path (in-process and worker-thread handler modes) so handlers whose response is still buffered — admission queue waits, long-running work — can observe a client disconnect and settle in-flight resources in-process, instead of only open streams receiving `response.onStreamClose`.
