// @ts-check

import {describe, expect, it} from "../../src/testing/test.js"
import {
  createDeviceCertificate,
  createSignedMutation,
  generateSyncSigningKeyPair,
  mutationIdempotencyKey,
  verifyDeviceCertificate,
  verifySignedMutation
} from "../../src/sync/device-identity.js"

describe("sync device identity and mutation signing", () => {
  it("creates a backend-signed device certificate that peers can verify offline", async () => {
    const backendKeys = await generateSyncSigningKeyPair()
    const deviceKeys = await generateSyncSigningKeyPair()
    const certificate = await createDeviceCertificate({
      backendPrivateKey: backendKeys.privateKey,
      certificate: {
        actorDeviceId: "device-1",
        actorUserId: "user-1",
        certificateId: "cert-1",
        devicePublicKey: deviceKeys.publicKey,
        expiresAt: "2026-01-03T03:04:05.000Z",
        issuedAt: "2026-01-02T03:04:05.000Z"
      }
    })

    expect(certificate.algorithm).toEqual("ECDSA-P256-SHA256")
    expect(certificate.signature).toMatch(/^ecdsa-p256-sha256-[A-Za-z0-9_-]+$/)

    const verifiedCertificate = await verifyDeviceCertificate({
      backendPublicKey: backendKeys.publicKey,
      certificate,
      now: new Date("2026-01-02T04:04:05.000Z")
    })

    expect(verifiedCertificate).toEqual(certificate.certificate)
  })

  it("rejects tampered mutations and expired device certificates", async () => {
    const backendKeys = await generateSyncSigningKeyPair()
    const deviceKeys = await generateSyncSigningKeyPair()
    const deviceCertificate = await createDeviceCertificate({
      backendPrivateKey: backendKeys.privateKey,
      certificate: {
        actorDeviceId: "device-1",
        actorUserId: "user-1",
        certificateId: "cert-1",
        devicePublicKey: deviceKeys.publicKey,
        expiresAt: "2026-01-03T03:04:05.000Z",
        issuedAt: "2026-01-02T03:04:05.000Z"
      }
    })
    const signedMutation = await createSignedMutation({
      deviceCertificate,
      devicePrivateKey: deviceKeys.privateKey,
      mutation: {
        actorDeviceId: "device-1",
        actorUserId: "user-1",
        attributes: {scanState: "accepted"},
        baseVersion: "server-100",
        clientMutationId: "mutation-1",
        model: "Ticket",
        occurredAt: "2026-01-02T04:04:05.000Z",
        offlineGrantId: "grant-1",
        operation: "update",
        policyHash: "sha256-policy"
      }
    })

    await expect(async () => {
      await verifySignedMutation({
        backendPublicKey: backendKeys.publicKey,
        now: new Date("2026-01-02T04:05:00.000Z"),
        signedMutation: {
          ...signedMutation,
          mutation: {...signedMutation.mutation, attributes: {scanState: "rejected"}}
        }
      })
    }).toThrow("Sync mutation signature did not match")

    await expect(async () => {
      await verifySignedMutation({
        backendPublicKey: backendKeys.publicKey,
        now: new Date("2026-01-03T03:04:06.000Z"),
        signedMutation
      })
    }).toThrow("Device certificate expired")
  })

  it("derives idempotency from actor user, actor device, and client mutation id", async () => {
    const signedMutation = {
      mutation: {
        actorDeviceId: "device-1",
        actorUserId: "user-1",
        clientMutationId: "mutation-1"
      }
    }

    expect(mutationIdempotencyKey(signedMutation)).toEqual("user-1:device-1:mutation-1")
  })
})
