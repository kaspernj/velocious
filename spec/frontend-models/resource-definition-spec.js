// @ts-check

import {describe, expect, it} from "../../src/testing/test.js"
import DatabaseRecord from "../../src/database/record/index.js"
import FrontendModelBaseResource from "../../src/frontend-model-resource/base-resource.js"
import {frontendModelApiManifest, frontendModelResourceConfigurationFromDefinition, frontendModelSyncManifestForBackendProjects, resolveFrontendModelResourceClass} from "../../src/frontend-models/resource-definition.js"

describe("Frontend model resource definitions", {databaseCleaning: {transaction: false, truncate: false}}, () => {
  it("rejects resourceConfig overrides on resource classes", () => {
    class FooResource extends FrontendModelBaseResource {
      /** @returns {import("../../src/configuration-types.js").FrontendModelResourceConfiguration} */
      static resourceConfig() {
        return {attributes: ["id"]}
      }
    }

    expect(() => {
      frontendModelResourceConfigurationFromDefinition(FooResource)
    }).toThrow("FooResource overrides static resourceConfig(), which is not supported. Use static resource properties instead.")
  })

  it("defaults to full CRUD when abilities are not declared", () => {
    class FooResource extends FrontendModelBaseResource {
      static attributes = ["id"]
    }

    const config = frontendModelResourceConfigurationFromDefinition(FooResource)

    expect(config?.abilities).toEqual({
      create: "create",
      destroy: "destroy",
      find: "read",
      index: "read",
      update: "update"
    })
  })

  it("rejects base CRUD abilities in explicit resource abilities", () => {
    class FooResource extends FrontendModelBaseResource {
      static attributes = ["id"]
      static abilities = ["read"]
    }

    expect(() => {
      frontendModelResourceConfigurationFromDefinition(FooResource)
    }).toThrow("Resource abilities must not include base actions: read")
  })

  it("adds custom explicit abilities on top of default CRUD abilities", () => {
    class FooResource extends FrontendModelBaseResource {
      static attributes = ["id"]
      static abilities = ["approve", "archive"]
    }

    const config = frontendModelResourceConfigurationFromDefinition(FooResource)

    expect(config?.abilities).toEqual({
      archive: "archive",
      approve: "approve",
      create: "create",
      destroy: "destroy",
      find: "read",
      index: "read",
      update: "update"
    })
  })
  it("rejects empty and duplicate composite primary keys", () => {
    class EmptyPrimaryKeyResource extends FrontendModelBaseResource {
      static attributes = ["id"]
      static primaryKey = []
    }

    class DuplicatePrimaryKeyResource extends FrontendModelBaseResource {
      static attributes = ["projectId"]
      static primaryKey = ["projectId", "projectId"]
    }

    expect(() => {
      frontendModelResourceConfigurationFromDefinition(EmptyPrimaryKeyResource)
    }).toThrow("Resource primaryKey arrays must contain at least one attribute.")

    expect(() => {
      frontendModelResourceConfigurationFromDefinition(DuplicatePrimaryKeyResource)
    }).toThrow("Resource primaryKey arrays must contain unique attributes.")
  })

  it("reports implicit composite primary keys with frontend attribute names in the API manifest", () => {
    class LegacyCompositeRecord extends DatabaseRecord {
      /** @returns {string[]} - Database-column primary key. */
      static primaryKey() { return ["tenant_id", "external_id"] }

      /** @param {string} name - Attribute or column name. @returns {string | null} - Frontend attribute name. */
      static resolveAttributeName(name) {
        return {external_id: "externalId", tenant_id: "tenantId"}[name] || null
      }
    }

    class LegacyCompositeResource extends FrontendModelBaseResource {
      static ModelClass = LegacyCompositeRecord
      static attributes = ["tenantId", "externalId"]
    }

    const manifest = frontendModelApiManifest([{frontendModels: {LegacyComposite: LegacyCompositeResource}, path: "/tmp/backend"}])
    // Narrows the public manifest resource map for this focused assertion.
    const resources = /** @type {Record<string, {primaryKey: import("../../src/utils/model-primary-key.js").ModelPrimaryKeyDefinition}>} */ (manifest.resources)

    expect(resources.LegacyComposite.primaryKey).toEqual(["tenantId", "externalId"])
  })
  it("normalizes safe sync metadata and computes a deterministic policy hash", () => {
    class FooResource extends FrontendModelBaseResource {
      static attributes = ["id", "name"]
      static sync = {
        conflictStrategy: "fieldThreeWay",
        metadata: {scope: "event", strategy: "snapshot"},
        operations: ["update", "index", "update"],
        policy: {grantScopeAttributes: ["eventId"], writableAttributes: ["name"]},
        policyVersion: "scanner-v1"
      }
    }

    class SamePolicyResource extends FrontendModelBaseResource {
      static attributes = ["id", "name"]
      static sync = {
        conflictStrategy: "fieldThreeWay",
        operations: ["index", "update"],
        policyVersion: "scanner-v1",
        policy: {writableAttributes: ["name"], grantScopeAttributes: ["eventId"]},
        metadata: {strategy: "snapshot", scope: "event"}
      }
    }

    class ChangedPolicyResource extends FrontendModelBaseResource {
      static attributes = ["id", "name"]
      static sync = {
        operations: ["index", "update"],
        policy: {grantScopeAttributes: ["eventId"], writableAttributes: ["name"]},
        policyVersion: "scanner-v2"
      }
    }

    const config = frontendModelResourceConfigurationFromDefinition(FooResource)
    const sameConfig = frontendModelResourceConfigurationFromDefinition(SamePolicyResource)
    const changedConfig = frontendModelResourceConfigurationFromDefinition(ChangedPolicyResource)

    expect(config?.sync).toEqual({
      conflictStrategy: "fieldThreeWay",
      enabled: true,
      metadata: {scope: "event", strategy: "snapshot"},
      operations: ["index", "update"],
      policyHash: config?.sync?.policyHash,
      policyVersion: "scanner-v1"
    })
    expect(config?.sync?.policyHash).toMatch(/^sha256-[a-f0-9]{64}$/)
    expect(sameConfig?.sync?.policyHash).toEqual(config?.sync?.policyHash)
    expect(changedConfig?.sync?.policyHash).not.toEqual(config?.sync?.policyHash)
    expect("policy" in /** @type {Record<string, unknown>} */ (config?.sync || {})).toEqual(false)
  })

  it("rejects non-deterministic or secret-looking sync policy input", () => {
    class FunctionPolicyResource extends FrontendModelBaseResource {
      static attributes = ["id"]
      static sync = {operations: ["index"], policy: {filter: () => true}}
    }

    class SecretPolicyResource extends FrontendModelBaseResource {
      static attributes = ["id"]
      static sync = {operations: ["index"], metadata: {privateKey: "do-not-leak"}}
    }

    expect(() => {
      frontendModelResourceConfigurationFromDefinition(FunctionPolicyResource)
    }).toThrow("Sync policy input must be deterministic JSON")

    expect(() => {
      frontendModelResourceConfigurationFromDefinition(SecretPolicyResource)
    }).toThrow("Sync policy metadata/privateKey is not allowed in frontend-visible sync policy config")
  })

  it("builds a frontend-safe sync manifest for enabled resources only", () => {
    class SyncResource extends FrontendModelBaseResource {
      static attributes = ["id"]
      static modelName = "Ticket"
      static sync = {
        conflictStrategy: "fieldThreeWay",
        metadata: {scope: "event"},
        operations: ["index", "update"],
        policyVersion: "scanner-v1"
      }
    }

    class DisabledResource extends FrontendModelBaseResource {
      static attributes = ["id"]
      static sync = {enabled: false, operations: ["index"]}
    }

    const manifest = frontendModelSyncManifestForBackendProjects([{frontendModels: {
      Disabled: DisabledResource,
      Ticket: SyncResource
    }, path: "/tmp/backend"}])

    expect(Object.keys(manifest)).toEqual(["Ticket"])
    expect(manifest.Ticket).toEqual({
      enabled: true,
      conflictStrategy: "fieldThreeWay",
      metadata: {scope: "event"},
      operations: ["index", "update"],
      policyHash: manifest.Ticket.policyHash,
      policyVersion: "scanner-v1"
    })
    expect(manifest.Ticket.policyHash).toMatch(/^sha256-[a-f0-9]{64}$/)
  })
  class TaskResource extends FrontendModelBaseResource {
    static attributes = ["id"]
  }

  class RenamedResource extends FrontendModelBaseResource {
    static attributes = ["id"]
    static modelName = "CustomName"
  }

  const configuration = {getBackendProjects: () => [{frontendModels: {InternalName: RenamedResource, Task: TaskResource}, path: "/tmp/backend"}]}

  it("resolves a registered resource class by its configured model name", () => {
    const resolved = resolveFrontendModelResourceClass({configuration, resourceType: "Task"})

    if (!resolved) throw new Error("Expected a resolved resource registration")

    expect(resolved.modelName).toEqual("Task")
    expect(resolved.resourceClass === TaskResource).toEqual(true)
    expect(resolved.resourceConfiguration.attributes).toEqual(["id"])
  })

  it("resolves modelName overrides instead of registry keys", () => {
    const resolved = resolveFrontendModelResourceClass({configuration, resourceType: "CustomName"})

    if (!resolved) throw new Error("Expected a resolved resource registration")

    expect(resolved.modelName).toEqual("CustomName")
    expect(resolved.resourceClass === RenamedResource).toEqual(true)

    expect(resolveFrontendModelResourceClass({configuration, resourceType: "InternalName"})).toEqual(null)
  })

  it("returns null for unknown resource types", () => {
    expect(resolveFrontendModelResourceClass({configuration, resourceType: "Nope"})).toEqual(null)
  })
})
