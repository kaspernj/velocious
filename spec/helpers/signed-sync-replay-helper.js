// @ts-check

import Ability from "../../src/authorization/ability.js"
import AuthorizationBaseResource from "../../src/authorization/base-resource.js"
import backendProjects from "../dummy/src/config/backend-projects.js"
import {frontendModelSyncManifestForBackendProjects} from "../../src/frontend-models/resource-definition.js"
import Task from "../dummy/src/models/task.js"
import TaskBoard from "../dummy/src/models/task-board.js"
import {
  createDeviceCertificate,
  createSignedMutation,
  generateSyncSigningKeyPair
} from "../../src/sync/device-identity.js"
import {createOfflineGrantFromBootstrap} from "../../src/sync/offline-grant.js"

/** Task ability scoped to the verified offline grant's project scope. */
class OfflineGrantTaskAbilityResource extends AuthorizationBaseResource {
  static ModelClass = Task

  /** @returns {void} */
  abilities() {
    const scopes = /** @type {Record<string, ReturnType<typeof JSON.parse>>} */ (this.getContext().offlineGrantScopes || {})

    this.can(["create", "destroy", "read", "update"], scopes.projectId === undefined ? "1=0" : {projectId: scopes.projectId})
  }
}

/** TaskBoard ability scoped to the verified offline grant's project scope. */
class OfflineGrantTaskBoardAbilityResource extends AuthorizationBaseResource {
  static ModelClass = TaskBoard

  /** @returns {void} */
  abilities() {
    const scopes = /** @type {Record<string, ReturnType<typeof JSON.parse>>} */ (this.getContext().offlineGrantScopes || {})

    this.can(["read", "update"], scopes.projectId === undefined ? "1=0" : {projectId: scopes.projectId})
  }
}

/**
 * Returns the AwesomeTasks proof abilityFactory: builds an Ability derived from
 * the verified signed actor and offline grant, scoping Task/TaskBoard access to
 * the grant's project scope.
 * @returns {(args: {actor: ReturnType<typeof JSON.parse>, configuration: ReturnType<typeof JSON.parse>, grant: import("../../src/sync/offline-grant.js").OfflineGrant}) => Ability} Ability factory.
 */
export function buildOfflineGrantAbilityFactory() {
  return ({actor, grant}) => new Ability({
    context: {
      currentUser: actor,
      offlineGrant: grant,
      offlineGrantScopes: grant?.scopes || {},
      resourceRuntime: "offline"
    },
    resources: [OfflineGrantTaskAbilityResource, OfflineGrantTaskBoardAbilityResource]
  })
}

/**
 * Returns the current sync manifest for the dummy backend projects — the same
 * manifest the signed replay service enforces policy hashes against.
 * @returns {Record<string, import("../../src/configuration-types.js").NormalizedFrontendModelResourceSyncConfiguration>} Sync manifest by model name.
 */
export function dummySyncManifest() {
  return frontendModelSyncManifestForBackendProjects(backendProjects)
}

/**
 * Builds the test keys, certificate, and grant fixtures for signed replay specs.
 * @param {object} args - Fixture args.
 * @param {string} args.actorDeviceId - Device id.
 * @param {string} args.actorUserId - User id.
 * @param {string} args.grantId - Grant id.
 * @param {Date} args.grantNow - Grant issue time.
 * @param {number} [args.grantTtlMs] - Grant TTL.
 * @param {Record<string, ReturnType<typeof JSON.parse>>} args.resources - Grant resource manifest (normalized entries with enabled/operations/policyHash).
 * @param {Record<string, ReturnType<typeof JSON.parse>>} args.scopes - Grant scopes.
 * @param {import("../../src/sync/device-identity.js").SyncJsonWebKey} [args.backendKeys] - Optional shared backend key pair; generated when omitted.
 * @param {import("../../src/sync/offline-grant.js").OfflineGrantSigningKey} [args.signingKey] - Optional shared offline-grant signing key; defaults to a literal test key.
 * @returns {Promise<Record<string, ReturnType<typeof JSON.parse>>>} Fixture bundle.
 */
export async function buildSignedReplayFixtures({actorDeviceId, actorUserId, grantId, grantNow, grantTtlMs = 1000 * 60 * 60 * 24 * 365 * 100, resources, scopes, backendKeys, signingKey}) {
  const resolvedBackendKeys = backendKeys || await generateSyncSigningKeyPair()
  const deviceKeys = await generateSyncSigningKeyPair()
  const deviceCertificate = await createDeviceCertificate({
    backendPrivateKey: resolvedBackendKeys.privateKey,
    certificate: {
      actorDeviceId,
      actorUserId,
      certificateId: "cert-1",
      devicePublicKey: deviceKeys.publicKey,
      expiresAt: "2031-01-01T00:00:00.000Z",
      issuedAt: "2026-08-01T00:00:00.000Z"
    }
  })
  const resolvedSigningKey = signingKey || {current: true, id: "key-1", secret: "super-secret-key"}
  const signedOfflineGrant = await createOfflineGrantFromBootstrap({
    deviceId: actorDeviceId,
    grantId,
    grantTtlMs,
    now: grantNow,
    resources,
    scopes,
    signingKey: resolvedSigningKey,
    userId: actorUserId
  })

  return {backendKeys: resolvedBackendKeys, deviceCertificate, deviceKeys, signingKey: resolvedSigningKey, signedOfflineGrant}
}

/**
 * Signs one mutation against fixture keys.
 * @param {object} args - Mutation args.
 * @param {Record<string, ReturnType<typeof JSON.parse>>} args.fixtures - Fixture bundle from {@link buildSignedReplayFixtures}.
 * @param {Record<string, ReturnType<typeof JSON.parse>>} args.mutation - Mutation payload passed to createSignedMutation.
 * @returns {Promise<Record<string, ReturnType<typeof JSON.parse>>>} Signed mutation envelope.
 */
export async function signFixtureMutation({fixtures, mutation}) {
  return await createSignedMutation({
    deviceCertificate: /** @type {Record<string, ReturnType<typeof JSON.parse>>} */ (fixtures.deviceCertificate),
    devicePrivateKey: /** @type {Record<string, ReturnType<typeof JSON.parse>>} */ (fixtures.deviceKeys).privateKey,
    mutation
  })
}
