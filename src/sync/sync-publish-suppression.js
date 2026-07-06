// @ts-check

/**
 * Records currently being written from an already-synced source (sync replay
 * applies, importers applying device-origin data). Module-scoped so the
 * framework's replay apply can mark records without holding a publisher
 * instance.
 * @type {WeakSet<object>}
 */
const serverApplyRecords = new WeakSet()

let withoutPublishingDepth = 0

/**
 * Marks one record as being written from an already-synced source so server
 * publish callbacks skip it (record-precise suppression). The framework's
 * routed sync replay apply uses this internally around every applied write, so
 * replayed device mutations never publish a second, server-origin sync change.
 * @param {?} record - Server model record about to be written.
 * @returns {() => void} Release callback re-enabling publishing for the record.
 */
export function markServerApply(record) {
  serverApplyRecords.add(record)

  return () => serverApplyRecords.delete(record)
}

/**
 * Runs a callback with server publish callbacks suppressed - for code applying
 * already-synced data outside the framework's replay apply (importers,
 * backfills applying device-origin rows). Suppression covers the whole async
 * duration of the callback (nested calls stack) and is process-wide while it
 * runs: mutations from concurrently running requests are also suppressed for
 * that window, so prefer `markServerApply(record)` when other flows can
 * interleave.
 * @template T
 * @param {() => Promise<T> | T} callback - Work whose model writes should not publish sync changes.
 * @returns {Promise<T>} The callback result.
 */
export async function withoutPublishing(callback) {
  withoutPublishingDepth++

  try {
    return await callback()
  } finally {
    withoutPublishingDepth--
  }
}

/**
 * Whether server publishing is currently suppressed for a record: either the
 * record was marked as a server apply (`markServerApply`) or a
 * `withoutPublishing` callback is running.
 * @param {?} record - Server model record being written.
 * @returns {boolean} Whether publishing is suppressed for the record.
 */
export function isPublishingSuppressed(record) {
  return withoutPublishingDepth > 0 || serverApplyRecords.has(record)
}
