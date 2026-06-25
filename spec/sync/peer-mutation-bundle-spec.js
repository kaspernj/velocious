import {describe, expect, it} from "../../src/testing/test.js"
import LocalMutationLog from "../../src/sync/local-mutation-log.js"
import {
  createDeviceCertificate,
  createSignedMutation,
  generateSyncSigningKeyPair,
  verifySignedMutation
} from "../../src/sync/device-identity.js"
import {
  exportPeerMutationBundle,
  importPeerMutationBundle
} from "../../src/sync/peer-mutation-bundle.js"

describe("sync peer mutation import/export", () => {
  it("exports pending local mutations as verifiable signed peer bundles in sequence order", async () => {
    const backendKeys = await generateSyncSigningKeyPair()
    const deviceKeys = await generateSyncSigningKeyPair()
    const deviceCertificate = await buildDeviceCertificate({backendKeys, deviceKeys})
    const mutationLog = new LocalMutationLog({idGenerator: nextValue(["log-1", "log-2", "log-3"]), storage: buildMemoryStorage()})
    const first = await mutationLog.append({mutation: buildMutation({clientMutationId: "mutation-1"})})
    const second = await mutationLog.append({mutation: buildMutation({clientMutationId: "mutation-2"})})
    const synced = await mutationLog.append({mutation: buildMutation({clientMutationId: "mutation-3"})})
    await mutationLog.updateStatus({id: synced.id, status: "synced"})

    const bundle = await exportPeerMutationBundle({
      deviceCertificate,
      devicePrivateKey: deviceKeys.privateKey,
      mutationLog,
      now: () => new Date("2026-06-25T10:00:00.000Z")
    })

    expect(bundle).toMatchObject({
      exportedAt: "2026-06-25T10:00:00.000Z",
      format: "velocious.sync.peer-mutation-bundle.v1"
    })
    expect(bundle.mutations.map((entry) => entry.localRecordId)).toEqual([first.id, second.id])
    expect(bundle.mutations.map((entry) => entry.localSequence)).toEqual([1, 2])

    const verifiedMutations = []
    for (const entry of bundle.mutations) {
      verifiedMutations.push(await verifySignedMutation({
        backendPublicKey: backendKeys.publicKey,
        now: new Date("2026-06-25T10:00:00.000Z"),
        signedMutation: entry.signedMutation
      }))
    }
    expect(verifiedMutations.map((mutation) => mutation.clientMutationId)).toEqual(["mutation-1", "mutation-2"])
  })

  it("imports verified peer mutations as peer-applied records and skips existing idempotency keys", async () => {
    const backendKeys = await generateSyncSigningKeyPair()
    const peerKeys = await generateSyncSigningKeyPair()
    const peerCertificate = await buildDeviceCertificate({
      actorDeviceId: "peer-device-1",
      actorUserId: "peer-user-1",
      backendKeys,
      deviceKeys: peerKeys
    })
    const storage = buildMemoryStorage()
    const mutationLog = new LocalMutationLog({idGenerator: nextValue(["local-1", "import-1", "import-2"]), storage})
    const existing = await mutationLog.append({
      mutation: buildMutation({
        actorDeviceId: "peer-device-1",
        actorUserId: "peer-user-1",
        clientMutationId: "peer-mutation-1"
      })
    })
    const firstSignedMutation = await createSignedMutation({
      deviceCertificate: peerCertificate,
      devicePrivateKey: peerKeys.privateKey,
      mutation: buildMutation({
        actorDeviceId: "peer-device-1",
        actorUserId: "peer-user-1",
        clientMutationId: "peer-mutation-1"
      })
    })
    const secondSignedMutation = await createSignedMutation({
      deviceCertificate: peerCertificate,
      devicePrivateKey: peerKeys.privateKey,
      mutation: buildMutation({
        actorDeviceId: "peer-device-1",
        actorUserId: "peer-user-1",
        clientMutationId: "peer-mutation-2"
      })
    })

    const result = await importPeerMutationBundle({
      backendPublicKey: backendKeys.publicKey,
      bundle: {
        exportedAt: "2026-06-25T10:00:00.000Z",
        format: "velocious.sync.peer-mutation-bundle.v1",
        mutations: [
          {signedMutation: firstSignedMutation},
          {signedMutation: secondSignedMutation}
        ]
      },
      mutationLog,
      now: new Date("2026-06-25T10:00:00.000Z")
    })

    expect(result).toEqual({
      imported: [{clientMutationId: "peer-mutation-2", idempotencyKey: "peer-user-1:peer-device-1:peer-mutation-2", localRecordId: "import-1"}],
      rejected: [],
      skipped: [{clientMutationId: "peer-mutation-1", idempotencyKey: "peer-user-1:peer-device-1:peer-mutation-1", localRecordId: existing.id, reason: "duplicate"}]
    })
    expect((await mutationLog.records()).map((record) => ({
      clientMutationId: record.mutation.clientMutationId,
      status: record.status
    }))).toEqual([
      {clientMutationId: "peer-mutation-1", status: "pending"},
      {clientMutationId: "peer-mutation-2", status: "peer-applied"}
    ])
  })

  it("rejects invalid peer mutations without appending them", async () => {
    const backendKeys = await generateSyncSigningKeyPair()
    const peerKeys = await generateSyncSigningKeyPair()
    const peerCertificate = await buildDeviceCertificate({backendKeys, deviceKeys: peerKeys})
    const mutationLog = new LocalMutationLog({idGenerator: () => "import-1", storage: buildMemoryStorage()})
    const signedMutation = await createSignedMutation({
      deviceCertificate: peerCertificate,
      devicePrivateKey: peerKeys.privateKey,
      mutation: buildMutation({clientMutationId: "peer-mutation-1"})
    })

    const result = await importPeerMutationBundle({
      backendPublicKey: backendKeys.publicKey,
      bundle: {
        exportedAt: "2026-06-25T10:00:00.000Z",
        format: "velocious.sync.peer-mutation-bundle.v1",
        mutations: [{signedMutation: {...signedMutation, mutation: {...signedMutation.mutation, attributes: {name: "Tampered"}}}}]
      },
      mutationLog,
      now: new Date("2026-06-25T10:00:00.000Z")
    })

    expect(result.imported).toEqual([])
    expect(result.skipped).toEqual([])
    expect(result.rejected).toEqual([{errorMessage: "Sync mutation signature did not match", index: 0}])
    expect(await mutationLog.records()).toEqual([])
  })
})

async function buildDeviceCertificate({actorDeviceId = "device-1", actorUserId = "user-1", backendKeys, deviceKeys}) {
  return await createDeviceCertificate({
    backendPrivateKey: backendKeys.privateKey,
    certificate: {
      actorDeviceId,
      actorUserId,
      certificateId: `${actorDeviceId}-certificate-1`,
      devicePublicKey: deviceKeys.publicKey,
      expiresAt: "2026-06-26T10:00:00.000Z",
      issuedAt: "2026-06-25T09:00:00.000Z"
    }
  })
}

function buildMutation(overrides = {}) {
  return {
    actorDeviceId: "device-1",
    actorUserId: "user-1",
    attributes: {name: "Offline task"},
    baseVersion: null,
    clientMutationId: "mutation-1",
    model: "Task",
    occurredAt: "2026-06-25T09:30:00.000Z",
    offlineGrantId: "grant-1",
    operation: "update",
    policyHash: "sha256-task",
    ...overrides
  }
}

function buildMemoryStorage() {
  const recordsByKey = new Map()

  return {
    appendRecord(storageKey, record) {
      recordsFor(storageKey).push(JSON.parse(JSON.stringify(record)))
    },
    deleteRecords(storageKey, ids) {
      recordsByKey.set(storageKey, recordsFor(storageKey).filter((record) => !ids.includes(record.id)))
    },
    nextSequence(storageKey) {
      return recordsFor(storageKey).length + 1
    },
    record(storageKey, id) {
      const record = recordsFor(storageKey).find((entry) => entry.id === id)
      return record ? JSON.parse(JSON.stringify(record)) : null
    },
    records(storageKey, options = {}) {
      let records = recordsFor(storageKey)
      if (options.statuses) records = records.filter((record) => options.statuses.includes(record.status))
      return JSON.parse(JSON.stringify(records))
    },
    updateRecord(storageKey, record) {
      const records = recordsFor(storageKey)
      const index = records.findIndex((entry) => entry.id === record.id)
      if (index < 0) throw new Error(`No record ${record.id}`)
      records[index] = JSON.parse(JSON.stringify(record))
    }
  }

  function recordsFor(storageKey) {
    if (!recordsByKey.has(storageKey)) recordsByKey.set(storageKey, [])
    return recordsByKey.get(storageKey)
  }
}

function nextValue(values) {
  let index = 0

  return () => values[index++]
}
