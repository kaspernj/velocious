# Testing Guidelines

## Preferred strategy
- Prefer end-to-end/browser integration tests over stub-only tests for frontend-model behavior.
- Validate actual browser-to-backend HTTP behavior using Velocious browser test runner.

## Browser test runner hardening
- Ensure backend app startup/shutdown is guarded with `try/finally`.
- If test framework startup fails, backend server must still stop to avoid leaked open handles.

## Coverage focus for frontend models
- Command URL mapping behavior
- `findBy` and `findByOrFail` real HTTP flows
- Date normalization behavior
- Nested object matching
- Explicit null matching
- Validation rejection for unsupported condition values

## Slowest tests report
`velocious test` records each test's wall-clock duration (the whole per-test lifecycle,
including retries) and prints a `Slowest N tests:` section after the run summary, so
suite hotspots and the before/after impact of optimizations are visible from a normal
run. Each line shows the duration, full description and `file:line`.

- Defaults to the **10** slowest tests.
- Set `VELOCIOUS_SLOW_TEST_COUNT=<n>` to change how many are printed; `0` disables the
  report.
- The report is skipped for single-test runs (where it would just be noise).

`TestRunner#getSlowestTests(limit = 10)` exposes the same data programmatically
(slowest first; `limit` of `0` returns every recorded test).

## Avoiding fixed sleeps
Never `await wait(<fixed ms>)` to let something async settle — it is both slow and
flaky (too short and it races, too long and it wastes wall-clock). Wait for the real
signal or condition instead:

- **Event-driven (a discrete signal):** `waitForEvent(emitter, eventName, {timeoutMs,
  filter})` from `velocious/build/src/testing/test.js` resolves the instant the event
  fires (optionally only when `filter` matches the emitted arguments) and rejects on
  timeout. It always removes its listener. Use it for a background job finishing, a
  model lifecycle event, a websocket message, etc.
- **Condition polling (no discrete event):** awaitery's `waitFor(callback, {timeout,
  wait})` retries `callback` until it stops throwing (default 5s timeout, 50ms
  interval). Use it when there is no event to hook, e.g. `await waitFor(() =>
  expect(rows.length).toEqual(3))`.
- **System/browser tests:** wait for the expected element to appear rather than
  sleeping before interacting with it.
