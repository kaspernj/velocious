// @ts-check

import {describe, expect, it} from "../../src/testing/test.js"
import {
  createOfflineGrant,
  verifyOfflineGrant
} from "../../src/sync/offline-grant.js"

describe("offline grant signing", () => {
  it("creates a signed grant and verifies it with the active signing key", async () => {
    const signedGrant = await createOfflineGrant({
      grant: {
        deviceId: "scanner-1",
        expiresAt: "2026-01-02T04:04:05.000Z",
        grantId: "grant-1",
        issuedAt: "2026-01-02T03:04:05.000Z",
        resources: {
          Ticket: {
            operations: ["find", "scanAttempt"],
            policyHash: "sha256-abc123",
            policyVersion: "scanner-v1"
          }
        },
        scopes: {eventId: "event-1"},
        userId: "user-1"
      },
      signingKey: {id: "key-1", secret: "test-signing-secret"}
    })

    expect(signedGrant.algorithm).toEqual("HS256")
    expect(signedGrant.keyId).toEqual("key-1")
    expect(signedGrant.signature).toMatch(/^hmac-sha256-[a-f0-9]{64}$/)

    const verifiedGrant = await verifyOfflineGrant({
      now: new Date("2026-01-02T03:05:00.000Z"),
      signedGrant,
      signingKeys: [{id: "key-1", secret: "test-signing-secret"}]
    })

    expect(verifiedGrant).toEqual(signedGrant.grant)
  })

  it("rejects tampered and expired grants", async () => {
    const signedGrant = await createOfflineGrant({
      grant: {
        deviceId: "scanner-1",
        expiresAt: "2026-01-02T04:04:05.000Z",
        grantId: "grant-1",
        issuedAt: "2026-01-02T03:04:05.000Z",
        resources: {},
        scopes: {eventId: "event-1"},
        userId: "user-1"
      },
      signingKey: {id: "key-1", secret: "test-signing-secret"}
    })

    await expect(async () => {
      await verifyOfflineGrant({
        now: new Date("2026-01-02T03:05:00.000Z"),
        signedGrant: {
          ...signedGrant,
          grant: {...signedGrant.grant, deviceId: "scanner-2"}
        },
        signingKeys: [{id: "key-1", secret: "test-signing-secret"}]
      })
    }).toThrow("Offline grant signature did not match")

    await expect(async () => {
      await verifyOfflineGrant({
        now: new Date("2026-01-02T04:04:06.000Z"),
        signedGrant,
        signingKeys: [{id: "key-1", secret: "test-signing-secret"}]
      })
    }).toThrow("Offline grant expired")
  })
})
