# Synchronized asset cache

Velocious provides a platform-neutral cache manager for immutable attachment
descriptors. Record sync carries descriptor metadata; authenticated attachment
downloads carry bytes separately. This keeps large binary bodies out of normal
change-feed rows while still making selected assets available offline.

The cache manager is imported directly:

```js
import SynchronizedAssetCache from "velocious/build/src/sync/assets/cache.js"

const cache = new SynchronizedAssetCache({
  accountId: currentBackendAccountNamespace,
  adapter: platformAssetCacheAdapter,
  download: async (descriptor) => await authenticatedAssetDownload(descriptor),
  maxBytes: 100 * 1024 * 1024
})
```

The application supplies the authenticated account namespace, global byte
budget, downloader, and platform adapter. The namespace must distinguish both
the backend and account identity so installations connected to multiple
backends cannot share cached state or bytes. Per-attachment behavior stays on
the model declaration described in
[Backend record attachments](attachments.md):

```js
User.hasOneAttachment("profilePicture", {
  sync: {
    fetch: "eager",
    offlineRequirement: "optional",
    retention: "evictable"
  }
})
```

## Descriptor contract

Each descriptor identifies one immutable attachment row and contains:

- `id`, `recordType`, `recordId`, and `name` for attachment identity;
- `digest` as `sha256-<lowercase hex>`, plus `byteSize`, `filename`, and
  `contentType` for verification and presentation;
- the model-derived `fetch`, `retention`, and `offlineRequirement` policy.

Call `synchronize({scopeKey, descriptors, online})` after applying one complete
descriptor scope. Descriptors removed from that scope lose the scope reference;
their bytes are deleted only after no active scope references the digest.
`synchronize` downloads eligible eager descriptors and returns both attempted
download failures and required asset ids in that scope that remain absent. It
does not hide a failed authenticated request or corrupt payload. Removing the
last reference while a download is active schedules the completed blob for
deletion instead of leaving unreferenced bytes behind.

Call `resolve({assetId, online})` when rendering an asset. A cached URI is
returned immediately. An absent on-demand asset downloads when online; offline
or retry-delayed optional assets return `null`, so consumers can render a text
or initials fallback. A failed eligible on-demand download rejects after its
retry metadata has been persisted.

## Integrity, retries, and interrupted work

Bytes are accepted only when both their byte count and SHA-256 digest match the
descriptor. The platform adapter does not see unverified content. Before the
download begins, cache metadata records `downloading`; after a failure it stores
the attempt count and exponential-backoff deadline. A process that restarts
with `downloading` state converts it to an immediately eligible failed attempt,
so interrupted work resumes without treating a partial file as valid.

Requests for one digest are single-flighted. Different descriptors with the
same digest share one stored blob, including concurrent requests.

## Adapter contract

An adapter implements the `SynchronizedAssetCacheAdapter` typedef from
`src/sync/assets/types.js`:

- `loadState({accountId})` and `saveState({accountId, state})` persist the
  versioned descriptor/retry manifest. `saveState` must replace it atomically.
- `blobUri({accountId, digest})` returns a renderable local URI only when the
  complete blob exists.
- `writeBlob({accountId, digest, bytes, contentType})` atomically commits the
  already-verified bytes and returns their URI. Temporary writes must never be
  visible through `blobUri`.
- `deleteBlob({accountId, digest})` is idempotent.

Every operation includes `accountId`. Adapters must use it as a physical
namespace rather than trusting a digest to isolate users. Signing out or
switching accounts can therefore remove one namespace without exposing another
account's cached bytes or metadata.

Platform implementations belong in separate packages so the core does not
import Expo filesystem or browser storage APIs. The Expo adapter should use
`expo-file-system`; the web adapter should use OPFS with browser quota/storage
pressure handling.

## Eviction and offline readiness

`cleanup()` counts each digest once, regardless of how many descriptors refer
to it. When the unique cached total exceeds `maxBytes`, it removes the
least-recently-used blob whose live references are all `evictable`. A blob with
any `durable` reference is retained even when that leaves the cache above its
budget. Evicted descriptor metadata remains, allowing the bytes to be fetched
again later.

The `missingRequiredAssetIds` result is the offline-readiness boundary. A sync
coordinator must not mark a scope offline-ready while this list is non-empty.
Optional assets, such as profile pictures, may fall back when absent or evicted.

This core manager does not replay offline attachment uploads. Upload replay,
peer-to-peer blob transfer, and a Node client-cache adapter are separate
concerns.
