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

The backend accepts Buffer, string, `Uint8Array`, `ArrayBuffer`, browser-style
`arrayBuffer()` values, `UploadedFile`, `{content, filename?, contentType?}`,
`{contentBase64, filename?, contentType?}`, and the Node-only
`{path, filename?, contentType?}` shape. Frontend-model attachment input remains
transport-safe and rejects `{path: ...}`.

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

For a path input, the filesystem driver pipelines the source's bounded Node
read stream into a temporary destination and renames it only after the copy
completes. Pipeline backpressure bounds memory use, and a failed source or
destination removes the temporary output. The S3 driver sends the same kind of
Node `Readable` as `PutObjectCommand.Body`, sends the opened-handle stat size as
`ContentLength`, and destroys the stream after success or failure. Neither
driver creates a whole-file Buffer or Base64 string before persistence.

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

The built-in native driver is the compatibility exception. Its public
`write({contentBase64, ...})` callback contract is unchanged, so it calls
`pathSource.readBuffer()` and Base64-encodes path input inside that driver after
selection. This is the only built-in path flow that whole-file buffers.
In-memory native input passes its existing Base64 string through unchanged.

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

Current attachment schemas keep `content_base64` nullable and store `null` for
driver-backed content. An older schema where that column is non-null preserves
its legacy behavior: in-memory Base64 is reused, while path content is read from
the same opened source and encoded only after the filesystem/S3 write succeeds.
No schema change is required for streaming path persistence.

`purgeAll()` validates that every selected driver supports deletion before
deleting any backing object or row. It then deletes each snapshotted object and
its row in order, leaving attachments created concurrently after the snapshot
untouched.
