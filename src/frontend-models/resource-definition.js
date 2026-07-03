// @ts-check

import * as inflection from "inflection"
import FrontendModelBaseResource from "../frontend-model-resource/base-resource.js"
import restArgsError from "../utils/rest-args-error.js"
import {validateFrontendModelResourceCommandName} from "./resource-config-validation.js"

const BASE_FRONTEND_MODEL_ABILITY_ACTIONS = ["create", "destroy", "read", "update"]
const SHA256_INITIAL_HASH = [
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
  0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19
]
const SHA256_K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5,
  0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
  0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
  0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3,
  0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5,
  0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
]
const RESOURCE_STATIC_CONFIG_KEYS = new Set([
  "abilities",
  "attachments",
  "attributes",
  "builtInCollectionCommands",
  "builtInMemberCommands",
  "collectionCommands",
  "commands",
  "memberCommands",
  "modelName",
  "ModelClass",
  "primaryKey",
  "quickSearchColumns",
  "relationships",
  "server",
  "SharedResource",
  "sync",
  "translatedAttributes",
  "writableAttributes"
])

/**
 * Runs the frontendModelResourcesForBackendProject helper.
 * @param {import("../configuration-types.js").BackendProjectConfiguration} backendProject - Backend project config.
 * @returns {Record<string, import("../configuration-types.js").FrontendModelResourceClassType>} - Resource definitions keyed by model name.
 */
export function frontendModelResourcesForBackendProject(backendProject) {
  const resources = backendProject.frontendModels

  if (resources !== undefined) {
    if (!resources || typeof resources !== "object") {
      throw new Error(`Expected backend project frontendModels object but got: ${resources}`)
    }

    return resources
  }

  return {}
}

/**
 * Runs the frontendModelResourceDefinitionIsClass helper.
 * @param {?} value - Candidate resource definition.
 * @returns {value is import("../configuration-types.js").FrontendModelResourceClassType} - Whether value is a resource class.
 */
export function frontendModelResourceDefinitionIsClass(value) {
  return typeof value === "function" && (value === FrontendModelBaseResource || value.prototype instanceof FrontendModelBaseResource)
}

/**
 * Runs the frontendModelResourceClassFromDefinition helper.
 * @param {?} resourceDefinition - Resource definition.
 * @returns {import("../configuration-types.js").FrontendModelResourceClassType | null} - Resource class when definition is class-based.
 */
export function frontendModelResourceClassFromDefinition(resourceDefinition) {
  return frontendModelResourceDefinitionIsClass(resourceDefinition) ? resourceDefinition : null
}

/**
 * Runs the frontendModelResourceConfigurationFromDefinition helper.
 * @param {?} resourceDefinition - Resource definition.
 * @returns {import("../configuration-types.js").NormalizedFrontendModelResourceConfiguration | null} - Normalized resource configuration.
 */
export function frontendModelResourceConfigurationFromDefinition(resourceDefinition) {
  if (!frontendModelResourceDefinitionIsClass(resourceDefinition)) return null

  assertResourceConfigIsFrameworkDefined(resourceDefinition)

  return normalizeFrontendModelResourceConfiguration(resourceDefinition.resourceConfig())
}

/**
 * Ensures resources use declarative static config properties instead of overriding resourceConfig().
 * @param {import("../configuration-types.js").FrontendModelResourceClassType} ResourceClass - Resource class.
 * @param {Set<import("../configuration-types.js").FrontendModelResourceClassType>} [visited] - Already inspected shared resources.
 * @returns {void}
 */
function assertResourceConfigIsFrameworkDefined(ResourceClass, visited = new Set()) {
  if (visited.has(ResourceClass)) return

  visited.add(ResourceClass)
  assertKnownResourceStaticConfigProperties(ResourceClass)

  const owner = staticMethodOwnerFor(ResourceClass, "resourceConfig")

  if (owner && owner !== FrontendModelBaseResource) {
    throw new Error(`${ResourceClass.name} overrides static resourceConfig(), which is not supported. Use static resource properties instead.`)
  }

  const SharedResource = ResourceClass.sharedResourceClass()

  if (SharedResource) assertResourceConfigIsFrameworkDefined(SharedResource, visited)
}

/**
 * Ensures declarative static resource config does not silently ignore typos or removed keys.
 * @param {import("../configuration-types.js").FrontendModelResourceClassType} ResourceClass - Resource class.
 * @returns {void}
 */
function assertKnownResourceStaticConfigProperties(ResourceClass) {
  let currentClass = ResourceClass

  while (currentClass && currentClass !== FrontendModelBaseResource && currentClass !== Function.prototype) {
    /** @type {Record<string, ?>} */
    const unknownStaticConfig = {}

    for (const key of Object.keys(currentClass)) {
      if (!RESOURCE_STATIC_CONFIG_KEYS.has(key)) unknownStaticConfig[key] = /** @type {Record<string, ?>} */ (/** @type {unknown} */ (currentClass))[key]
    }

    restArgsError(unknownStaticConfig)

    currentClass = Object.getPrototypeOf(currentClass)
  }
}

/**
 * Locates which constructor owns a static method implementation.
 * @param {import("../configuration-types.js").FrontendModelResourceClassType} ResourceClass - Resource class.
 * @param {string} methodName - Method name.
 * @returns {import("../configuration-types.js").FrontendModelResourceClassType | typeof FrontendModelBaseResource | null} - Class that owns the static method.
 */
function staticMethodOwnerFor(ResourceClass, methodName) {
  let currentClass = ResourceClass

  while (currentClass && currentClass !== Function.prototype) {
    if (Object.prototype.hasOwnProperty.call(currentClass, methodName)) return currentClass

    currentClass = Object.getPrototypeOf(currentClass)
  }

  return null
}

/**
 * Runs normalize frontend model resource configuration.
 * @param {import("../configuration-types.js").FrontendModelResourceConfiguration} resourceConfiguration - Raw resource configuration.
 * @returns {import("../configuration-types.js").NormalizedFrontendModelResourceConfiguration} - Normalized resource configuration.
 */
function normalizeFrontendModelResourceConfiguration(resourceConfiguration) {
  const restArgs = /** @type {Record<string, ?>} */ ({...resourceConfiguration})

  for (const key of [
    "abilities",
    "attributes",
    "attachments",
    "builtInCollectionCommands",
    "builtInMemberCommands",
    "collectionCommands",
    "commands",
    "memberCommands",
    "modelName",
    "primaryKey",
    "relationships",
    "server",
    "sync"
  ]) {
    delete restArgs[key]
  }

  restArgsError(restArgs)

  const normalizedCommands = normalizeFrontendModelResourceCommands(resourceConfiguration)
  const sync = normalizeFrontendModelResourceSync(resourceConfiguration)

  return {
    ...resourceConfiguration,
    abilities: normalizeFrontendModelResourceAbilities(resourceConfiguration.abilities),
    builtInCollectionCommands: normalizedCommands.builtInCollectionCommands,
    builtInMemberCommands: normalizedCommands.builtInMemberCommands,
    collectionCommands: normalizedCommands.collectionCommands,
    // Per-command metadata (typed args + declared return type) keyed by method
    // name, derived from `{name, args?, returnType?}` command entries. The
    // generator uses it to type each custom command method.
    commandMetadata: normalizedCommands.commandMetadata,
    memberCommands: normalizedCommands.memberCommands,
    sync
  }
}

/**
 * Runs normalize frontend model resource abilities.
 * @param {string[] | undefined} abilities - Resource abilities config (camelCase action list).
 * @returns {Record<string, string>} - Normalized abilities config.
 */
function normalizeFrontendModelResourceAbilities(abilities) {
  const normalized = defaultCrudAbilities()

  if (abilities === undefined) return normalized

  if (!Array.isArray(abilities)) {
    throw new Error("Resource abilities must be an array of action names. Object form is no longer supported.")
  }

  const duplicatedBaseAbilities = abilities.filter((ability) => BASE_FRONTEND_MODEL_ABILITY_ACTIONS.includes(ability))

  if (duplicatedBaseAbilities.length > 0) {
    throw new Error(`Resource abilities must not include base actions: ${duplicatedBaseAbilities.join(", ")}`)
  }

  for (const ability of abilities) {
    if (typeof ability !== "string" || ability.length < 1) {
      throw new Error("Resource abilities entries must be non-empty strings.")
    }

    normalized[ability] = ability
  }

  return normalized
}

/**
 * Runs default crud abilities.
 * @returns {Record<string, string>} - Default CRUD ability map.
 */
function defaultCrudAbilities() {
  return {
    create: "create",
    destroy: "destroy",
    find: "read",
    index: "read",
    update: "update"
  }
}

/**
 * Builds a frontend-safe sync manifest for all sync-enabled frontend-model resources.
 * @param {import("../configuration-types.js").BackendProjectConfiguration[]} backendProjects - Backend projects to scan.
 * @returns {Record<string, import("../configuration-types.js").NormalizedFrontendModelResourceSyncConfiguration>} - Sync metadata keyed by model name.
 */
export function frontendModelSyncManifestForBackendProjects(backendProjects) {
  /** @type {Record<string, import("../configuration-types.js").NormalizedFrontendModelResourceSyncConfiguration>} */
  const manifest = {}

  for (const backendProject of backendProjects) {
    const resources = frontendModelResourcesForBackendProject(backendProject)

    for (const configuredModelName of Object.keys(resources).sort()) {
      const resourceDefinition = resources[configuredModelName]
      const resourceConfiguration = frontendModelResourceConfigurationFromDefinition(resourceDefinition)

      if (!resourceConfiguration) continue
      if (!resourceConfiguration.sync?.enabled) continue

      const modelName = resourceConfiguration.modelName || configuredModelName

      manifest[modelName] = resourceConfiguration.sync
    }
  }

  return manifest
}

/**
 * Normalizes sync policy metadata and computes a deterministic hash from safe policy inputs.
 * @param {import("../configuration-types.js").FrontendModelResourceConfiguration} resourceConfiguration - Raw resource configuration.
 * @returns {import("../configuration-types.js").NormalizedFrontendModelResourceSyncConfiguration | undefined} - Frontend-safe sync metadata.
 */
function normalizeFrontendModelResourceSync(resourceConfiguration) {
  const sync = resourceConfiguration.sync

  if (sync === undefined || sync === null) return undefined
  if (sync === false) return {conflictStrategy: "optimisticVersion", enabled: false, operations: [], policyHash: syncPolicyHash({conflictStrategy: "optimisticVersion", enabled: false}), policyVersion: null}
  if (sync === true) {
    return normalizeFrontendModelResourceSync({
      ...resourceConfiguration,
      sync: {operations: ["index", "find"]}
    })
  }
  if (!sync || typeof sync !== "object" || Array.isArray(sync)) {
    throw new Error("Resource sync configuration must be true, false, or an object.")
  }

  const {conflictStrategy, enabled = true, metadata, operations, policy, policyVersion, ...rest} = /** @type {import("../configuration-types.js").FrontendModelResourceSyncConfiguration} */ (sync)

  if (Object.keys(rest).length > 0) {
    throw new Error(`Unexpected sync keys: ${Object.keys(rest).join(", ")}. Allowed: conflictStrategy, enabled, metadata, operations, policy, policyVersion`)
  }
  if (enabled !== true && enabled !== false) throw new Error("Resource sync enabled must be true or false when provided.")

  const normalizedConflictStrategy = normalizeSyncConflictStrategy(conflictStrategy)
  const normalizedOperations = normalizeSyncOperations(operations)
  const normalizedMetadata = metadata === undefined ? undefined : deterministicSyncJson({label: "metadata", value: metadata})
  const normalizedPolicy = policy === undefined ? undefined : deterministicSyncJson({label: "policy", value: policy})
  const normalizedPolicyVersion = policyVersion === undefined || policyVersion === null ? null : String(policyVersion)
  const hashInput = {
    conflictStrategy: normalizedConflictStrategy,
    enabled,
    metadata: normalizedMetadata,
    modelName: resourceConfiguration.modelName || null,
    operations: normalizedOperations,
    policy: normalizedPolicy,
    policyVersion: normalizedPolicyVersion
  }
  /** @type {import("../configuration-types.js").NormalizedFrontendModelResourceSyncConfiguration} */
  const normalized = {
    conflictStrategy: normalizedConflictStrategy,
    enabled,
    operations: normalizedOperations,
    policyHash: syncPolicyHash(hashInput),
    policyVersion: normalizedPolicyVersion
  }

  if (normalizedMetadata !== undefined) normalized.metadata = /** @type {Record<string, import("../configuration-types.js").FrontendModelSyncJsonValue>} */ (normalizedMetadata)

  return normalized
}

/**
 * Normalizes the sync conflict strategy for replay clients/servers.
 * @param {unknown} conflictStrategy - Raw strategy.
 * @returns {"optimisticVersion" | "serverWins" | "lastWriterWins" | "fieldThreeWay" | "appendOnly"} - Normalized strategy.
 */
function normalizeSyncConflictStrategy(conflictStrategy) {
  if (conflictStrategy === undefined || conflictStrategy === null) return "optimisticVersion"
  if (["optimisticVersion", "serverWins", "lastWriterWins", "fieldThreeWay", "appendOnly"].includes(String(conflictStrategy))) {
    return /** @type {"optimisticVersion" | "serverWins" | "lastWriterWins" | "fieldThreeWay" | "appendOnly"} */ (conflictStrategy)
  }

  throw new Error(`Unknown resource sync conflictStrategy: ${String(conflictStrategy)}`)
}

/**
 * Normalizes sync operations into a stable, duplicate-free list.
 * @param {unknown} operations - Raw operations value.
 * @returns {string[]} - Normalized operations.
 */
function normalizeSyncOperations(operations) {
  if (operations === undefined) return []
  if (!Array.isArray(operations)) throw new Error("Resource sync operations must be an array of operation names.")

  const normalized = operations.map((operation) => {
    if (typeof operation !== "string" || operation.length < 1) throw new Error("Resource sync operations entries must be non-empty strings.")

    return operation
  })

  return [...new Set(normalized)].sort()
}

/**
 * Builds a deterministic policy hash.
 * @param {unknown} value - Hash input.
 * @returns {string} - sha256-prefixed hash.
 */
function syncPolicyHash(value) {
  return `sha256-${sha256Hex(stableJsonStringify(value))}`
}

/**
 * Computes SHA-256 without importing Node-only crypto modules, keeping this
 * resource-definition module safe for Expo/browser bundles.
 * @param {string} message - UTF-8 message.
 * @returns {string} - Hex digest.
 */
function sha256Hex(message) {
  const bytes = utf8Bytes(message)
  const padded = [...bytes]
  const bitLength = bytes.length * 8
  const hash = [...SHA256_INITIAL_HASH]
  /** @type {number[]} */
  const words = new Array(64)

  padded.push(0x80)
  while (padded.length % 64 !== 56) padded.push(0)

  const highLength = Math.floor(bitLength / 0x100000000)
  const lowLength = bitLength >>> 0

  for (const value of [highLength, lowLength]) {
    padded.push((value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff)
  }

  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let i = 0; i < 16; i++) {
      const index = offset + (i * 4)

      words[i] = (((padded[index] || 0) << 24) | ((padded[index + 1] || 0) << 16) | ((padded[index + 2] || 0) << 8) | (padded[index + 3] || 0)) >>> 0
    }

    for (let i = 16; i < 64; i++) {
      const s0 = rotateRight(words[i - 15], 7) ^ rotateRight(words[i - 15], 18) ^ (words[i - 15] >>> 3)
      const s1 = rotateRight(words[i - 2], 17) ^ rotateRight(words[i - 2], 19) ^ (words[i - 2] >>> 10)

      words[i] = add32(words[i - 16], s0, words[i - 7], s1)
    }

    let [a, b, c, d, e, f, g, h] = hash

    for (let i = 0; i < 64; i++) {
      const s1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25)
      const ch = (e & f) ^ ((~e) & g)
      const temp1 = add32(h, s1, ch, SHA256_K[i], words[i])
      const s0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22)
      const maj = (a & b) ^ (a & c) ^ (b & c)
      const temp2 = add32(s0, maj)

      h = g
      g = f
      f = e
      e = add32(d, temp1)
      d = c
      c = b
      b = a
      a = add32(temp1, temp2)
    }

    hash[0] = add32(hash[0], a)
    hash[1] = add32(hash[1], b)
    hash[2] = add32(hash[2], c)
    hash[3] = add32(hash[3], d)
    hash[4] = add32(hash[4], e)
    hash[5] = add32(hash[5], f)
    hash[6] = add32(hash[6], g)
    hash[7] = add32(hash[7], h)
  }

  return hash.map((value) => value.toString(16).padStart(8, "0")).join("")
}

/**
 * Converts a string to UTF-8 bytes.
 * @param {string} value - String value.
 * @returns {number[]} - UTF-8 bytes.
 */
function utf8Bytes(value) {
  /** @type {number[]} */
  const bytes = []

  for (const character of value) {
    const codePoint = /** @type {number} */ (character.codePointAt(0))

    if (codePoint <= 0x7f) {
      bytes.push(codePoint)
    } else if (codePoint <= 0x7ff) {
      bytes.push(0xc0 | (codePoint >>> 6), 0x80 | (codePoint & 0x3f))
    } else if (codePoint <= 0xffff) {
      bytes.push(0xe0 | (codePoint >>> 12), 0x80 | ((codePoint >>> 6) & 0x3f), 0x80 | (codePoint & 0x3f))
    } else {
      bytes.push(0xf0 | (codePoint >>> 18), 0x80 | ((codePoint >>> 12) & 0x3f), 0x80 | ((codePoint >>> 6) & 0x3f), 0x80 | (codePoint & 0x3f))
    }
  }

  return bytes
}

/**
 * Adds unsigned 32-bit integers.
 * @param {...number} values - Values to add.
 * @returns {number} - Unsigned 32-bit result.
 */
function add32(...values) {
  return values.reduce((sum, value) => (sum + value) >>> 0, 0)
}

/**
 * Rotates a 32-bit integer right.
 * @param {number} value - Value to rotate.
 * @param {number} bits - Bit count.
 * @returns {number} - Rotated value.
 */
function rotateRight(value, bits) {
  return (value >>> bits) | (value << (32 - bits))
}

/**
 * Validates that a sync config subtree is deterministic JSON and does not contain obvious secrets.
 * @param {object} args - Arguments.
 * @param {string} args.label - Diagnostic path label.
 * @param {unknown} args.value - Value to validate.
 * @returns {import("../configuration-types.js").FrontendModelSyncJsonValue} - Stable JSON value.
 */
function deterministicSyncJson({label, value}) {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value

  if (Array.isArray(value)) {
    return value.map((entry, index) => deterministicSyncJson({label: `${label}/${index}`, value: entry}))
  }

  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    /** @type {Record<string, import("../configuration-types.js").FrontendModelSyncJsonValue>} */
    const normalized = {}

    for (const key of Object.keys(value).sort()) {
      const childValue = /** @type {Record<string, unknown>} */ (value)[key]

      if (childValue === undefined) continue
      if (syncConfigKeyLooksSecret(key)) {
        throw new Error(`Sync policy ${label}/${key} is not allowed in frontend-visible sync policy config`)
      }

      normalized[key] = deterministicSyncJson({label: `${label}/${key}`, value: childValue})
    }

    return normalized
  }

  throw new Error("Sync policy input must be deterministic JSON")
}

/**
 * Stable JSON stringifier with sorted object keys.
 * @param {unknown} value - Value to stringify.
 * @returns {string} - Stable JSON.
 */
function stableJsonStringify(value) {
  return JSON.stringify(deterministicSyncJson({label: "hash", value}))
}

/**
 * Returns whether a sync config key looks like a credential/secret.
 * @param {string} key - Object key.
 * @returns {boolean} - Whether key is disallowed.
 */
function syncConfigKeyLooksSecret(key) {
  return /secret|token|password|private.?key|signing.?key/i.test(key)
}

/**
 * Runs normalize frontend model resource commands.
 * @param {import("../configuration-types.js").FrontendModelResourceConfiguration} resourceConfiguration - Raw resource configuration.
 * @returns {{builtInCollectionCommands: Record<string, string>, builtInMemberCommands: Record<string, string>, collectionCommands: Record<string, string>, commandMetadata: Record<string, {args: Array<{name: string, type: string}>, returnType: string | null}>, memberCommands: Record<string, string>}} - Normalized command configuration.
 */
function normalizeFrontendModelResourceCommands(resourceConfiguration) {
  const builtInCollectionCommands = resourceConfiguration.builtInCollectionCommands
  const builtInMemberCommands = resourceConfiguration.builtInMemberCommands
  const customCollectionCommands = resourceConfiguration.collectionCommands
  const customMemberCommands = resourceConfiguration.memberCommands
  const normalizedBuiltInCollectionCommands = normalizeFrontendModelBuiltInCommands({
    commandDefaults: {
      create: "create",
      index: "index"
    },
    commandsConfig: builtInCollectionCommands,
    modelName: "CollectionCommand"
  })
  const normalizedBuiltInMemberCommands = normalizeFrontendModelBuiltInCommands({
    commandDefaults: {
      attach: "attach",
      attachmentList: "attachmentList",
      destroy: "destroy",
      download: "download",
      find: "find",
      update: "update",
      url: "url"
    },
    commandsConfig: builtInMemberCommands,
    modelName: "MemberCommand"
  })

  const normalizedCollectionCommands = normalizeFrontendModelCustomCommands({commandsConfig: customCollectionCommands, modelName: "CollectionCommand"})
  const normalizedMemberCommands = normalizeFrontendModelCustomCommands({commandsConfig: customMemberCommands, modelName: "MemberCommand"})

  return {
    builtInCollectionCommands: normalizedBuiltInCollectionCommands,
    builtInMemberCommands: normalizedBuiltInMemberCommands,
    collectionCommands: normalizedCollectionCommands.commands,
    commandMetadata: {...normalizedCollectionCommands.metadata, ...normalizedMemberCommands.metadata},
    memberCommands: normalizedMemberCommands.commands
  }
}

/**
 * Runs normalize frontend model built in commands.
 * @param {object} args - Arguments.
 * @param {Record<string, string>} args.commandDefaults - Built-in default command names.
 * @param {string[] | undefined} args.commandsConfig - Built-in commands config (camelCase command type list).
 * @param {string} args.modelName - Diagnostic model name.
 * @returns {Record<string, string>} - Normalized built-in command config.
 */
function normalizeFrontendModelBuiltInCommands({commandDefaults, commandsConfig, modelName}) {
  if (!commandsConfig) {
    return commandDefaults
  }

  if (!Array.isArray(commandsConfig)) {
    throw new Error(`${modelName} configuration must use the array form. Object form is no longer supported.`)
  }

  /**
   * Normalized commands.
   * @type {Record<string, string>} */
  const normalizedCommands = {}

  for (const commandType of commandsConfig) {
    const defaultCommandName = commandDefaults[commandType]

    if (!defaultCommandName) {
      throw new Error(`Unknown built-in frontend model command '${commandType}' for ${modelName}`)
    }

    normalizedCommands[commandType] = validateFrontendModelResourceCommandName({
      commandName: defaultCommandName,
      commandType: defaultCommandName,
      modelName
    })
  }

  return normalizedCommands
}

/**
 * Runs normalize frontend model custom commands. Entries are either a plain
 * camelCase method-name string or a `{name, args?, returnType?}` object that
 * also declares the command's typed arguments and/or response type.
 * @param {object} args - Arguments.
 * @param {Array<string | {name: string, args?: Array<{name: string, type: string}>, returnType?: string}> | undefined} args.commandsConfig - Custom commands config.
 * @param {string} args.modelName - Diagnostic model name.
 * @returns {{commands: Record<string, string>, metadata: Record<string, {args: Array<{name: string, type: string}>, returnType: string | null}>}} - Route map (method name → kebab slug) + per-command metadata.
 */
function normalizeFrontendModelCustomCommands({commandsConfig, modelName}) {
  if (!commandsConfig) {
    return {commands: {}, metadata: {}}
  }

  if (!Array.isArray(commandsConfig)) {
    throw new Error(`${modelName} configuration must use the array form. Object form is no longer supported.`)
  }

  /** @type {Record<string, string>} */
  const commands = {}
  /** @type {Record<string, {args: Array<{name: string, type: string}>, returnType: string | null}>} */
  const metadata = {}

  for (const commandEntry of commandsConfig) {
    const {methodName, args, returnType} = normalizeFrontendModelCustomCommandEntry({commandEntry, modelName})
    const validatedMethodName = validateFrontendModelResourceCommandName({
      commandName: methodName,
      commandType: methodName,
      modelName
    })
    const commandSlug = inflection.dasherize(inflection.underscore(validatedMethodName))

    commands[validatedMethodName] = commandSlug
    metadata[validatedMethodName] = {args, returnType}
  }

  return {commands, metadata}
}

/**
 * Normalizes one custom-command entry (string shorthand or contract object).
 * @param {object} args - Arguments.
 * @param {unknown} args.commandEntry - Raw command entry.
 * @param {string} args.modelName - Diagnostic model name.
 * @returns {{methodName: string, args: Array<{name: string, type: string}>, returnType: string | null}} - Method name + metadata.
 */
function normalizeFrontendModelCustomCommandEntry({commandEntry, modelName}) {
  if (typeof commandEntry === "string") {
    return {methodName: commandEntry, args: [], returnType: null}
  }

  if (!commandEntry || typeof commandEntry !== "object" || Array.isArray(commandEntry)) {
    throw new Error(`${modelName} entries must be a camelCase name string or a {name, args?, returnType?} object`)
  }

  const {name, args, returnType, ...rest} = /** @type {{name?: unknown, args?: unknown, returnType?: unknown}} */ (commandEntry)

  if (Object.keys(rest).length > 0) {
    throw new Error(`Unexpected ${modelName} keys: ${Object.keys(rest).join(", ")}. Allowed: name, args, returnType`)
  }

  if (typeof name !== "string" || name.length < 1) {
    throw new Error(`${modelName} object entries require a non-empty 'name' string`)
  }

  return {
    methodName: name,
    args: normalizeFrontendModelCommandArgs({args, commandName: name, modelName}),
    returnType: normalizeFrontendModelCommandReturnType({commandName: name, modelName, returnType})
  }
}

/**
 * Validates and normalizes a custom command's typed-argument list.
 * @param {object} args - Arguments.
 * @param {unknown} args.args - Raw command args.
 * @param {string} args.commandName - Command name for diagnostics.
 * @param {string} args.modelName - Diagnostic model name.
 * @returns {Array<{name: string, type: string}>} - Normalized typed command arguments.
 */
function normalizeFrontendModelCommandArgs({args, commandName, modelName}) {
  if (args === undefined || args === null) {
    return []
  }

  if (!Array.isArray(args)) {
    throw new Error(`${modelName} '${commandName}' args must be an array of {name, type} objects`)
  }

  return args.map((arg) => {
    if (!arg || typeof arg !== "object" || typeof arg.name !== "string" || arg.name.length < 1 || typeof arg.type !== "string" || arg.type.trim().length < 1) {
      throw new Error(`${modelName} '${commandName}' args entries require non-empty 'name' and JSDoc-type 'type' strings`)
    }

    return {name: arg.name, type: arg.type.trim()}
  })
}

/**
 * Validates and normalizes a custom command's declared JSDoc return type.
 * @param {object} args - Arguments.
 * @param {string} args.commandName - Command name for diagnostics.
 * @param {string} args.modelName - Diagnostic model name.
 * @param {unknown} args.returnType - Raw return type.
 * @returns {string | null} - Normalized JSDoc return type.
 */
function normalizeFrontendModelCommandReturnType({commandName, modelName, returnType}) {
  if (returnType === undefined || returnType === null) {
    return null
  }

  if (typeof returnType !== "string" || returnType.trim().length < 1) {
    throw new Error(`${modelName} '${commandName}' returnType must be a non-empty JSDoc type string`)
  }

  return returnType.trim()
}

/**
 * Runs the frontendModelResourcePath helper.
 * @param {string} modelName - Model class name.
 * @param {?} resourceDefinition - Resource definition.
 * @returns {string} - Normalized resource path.
 */
export function frontendModelResourcePath(modelName, resourceDefinition) {
  const resourceConfiguration = frontendModelResourceConfigurationFromDefinition(resourceDefinition)

  if (!resourceConfiguration) {
    throw new Error(`Invalid frontend model resource definition for ${modelName}`)
  }

  return `/${inflection.dasherize(inflection.pluralize(inflection.underscore(modelName)))}`
}

/**
 * Runs the frontendModelActionForCommand helper.
 * @param {object} args - Arguments.
 * @param {string} args.commandName - Command path segment.
 * @param {string} args.modelName - Model class name.
 * @param {?} args.resourceDefinition - Resource definition.
 * @returns {"destroy" | "find" | "index" | "create" | "update" | "attach" | "download" | "url" | null} - Frontend action.
 */
export function frontendModelActionForCommand({commandName, modelName, resourceDefinition}) {
  const resourceConfiguration = frontendModelResourceConfigurationFromDefinition(resourceDefinition)

  if (!resourceConfiguration) {
    throw new Error(`Invalid frontend model resource definition for ${modelName}`)
  }

  for (const [action, configuredCommandName] of Object.entries({
    ...resourceConfiguration.builtInCollectionCommands,
    ...resourceConfiguration.builtInMemberCommands
  })) {
    if (configuredCommandName === undefined) continue

    const validatedCommandName = validateFrontendModelResourceCommandName({
      commandName: configuredCommandName,
      commandType: /** @type {"attach" | "create" | "destroy" | "download" | "find" | "index" | "update" | "url"} */ (action),
      modelName
    })

    if (commandName === validatedCommandName) {
      return /** @type {"attach" | "create" | "destroy" | "download" | "find" | "index" | "update" | "url"} */ (action)
    }
  }

  return null
}

/**
 * Runs the frontendModelCustomCommandForPath helper.
 * @param {object} args - Arguments.
 * @param {import("../configuration-types.js").BackendProjectConfiguration[]} args.backendProjects - Backend projects to scan.
 * @param {string} args.currentPath - Request path without query.
 * @returns {{commandName: string, memberId?: string, methodName: string, modelName: string, resourcePath: string, scope: "collection" | "member"} | null} - Matched custom command metadata.
 */
export function frontendModelCustomCommandForPath({backendProjects, currentPath}) {
  const normalizedCurrentPath = normalizeFrontendModelResourcePathForMatch(currentPath)

  for (const backendProject of backendProjects) {
    const resources = frontendModelResourcesForBackendProject(backendProject)

    for (const modelName in resources) {
      const resourceDefinition = resources[modelName]
      const resourceConfiguration = frontendModelResourceConfigurationFromDefinition(resourceDefinition)

      if (!resourceConfiguration) {
        continue
      }

      const resourcePath = normalizeFrontendModelResourcePathForMatch(frontendModelResourcePath(modelName, resourceDefinition))
      const expectedPrefix = `${resourcePath}/`

      if (!normalizedCurrentPath.startsWith(expectedPrefix)) {
        continue
      }

      const pathSegments = normalizedCurrentPath
        .slice(expectedPrefix.length)
        .split("/")
        .filter(Boolean)

      if (pathSegments.length === 1) {
        const matchedCollectionCommand = Object.entries(resourceConfiguration.collectionCommands)
          .find(([, commandName]) => commandName === pathSegments[0])

        if (matchedCollectionCommand) {
          return {
            commandName: matchedCollectionCommand[1],
            methodName: matchedCollectionCommand[0],
            modelName,
            resourcePath,
            scope: "collection"
          }
        }
      }

      if (pathSegments.length === 2) {
        const matchedMemberCommand = Object.entries(resourceConfiguration.memberCommands)
          .find(([, commandName]) => commandName === pathSegments[1])

        if (matchedMemberCommand) {
          return {
            commandName: matchedMemberCommand[1],
            memberId: decodeURIComponent(pathSegments[0]),
            methodName: matchedMemberCommand[0],
            modelName,
            resourcePath,
            scope: "member"
          }
        }
      }
    }
  }

  return null
}

/**
 * Runs normalize frontend model resource path for match.
 * @param {string} path - Path value.
 * @returns {string} - Normalized path with leading slash and no trailing slash.
 */
function normalizeFrontendModelResourcePathForMatch(path) {
  const withLeadingSlash = path.startsWith("/") ? path : `/${path}`

  if (withLeadingSlash.length > 1) {
    return withLeadingSlash.replace(/\/+$/, "")
  }

  return withLeadingSlash
}

/**
 * Resolved frontend-model resource registration for a replay resource type.
 * @typedef {object} FrontendModelResolvedResourceRegistration
 * @property {string} modelName - Effective frontend model name (modelName override or registry key).
 * @property {import("../configuration-types.js").FrontendModelResourceClassType} resourceClass - Registered resource class.
 * @property {import("../configuration-types.js").NormalizedFrontendModelResourceConfiguration} resourceConfiguration - Normalized resource configuration.
 */

/**
 * Resolves the registered frontend-model resource class for a resource type
 * across all backend projects. A resource's effective name is its
 * `modelName` override when declared, otherwise its registry key — matching
 * {@link frontendModelSyncManifestForBackendProjects}. A registry key shadowed
 * by a `modelName` override does not resolve.
 * @param {object} args - Options.
 * @param {{getBackendProjects: () => import("../configuration-types.js").BackendProjectConfiguration[]}} args.configuration - Configuration exposing the backend projects.
 * @param {string} args.resourceType - Frontend model name to resolve.
 * @returns {FrontendModelResolvedResourceRegistration | null} Resolved registration or null when the resource type is not registered.
 */
export function resolveFrontendModelResourceClass({configuration, resourceType}) {
  for (const backendProject of configuration.getBackendProjects()) {
    const resources = frontendModelResourcesForBackendProject(backendProject)

    for (const configuredModelName of Object.keys(resources)) {
      const resourceDefinition = resources[configuredModelName]
      const resourceClass = frontendModelResourceClassFromDefinition(resourceDefinition)

      if (!resourceClass) continue

      // Cheap direct-key mismatch skip: only normalize configurations for the
      // matching key or when a modelName override could rename the resource.
      if (configuredModelName !== resourceType && !resourceClass.sharedResourceStaticValue("modelName")) continue

      const resourceConfiguration = frontendModelResourceConfigurationFromDefinition(resourceDefinition)

      if (!resourceConfiguration) continue
      if ((resourceConfiguration.modelName || configuredModelName) !== resourceType) continue

      return {modelName: resourceType, resourceClass, resourceConfiguration}
    }
  }

  return null
}
