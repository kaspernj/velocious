## Frontend model transport idle waits

- Added `FrontendModelBase.waitForIdle()` for teardown flows that need to wait for queued, scheduled, and active frontend-model transport requests before resetting app state.
