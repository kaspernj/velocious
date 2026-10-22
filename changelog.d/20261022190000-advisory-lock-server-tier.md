# Centralized lock-server tier for advisory locks

`Record.withAdvisoryLock`, `withAdvisoryLockOrFail`, and `withAdvisoryLockOrDefer` can now be served by the centralized lock server (`consens-lock`, protocol v2) instead of a database session, so a held lock no longer pins a pooled connection.

```js
new Configuration({
  advisoryLocks: {
    backends: {
      lockServer: {enabled: true, host: "127.0.0.1", port: 3006, authToken: "..."},
      driverNative: {enabled: true},
    },
    policy: [
      {name: "tensorbuzz-account-build-start-*", minTier: "driver-native", preferredTier: "lock-server"},
    ],
  },
})
```

- Tier (b) is selected per lock name through the existing `advisoryLocks.policy` (`preferredTier: "lock-server"`), never implicitly: an app that configures nothing keeps today's driver-native behavior.
- Holds are leases renewed every third of the lease window; a fenced lease surfaces as `AdvisoryLockLostError` after the critical section, with the granted and current epochs attached.
- An unreachable lock server fails **upward**: when the lock name's `minTier` permits `driver-native`, the acquisition continues on the driver tier and emits `advisory-lock-fallback` on the framework-error channel. `minTier: "lock-server"` refuses instead with `AdvisoryLockBackendUnavailableError`.
- `getAdvisoryLockBackendStatus(lockName)` now also reports the lock-server connection state and leased names.
