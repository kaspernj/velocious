// @ts-check

import LocalMutationLog from "../../src/sync/local-mutation-log.js"

/** @returns {import("../../src/sync/local-mutation-log.js").LocalMutationLogStorage} In-memory durable-log test adapter. */
function buildMutationLogStorage() {
  /** @type {Map<string, Array<import("../../src/sync/local-mutation-log.js").LocalMutationLogRecord>>} */
  const recordsByKey = new Map()

  return {
    appendRecord: (storageKey, record) => {
      const records = recordsByKey.get(storageKey) || []

      records.push(record)
      recordsByKey.set(storageKey, records)
    },
    deleteRecords: (storageKey, ids) => {
      recordsByKey.set(storageKey, (recordsByKey.get(storageKey) || []).filter((record) => !ids.includes(record.id)))
    },
    nextSequence: (storageKey) => (recordsByKey.get(storageKey) || []).length + 1,
    record: (storageKey, id) => (recordsByKey.get(storageKey) || []).find((record) => record.id === id),
    records: (storageKey, options) => (recordsByKey.get(storageKey) || [])
      .filter((record) => !options?.statuses || options.statuses.includes(record.status)),
    updateRecord: (storageKey, record) => {
      const records = recordsByKey.get(storageKey) || []
      const index = records.findIndex((candidate) => candidate.id === record.id)

      records[index] = record
    }
  }
}

/** @param {string[]} ids - Stable record and mutation ids. @returns {LocalMutationLog} Test mutation log. */
export function buildMutationLog(ids) {
  let index = 0

  return new LocalMutationLog({
    idGenerator: () => `log-${ids[index]}`,
    now: () => new Date(`2026-08-12T10:00:0${index++}.000Z`),
    storage: buildMutationLogStorage()
  })
}

/** @param {LocalMutationLog} mutationLog - Log. @param {string[]} ids - Mutation ids. @returns {Record<string, ReturnType<typeof JSON.parse>>} Conflict tracking declaration. */
export function conflictTracking(mutationLog, ids) {
  let index = 0

  return {
    actorDeviceId: "device-1",
    actorUserId: "user-1",
    clientMutationId: () => ids[index++],
    mutationLog,
    offlineGrantId: "grant-1",
    policyHash: "policy-1",
    versionAttribute: "updatedAt"
  }
}
