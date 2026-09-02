// @ts-check

/**
 * Canonical framework-owned websocket channel for synced resources. The server
 * registers it automatically when `sync.api` is configured (subscribe
 * authorization delegates to the app sync resource's `authorizeChanges`), the
 * sync publisher broadcasts standard sync envelopes on it, and the derived
 * sync client subscribes its declared pull scopes to it automatically.
 */
export const VELOCIOUS_SYNC_CHANNEL = "velocious-sync"
