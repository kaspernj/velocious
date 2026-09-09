Update SnapReq to 0.0.15 so WebSocket clients preserve fresh-session and reconnect handshake ordering, wait for session readiness across concurrent callers, and reject all waiting callers if a reconnect closes before readiness.

Always finish Velocious reconnect teardown with stopped-state cleanup, including when an in-flight online check settles during the initial close and has already left the tracked task set. Session abort must not leave the client waiting for online after teardown resolves.
