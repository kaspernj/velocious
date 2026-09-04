# Backend record attachments

Backend record attachments provide `hasOne` and `hasMany` handles backed by a
configured filesystem, S3, native callback, or custom storage driver.

```js
Task.hasManyAttachments("files")
Task.hasOneAttachment("descriptionFile")
Task.hasOneAttachment("archive", {driver: "s3"})

await task.descriptionFile().attach({
  content: "report contents",
  filename: "report.txt",
  contentType: "text/plain"
})
```

## Synchronized client policy

Declare per-attachment client policy on the model attachment itself. A resource
backed by that model automatically exposes the client-safe policy to API
manifests and generated frontend models, so the resource does not repeat an
`attachments` block:

```js
User.hasOneAttachment("profilePicture", {
  driver: "s3",
  sync: {
    fetch: "eager",
    offlineRequirement: "optional",
    retention: "evictable"
  }
})
```

- `fetch` is `"eager"` when a client should prefetch bytes or `"on-demand"`
  when it should wait for access.
- `retention` is `"evictable"` for replaceable cache data or `"durable"` for
  bytes that storage-pressure cleanup must retain.
- `offlineRequirement` is `"optional"` when an offline-ready scope can work
  without the bytes or `"required"` when it cannot. Required assets must use
  durable retention; Velocious rejects `required` plus `evictable`.

The generated metadata includes only `type` and `sync`. Storage drivers and
their credentials remain backend-only. This policy is the contract for client
asset-cache adapters; binary content still travels through the attachment
download endpoint rather than normal record sync payloads.

Backend records and frontend model classes expose this metadata through the
common static `attachmentDefinitions()` contract. This lets the same resource
configuration code work in backend and frontend/local shared-resource wrappers.

Resource-level `static attachments` remains available as a fallback for a
frontend-only resource without a backing model. When a backing model declares
an attachment with the same name, the model declaration is authoritative.

The backend accepts Buffer, string, `Uint8Array`, `ArrayBuffer`, browser-style
`arrayBuffer()` values, `UploadedFile`, `{content, filename?, contentType?}`,
`{contentBase64, filename?, contentType?}`, and the Node-only
`{path, filename?, contentType?}` shape. Frontend-model attachment input remains
transport-safe and rejects `{path: ...}`.

`db:migrate` creates and updates the framework-owned `velocious_attachments`
table on each migrated database through the same idempotent schema owner used
at runtime. This keeps schema DDL outside application and test transactions and
includes the table in generated structure SQL before the first attachment is
written. Attachment owner identities use unbounded text so the complete
canonical tuple for a composite primary key is retained even when it exceeds
the former 255-character scalar-id column.

## Node path input

Path input is disabled by default because it lets application code ask the
backend process to read a local file. Enable it explicitly and, when possible,
restrict it to application-owned directories:

```js
new Configuration({
  attachments: {
    allowPathInput: true,
    allowedPathPrefixes: ["/var/app/uploads"],
    defaultDriver: "filesystem",
    drivers: {
      filesystem: {
        driverClass: FilesystemAttachmentStorageDriver,
        directory: "/var/app/attachments"
      }
    }
  }
})
```

The Node environment handler resolves the path, enforces
`allowedPathPrefixes`, opens the source once, stats that opened handle, rejects
non-regular files, and records the opened-handle byte size. It does not call
`readAttachmentInputFile()` during path normalization. The opened handle fixes
the source identity before driver selection, so replacing the pathname does not
change the bytes later persisted.

For a path input on the current nullable schema, the filesystem driver pipelines
the source's bounded Node read stream into a temporary destination and renames
it only after the copy completes. Pipeline backpressure bounds memory use, and
a failed source or destination removes the temporary output. The S3 driver
sends the same kind of Node `Readable` as `PutObjectCommand.Body`, sends the
opened-handle stat size as `ContentLength`, and destroys the stream after
success or failure. Neither driver creates a whole-file Buffer or Base64 string
on that current-schema path.

Reads must produce exactly the stat snapshot size. Truncation is rejected;
bytes appended after normalization are ignored. Changes made through the same
file identity within the snapshot range can still affect the result, so
application code should otherwise treat an attached source as immutable until
`attach()` completes. Open, stat, read, destination, or S3 errors reject the
attachment without creating a row that claims the failed write. The store
closes the owned source after every success or error path.

## Normalized storage-driver input

Storage drivers receive a stable metadata object with an explicit in-memory or
path representation:

```js
{
  byteSize,       // exact byte count
  contentBuffer,  // Buffer for in-memory input, otherwise null
  contentBase64,  // string for in-memory input, otherwise null
  contentType,
  filename,
  pathSource      // opened environment-owned source for path input, otherwise null
}
```

Existing Buffer, string, Base64, browser-style, and `UploadedFile` inputs remain
Buffers and keep their Base64 representation. A custom driver that supports
Node path input should consume `pathSource.createReadStream()`. The stream is
bounded to `pathSource.byteSize`, backpressured, tied to the single opened file
identity, and rejects truncation. `pathSource.filePath` is metadata only:
drivers must not reopen it. The store owns `pathSource.close()` and calls it
after persistence. These capabilities travel with normalized input, so a
preconstructed driver configured with `{instance: driver}` does not need
configuration injection to read a path source.

The legacy non-null `content_base64` schema is the storage-driver input
exception. Before calling any driver, the store reads the opened snapshot
exactly once and derives one Buffer and Base64 string from it. Filesystem and S3
receive that Buffer, native receives that Base64 string, and the database row
receives the same Base64 string. The original `pathSource` remains store-owned
and is still closed after persistence.

The built-in native driver is the compatibility exception. Its public
`write({contentBase64, ...})` callback contract is unchanged, so it calls
`pathSource.readBuffer()` and Base64-encodes path input inside that driver after
selection on current nullable schemas. Legacy path input is already materialized
by the store and follows the same callback contract without a second source
read. In-memory native input passes its existing Base64 string through
unchanged.

## Persistence and failure ordering

Velocious normalizes and validates the input, selects the driver, and completes
the new storage write before changing attachment rows. For `hasOne`
replacement, existing backing storage is deleted before its old row, and the
new row is inserted last. A source or destination failure therefore leaves the
existing attachment row intact, and no row claims a storage write that failed.
If database persistence fails before `db.insert()` completes, Velocious calls
the selected driver's `delete` operation when it has one; simultaneous
finalization and cleanup failures are reported together. Once `db.insert()`
completes, the new object is referenced and is retained even if later connection
check-in fails.

When an update changes an attachment owner's primary key, Velocious migrates
the attachment rows on the record transaction's own connection. A later
reload, lifecycle callback, attachment flush, or save failure therefore rolls
both the record key and its attachment ownership back together.

Current attachment schemas keep `content_base64` nullable and store `null` for
driver-backed content. An older schema where that column is non-null preserves
its legacy behavior: in-memory Base64 is reused, while path content is
materialized from the opened source once before driver persistence. That same
snapshot supplies both backing storage and the required database Base64, so a
same-inode modification between persistence phases cannot make them disagree.
No schema change is required for current-schema streaming path persistence.

`purgeAll()` validates that every selected driver supports deletion before
deleting any backing object or row. It then deletes each snapshotted object and
its row in order, leaving attachments created concurrently after the snapshot
untouched.
