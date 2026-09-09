// @ts-check
import * as inflection from "inflection";
import FrontendModelBaseResource from "../frontend-model-resource/base-resource.js";
import restArgsError from "../utils/rest-args-error.js";
import sha256Hex from "../utils/sha256-hex.js";
import { validateFrontendModelResourceCommandName } from "./resource-config-validation.js";
/**
 * Resolved frontend-model resource registration for a replay resource type.
 * @typedef {object} FrontendModelResolvedResourceRegistration
 * @property {string} modelName - Effective frontend model name (modelName override or registry key).
 * @property {import("../configuration-types.js").FrontendModelResourceClassType} resourceClass - Registered resource class.
 * @property {import("../configuration-types.js").NormalizedFrontendModelResourceConfiguration} resourceConfiguration - Normalized resource configuration.
 */
const BASE_FRONTEND_MODEL_ABILITY_ACTIONS = ["create", "destroy", "read", "update"];
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
    "ReplayServiceClass",
    "server",
    "SharedResource",
    "sync",
    "translatedAttributes",
    "writableAttributes"
]);
/**
 * Runs the frontendModelResourcesForBackendProject helper.
 * @param {import("../configuration-types.js").BackendProjectConfiguration} backendProject - Backend project config.
 * @returns {Record<string, import("../configuration-types.js").FrontendModelResourceClassType>} - Resource definitions keyed by model name.
 */
export function frontendModelResourcesForBackendProject(backendProject) {
    const resources = backendProject.frontendModels;
    if (resources !== undefined) {
        if (!resources || typeof resources !== "object") {
            throw new Error(`Expected backend project frontendModels object but got: ${resources}`);
        }
        return resources;
    }
    return {};
}
/**
 * Runs the frontendModelResourceDefinitionIsClass helper.
 * @param {ReturnType<typeof JSON.parse>} value - Candidate resource definition.
 * @returns {value is import("../configuration-types.js").FrontendModelResourceClassType} - Whether value is a resource class.
 */
export function frontendModelResourceDefinitionIsClass(value) {
    return typeof value === "function" && (value === FrontendModelBaseResource || value.prototype instanceof FrontendModelBaseResource);
}
/**
 * Runs the frontendModelResourceClassFromDefinition helper.
 * @param {ReturnType<typeof JSON.parse>} resourceDefinition - Resource definition.
 * @returns {import("../configuration-types.js").FrontendModelResourceClassType | null} - Resource class when definition is class-based.
 */
export function frontendModelResourceClassFromDefinition(resourceDefinition) {
    return frontendModelResourceDefinitionIsClass(resourceDefinition) ? resourceDefinition : null;
}
/**
 * Runs the frontendModelResourceConfigurationFromDefinition helper.
 * @param {ReturnType<typeof JSON.parse>} resourceDefinition - Resource definition.
 * @returns {import("../configuration-types.js").NormalizedFrontendModelResourceConfiguration | null} - Normalized resource configuration.
 */
export function frontendModelResourceConfigurationFromDefinition(resourceDefinition) {
    if (!frontendModelResourceDefinitionIsClass(resourceDefinition))
        return null;
    assertResourceConfigIsFrameworkDefined(resourceDefinition);
    return normalizeFrontendModelResourceConfiguration(resourceDefinition.resourceConfig());
}
/**
 * Ensures resources use declarative static config properties instead of overriding resourceConfig().
 * @param {import("../configuration-types.js").FrontendModelResourceClassType} ResourceClass - Resource class.
 * @param {Set<import("../configuration-types.js").FrontendModelResourceClassType>} [visited] - Already inspected shared resources.
 * @returns {void}
 */
function assertResourceConfigIsFrameworkDefined(ResourceClass, visited = new Set()) {
    if (visited.has(ResourceClass))
        return;
    visited.add(ResourceClass);
    assertKnownResourceStaticConfigProperties(ResourceClass);
    const owner = staticMethodOwnerFor(ResourceClass, "resourceConfig");
    if (owner && owner !== FrontendModelBaseResource) {
        throw new Error(`${ResourceClass.name} overrides static resourceConfig(), which is not supported. Use static resource properties instead.`);
    }
    const SharedResource = ResourceClass.sharedResourceClass();
    if (SharedResource)
        assertResourceConfigIsFrameworkDefined(SharedResource, visited);
}
/**
 * Ensures declarative static resource config does not silently ignore typos or removed keys.
 * @param {import("../configuration-types.js").FrontendModelResourceClassType} ResourceClass - Resource class.
 * @returns {void}
 */
function assertKnownResourceStaticConfigProperties(ResourceClass) {
    let currentClass = ResourceClass;
    while (currentClass && currentClass !== FrontendModelBaseResource && currentClass !== Function.prototype) {
        /** @type {Record<string, ReturnType<typeof JSON.parse>>} */
        const unknownStaticConfig = {};
        for (const key of Object.keys(currentClass)) {
            if (!RESOURCE_STATIC_CONFIG_KEYS.has(key))
                unknownStaticConfig[key] = /** @type {Record<string, ReturnType<typeof JSON.parse>>} */ ( /** @type {unknown} */(currentClass))[key];
        }
        restArgsError(unknownStaticConfig);
        currentClass = Object.getPrototypeOf(currentClass);
    }
}
/**
 * Locates which constructor owns a static method implementation.
 * @param {import("../configuration-types.js").FrontendModelResourceClassType} ResourceClass - Resource class.
 * @param {string} methodName - Method name.
 * @returns {import("../configuration-types.js").FrontendModelResourceClassType | typeof FrontendModelBaseResource | null} - Class that owns the static method.
 */
function staticMethodOwnerFor(ResourceClass, methodName) {
    let currentClass = ResourceClass;
    while (currentClass && currentClass !== Function.prototype) {
        if (Object.prototype.hasOwnProperty.call(currentClass, methodName))
            return currentClass;
        currentClass = Object.getPrototypeOf(currentClass);
    }
    return null;
}
/**
 * Runs normalize frontend model resource configuration.
 * @param {import("../configuration-types.js").FrontendModelResourceConfiguration} resourceConfiguration - Raw resource configuration.
 * @returns {import("../configuration-types.js").NormalizedFrontendModelResourceConfiguration} - Normalized resource configuration.
 */
function normalizeFrontendModelResourceConfiguration(resourceConfiguration) {
    const restArgs = /** @type {Record<string, ReturnType<typeof JSON.parse>>} */ ({ ...resourceConfiguration });
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
        delete restArgs[key];
    }
    restArgsError(restArgs);
    validateFrontendModelResourcePrimaryKey(resourceConfiguration.primaryKey);
    const normalizedCommands = normalizeFrontendModelResourceCommands(resourceConfiguration);
    const sync = normalizeFrontendModelResourceSync(resourceConfiguration);
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
    };
}
/**
 * Validates a resource primary-key definition before it can be used to build CRUD conditions.
 * @param {import("../utils/model-primary-key.js").ModelPrimaryKeyDefinition | undefined} primaryKey - Resource primary key.
 * @returns {void}
 */
function validateFrontendModelResourcePrimaryKey(primaryKey) {
    if (!Array.isArray(primaryKey))
        return;
    if (primaryKey.length === 0) {
        throw new Error("Resource primaryKey arrays must contain at least one attribute.");
    }
    if (new Set(primaryKey).size !== primaryKey.length) {
        throw new Error("Resource primaryKey arrays must contain unique attributes.");
    }
}
/**
 * Runs normalize frontend model resource abilities.
 * @param {string[] | undefined} abilities - Resource abilities config (camelCase action list).
 * @returns {Record<string, string>} - Normalized abilities config.
 */
function normalizeFrontendModelResourceAbilities(abilities) {
    const normalized = defaultCrudAbilities();
    if (abilities === undefined)
        return normalized;
    if (!Array.isArray(abilities)) {
        throw new Error("Resource abilities must be an array of action names. Object form is no longer supported.");
    }
    const duplicatedBaseAbilities = abilities.filter((ability) => BASE_FRONTEND_MODEL_ABILITY_ACTIONS.includes(ability));
    if (duplicatedBaseAbilities.length > 0) {
        throw new Error(`Resource abilities must not include base actions: ${duplicatedBaseAbilities.join(", ")}`);
    }
    for (const ability of abilities) {
        if (typeof ability !== "string" || ability.length < 1) {
            throw new Error("Resource abilities entries must be non-empty strings.");
        }
        normalized[ability] = ability;
    }
    return normalized;
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
    };
}
/**
 * Builds a frontend-safe sync manifest for all sync-enabled frontend-model resources.
 * @param {import("../configuration-types.js").BackendProjectConfiguration[]} backendProjects - Backend projects to scan.
 * @returns {Record<string, import("../configuration-types.js").NormalizedFrontendModelResourceSyncConfiguration>} - Sync metadata keyed by model name.
 */
export function frontendModelSyncManifestForBackendProjects(backendProjects) {
    /** @type {Record<string, import("../configuration-types.js").NormalizedFrontendModelResourceSyncConfiguration>} */
    const manifest = {};
    for (const backendProject of backendProjects) {
        const resources = frontendModelResourcesForBackendProject(backendProject);
        for (const configuredModelName of Object.keys(resources).sort()) {
            const resourceDefinition = resources[configuredModelName];
            const resourceConfiguration = frontendModelResourceConfigurationFromDefinition(resourceDefinition);
            if (!resourceConfiguration)
                continue;
            if (!resourceConfiguration.sync?.enabled)
                continue;
            const modelName = resourceConfiguration.modelName || configuredModelName;
            manifest[modelName] = resourceConfiguration.sync;
        }
    }
    return manifest;
}
/**
 * Builds a frontend-safe API manifest for all registered frontend-model
 * resources. The manifest is deterministic (sorted model names, sorted
 * attributes, sorted commands) and includes only public-safe metadata: no
 * secrets, no server callbacks, no backend file paths.
 * @param {import("../configuration-types.js").BackendProjectConfiguration[]} backendProjects - Backend projects to scan.
 * @returns {Record<string, unknown>} - Frontend-safe API manifest.
 */
export function frontendModelApiManifest(backendProjects) {
    /** @type {Record<string, unknown>} */
    const resources = {};
    for (const backendProject of backendProjects) {
        const projectResources = frontendModelResourcesForBackendProject(backendProject);
        for (const configuredModelName of Object.keys(projectResources).sort()) {
            const resourceDefinition = projectResources[configuredModelName];
            const resourceConfiguration = frontendModelResourceConfigurationFromDefinition(resourceDefinition);
            const resourceClass = frontendModelResourceClassFromDefinition(resourceDefinition);
            if (!resourceConfiguration || !resourceClass)
                continue;
            const modelName = resourceConfiguration.modelName || configuredModelName;
            const resourcePath = `/${inflection.dasherize(inflection.pluralize(inflection.underscore(configuredModelName)))}`;
            /** @type {Record<string, unknown>} */
            const entry = {
                modelName,
                path: resourcePath,
                primaryKey: resourceClass.resolvedPrimaryKey(resourceConfiguration),
                attributes: manifestAttributes(resourceConfiguration.attributes),
                abilities: resourceConfiguration.abilities,
                builtInCommands: {
                    collection: resourceConfiguration.builtInCollectionCommands,
                    member: resourceConfiguration.builtInMemberCommands
                }
            };
            const relationships = resourceConfiguration.relationships;
            if (relationships && relationships.length > 0) {
                /** @type {Record<string, unknown>} */
                const rels = {};
                for (const relName of relationships) {
                    rels[relName] = {};
                }
                entry.relationships = rels;
            }
            const attachments = resourceConfiguration.attachments;
            if (attachments && Object.keys(attachments).length > 0) {
                entry.attachments = attachments;
            }
            const collectionCommands = manifestCommandEntries({
                commandMetadata: resourceConfiguration.commandMetadata || {},
                commands: resourceConfiguration.collectionCommands,
                resourcePath,
                scope: "collection"
            });
            const memberCommands = manifestCommandEntries({
                commandMetadata: resourceConfiguration.commandMetadata || {},
                commands: resourceConfiguration.memberCommands,
                resourcePath,
                scope: "member"
            });
            if (collectionCommands.length > 0 || memberCommands.length > 0) {
                /** @type {Record<string, unknown>} */
                const cmds = {};
                if (collectionCommands.length > 0)
                    cmds["collection"] = collectionCommands;
                if (memberCommands.length > 0)
                    cmds["member"] = memberCommands;
                entry.commands = cmds;
            }
            if (resourceConfiguration.sync?.enabled) {
                entry.sync = resourceConfiguration.sync;
            }
            resources[configuredModelName] = entry;
        }
    }
    return {
        formatVersion: 1,
        resources: Object.keys(resources).sort().reduce((sorted, key) => {
            /** @type {Record<string, unknown>} */ (sorted)[key] = resources[key];
            return sorted;
        }, /** @type {Record<string, unknown>} */ ({}))
    };
}
/**
 * Normalizes resource attribute definitions into a sorted array of strings.
 * @param {ReturnType<typeof JSON.parse>} attributes - Raw attributes config (array or object).
 * @returns {string[]} - Sorted attribute names.
 */
function manifestAttributes(attributes) {
    if (!attributes)
        return [];
    let names;
    if (Array.isArray(attributes)) {
        names = attributes.map((entry) => typeof entry === "string" ? entry : entry.name).filter(Boolean);
    }
    else if (attributes && typeof attributes === "object") {
        names = Object.keys(attributes);
    }
    else {
        return [];
    }
    return names.sort();
}
/**
 * Builds manifest-safe command entry list.
 * @param {object} args - Arguments.
 * @param {Record<string, {args: Array<{name: string, type: string}>, returnType: string | null}>} args.commandMetadata - Per-command metadata.
 * @param {Record<string, string>} args.commands - Method name → kebab slug map.
 * @param {string} args.resourcePath - Resource path.
 * @param {"collection" | "member"} args.scope - Command scope.
 * @returns {Record<string, unknown>[]} - Manifest command entries.
 */
function manifestCommandEntries({ commandMetadata, commands, resourcePath, scope }) {
    return Object.keys(commands).sort().map((methodName) => {
        const slug = commands[methodName];
        const metadata = commandMetadata[methodName] || { args: [], returnType: null };
        const path = scope === "member"
            ? `${resourcePath}/<id>/${slug}`
            : `${resourcePath}/${slug}`;
        /** @type {Record<string, unknown>} */
        const entry = {
            methodName,
            scope,
            path,
            args: metadata.args
        };
        if (metadata.returnType) {
            entry.returnType = metadata.returnType;
        }
        return entry;
    });
}
/**
 * Normalizes sync policy metadata and computes a deterministic hash from safe policy inputs.
 * @param {import("../configuration-types.js").FrontendModelResourceConfiguration} resourceConfiguration - Raw resource configuration.
 * @returns {import("../configuration-types.js").NormalizedFrontendModelResourceSyncConfiguration | undefined} - Frontend-safe sync metadata.
 */
function normalizeFrontendModelResourceSync(resourceConfiguration) {
    const sync = resourceConfiguration.sync;
    if (sync === undefined || sync === null)
        return undefined;
    if (sync === false)
        return { conflictStrategy: "optimisticVersion", enabled: false, operations: [], policyHash: syncPolicyHash({ conflictStrategy: "optimisticVersion", enabled: false }), policyVersion: null };
    if (sync === true) {
        return normalizeFrontendModelResourceSync({
            ...resourceConfiguration,
            sync: { operations: ["index", "find"] }
        });
    }
    if (!sync || typeof sync !== "object" || Array.isArray(sync)) {
        throw new Error("Resource sync configuration must be true, false, or an object.");
    }
    const { conflictStrategy, enabled = true, metadata, operations, policy, policyVersion, ...rest } = /** @type {import("../configuration-types.js").FrontendModelResourceSyncConfiguration} */ (sync);
    if (Object.keys(rest).length > 0) {
        throw new Error(`Unexpected sync keys: ${Object.keys(rest).join(", ")}. Allowed: conflictStrategy, enabled, metadata, operations, policy, policyVersion`);
    }
    if (enabled !== true && enabled !== false)
        throw new Error("Resource sync enabled must be true or false when provided.");
    const normalizedConflictStrategy = normalizeSyncConflictStrategy(conflictStrategy);
    const normalizedOperations = normalizeSyncOperations(operations);
    const normalizedMetadata = metadata === undefined ? undefined : deterministicSyncJson({ label: "metadata", value: metadata });
    const normalizedPolicy = policy === undefined ? undefined : deterministicSyncJson({ label: "policy", value: policy });
    const normalizedPolicyVersion = policyVersion === undefined || policyVersion === null ? null : String(policyVersion);
    const hashInput = {
        conflictStrategy: normalizedConflictStrategy,
        enabled,
        metadata: normalizedMetadata,
        modelName: resourceConfiguration.modelName || null,
        operations: normalizedOperations,
        policy: normalizedPolicy,
        policyVersion: normalizedPolicyVersion
    };
    /** @type {import("../configuration-types.js").NormalizedFrontendModelResourceSyncConfiguration} */
    const normalized = {
        conflictStrategy: normalizedConflictStrategy,
        enabled,
        operations: normalizedOperations,
        policyHash: syncPolicyHash(hashInput),
        policyVersion: normalizedPolicyVersion
    };
    if (normalizedMetadata !== undefined)
        normalized.metadata = /** @type {Record<string, import("../configuration-types.js").FrontendModelSyncJsonValue>} */ (normalizedMetadata);
    return normalized;
}
/**
 * Normalizes the sync conflict strategy for replay clients/servers.
 * @param {unknown} conflictStrategy - Raw strategy.
 * @returns {"optimisticVersion" | "serverWins" | "lastWriterWins" | "fieldThreeWay" | "appendOnly"} - Normalized strategy.
 */
function normalizeSyncConflictStrategy(conflictStrategy) {
    if (conflictStrategy === undefined || conflictStrategy === null)
        return "optimisticVersion";
    if (["optimisticVersion", "serverWins", "lastWriterWins", "fieldThreeWay", "appendOnly"].includes(String(conflictStrategy))) {
        return /** @type {"optimisticVersion" | "serverWins" | "lastWriterWins" | "fieldThreeWay" | "appendOnly"} */ (conflictStrategy);
    }
    throw new Error(`Unknown resource sync conflictStrategy: ${String(conflictStrategy)}`);
}
/**
 * Normalizes sync operations into a stable, duplicate-free list.
 * @param {unknown} operations - Raw operations value.
 * @returns {string[]} - Normalized operations.
 */
function normalizeSyncOperations(operations) {
    if (operations === undefined)
        return [];
    if (!Array.isArray(operations))
        throw new Error("Resource sync operations must be an array of operation names.");
    const normalized = operations.map((operation) => {
        if (typeof operation !== "string" || operation.length < 1)
            throw new Error("Resource sync operations entries must be non-empty strings.");
        return operation;
    });
    return [...new Set(normalized)].sort();
}
/**
 * Builds a deterministic policy hash.
 * @param {unknown} value - Hash input.
 * @returns {string} - sha256-prefixed hash.
 */
function syncPolicyHash(value) {
    return `sha256-${sha256Hex(stableJsonStringify(value))}`;
}
/**
 * Validates that a sync config subtree is deterministic JSON and does not contain obvious secrets.
 * @param {object} args - Arguments.
 * @param {string} args.label - Diagnostic path label.
 * @param {unknown} args.value - Value to validate.
 * @returns {import("../configuration-types.js").FrontendModelSyncJsonValue} - Stable JSON value.
 */
function deterministicSyncJson({ label, value }) {
    if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean")
        return value;
    if (Array.isArray(value)) {
        return value.map((entry, index) => deterministicSyncJson({ label: `${label}/${index}`, value: entry }));
    }
    if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
        /** @type {Record<string, import("../configuration-types.js").FrontendModelSyncJsonValue>} */
        const normalized = {};
        for (const key of Object.keys(value).sort()) {
            const childValue = /** @type {Record<string, unknown>} */ (value)[key];
            if (childValue === undefined)
                continue;
            if (syncConfigKeyLooksSecret(key)) {
                throw new Error(`Sync policy ${label}/${key} is not allowed in frontend-visible sync policy config`);
            }
            normalized[key] = deterministicSyncJson({ label: `${label}/${key}`, value: childValue });
        }
        return normalized;
    }
    throw new Error("Sync policy input must be deterministic JSON");
}
/**
 * Stable JSON stringifier with sorted object keys.
 * @param {unknown} value - Value to stringify.
 * @returns {string} - Stable JSON.
 */
function stableJsonStringify(value) {
    return JSON.stringify(deterministicSyncJson({ label: "hash", value }));
}
/**
 * Returns whether a sync config key looks like a credential/secret.
 * @param {string} key - Object key.
 * @returns {boolean} - Whether key is disallowed.
 */
function syncConfigKeyLooksSecret(key) {
    return /secret|token|password|private.?key|signing.?key/i.test(key);
}
/**
 * Runs normalize frontend model resource commands.
 * @param {import("../configuration-types.js").FrontendModelResourceConfiguration} resourceConfiguration - Raw resource configuration.
 * @returns {{builtInCollectionCommands: Record<string, string>, builtInMemberCommands: Record<string, string>, collectionCommands: Record<string, string>, commandMetadata: Record<string, {args: Array<{name: string, type: string}>, returnType: string | null}>, memberCommands: Record<string, string>}} - Normalized command configuration.
 */
function normalizeFrontendModelResourceCommands(resourceConfiguration) {
    const builtInCollectionCommands = resourceConfiguration.builtInCollectionCommands;
    const builtInMemberCommands = resourceConfiguration.builtInMemberCommands;
    const customCollectionCommands = resourceConfiguration.collectionCommands;
    const customMemberCommands = resourceConfiguration.memberCommands;
    const normalizedBuiltInCollectionCommands = normalizeFrontendModelBuiltInCommands({
        commandDefaults: {
            create: "create",
            index: "index"
        },
        commandsConfig: builtInCollectionCommands,
        modelName: "CollectionCommand"
    });
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
    });
    const normalizedCollectionCommands = normalizeFrontendModelCustomCommands({ commandsConfig: customCollectionCommands, modelName: "CollectionCommand" });
    const normalizedMemberCommands = normalizeFrontendModelCustomCommands({ commandsConfig: customMemberCommands, modelName: "MemberCommand" });
    return {
        builtInCollectionCommands: normalizedBuiltInCollectionCommands,
        builtInMemberCommands: normalizedBuiltInMemberCommands,
        collectionCommands: normalizedCollectionCommands.commands,
        commandMetadata: { ...normalizedCollectionCommands.metadata, ...normalizedMemberCommands.metadata },
        memberCommands: normalizedMemberCommands.commands
    };
}
/**
 * Runs normalize frontend model built in commands.
 * @param {object} args - Arguments.
 * @param {Record<string, string>} args.commandDefaults - Built-in default command names.
 * @param {string[] | undefined} args.commandsConfig - Built-in commands config (camelCase command type list).
 * @param {string} args.modelName - Diagnostic model name.
 * @returns {Record<string, string>} - Normalized built-in command config.
 */
function normalizeFrontendModelBuiltInCommands({ commandDefaults, commandsConfig, modelName }) {
    if (!commandsConfig) {
        return commandDefaults;
    }
    if (!Array.isArray(commandsConfig)) {
        throw new Error(`${modelName} configuration must use the array form. Object form is no longer supported.`);
    }
    /**
     * Normalized commands.
     * @type {Record<string, string>} */
    const normalizedCommands = {};
    for (const commandType of commandsConfig) {
        const defaultCommandName = commandDefaults[commandType];
        if (!defaultCommandName) {
            throw new Error(`Unknown built-in frontend model command '${commandType}' for ${modelName}`);
        }
        normalizedCommands[commandType] = validateFrontendModelResourceCommandName({
            commandName: defaultCommandName,
            commandType: defaultCommandName,
            modelName
        });
    }
    return normalizedCommands;
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
function normalizeFrontendModelCustomCommands({ commandsConfig, modelName }) {
    if (!commandsConfig) {
        return { commands: {}, metadata: {} };
    }
    if (!Array.isArray(commandsConfig)) {
        throw new Error(`${modelName} configuration must use the array form. Object form is no longer supported.`);
    }
    /** @type {Record<string, string>} */
    const commands = {};
    /** @type {Record<string, {args: Array<{name: string, type: string}>, returnType: string | null}>} */
    const metadata = {};
    for (const commandEntry of commandsConfig) {
        const { methodName, args, returnType } = normalizeFrontendModelCustomCommandEntry({ commandEntry, modelName });
        const validatedMethodName = validateFrontendModelResourceCommandName({
            commandName: methodName,
            commandType: methodName,
            modelName
        });
        const commandSlug = inflection.dasherize(inflection.underscore(validatedMethodName));
        commands[validatedMethodName] = commandSlug;
        metadata[validatedMethodName] = { args, returnType };
    }
    return { commands, metadata };
}
/**
 * Normalizes one custom-command entry (string shorthand or contract object).
 * @param {object} args - Arguments.
 * @param {unknown} args.commandEntry - Raw command entry.
 * @param {string} args.modelName - Diagnostic model name.
 * @returns {{methodName: string, args: Array<{name: string, type: string}>, returnType: string | null}} - Method name + metadata.
 */
function normalizeFrontendModelCustomCommandEntry({ commandEntry, modelName }) {
    if (typeof commandEntry === "string") {
        return { methodName: commandEntry, args: [], returnType: null };
    }
    if (!commandEntry || typeof commandEntry !== "object" || Array.isArray(commandEntry)) {
        throw new Error(`${modelName} entries must be a camelCase name string or a {name, args?, returnType?} object`);
    }
    const { name, args, returnType, ...rest } = /** @type {{name?: unknown, args?: unknown, returnType?: unknown}} */ (commandEntry);
    if (Object.keys(rest).length > 0) {
        throw new Error(`Unexpected ${modelName} keys: ${Object.keys(rest).join(", ")}. Allowed: name, args, returnType`);
    }
    if (typeof name !== "string" || name.length < 1) {
        throw new Error(`${modelName} object entries require a non-empty 'name' string`);
    }
    return {
        methodName: name,
        args: normalizeFrontendModelCommandArgs({ args, commandName: name, modelName }),
        returnType: normalizeFrontendModelCommandReturnType({ commandName: name, modelName, returnType })
    };
}
/**
 * Validates and normalizes a custom command's typed-argument list.
 * @param {object} args - Arguments.
 * @param {unknown} args.args - Raw command args.
 * @param {string} args.commandName - Command name for diagnostics.
 * @param {string} args.modelName - Diagnostic model name.
 * @returns {Array<{name: string, type: string}>} - Normalized typed command arguments.
 */
function normalizeFrontendModelCommandArgs({ args, commandName, modelName }) {
    if (args === undefined || args === null) {
        return [];
    }
    if (!Array.isArray(args)) {
        throw new Error(`${modelName} '${commandName}' args must be an array of {name, type} objects`);
    }
    return args.map((arg) => {
        if (!arg || typeof arg !== "object" || typeof arg.name !== "string" || arg.name.length < 1 || typeof arg.type !== "string" || arg.type.trim().length < 1) {
            throw new Error(`${modelName} '${commandName}' args entries require non-empty 'name' and JSDoc-type 'type' strings`);
        }
        return { name: arg.name, type: arg.type.trim() };
    });
}
/**
 * Validates and normalizes a custom command's declared JSDoc return type.
 * @param {object} args - Arguments.
 * @param {string} args.commandName - Command name for diagnostics.
 * @param {string} args.modelName - Diagnostic model name.
 * @param {unknown} args.returnType - Raw return type.
 * @returns {string | null} - Normalized JSDoc return type.
 */
function normalizeFrontendModelCommandReturnType({ commandName, modelName, returnType }) {
    if (returnType === undefined || returnType === null) {
        return null;
    }
    if (typeof returnType !== "string" || returnType.trim().length < 1) {
        throw new Error(`${modelName} '${commandName}' returnType must be a non-empty JSDoc type string`);
    }
    return returnType.trim();
}
/**
 * Runs the frontendModelResourcePath helper.
 * @param {string} modelName - Model class name.
 * @param {ReturnType<typeof JSON.parse>} resourceDefinition - Resource definition.
 * @returns {string} - Normalized resource path.
 */
export function frontendModelResourcePath(modelName, resourceDefinition) {
    const resourceConfiguration = frontendModelResourceConfigurationFromDefinition(resourceDefinition);
    if (!resourceConfiguration) {
        throw new Error(`Invalid frontend model resource definition for ${modelName}`);
    }
    return `/${inflection.dasherize(inflection.pluralize(inflection.underscore(modelName)))}`;
}
/**
 * Runs the frontendModelActionForCommand helper.
 * @param {object} args - Arguments.
 * @param {string} args.commandName - Command path segment.
 * @param {string} args.modelName - Model class name.
 * @param {ReturnType<typeof JSON.parse>} args.resourceDefinition - Resource definition.
 * @returns {"destroy" | "find" | "index" | "create" | "update" | "attach" | "download" | "url" | null} - Frontend action.
 */
export function frontendModelActionForCommand({ commandName, modelName, resourceDefinition }) {
    const resourceConfiguration = frontendModelResourceConfigurationFromDefinition(resourceDefinition);
    if (!resourceConfiguration) {
        throw new Error(`Invalid frontend model resource definition for ${modelName}`);
    }
    for (const [action, configuredCommandName] of Object.entries({
        ...resourceConfiguration.builtInCollectionCommands,
        ...resourceConfiguration.builtInMemberCommands
    })) {
        if (configuredCommandName === undefined)
            continue;
        const validatedCommandName = validateFrontendModelResourceCommandName({
            commandName: configuredCommandName,
            commandType: /** @type {"attach" | "create" | "destroy" | "download" | "find" | "index" | "update" | "url"} */ (action),
            modelName
        });
        if (commandName === validatedCommandName) {
            return /** @type {"attach" | "create" | "destroy" | "download" | "find" | "index" | "update" | "url"} */ (action);
        }
    }
    return null;
}
/**
 * Runs the frontendModelCustomCommandForPath helper.
 * @param {object} args - Arguments.
 * @param {import("../configuration-types.js").BackendProjectConfiguration[]} args.backendProjects - Backend projects to scan.
 * @param {string} args.currentPath - Request path without query.
 * @returns {{commandName: string, memberId?: string, methodName: string, modelName: string, resourcePath: string, scope: "collection" | "member"} | null} - Matched custom command metadata.
 */
export function frontendModelCustomCommandForPath({ backendProjects, currentPath }) {
    const normalizedCurrentPath = normalizeFrontendModelResourcePathForMatch(currentPath);
    for (const backendProject of backendProjects) {
        const resources = frontendModelResourcesForBackendProject(backendProject);
        for (const modelName in resources) {
            const resourceDefinition = resources[modelName];
            const resourceConfiguration = frontendModelResourceConfigurationFromDefinition(resourceDefinition);
            if (!resourceConfiguration) {
                continue;
            }
            const resourcePath = normalizeFrontendModelResourcePathForMatch(frontendModelResourcePath(modelName, resourceDefinition));
            const expectedPrefix = `${resourcePath}/`;
            if (!normalizedCurrentPath.startsWith(expectedPrefix)) {
                continue;
            }
            const pathSegments = normalizedCurrentPath
                .slice(expectedPrefix.length)
                .split("/")
                .filter(Boolean);
            if (pathSegments.length === 1) {
                const matchedCollectionCommand = Object.entries(resourceConfiguration.collectionCommands)
                    .find(([, commandName]) => commandName === pathSegments[0]);
                if (matchedCollectionCommand) {
                    return {
                        commandName: matchedCollectionCommand[1],
                        methodName: matchedCollectionCommand[0],
                        modelName,
                        resourcePath,
                        scope: "collection"
                    };
                }
            }
            if (pathSegments.length === 2) {
                const matchedMemberCommand = Object.entries(resourceConfiguration.memberCommands)
                    .find(([, commandName]) => commandName === pathSegments[1]);
                if (matchedMemberCommand) {
                    return {
                        commandName: matchedMemberCommand[1],
                        memberId: decodeURIComponent(pathSegments[0]),
                        methodName: matchedMemberCommand[0],
                        modelName,
                        resourcePath,
                        scope: "member"
                    };
                }
            }
        }
    }
    return null;
}
/**
 * Runs normalize frontend model resource path for match.
 * @param {string} path - Path value.
 * @returns {string} - Normalized path with leading slash and no trailing slash.
 */
function normalizeFrontendModelResourcePathForMatch(path) {
    const withLeadingSlash = path.startsWith("/") ? path : `/${path}`;
    if (withLeadingSlash.length > 1) {
        return withLeadingSlash.replace(/\/+$/, "");
    }
    return withLeadingSlash;
}
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
export function resolveFrontendModelResourceClass({ configuration, resourceType }) {
    for (const backendProject of configuration.getBackendProjects()) {
        const resources = frontendModelResourcesForBackendProject(backendProject);
        for (const configuredModelName of Object.keys(resources)) {
            const resourceDefinition = resources[configuredModelName];
            const resourceClass = frontendModelResourceClassFromDefinition(resourceDefinition);
            if (!resourceClass)
                continue;
            // Cheap direct-key mismatch skip: only normalize configurations for the
            // matching key or when a modelName override could rename the resource.
            if (configuredModelName !== resourceType && !resourceClass.sharedResourceStaticValue("modelName"))
                continue;
            const resourceConfiguration = frontendModelResourceConfigurationFromDefinition(resourceDefinition);
            if (!resourceConfiguration)
                continue;
            if ((resourceConfiguration.modelName || configuredModelName) !== resourceType)
                continue;
            return { modelName: resourceType, resourceClass, resourceConfiguration };
        }
    }
    return null;
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicmVzb3VyY2UtZGVmaW5pdGlvbi5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9mcm9udGVuZC1tb2RlbHMvcmVzb3VyY2UtZGVmaW5pdGlvbi5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxZQUFZO0FBRVosT0FBTyxLQUFLLFVBQVUsTUFBTSxZQUFZLENBQUE7QUFDeEMsT0FBTyx5QkFBeUIsTUFBTSw2Q0FBNkMsQ0FBQTtBQUNuRixPQUFPLGFBQWEsTUFBTSw2QkFBNkIsQ0FBQTtBQUN2RCxPQUFPLFNBQVMsTUFBTSx3QkFBd0IsQ0FBQTtBQUM5QyxPQUFPLEVBQUMsd0NBQXdDLEVBQUMsTUFBTSxpQ0FBaUMsQ0FBQTtBQUV4Rjs7Ozs7O0dBTUc7QUFDSCxNQUFNLG1DQUFtQyxHQUFHLENBQUMsUUFBUSxFQUFFLFNBQVMsRUFBRSxNQUFNLEVBQUUsUUFBUSxDQUFDLENBQUE7QUFDbkYsTUFBTSwyQkFBMkIsR0FBRyxJQUFJLEdBQUcsQ0FBQztJQUMxQyxXQUFXO0lBQ1gsYUFBYTtJQUNiLFlBQVk7SUFDWiwyQkFBMkI7SUFDM0IsdUJBQXVCO0lBQ3ZCLG9CQUFvQjtJQUNwQixVQUFVO0lBQ1YsZ0JBQWdCO0lBQ2hCLFdBQVc7SUFDWCxZQUFZO0lBQ1osWUFBWTtJQUNaLG9CQUFvQjtJQUNwQixlQUFlO0lBQ2Ysb0JBQW9CO0lBQ3BCLFFBQVE7SUFDUixnQkFBZ0I7SUFDaEIsTUFBTTtJQUNOLHNCQUFzQjtJQUN0QixvQkFBb0I7Q0FDckIsQ0FBQyxDQUFBO0FBRUY7Ozs7R0FJRztBQUNILE1BQU0sVUFBVSx1Q0FBdUMsQ0FBQyxjQUFjO0lBQ3BFLE1BQU0sU0FBUyxHQUFHLGNBQWMsQ0FBQyxjQUFjLENBQUE7SUFFL0MsSUFBSSxTQUFTLEtBQUssU0FBUyxFQUFFLENBQUM7UUFDNUIsSUFBSSxDQUFDLFNBQVMsSUFBSSxPQUFPLFNBQVMsS0FBSyxRQUFRLEVBQUUsQ0FBQztZQUNoRCxNQUFNLElBQUksS0FBSyxD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QXVFO1lBQ3ZFLElBQUksbUJBQW1CLEtBQUssWUFBWSxJQUFJLENBQUMsYUFBYSxDQUFDLHlCQUF5QixDQUFDLFdBQVcsQ0FBQztnQkFBRSxTQUFRO1lBRTNHLE1BQU0scUJBQXFCLEdBQUcsZ0RBQWdELENBQUMsa0JBQWtCLENBQUMsQ0FBQTtZQUVsRyxJQUFJLENBQUMscUJBQXFCO2dCQUFFLFNBQVE7WUFDcEMsSUFBSSxDQUFDLHFCQUFxQixDQUFDLFNBQVMsSUFBSSxtQkFBbUIsQ0FBQyxLQUFLLFlBQVk7Z0JBQUUsU0FBUTtZQUV2RixPQUFPLEVBQUMsU0FBUyxFQUFFLFlBQVksRUFBRSxhQUFhLEVBQUUscUJBQXFCLEVBQUMsQ0FBQTtRQUN4RSxDQUFDO0lBQ0gsQ0FBQztJQUVELE9BQU8sSUFBSSxDQUFBO0FBQ2IsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG5pbXBvcnQgKiBhcyBpbmZsZWN0aW9uIGZyb20gXCJpbmZsZWN0aW9uXCJcbmltcG9ydCBGcm9udGVuZE1vZGVsQmFzZVJlc291cmNlIGZyb20gXCIuLi9mcm9udGVuZC1tb2RlbC1yZXNvdXJjZS9iYXNlLXJlc291cmNlLmpzXCJcbmltcG9ydCByZXN0QXJnc0Vycm9yIGZyb20gXCIuLi91dGlscy9yZXN0LWFyZ3MtZXJyb3IuanNcIlxuaW1wb3J0IHNoYTI1NkhleCBmcm9tIFwiLi4vdXRpbHMvc2hhMjU2LWhleC5qc1wiXG5pbXBvcnQge3ZhbGlkYXRlRnJvbnRlbmRNb2RlbFJlc291cmNlQ29tbWFuZE5hbWV9IGZyb20gXCIuL3Jlc291cmNlLWNvbmZpZy12YWxpZGF0aW9uLmpzXCJcblxuLyoqXG4gKiBSZXNvbHZlZCBmcm9udGVuZC1tb2RlbCByZXNvdXJjZSByZWdpc3RyYXRpb24gZm9yIGEgcmVwbGF5IHJlc291cmNlIHR5cGUuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBGcm9udGVuZE1vZGVsUmVzb2x2ZWRSZXNvdXJjZVJlZ2lzdHJhdGlvblxuICogQHByb3BlcnR5IHtzdHJpbmd9IG1vZGVsTmFtZSAtIEVmZmVjdGl2ZSBmcm9udGVuZCBtb2RlbCBuYW1lIChtb2RlbE5hbWUgb3ZlcnJpZGUgb3IgcmVnaXN0cnkga2V5KS5cbiAqIEBwcm9wZXJ0eSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Gcm9udGVuZE1vZGVsUmVzb3VyY2VDbGFzc1R5cGV9IHJlc291cmNlQ2xhc3MgLSBSZWdpc3RlcmVkIHJlc291cmNlIGNsYXNzLlxuICogQHByb3BlcnR5IHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLk5vcm1hbGl6ZWRGcm9udGVuZE1vZGVsUmVzb3VyY2VDb25maWd1cmF0aW9ufSByZXNvdXJjZUNvbmZpZ3VyYXRpb24gLSBOb3JtYWxpemVkIHJlc291cmNlIGNvbmZpZ3VyYXRpb24uXG4gKi9cbmNvbnN0IEJBU0VfRlJPTlRFTkRfTU9ERUxfQUJJTElUWV9BQ1RJT05TID0gW1wiY3JlYXRlXCIsIFwiZGVzdHJveVwiLCBcInJlYWRcIiwgXCJ1cGRhdGVcIl1cbmNvbnN0IFJFU09VUkNFX1NUQVRJQ19DT05GSUdfS0VZUyA9IG5ldyBTZXQoW1xuICBcImFiaWxpdGllc1wiLFxuICBcImF0dGFjaG1lbnRzXCIsXG4gIFwiYXR0cmlidXRlc1wiLFxuICBcImJ1aWx0SW5Db2xsZWN0aW9uQ29tbWFuZHNcIixcbiAgXCJidWlsdEluTWVtYmVyQ29tbWFuZHNcIixcbiAgXCJjb2xsZWN0aW9uQ29tbWFuZHNcIixcbiAgXCJjb21tYW5kc1wiLFxuICBcIm1lbWJlckNvbW1hbmRzXCIsXG4gIFwibW9kZWxOYW1lXCIsXG4gIFwiTW9kZWxDbGFzc1wiLFxuICBcInByaW1hcnlLZXlcIixcbiAgXCJxdWlja1NlYXJjaENvbHVtbnNcIixcbiAgXCJyZWxhdGlvbnNoaXBzXCIsXG4gIFwiUmVwbGF5U2VydmljZUNsYXNzXCIsXG4gIFwic2VydmVyXCIsXG4gIFwiU2hhcmVkUmVzb3VyY2VcIixcbiAgXCJzeW5jXCIsXG4gIFwidHJhbnNsYXRlZEF0dHJpYnV0ZXNcIixcbiAgXCJ3cml0YWJsZUF0dHJpYnV0ZXNcIlxuXSlcblxuLyoqXG4gKiBSdW5zIHRoZSBmcm9udGVuZE1vZGVsUmVzb3VyY2VzRm9yQmFja2VuZFByb2plY3QgaGVscGVyLlxuICogQHBhcmFtIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkJhY2tlbmRQcm9qZWN0Q29uZmlndXJhdGlvbn0gYmFja2VuZFByb2plY3QgLSBCYWNrZW5kIHByb2plY3QgY29uZmlnLlxuICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIGltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRnJvbnRlbmRNb2RlbFJlc291cmNlQ2xhc3NUeXBlPn0gLSBSZXNvdXJjZSBkZWZpbml0aW9ucyBrZXllZCBieSBtb2RlbCBuYW1lLlxuICovXG5leHBvcnQgZnVuY3Rpb24gZnJvbnRlbmRNb2RlbFJlc291cmNlc0ZvckJhY2tlbmRQcm9qZWN0KGJhY2tlbmRQcm9qZWN0KSB7XG4gIGNvbnN0IHJlc291cmNlcyA9IGJhY2tlbmRQcm9qZWN0LmZyb250ZW5kTW9kZWxzXG5cbiAgaWYgKHJlc291cmNlcyAhPT0gdW5kZWZpbmVkKSB7XG4gICAgaWYgKCFyZXNvdXJjZXMgfHwgdHlwZW9mIHJlc291cmNlcyAhPT0gXCJvYmplY3RcIikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBFeHBlY3RlZCBiYWNrZW5kIHByb2plY3QgZnJvbnRlbmRNb2RlbHMgb2JqZWN0IGJ1dCBnb3Q6ICR7cmVzb3VyY2VzfWApXG4gICAgfVxuXG4gICAgcmV0dXJuIHJlc291cmNlc1xuICB9XG5cbiAgcmV0dXJuIHt9XG59XG5cbi8qKlxuICogUnVucyB0aGUgZnJvbnRlbmRNb2RlbFJlc291cmNlRGVmaW5pdGlvbklzQ2xhc3MgaGVscGVyLlxuICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gdmFsdWUgLSBDYW5kaWRhdGUgcmVzb3VyY2UgZGVmaW5pdGlvbi5cbiAqIEByZXR1cm5zIHt2YWx1ZSBpcyBpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkZyb250ZW5kTW9kZWxSZXNvdXJjZUNsYXNzVHlwZX0gLSBXaGV0aGVyIHZhbHVlIGlzIGEgcmVzb3VyY2UgY2xhc3MuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBmcm9udGVuZE1vZGVsUmVzb3VyY2VEZWZpbml0aW9uSXNDbGFzcyh2YWx1ZSkge1xuICByZXR1cm4gdHlwZW9mIHZhbHVlID09PSBcImZ1bmN0aW9uXCIgJiYgKHZhbHVlID09PSBGcm9udGVuZE1vZGVsQmFzZVJlc291cmNlIHx8IHZhbHVlLnByb3RvdHlwZSBpbnN0YW5jZW9mIEZyb250ZW5kTW9kZWxCYXNlUmVzb3VyY2UpXG59XG5cbi8qKlxuICogUnVucyB0aGUgZnJvbnRlbmRNb2RlbFJlc291cmNlQ2xhc3NGcm9tRGVmaW5pdGlvbiBoZWxwZXIuXG4gKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSByZXNvdXJjZURlZmluaXRpb24gLSBSZXNvdXJjZSBkZWZpbml0aW9uLlxuICogQHJldHVybnMge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRnJvbnRlbmRNb2RlbFJlc291cmNlQ2xhc3NUeXBlIHwgbnVsbH0gLSBSZXNvdXJjZSBjbGFzcyB3aGVuIGRlZmluaXRpb24gaXMgY2xhc3MtYmFzZWQuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBmcm9udGVuZE1vZGVsUmVzb3VyY2VDbGFzc0Zyb21EZWZpbml0aW9uKHJlc291cmNlRGVmaW5pdGlvbikge1xuICByZXR1cm4gZnJvbnRlbmRNb2RlbFJlc291cmNlRGVmaW5pdGlvbklzQ2xhc3MocmVzb3VyY2VEZWZpbml0aW9uKSA/IHJlc291cmNlRGVmaW5pdGlvbiA6IG51bGxcbn1cblxuLyoqXG4gKiBSdW5zIHRoZSBmcm9udGVuZE1vZGVsUmVzb3VyY2VDb25maWd1cmF0aW9uRnJvbURlZmluaXRpb24gaGVscGVyLlxuICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gcmVzb3VyY2VEZWZpbml0aW9uIC0gUmVzb3VyY2UgZGVmaW5pdGlvbi5cbiAqIEByZXR1cm5zIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLk5vcm1hbGl6ZWRGcm9udGVuZE1vZGVsUmVzb3VyY2VDb25maWd1cmF0aW9uIHwgbnVsbH0gLSBOb3JtYWxpemVkIHJlc291cmNlIGNvbmZpZ3VyYXRpb24uXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBmcm9udGVuZE1vZGVsUmVzb3VyY2VDb25maWd1cmF0aW9uRnJvbURlZmluaXRpb24ocmVzb3VyY2VEZWZpbml0aW9uKSB7XG4gIGlmICghZnJvbnRlbmRNb2RlbFJlc291cmNlRGVmaW5pdGlvbklzQ2xhc3MocmVzb3VyY2VEZWZpbml0aW9uKSkgcmV0dXJuIG51bGxcblxuICBhc3NlcnRSZXNvdXJjZUNvbmZpZ0lzRnJhbWV3b3JrRGVmaW5lZChyZXNvdXJjZURlZmluaXRpb24pXG5cbiAgcmV0dXJuIG5vcm1hbGl6ZUZyb250ZW5kTW9kZWxSZXNvdXJjZUNvbmZpZ3VyYXRpb24ocmVzb3VyY2VEZWZpbml0aW9uLnJlc291cmNlQ29uZmlnKCkpXG59XG5cbi8qKlxuICogRW5zdXJlcyByZXNvdXJjZXMgdXNlIGRlY2xhcmF0aXZlIHN0YXRpYyBjb25maWcgcHJvcGVydGllcyBpbnN0ZWFkIG9mIG92ZXJyaWRpbmcgcmVzb3VyY2VDb25maWcoKS5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Gcm9udGVuZE1vZGVsUmVzb3VyY2VDbGFzc1R5cGV9IFJlc291cmNlQ2xhc3MgLSBSZXNvdXJjZSBjbGFzcy5cbiAqIEBwYXJhbSB7U2V0PGltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRnJvbnRlbmRNb2RlbFJlc291cmNlQ2xhc3NUeXBlPn0gW3Zpc2l0ZWRdIC0gQWxyZWFkeSBpbnNwZWN0ZWQgc2hhcmVkIHJlc291cmNlcy5cbiAqIEByZXR1cm5zIHt2b2lkfVxuICovXG5mdW5jdGlvbiBhc3NlcnRSZXNvdXJjZUNvbmZpZ0lzRnJhbWV3b3JrRGVmaW5lZChSZXNvdXJjZUNsYXNzLCB2aXNpdGVkID0gbmV3IFNldCgpKSB7XG4gIGlmICh2aXNpdGVkLmhhcyhSZXNvdXJjZUNsYXNzKSkgcmV0dXJuXG5cbiAgdmlzaXRlZC5hZGQoUmVzb3VyY2VDbGFzcylcbiAgYXNzZXJ0S25vd25SZXNvdXJjZVN0YXRpY0NvbmZpZ1Byb3BlcnRpZXMoUmVzb3VyY2VDbGFzcylcblxuICBjb25zdCBvd25lciA9IHN0YXRpY01ldGhvZE93bmVyRm9yKFJlc291cmNlQ2xhc3MsIFwicmVzb3VyY2VDb25maWdcIilcblxuICBpZiAob3duZXIgJiYgb3duZXIgIT09IEZyb250ZW5kTW9kZWxCYXNlUmVzb3VyY2UpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYCR7UmVzb3VyY2VDbGFzcy5uYW1lfSBvdmVycmlkZXMgc3RhdGljIHJlc291cmNlQ29uZmlnKCksIHdoaWNoIGlzIG5vdCBzdXBwb3J0ZWQuIFVzZSBzdGF0aWMgcmVzb3VyY2UgcHJvcGVydGllcyBpbnN0ZWFkLmApXG4gIH1cblxuICBjb25zdCBTaGFyZWRSZXNvdXJjZSA9IFJlc291cmNlQ2xhc3Muc2hhcmVkUmVzb3VyY2VDbGFzcygpXG5cbiAgaWYgKFNoYXJlZFJlc291cmNlKSBhc3NlcnRSZXNvdXJjZUNvbmZpZ0lzRnJhbWV3b3JrRGVmaW5lZChTaGFyZWRSZXNvdXJjZSwgdmlzaXRlZClcbn1cblxuLyoqXG4gKiBFbnN1cmVzIGRlY2xhcmF0aXZlIHN0YXRpYyByZXNvdXJjZSBjb25maWcgZG9lcyBub3Qgc2lsZW50bHkgaWdub3JlIHR5cG9zIG9yIHJlbW92ZWQga2V5cy5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Gcm9udGVuZE1vZGVsUmVzb3VyY2VDbGFzc1R5cGV9IFJlc291cmNlQ2xhc3MgLSBSZXNvdXJjZSBjbGFzcy5cbiAqIEByZXR1cm5zIHt2b2lkfVxuICovXG5mdW5jdGlvbiBhc3NlcnRLbm93blJlc291cmNlU3RhdGljQ29uZmlnUHJvcGVydGllcyhSZXNvdXJjZUNsYXNzKSB7XG4gIGxldCBjdXJyZW50Q2xhc3MgPSBSZXNvdXJjZUNsYXNzXG5cbiAgd2hpbGUgKGN1cnJlbnRDbGFzcyAmJiBjdXJyZW50Q2xhc3MgIT09IEZyb250ZW5kTW9kZWxCYXNlUmVzb3VyY2UgJiYgY3VycmVudENsYXNzICE9PSBGdW5jdGlvbi5wcm90b3R5cGUpIHtcbiAgICAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi9cbiAgICBjb25zdCB1bmtub3duU3RhdGljQ29uZmlnID0ge31cblxuICAgIGZvciAoY29uc3Qga2V5IG9mIE9iamVjdC5rZXlzKGN1cnJlbnRDbGFzcykpIHtcbiAgICAgIGlmICghUkVTT1VSQ0VfU1RBVElDX0NPTkZJR19LRVlTLmhhcyhrZXkpKSB1bmtub3duU3RhdGljQ29uZmlnW2tleV0gPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKC8qKiBAdHlwZSB7dW5rbm93bn0gKi8gKGN1cnJlbnRDbGFzcykpW2tleV1cbiAgICB9XG5cbiAgICByZXN0QXJnc0Vycm9yKHVua25vd25TdGF0aWNDb25maWcpXG5cbiAgICBjdXJyZW50Q2xhc3MgPSBPYmplY3QuZ2V0UHJvdG90eXBlT2YoY3VycmVudENsYXNzKVxuICB9XG59XG5cbi8qKlxuICogTG9jYXRlcyB3aGljaCBjb25zdHJ1Y3RvciBvd25zIGEgc3RhdGljIG1ldGhvZCBpbXBsZW1lbnRhdGlvbi5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Gcm9udGVuZE1vZGVsUmVzb3VyY2VDbGFzc1R5cGV9IFJlc291cmNlQ2xhc3MgLSBSZXNvdXJjZSBjbGFzcy5cbiAqIEBwYXJhbSB7c3RyaW5nfSBtZXRob2ROYW1lIC0gTWV0aG9kIG5hbWUuXG4gKiBAcmV0dXJucyB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Gcm9udGVuZE1vZGVsUmVzb3VyY2VDbGFzc1R5cGUgfCB0eXBlb2YgRnJvbnRlbmRNb2RlbEJhc2VSZXNvdXJjZSB8IG51bGx9IC0gQ2xhc3MgdGhhdCBvd25zIHRoZSBzdGF0aWMgbWV0aG9kLlxuICovXG5mdW5jdGlvbiBzdGF0aWNNZXRob2RPd25lckZvcihSZXNvdXJjZUNsYXNzLCBtZXRob2ROYW1lKSB7XG4gIGxldCBjdXJyZW50Q2xhc3MgPSBSZXNvdXJjZUNsYXNzXG5cbiAgd2hpbGUgKGN1cnJlbnRDbGFzcyAmJiBjdXJyZW50Q2xhc3MgIT09IEZ1bmN0aW9uLnByb3RvdHlwZSkge1xuICAgIGlmIChPYmplY3QucHJvdG90eXBlLmhhc093blByb3BlcnR5LmNhbGwoY3VycmVudENsYXNzLCBtZXRob2ROYW1lKSkgcmV0dXJuIGN1cnJlbnRDbGFzc1xuXG4gICAgY3VycmVudENsYXNzID0gT2JqZWN0LmdldFByb3RvdHlwZU9mKGN1cnJlbnRDbGFzcylcbiAgfVxuXG4gIHJldHVybiBudWxsXG59XG5cbi8qKlxuICogUnVucyBub3JtYWxpemUgZnJvbnRlbmQgbW9kZWwgcmVzb3VyY2UgY29uZmlndXJhdGlvbi5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Gcm9udGVuZE1vZGVsUmVzb3VyY2VDb25maWd1cmF0aW9ufSByZXNvdXJjZUNvbmZpZ3VyYXRpb24gLSBSYXcgcmVzb3VyY2UgY29uZmlndXJhdGlvbi5cbiAqIEByZXR1cm5zIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLk5vcm1hbGl6ZWRGcm9udGVuZE1vZGVsUmVzb3VyY2VDb25maWd1cmF0aW9ufSAtIE5vcm1hbGl6ZWQgcmVzb3VyY2UgY29uZmlndXJhdGlvbi5cbiAqL1xuZnVuY3Rpb24gbm9ybWFsaXplRnJvbnRlbmRNb2RlbFJlc291cmNlQ29uZmlndXJhdGlvbihyZXNvdXJjZUNvbmZpZ3VyYXRpb24pIHtcbiAgY29uc3QgcmVzdEFyZ3MgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKHsuLi5yZXNvdXJjZUNvbmZpZ3VyYXRpb259KVxuXG4gIGZvciAoY29uc3Qga2V5IG9mIFtcbiAgICBcImFiaWxpdGllc1wiLFxuICAgIFwiYXR0cmlidXRlc1wiLFxuICAgIFwiYXR0YWNobWVudHNcIixcbiAgICBcImJ1aWx0SW5Db2xsZWN0aW9uQ29tbWFuZHNcIixcbiAgICBcImJ1aWx0SW5NZW1iZXJDb21tYW5kc1wiLFxuICAgIFwiY29sbGVjdGlvbkNvbW1hbmRzXCIsXG4gICAgXCJjb21tYW5kc1wiLFxuICAgIFwibWVtYmVyQ29tbWFuZHNcIixcbiAgICBcIm1vZGVsTmFtZVwiLFxuICAgIFwicHJpbWFyeUtleVwiLFxuICAgIFwicmVsYXRpb25zaGlwc1wiLFxuICAgIFwic2VydmVyXCIsXG4gICAgXCJzeW5jXCJcbiAgXSkge1xuICAgIGRlbGV0ZSByZXN0QXJnc1trZXldXG4gIH1cblxuICByZXN0QXJnc0Vycm9yKHJlc3RBcmdzKVxuICB2YWxpZGF0ZUZyb250ZW5kTW9kZWxSZXNvdXJjZVByaW1hcnlLZXkocmVzb3VyY2VDb25maWd1cmF0aW9uLnByaW1hcnlLZXkpXG5cbiAgY29uc3Qgbm9ybWFsaXplZENvbW1hbmRzID0gbm9ybWFsaXplRnJvbnRlbmRNb2RlbFJlc291cmNlQ29tbWFuZHMocmVzb3VyY2VDb25maWd1cmF0aW9uKVxuICBjb25zdCBzeW5jID0gbm9ybWFsaXplRnJvbnRlbmRNb2RlbFJlc291cmNlU3luYyhyZXNvdXJjZUNvbmZpZ3VyYXRpb24pXG5cbiAgcmV0dXJuIHtcbiAgICAuLi5yZXNvdXJjZUNvbmZpZ3VyYXRpb24sXG4gICAgYWJpbGl0aWVzOiBub3JtYWxpemVGcm9udGVuZE1vZGVsUmVzb3VyY2VBYmlsaXRpZXMocmVzb3VyY2VDb25maWd1cmF0aW9uLmFiaWxpdGllcyksXG4gICAgYnVpbHRJbkNvbGxlY3Rpb25Db21tYW5kczogbm9ybWFsaXplZENvbW1hbmRzLmJ1aWx0SW5Db2xsZWN0aW9uQ29tbWFuZHMsXG4gICAgYnVpbHRJbk1lbWJlckNvbW1hbmRzOiBub3JtYWxpemVkQ29tbWFuZHMuYnVpbHRJbk1lbWJlckNvbW1hbmRzLFxuICAgIGNvbGxlY3Rpb25Db21tYW5kczogbm9ybWFsaXplZENvbW1hbmRzLmNvbGxlY3Rpb25Db21tYW5kcyxcbiAgICAvLyBQZXItY29tbWFuZCBtZXRhZGF0YSAodHlwZWQgYXJncyArIGRlY2xhcmVkIHJldHVybiB0eXBlKSBrZXllZCBieSBtZXRob2RcbiAgICAvLyBuYW1lLCBkZXJpdmVkIGZyb20gYHtuYW1lLCBhcmdzPywgcmV0dXJuVHlwZT99YCBjb21tYW5kIGVudHJpZXMuIFRoZVxuICAgIC8vIGdlbmVyYXRvciB1c2VzIGl0IHRvIHR5cGUgZWFjaCBjdXN0b20gY29tbWFuZCBtZXRob2QuXG4gICAgY29tbWFuZE1ldGFkYXRhOiBub3JtYWxpemVkQ29tbWFuZHMuY29tbWFuZE1ldGFkYXRhLFxuICAgIG1lbWJlckNvbW1hbmRzOiBub3JtYWxpemVkQ29tbWFuZHMubWVtYmVyQ29tbWFuZHMsXG4gICAgc3luY1xuICB9XG59XG5cbi8qKlxuICogVmFsaWRhdGVzIGEgcmVzb3VyY2UgcHJpbWFyeS1rZXkgZGVmaW5pdGlvbiBiZWZvcmUgaXQgY2FuIGJlIHVzZWQgdG8gYnVpbGQgQ1JVRCBjb25kaXRpb25zLlxuICogQHBhcmFtIHtpbXBvcnQoXCIuLi91dGlscy9tb2RlbC1wcmltYXJ5LWtleS5qc1wiKS5Nb2RlbFByaW1hcnlLZXlEZWZpbml0aW9uIHwgdW5kZWZpbmVkfSBwcmltYXJ5S2V5IC0gUmVzb3VyY2UgcHJpbWFyeSBrZXkuXG4gKiBAcmV0dXJucyB7dm9pZH1cbiAqL1xuZnVuY3Rpb24gdmFsaWRhdGVGcm9udGVuZE1vZGVsUmVzb3VyY2VQcmltYXJ5S2V5KHByaW1hcnlLZXkpIHtcbiAgaWYgKCFBcnJheS5pc0FycmF5KHByaW1hcnlLZXkpKSByZXR1cm5cblxuICBpZiAocHJpbWFyeUtleS5sZW5ndGggPT09IDApIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXCJSZXNvdXJjZSBwcmltYXJ5S2V5IGFycmF5cyBtdXN0IGNvbnRhaW4gYXQgbGVhc3Qgb25lIGF0dHJpYnV0ZS5cIilcbiAgfVxuXG4gIGlmIChuZXcgU2V0KHByaW1hcnlLZXkpLnNpemUgIT09IHByaW1hcnlLZXkubGVuZ3RoKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFwiUmVzb3VyY2UgcHJpbWFyeUtleSBhcnJheXMgbXVzdCBjb250YWluIHVuaXF1ZSBhdHRyaWJ1dGVzLlwiKVxuICB9XG59XG5cbi8qKlxuICogUnVucyBub3JtYWxpemUgZnJvbnRlbmQgbW9kZWwgcmVzb3VyY2UgYWJpbGl0aWVzLlxuICogQHBhcmFtIHtzdHJpbmdbXSB8IHVuZGVmaW5lZH0gYWJpbGl0aWVzIC0gUmVzb3VyY2UgYWJpbGl0aWVzIGNvbmZpZyAoY2FtZWxDYXNlIGFjdGlvbiBsaXN0KS5cbiAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+fSAtIE5vcm1hbGl6ZWQgYWJpbGl0aWVzIGNvbmZpZy5cbiAqL1xuZnVuY3Rpb24gbm9ybWFsaXplRnJvbnRlbmRNb2RlbFJlc291cmNlQWJpbGl0aWVzKGFiaWxpdGllcykge1xuICBjb25zdCBub3JtYWxpemVkID0gZGVmYXVsdENydWRBYmlsaXRpZXMoKVxuXG4gIGlmIChhYmlsaXRpZXMgPT09IHVuZGVmaW5lZCkgcmV0dXJuIG5vcm1hbGl6ZWRcblxuICBpZiAoIUFycmF5LmlzQXJyYXkoYWJpbGl0aWVzKSkge1xuICAgIHRocm93IG5ldyBFcnJvcihcIlJlc291cmNlIGFiaWxpdGllcyBtdXN0IGJlIGFuIGFycmF5IG9mIGFjdGlvbiBuYW1lcy4gT2JqZWN0IGZvcm0gaXMgbm8gbG9uZ2VyIHN1cHBvcnRlZC5cIilcbiAgfVxuXG4gIGNvbnN0IGR1cGxpY2F0ZWRCYXNlQWJpbGl0aWVzID0gYWJpbGl0aWVzLmZpbHRlcigoYWJpbGl0eSkgPT4gQkFTRV9GUk9OVEVORF9NT0RFTF9BQklMSVRZX0FDVElPTlMuaW5jbHVkZXMoYWJpbGl0eSkpXG5cbiAgaWYgKGR1cGxpY2F0ZWRCYXNlQWJpbGl0aWVzLmxlbmd0aCA+IDApIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYFJlc291cmNlIGFiaWxpdGllcyBtdXN0IG5vdCBpbmNsdWRlIGJhc2UgYWN0aW9uczogJHtkdXBsaWNhdGVkQmFzZUFiaWxpdGllcy5qb2luKFwiLCBcIil9YClcbiAgfVxuXG4gIGZvciAoY29uc3QgYWJpbGl0eSBvZiBhYmlsaXRpZXMpIHtcbiAgICBpZiAodHlwZW9mIGFiaWxpdHkgIT09IFwic3RyaW5nXCIgfHwgYWJpbGl0eS5sZW5ndGggPCAxKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJSZXNvdXJjZSBhYmlsaXRpZXMgZW50cmllcyBtdXN0IGJlIG5vbi1lbXB0eSBzdHJpbmdzLlwiKVxuICAgIH1cblxuICAgIG5vcm1hbGl6ZWRbYWJpbGl0eV0gPSBhYmlsaXR5XG4gIH1cblxuICByZXR1cm4gbm9ybWFsaXplZFxufVxuXG4vKipcbiAqIFJ1bnMgZGVmYXVsdCBjcnVkIGFiaWxpdGllcy5cbiAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+fSAtIERlZmF1bHQgQ1JVRCBhYmlsaXR5IG1hcC5cbiAqL1xuZnVuY3Rpb24gZGVmYXVsdENydWRBYmlsaXRpZXMoKSB7XG4gIHJldHVybiB7XG4gICAgY3JlYXRlOiBcImNyZWF0ZVwiLFxuICAgIGRlc3Ryb3k6IFwiZGVzdHJveVwiLFxuICAgIGZpbmQ6IFwicmVhZFwiLFxuICAgIGluZGV4OiBcInJlYWRcIixcbiAgICB1cGRhdGU6IFwidXBkYXRlXCJcbiAgfVxufVxuXG4vKipcbiAqIEJ1aWxkcyBhIGZyb250ZW5kLXNhZmUgc3luYyBtYW5pZmVzdCBmb3IgYWxsIHN5bmMtZW5hYmxlZCBmcm9udGVuZC1tb2RlbCByZXNvdXJjZXMuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuQmFja2VuZFByb2plY3RDb25maWd1cmF0aW9uW119IGJhY2tlbmRQcm9qZWN0cyAtIEJhY2tlbmQgcHJvamVjdHMgdG8gc2Nhbi5cbiAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLk5vcm1hbGl6ZWRGcm9udGVuZE1vZGVsUmVzb3VyY2VTeW5jQ29uZmlndXJhdGlvbj59IC0gU3luYyBtZXRhZGF0YSBrZXllZCBieSBtb2RlbCBuYW1lLlxuICovXG5leHBvcnQgZnVuY3Rpb24gZnJvbnRlbmRNb2RlbFN5bmNNYW5pZmVzdEZvckJhY2tlbmRQcm9qZWN0cyhiYWNrZW5kUHJvamVjdHMpIHtcbiAgLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLk5vcm1hbGl6ZWRGcm9udGVuZE1vZGVsUmVzb3VyY2VTeW5jQ29uZmlndXJhdGlvbj59ICovXG4gIGNvbnN0IG1hbmlmZXN0ID0ge31cblxuICBmb3IgKGNvbnN0IGJhY2tlbmRQcm9qZWN0IG9mIGJhY2tlbmRQcm9qZWN0cykge1xuICAgIGNvbnN0IHJlc291cmNlcyA9IGZyb250ZW5kTW9kZWxSZXNvdXJjZXNGb3JCYWNrZW5kUHJvamVjdChiYWNrZW5kUHJvamVjdClcblxuICAgIGZvciAoY29uc3QgY29uZmlndXJlZE1vZGVsTmFtZSBvZiBPYmplY3Qua2V5cyhyZXNvdXJjZXMpLnNvcnQoKSkge1xuICAgICAgY29uc3QgcmVzb3VyY2VEZWZpbml0aW9uID0gcmVzb3VyY2VzW2NvbmZpZ3VyZWRNb2RlbE5hbWVdXG4gICAgICBjb25zdCByZXNvdXJjZUNvbmZpZ3VyYXRpb24gPSBmcm9udGVuZE1vZGVsUmVzb3VyY2VDb25maWd1cmF0aW9uRnJvbURlZmluaXRpb24ocmVzb3VyY2VEZWZpbml0aW9uKVxuXG4gICAgICBpZiAoIXJlc291cmNlQ29uZmlndXJhdGlvbikgY29udGludWVcbiAgICAgIGlmICghcmVzb3VyY2VDb25maWd1cmF0aW9uLnN5bmM/LmVuYWJsZWQpIGNvbnRpbnVlXG5cbiAgICAgIGNvbnN0IG1vZGVsTmFtZSA9IHJlc291cmNlQ29uZmlndXJhdGlvbi5tb2RlbE5hbWUgfHwgY29uZmlndXJlZE1vZGVsTmFtZVxuXG4gICAgICBtYW5pZmVzdFttb2RlbE5hbWVdID0gcmVzb3VyY2VDb25maWd1cmF0aW9uLnN5bmNcbiAgICB9XG4gIH1cblxuICByZXR1cm4gbWFuaWZlc3Rcbn1cblxuLyoqXG4gKiBCdWlsZHMgYSBmcm9udGVuZC1zYWZlIEFQSSBtYW5pZmVzdCBmb3IgYWxsIHJlZ2lzdGVyZWQgZnJvbnRlbmQtbW9kZWxcbiAqIHJlc291cmNlcy4gVGhlIG1hbmlmZXN0IGlzIGRldGVybWluaXN0aWMgKHNvcnRlZCBtb2RlbCBuYW1lcywgc29ydGVkXG4gKiBhdHRyaWJ1dGVzLCBzb3J0ZWQgY29tbWFuZHMpIGFuZCBpbmNsdWRlcyBvbmx5IHB1YmxpYy1zYWZlIG1ldGFkYXRhOiBub1xuICogc2VjcmV0cywgbm8gc2VydmVyIGNhbGxiYWNrcywgbm8gYmFja2VuZCBmaWxlIHBhdGhzLlxuICogQHBhcmFtIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkJhY2tlbmRQcm9qZWN0Q29uZmlndXJhdGlvbltdfSBiYWNrZW5kUHJvamVjdHMgLSBCYWNrZW5kIHByb2plY3RzIHRvIHNjYW4uXG4gKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgdW5rbm93bj59IC0gRnJvbnRlbmQtc2FmZSBBUEkgbWFuaWZlc3QuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBmcm9udGVuZE1vZGVsQXBpTWFuaWZlc3QoYmFja2VuZFByb2plY3RzKSB7XG4gIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgdW5rbm93bj59ICovXG4gIGNvbnN0IHJlc291cmNlcyA9IHt9XG5cbiAgZm9yIChjb25zdCBiYWNrZW5kUHJvamVjdCBvZiBiYWNrZW5kUHJvamVjdHMpIHtcbiAgICBjb25zdCBwcm9qZWN0UmVzb3VyY2VzID0gZnJvbnRlbmRNb2RlbFJlc291cmNlc0ZvckJhY2tlbmRQcm9qZWN0KGJhY2tlbmRQcm9qZWN0KVxuXG4gICAgZm9yIChjb25zdCBjb25maWd1cmVkTW9kZWxOYW1lIG9mIE9iamVjdC5rZXlzKHByb2plY3RSZXNvdXJjZXMpLnNvcnQoKSkge1xuICAgICAgY29uc3QgcmVzb3VyY2VEZWZpbml0aW9uID0gcHJvamVjdFJlc291cmNlc1tjb25maWd1cmVkTW9kZWxOYW1lXVxuICAgICAgY29uc3QgcmVzb3VyY2VDb25maWd1cmF0aW9uID0gZnJvbnRlbmRNb2RlbFJlc291cmNlQ29uZmlndXJhdGlvbkZyb21EZWZpbml0aW9uKHJlc291cmNlRGVmaW5pdGlvbilcbiAgICAgIGNvbnN0IHJlc291cmNlQ2xhc3MgPSBmcm9udGVuZE1vZGVsUmVzb3VyY2VDbGFzc0Zyb21EZWZpbml0aW9uKHJlc291cmNlRGVmaW5pdGlvbilcblxuICAgICAgaWYgKCFyZXNvdXJjZUNvbmZpZ3VyYXRpb24gfHwgIXJlc291cmNlQ2xhc3MpIGNvbnRpbnVlXG5cbiAgICAgIGNvbnN0IG1vZGVsTmFtZSA9IHJlc291cmNlQ29uZmlndXJhdGlvbi5tb2RlbE5hbWUgfHwgY29uZmlndXJlZE1vZGVsTmFtZVxuICAgICAgY29uc3QgcmVzb3VyY2VQYXRoID0gYC8ke2luZmxlY3Rpb24uZGFzaGVyaXplKGluZmxlY3Rpb24ucGx1cmFsaXplKGluZmxlY3Rpb24udW5kZXJzY29yZShjb25maWd1cmVkTW9kZWxOYW1lKSkpfWBcblxuICAgICAgLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCB1bmtub3duPn0gKi9cbiAgICAgIGNvbnN0IGVudHJ5ID0ge1xuICAgICAgICBtb2RlbE5hbWUsXG4gICAgICAgIHBhdGg6IHJlc291cmNlUGF0aCxcbiAgICAgICAgcHJpbWFyeUtleTogcmVzb3VyY2VDbGFzcy5yZXNvbHZlZFByaW1hcnlLZXkocmVzb3VyY2VDb25maWd1cmF0aW9uKSxcbiAgICAgICAgYXR0cmlidXRlczogbWFuaWZlc3RBdHRyaWJ1dGVzKHJlc291cmNlQ29uZmlndXJhdGlvbi5hdHRyaWJ1dGVzKSxcbiAgICAgICAgYWJpbGl0aWVzOiByZXNvdXJjZUNvbmZpZ3VyYXRpb24uYWJpbGl0aWVzLFxuICAgICAgICBidWlsdEluQ29tbWFuZHM6IHtcbiAgICAgICAgICBjb2xsZWN0aW9uOiByZXNvdXJjZUNvbmZpZ3VyYXRpb24uYnVpbHRJbkNvbGxlY3Rpb25Db21tYW5kcyxcbiAgICAgICAgICBtZW1iZXI6IHJlc291cmNlQ29uZmlndXJhdGlvbi5idWlsdEluTWVtYmVyQ29tbWFuZHNcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICBjb25zdCByZWxhdGlvbnNoaXBzID0gcmVzb3VyY2VDb25maWd1cmF0aW9uLnJlbGF0aW9uc2hpcHNcbiAgICAgIGlmIChyZWxhdGlvbnNoaXBzICYmIHJlbGF0aW9uc2hpcHMubGVuZ3RoID4gMCkge1xuICAgICAgICAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIHVua25vd24+fSAqL1xuICAgICAgICBjb25zdCByZWxzID0ge31cbiAgICAgICAgZm9yIChjb25zdCByZWxOYW1lIG9mIHJlbGF0aW9uc2hpcHMpIHtcbiAgICAgICAgICByZWxzW3JlbE5hbWVdID0ge31cbiAgICAgICAgfVxuICAgICAgICBlbnRyeS5yZWxhdGlvbnNoaXBzID0gcmVsc1xuICAgICAgfVxuXG4gICAgICBjb25zdCBhdHRhY2htZW50cyA9IHJlc291cmNlQ29uZmlndXJhdGlvbi5hdHRhY2htZW50c1xuICAgICAgaWYgKGF0dGFjaG1lbnRzICYmIE9iamVjdC5rZXlzKGF0dGFjaG1lbnRzKS5sZW5ndGggPiAwKSB7XG4gICAgICAgIGVudHJ5LmF0dGFjaG1lbnRzID0gYXR0YWNobWVudHNcbiAgICAgIH1cblxuICAgICAgY29uc3QgY29sbGVjdGlvbkNvbW1hbmRzID0gbWFuaWZlc3RDb21tYW5kRW50cmllcyh7XG4gICAgICAgIGNvbW1hbmRNZXRhZGF0YTogcmVzb3VyY2VDb25maWd1cmF0aW9uLmNvbW1hbmRNZXRhZGF0YSB8fCB7fSxcbiAgICAgICAgY29tbWFuZHM6IHJlc291cmNlQ29uZmlndXJhdGlvbi5jb2xsZWN0aW9uQ29tbWFuZHMsXG4gICAgICAgIHJlc291cmNlUGF0aCxcbiAgICAgICAgc2NvcGU6IFwiY29sbGVjdGlvblwiXG4gICAgICB9KVxuICAgICAgY29uc3QgbWVtYmVyQ29tbWFuZHMgPSBtYW5pZmVzdENvbW1hbmRFbnRyaWVzKHtcbiAgICAgICAgY29tbWFuZE1ldGFkYXRhOiByZXNvdXJjZUNvbmZpZ3VyYXRpb24uY29tbWFuZE1ldGFkYXRhIHx8IHt9LFxuICAgICAgICBjb21tYW5kczogcmVzb3VyY2VDb25maWd1cmF0aW9uLm1lbWJlckNvbW1hbmRzLFxuICAgICAgICByZXNvdXJjZVBhdGgsXG4gICAgICAgIHNjb3BlOiBcIm1lbWJlclwiXG4gICAgICB9KVxuXG4gICAgICBpZiAoY29sbGVjdGlvbkNvbW1hbmRzLmxlbmd0aCA+IDAgfHwgbWVtYmVyQ29tbWFuZHMubGVuZ3RoID4gMCkge1xuICAgICAgICAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIHVua25vd24+fSAqL1xuICAgICAgICBjb25zdCBjbWRzID0ge31cbiAgICAgICAgaWYgKGNvbGxlY3Rpb25Db21tYW5kcy5sZW5ndGggPiAwKSBjbWRzW1wiY29sbGVjdGlvblwiXSA9IGNvbGxlY3Rpb25Db21tYW5kc1xuICAgICAgICBpZiAobWVtYmVyQ29tbWFuZHMubGVuZ3RoID4gMCkgY21kc1tcIm1lbWJlclwiXSA9IG1lbWJlckNvbW1hbmRzXG4gICAgICAgIGVudHJ5LmNvbW1hbmRzID0gY21kc1xuICAgICAgfVxuXG4gICAgICBpZiAocmVzb3VyY2VDb25maWd1cmF0aW9uLnN5bmM/LmVuYWJsZWQpIHtcbiAgICAgICAgZW50cnkuc3luYyA9IHJlc291cmNlQ29uZmlndXJhdGlvbi5zeW5jXG4gICAgICB9XG5cbiAgICAgIHJlc291cmNlc1tjb25maWd1cmVkTW9kZWxOYW1lXSA9IGVudHJ5XG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIHtcbiAgICBmb3JtYXRWZXJzaW9uOiAxLFxuICAgIHJlc291cmNlczogT2JqZWN0LmtleXMocmVzb3VyY2VzKS5zb3J0KCkucmVkdWNlKChzb3J0ZWQsIGtleSkgPT4ge1xuICAgICAgLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCB1bmtub3duPn0gKi8gKHNvcnRlZClba2V5XSA9IHJlc291cmNlc1trZXldXG4gICAgICByZXR1cm4gc29ydGVkXG4gICAgfSwgLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCB1bmtub3duPn0gKi8gKHt9KSlcbiAgfVxufVxuXG4vKipcbiAqIE5vcm1hbGl6ZXMgcmVzb3VyY2UgYXR0cmlidXRlIGRlZmluaXRpb25zIGludG8gYSBzb3J0ZWQgYXJyYXkgb2Ygc3RyaW5ncy5cbiAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGF0dHJpYnV0ZXMgLSBSYXcgYXR0cmlidXRlcyBjb25maWcgKGFycmF5IG9yIG9iamVjdCkuXG4gKiBAcmV0dXJucyB7c3RyaW5nW119IC0gU29ydGVkIGF0dHJpYnV0ZSBuYW1lcy5cbiAqL1xuZnVuY3Rpb24gbWFuaWZlc3RBdHRyaWJ1dGVzKGF0dHJpYnV0ZXMpIHtcbiAgaWYgKCFhdHRyaWJ1dGVzKSByZXR1cm4gW11cblxuICBsZXQgbmFtZXNcblxuICBpZiAoQXJyYXkuaXNBcnJheShhdHRyaWJ1dGVzKSkge1xuICAgIG5hbWVzID0gYXR0cmlidXRlcy5tYXAoKGVudHJ5KSA9PiB0eXBlb2YgZW50cnkgPT09IFwic3RyaW5nXCIgPyBlbnRyeSA6IGVudHJ5Lm5hbWUpLmZpbHRlcihCb29sZWFuKVxuICB9IGVsc2UgaWYgKGF0dHJpYnV0ZXMgJiYgdHlwZW9mIGF0dHJpYnV0ZXMgPT09IFwib2JqZWN0XCIpIHtcbiAgICBuYW1lcyA9IE9iamVjdC5rZXlzKGF0dHJpYnV0ZXMpXG4gIH0gZWxzZSB7XG4gICAgcmV0dXJuIFtdXG4gIH1cblxuICByZXR1cm4gbmFtZXMuc29ydCgpXG59XG5cbi8qKlxuICogQnVpbGRzIG1hbmlmZXN0LXNhZmUgY29tbWFuZCBlbnRyeSBsaXN0LlxuICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBBcmd1bWVudHMuXG4gKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIHthcmdzOiBBcnJheTx7bmFtZTogc3RyaW5nLCB0eXBlOiBzdHJpbmd9PiwgcmV0dXJuVHlwZTogc3RyaW5nIHwgbnVsbH0+fSBhcmdzLmNvbW1hbmRNZXRhZGF0YSAtIFBlci1jb21tYW5kIG1ldGFkYXRhLlxuICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+fSBhcmdzLmNvbW1hbmRzIC0gTWV0aG9kIG5hbWUg4oaSIGtlYmFiIHNsdWcgbWFwLlxuICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MucmVzb3VyY2VQYXRoIC0gUmVzb3VyY2UgcGF0aC5cbiAqIEBwYXJhbSB7XCJjb2xsZWN0aW9uXCIgfCBcIm1lbWJlclwifSBhcmdzLnNjb3BlIC0gQ29tbWFuZCBzY29wZS5cbiAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCB1bmtub3duPltdfSAtIE1hbmlmZXN0IGNvbW1hbmQgZW50cmllcy5cbiAqL1xuZnVuY3Rpb24gbWFuaWZlc3RDb21tYW5kRW50cmllcyh7Y29tbWFuZE1ldGFkYXRhLCBjb21tYW5kcywgcmVzb3VyY2VQYXRoLCBzY29wZX0pIHtcbiAgcmV0dXJuIE9iamVjdC5rZXlzKGNvbW1hbmRzKS5zb3J0KCkubWFwKChtZXRob2ROYW1lKSA9PiB7XG4gICAgY29uc3Qgc2x1ZyA9IGNvbW1hbmRzW21ldGhvZE5hbWVdXG4gICAgY29uc3QgbWV0YWRhdGEgPSBjb21tYW5kTWV0YWRhdGFbbWV0aG9kTmFtZV0gfHwge2FyZ3M6IFtdLCByZXR1cm5UeXBlOiBudWxsfVxuICAgIGNvbnN0IHBhdGggPSBzY29wZSA9PT0gXCJtZW1iZXJcIlxuICAgICAgPyBgJHtyZXNvdXJjZVBhdGh9LzxpZD4vJHtzbHVnfWBcbiAgICAgIDogYCR7cmVzb3VyY2VQYXRofS8ke3NsdWd9YFxuXG4gICAgLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCB1bmtub3duPn0gKi9cbiAgICBjb25zdCBlbnRyeSA9IHtcbiAgICAgIG1ldGhvZE5hbWUsXG4gICAgICBzY29wZSxcbiAgICAgIHBhdGgsXG4gICAgICBhcmdzOiBtZXRhZGF0YS5hcmdzXG4gICAgfVxuXG4gICAgaWYgKG1ldGFkYXRhLnJldHVyblR5cGUpIHtcbiAgICAgIGVudHJ5LnJldHVyblR5cGUgPSBtZXRhZGF0YS5yZXR1cm5UeXBlXG4gICAgfVxuXG4gICAgcmV0dXJuIGVudHJ5XG4gIH0pXG59XG5cbi8qKlxuICogTm9ybWFsaXplcyBzeW5jIHBvbGljeSBtZXRhZGF0YSBhbmQgY29tcHV0ZXMgYSBkZXRlcm1pbmlzdGljIGhhc2ggZnJvbSBzYWZlIHBvbGljeSBpbnB1dHMuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRnJvbnRlbmRNb2RlbFJlc291cmNlQ29uZmlndXJhdGlvbn0gcmVzb3VyY2VDb25maWd1cmF0aW9uIC0gUmF3IHJlc291cmNlIGNvbmZpZ3VyYXRpb24uXG4gKiBAcmV0dXJucyB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Ob3JtYWxpemVkRnJvbnRlbmRNb2RlbFJlc291cmNlU3luY0NvbmZpZ3VyYXRpb24gfCB1bmRlZmluZWR9IC0gRnJvbnRlbmQtc2FmZSBzeW5jIG1ldGFkYXRhLlxuICovXG5mdW5jdGlvbiBub3JtYWxpemVGcm9udGVuZE1vZGVsUmVzb3VyY2VTeW5jKHJlc291cmNlQ29uZmlndXJhdGlvbikge1xuICBjb25zdCBzeW5jID0gcmVzb3VyY2VDb25maWd1cmF0aW9uLnN5bmNcblxuICBpZiAoc3luYyA9PT0gdW5kZWZpbmVkIHx8IHN5bmMgPT09IG51bGwpIHJldHVybiB1bmRlZmluZWRcbiAgaWYgKHN5bmMgPT09IGZhbHNlKSByZXR1cm4ge2NvbmZsaWN0U3RyYXRlZ3k6IFwib3B0aW1pc3RpY1ZlcnNpb25cIiwgZW5hYmxlZDogZmFsc2UsIG9wZXJhdGlvbnM6IFtdLCBwb2xpY3lIYXNoOiBzeW5jUG9saWN5SGFzaCh7Y29uZmxpY3RTdHJhdGVneTogXCJvcHRpbWlzdGljVmVyc2lvblwiLCBlbmFibGVkOiBmYWxzZX0pLCBwb2xpY3lWZXJzaW9uOiBudWxsfVxuICBpZiAoc3luYyA9PT0gdHJ1ZSkge1xuICAgIHJldHVybiBub3JtYWxpemVGcm9udGVuZE1vZGVsUmVzb3VyY2VTeW5jKHtcbiAgICAgIC4uLnJlc291cmNlQ29uZmlndXJhdGlvbixcbiAgICAgIHN5bmM6IHtvcGVyYXRpb25zOiBbXCJpbmRleFwiLCBcImZpbmRcIl19XG4gICAgfSlcbiAgfVxuICBpZiAoIXN5bmMgfHwgdHlwZW9mIHN5bmMgIT09IFwib2JqZWN0XCIgfHwgQXJyYXkuaXNBcnJheShzeW5jKSkge1xuICAgIHRocm93IG5ldyBFcnJvcihcIlJlc291cmNlIHN5bmMgY29uZmlndXJhdGlvbiBtdXN0IGJlIHRydWUsIGZhbHNlLCBvciBhbiBvYmplY3QuXCIpXG4gIH1cblxuICBjb25zdCB7Y29uZmxpY3RTdHJhdGVneSwgZW5hYmxlZCA9IHRydWUsIG1ldGFkYXRhLCBvcGVyYXRpb25zLCBwb2xpY3ksIHBvbGljeVZlcnNpb24sIC4uLnJlc3R9ID0gLyoqIEB0eXBlIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkZyb250ZW5kTW9kZWxSZXNvdXJjZVN5bmNDb25maWd1cmF0aW9ufSAqLyAoc3luYylcblxuICBpZiAoT2JqZWN0LmtleXMocmVzdCkubGVuZ3RoID4gMCkge1xuICAgIHRocm93IG5ldyBFcnJvcihgVW5leHBlY3RlZCBzeW5jIGtleXM6ICR7T2JqZWN0LmtleXMocmVzdCkuam9pbihcIiwgXCIpfS4gQWxsb3dlZDogY29uZmxpY3RTdHJhdGVneSwgZW5hYmxlZCwgbWV0YWRhdGEsIG9wZXJhdGlvbnMsIHBvbGljeSwgcG9saWN5VmVyc2lvbmApXG4gIH1cbiAgaWYgKGVuYWJsZWQgIT09IHRydWUgJiYgZW5hYmxlZCAhPT0gZmFsc2UpIHRocm93IG5ldyBFcnJvcihcIlJlc291cmNlIHN5bmMgZW5hYmxlZCBtdXN0IGJlIHRydWUgb3IgZmFsc2Ugd2hlbiBwcm92aWRlZC5cIilcblxuICBjb25zdCBub3JtYWxpemVkQ29uZmxpY3RTdHJhdGVneSA9IG5vcm1hbGl6ZVN5bmNDb25mbGljdFN0cmF0ZWd5KGNvbmZsaWN0U3RyYXRlZ3kpXG4gIGNvbnN0IG5vcm1hbGl6ZWRPcGVyYXRpb25zID0gbm9ybWFsaXplU3luY09wZXJhdGlvbnMob3BlcmF0aW9ucylcbiAgY29uc3Qgbm9ybWFsaXplZE1ldGFkYXRhID0gbWV0YWRhdGEgPT09IHVuZGVmaW5lZCA/IHVuZGVmaW5lZCA6IGRldGVybWluaXN0aWNTeW5jSnNvbih7bGFiZWw6IFwibWV0YWRhdGFcIiwgdmFsdWU6IG1ldGFkYXRhfSlcbiAgY29uc3Qgbm9ybWFsaXplZFBvbGljeSA9IHBvbGljeSA9PT0gdW5kZWZpbmVkID8gdW5kZWZpbmVkIDogZGV0ZXJtaW5pc3RpY1N5bmNKc29uKHtsYWJlbDogXCJwb2xpY3lcIiwgdmFsdWU6IHBvbGljeX0pXG4gIGNvbnN0IG5vcm1hbGl6ZWRQb2xpY3lWZXJzaW9uID0gcG9saWN5VmVyc2lvbiA9PT0gdW5kZWZpbmVkIHx8IHBvbGljeVZlcnNpb24gPT09IG51bGwgPyBudWxsIDogU3RyaW5nKHBvbGljeVZlcnNpb24pXG4gIGNvbnN0IGhhc2hJbnB1dCA9IHtcbiAgICBjb25mbGljdFN0cmF0ZWd5OiBub3JtYWxpemVkQ29uZmxpY3RTdHJhdGVneSxcbiAgICBlbmFibGVkLFxuICAgIG1ldGFkYXRhOiBub3JtYWxpemVkTWV0YWRhdGEsXG4gICAgbW9kZWxOYW1lOiByZXNvdXJjZUNvbmZpZ3VyYXRpb24ubW9kZWxOYW1lIHx8IG51bGwsXG4gICAgb3BlcmF0aW9uczogbm9ybWFsaXplZE9wZXJhdGlvbnMsXG4gICAgcG9saWN5OiBub3JtYWxpemVkUG9saWN5LFxuICAgIHBvbGljeVZlcnNpb246IG5vcm1hbGl6ZWRQb2xpY3lWZXJzaW9uXG4gIH1cbiAgLyoqIEB0eXBlIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLk5vcm1hbGl6ZWRGcm9udGVuZE1vZGVsUmVzb3VyY2VTeW5jQ29uZmlndXJhdGlvbn0gKi9cbiAgY29uc3Qgbm9ybWFsaXplZCA9IHtcbiAgICBjb25mbGljdFN0cmF0ZWd5OiBub3JtYWxpemVkQ29uZmxpY3RTdHJhdGVneSxcbiAgICBlbmFibGVkLFxuICAgIG9wZXJhdGlvbnM6IG5vcm1hbGl6ZWRPcGVyYXRpb25zLFxuICAgIHBvbGljeUhhc2g6IHN5bmNQb2xpY3lIYXNoKGhhc2hJbnB1dCksXG4gICAgcG9saWN5VmVyc2lvbjogbm9ybWFsaXplZFBvbGljeVZlcnNpb25cbiAgfVxuXG4gIGlmIChub3JtYWxpemVkTWV0YWRhdGEgIT09IHVuZGVmaW5lZCkgbm9ybWFsaXplZC5tZXRhZGF0YSA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Gcm9udGVuZE1vZGVsU3luY0pzb25WYWx1ZT59ICovIChub3JtYWxpemVkTWV0YWRhdGEpXG5cbiAgcmV0dXJuIG5vcm1hbGl6ZWRcbn1cblxuLyoqXG4gKiBOb3JtYWxpemVzIHRoZSBzeW5jIGNvbmZsaWN0IHN0cmF0ZWd5IGZvciByZXBsYXkgY2xpZW50cy9zZXJ2ZXJzLlxuICogQHBhcmFtIHt1bmtub3dufSBjb25mbGljdFN0cmF0ZWd5IC0gUmF3IHN0cmF0ZWd5LlxuICogQHJldHVybnMge1wib3B0aW1pc3RpY1ZlcnNpb25cIiB8IFwic2VydmVyV2luc1wiIHwgXCJsYXN0V3JpdGVyV2luc1wiIHwgXCJmaWVsZFRocmVlV2F5XCIgfCBcImFwcGVuZE9ubHlcIn0gLSBOb3JtYWxpemVkIHN0cmF0ZWd5LlxuICovXG5mdW5jdGlvbiBub3JtYWxpemVTeW5jQ29uZmxpY3RTdHJhdGVneShjb25mbGljdFN0cmF0ZWd5KSB7XG4gIGlmIChjb25mbGljdFN0cmF0ZWd5ID09PSB1bmRlZmluZWQgfHwgY29uZmxpY3RTdHJhdGVneSA9PT0gbnVsbCkgcmV0dXJuIFwib3B0aW1pc3RpY1ZlcnNpb25cIlxuICBpZiAoW1wib3B0aW1pc3RpY1ZlcnNpb25cIiwgXCJzZXJ2ZXJXaW5zXCIsIFwibGFzdFdyaXRlcldpbnNcIiwgXCJmaWVsZFRocmVlV2F5XCIsIFwiYXBwZW5kT25seVwiXS5pbmNsdWRlcyhTdHJpbmcoY29uZmxpY3RTdHJhdGVneSkpKSB7XG4gICAgcmV0dXJuIC8qKiBAdHlwZSB7XCJvcHRpbWlzdGljVmVyc2lvblwiIHwgXCJzZXJ2ZXJXaW5zXCIgfCBcImxhc3RXcml0ZXJXaW5zXCIgfCBcImZpZWxkVGhyZWVXYXlcIiB8IFwiYXBwZW5kT25seVwifSAqLyAoY29uZmxpY3RTdHJhdGVneSlcbiAgfVxuXG4gIHRocm93IG5ldyBFcnJvcihgVW5rbm93biByZXNvdXJjZSBzeW5jIGNvbmZsaWN0U3RyYXRlZ3k6ICR7U3RyaW5nKGNvbmZsaWN0U3RyYXRlZ3kpfWApXG59XG5cbi8qKlxuICogTm9ybWFsaXplcyBzeW5jIG9wZXJhdGlvbnMgaW50byBhIHN0YWJsZSwgZHVwbGljYXRlLWZyZWUgbGlzdC5cbiAqIEBwYXJhbSB7dW5rbm93bn0gb3BlcmF0aW9ucyAtIFJhdyBvcGVyYXRpb25zIHZhbHVlLlxuICogQHJldHVybnMge3N0cmluZ1tdfSAtIE5vcm1hbGl6ZWQgb3BlcmF0aW9ucy5cbiAqL1xuZnVuY3Rpb24gbm9ybWFsaXplU3luY09wZXJhdGlvbnMob3BlcmF0aW9ucykge1xuICBpZiAob3BlcmF0aW9ucyA9PT0gdW5kZWZpbmVkKSByZXR1cm4gW11cbiAgaWYgKCFBcnJheS5pc0FycmF5KG9wZXJhdGlvbnMpKSB0aHJvdyBuZXcgRXJyb3IoXCJSZXNvdXJjZSBzeW5jIG9wZXJhdGlvbnMgbXVzdCBiZSBhbiBhcnJheSBvZiBvcGVyYXRpb24gbmFtZXMuXCIpXG5cbiAgY29uc3Qgbm9ybWFsaXplZCA9IG9wZXJhdGlvbnMubWFwKChvcGVyYXRpb24pID0+IHtcbiAgICBpZiAodHlwZW9mIG9wZXJhdGlvbiAhPT0gXCJzdHJpbmdcIiB8fCBvcGVyYXRpb24ubGVuZ3RoIDwgMSkgdGhyb3cgbmV3IEVycm9yKFwiUmVzb3VyY2Ugc3luYyBvcGVyYXRpb25zIGVudHJpZXMgbXVzdCBiZSBub24tZW1wdHkgc3RyaW5ncy5cIilcblxuICAgIHJldHVybiBvcGVyYXRpb25cbiAgfSlcblxuICByZXR1cm4gWy4uLm5ldyBTZXQobm9ybWFsaXplZCldLnNvcnQoKVxufVxuXG4vKipcbiAqIEJ1aWxkcyBhIGRldGVybWluaXN0aWMgcG9saWN5IGhhc2guXG4gKiBAcGFyYW0ge3Vua25vd259IHZhbHVlIC0gSGFzaCBpbnB1dC5cbiAqIEByZXR1cm5zIHtzdHJpbmd9IC0gc2hhMjU2LXByZWZpeGVkIGhhc2guXG4gKi9cbmZ1bmN0aW9uIHN5bmNQb2xpY3lIYXNoKHZhbHVlKSB7XG4gIHJldHVybiBgc2hhMjU2LSR7c2hhMjU2SGV4KHN0YWJsZUpzb25TdHJpbmdpZnkodmFsdWUpKX1gXG59XG5cbi8qKlxuICogVmFsaWRhdGVzIHRoYXQgYSBzeW5jIGNvbmZpZyBzdWJ0cmVlIGlzIGRldGVybWluaXN0aWMgSlNPTiBhbmQgZG9lcyBub3QgY29udGFpbiBvYnZpb3VzIHNlY3JldHMuXG4gKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEFyZ3VtZW50cy5cbiAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmxhYmVsIC0gRGlhZ25vc3RpYyBwYXRoIGxhYmVsLlxuICogQHBhcmFtIHt1bmtub3dufSBhcmdzLnZhbHVlIC0gVmFsdWUgdG8gdmFsaWRhdGUuXG4gKiBAcmV0dXJucyB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Gcm9udGVuZE1vZGVsU3luY0pzb25WYWx1ZX0gLSBTdGFibGUgSlNPTiB2YWx1ZS5cbiAqL1xuZnVuY3Rpb24gZGV0ZXJtaW5pc3RpY1N5bmNKc29uKHtsYWJlbCwgdmFsdWV9KSB7XG4gIGlmICh2YWx1ZSA9PT0gbnVsbCB8fCB0eXBlb2YgdmFsdWUgPT09IFwic3RyaW5nXCIgfHwgdHlwZW9mIHZhbHVlID09PSBcIm51bWJlclwiIHx8IHR5cGVvZiB2YWx1ZSA9PT0gXCJib29sZWFuXCIpIHJldHVybiB2YWx1ZVxuXG4gIGlmIChBcnJheS5pc0FycmF5KHZhbHVlKSkge1xuICAgIHJldHVybiB2YWx1ZS5tYXAoKGVudHJ5LCBpbmRleCkgPT4gZGV0ZXJtaW5pc3RpY1N5bmNKc29uKHtsYWJlbDogYCR7bGFiZWx9LyR7aW5kZXh9YCwgdmFsdWU6IGVudHJ5fSkpXG4gIH1cblxuICBpZiAodmFsdWUgJiYgdHlwZW9mIHZhbHVlID09PSBcIm9iamVjdFwiICYmIE9iamVjdC5nZXRQcm90b3R5cGVPZih2YWx1ZSkgPT09IE9iamVjdC5wcm90b3R5cGUpIHtcbiAgICAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIGltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRnJvbnRlbmRNb2RlbFN5bmNKc29uVmFsdWU+fSAqL1xuICAgIGNvbnN0IG5vcm1hbGl6ZWQgPSB7fVxuXG4gICAgZm9yIChjb25zdCBrZXkgb2YgT2JqZWN0LmtleXModmFsdWUpLnNvcnQoKSkge1xuICAgICAgY29uc3QgY2hpbGRWYWx1ZSA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgdW5rbm93bj59ICovICh2YWx1ZSlba2V5XVxuXG4gICAgICBpZiAoY2hpbGRWYWx1ZSA9PT0gdW5kZWZpbmVkKSBjb250aW51ZVxuICAgICAgaWYgKHN5bmNDb25maWdLZXlMb29rc1NlY3JldChrZXkpKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgU3luYyBwb2xpY3kgJHtsYWJlbH0vJHtrZXl9IGlzIG5vdCBhbGxvd2VkIGluIGZyb250ZW5kLXZpc2libGUgc3luYyBwb2xpY3kgY29uZmlnYClcbiAgICAgIH1cblxuICAgICAgbm9ybWFsaXplZFtrZXldID0gZGV0ZXJtaW5pc3RpY1N5bmNKc29uKHtsYWJlbDogYCR7bGFiZWx9LyR7a2V5fWAsIHZhbHVlOiBjaGlsZFZhbHVlfSlcbiAgICB9XG5cbiAgICByZXR1cm4gbm9ybWFsaXplZFxuICB9XG5cbiAgdGhyb3cgbmV3IEVycm9yKFwiU3luYyBwb2xpY3kgaW5wdXQgbXVzdCBiZSBkZXRlcm1pbmlzdGljIEpTT05cIilcbn1cblxuLyoqXG4gKiBTdGFibGUgSlNPTiBzdHJpbmdpZmllciB3aXRoIHNvcnRlZCBvYmplY3Qga2V5cy5cbiAqIEBwYXJhbSB7dW5rbm93bn0gdmFsdWUgLSBWYWx1ZSB0byBzdHJpbmdpZnkuXG4gKiBAcmV0dXJucyB7c3RyaW5nfSAtIFN0YWJsZSBKU09OLlxuICovXG5mdW5jdGlvbiBzdGFibGVKc29uU3RyaW5naWZ5KHZhbHVlKSB7XG4gIHJldHVybiBKU09OLnN0cmluZ2lmeShkZXRlcm1pbmlzdGljU3luY0pzb24oe2xhYmVsOiBcImhhc2hcIiwgdmFsdWV9KSlcbn1cblxuLyoqXG4gKiBSZXR1cm5zIHdoZXRoZXIgYSBzeW5jIGNvbmZpZyBrZXkgbG9va3MgbGlrZSBhIGNyZWRlbnRpYWwvc2VjcmV0LlxuICogQHBhcmFtIHtzdHJpbmd9IGtleSAtIE9iamVjdCBrZXkuXG4gKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIGtleSBpcyBkaXNhbGxvd2VkLlxuICovXG5mdW5jdGlvbiBzeW5jQ29uZmlnS2V5TG9va3NTZWNyZXQoa2V5KSB7XG4gIHJldHVybiAvc2VjcmV0fHRva2VufHBhc3N3b3JkfHByaXZhdGUuP2tleXxzaWduaW5nLj9rZXkvaS50ZXN0KGtleSlcbn1cblxuLyoqXG4gKiBSdW5zIG5vcm1hbGl6ZSBmcm9udGVuZCBtb2RlbCByZXNvdXJjZSBjb21tYW5kcy5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Gcm9udGVuZE1vZGVsUmVzb3VyY2VDb25maWd1cmF0aW9ufSByZXNvdXJjZUNvbmZpZ3VyYXRpb24gLSBSYXcgcmVzb3VyY2UgY29uZmlndXJhdGlvbi5cbiAqIEByZXR1cm5zIHt7YnVpbHRJbkNvbGxlY3Rpb25Db21tYW5kczogUmVjb3JkPHN0cmluZywgc3RyaW5nPiwgYnVpbHRJbk1lbWJlckNvbW1hbmRzOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+LCBjb2xsZWN0aW9uQ29tbWFuZHM6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4sIGNvbW1hbmRNZXRhZGF0YTogUmVjb3JkPHN0cmluZywge2FyZ3M6IEFycmF5PHtuYW1lOiBzdHJpbmcsIHR5cGU6IHN0cmluZ30+LCByZXR1cm5UeXBlOiBzdHJpbmcgfCBudWxsfT4sIG1lbWJlckNvbW1hbmRzOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+fX0gLSBOb3JtYWxpemVkIGNvbW1hbmQgY29uZmlndXJhdGlvbi5cbiAqL1xuZnVuY3Rpb24gbm9ybWFsaXplRnJvbnRlbmRNb2RlbFJlc291cmNlQ29tbWFuZHMocmVzb3VyY2VDb25maWd1cmF0aW9uKSB7XG4gIGNvbnN0IGJ1aWx0SW5Db2xsZWN0aW9uQ29tbWFuZHMgPSByZXNvdXJjZUNvbmZpZ3VyYXRpb24uYnVpbHRJbkNvbGxlY3Rpb25Db21tYW5kc1xuICBjb25zdCBidWlsdEluTWVtYmVyQ29tbWFuZHMgPSByZXNvdXJjZUNvbmZpZ3VyYXRpb24uYnVpbHRJbk1lbWJlckNvbW1hbmRzXG4gIGNvbnN0IGN1c3RvbUNvbGxlY3Rpb25Db21tYW5kcyA9IHJlc291cmNlQ29uZmlndXJhdGlvbi5jb2xsZWN0aW9uQ29tbWFuZHNcbiAgY29uc3QgY3VzdG9tTWVtYmVyQ29tbWFuZHMgPSByZXNvdXJjZUNvbmZpZ3VyYXRpb24ubWVtYmVyQ29tbWFuZHNcbiAgY29uc3Qgbm9ybWFsaXplZEJ1aWx0SW5Db2xsZWN0aW9uQ29tbWFuZHMgPSBub3JtYWxpemVGcm9udGVuZE1vZGVsQnVpbHRJbkNvbW1hbmRzKHtcbiAgICBjb21tYW5kRGVmYXVsdHM6IHtcbiAgICAgIGNyZWF0ZTogXCJjcmVhdGVcIixcbiAgICAgIGluZGV4OiBcImluZGV4XCJcbiAgICB9LFxuICAgIGNvbW1hbmRzQ29uZmlnOiBidWlsdEluQ29sbGVjdGlvbkNvbW1hbmRzLFxuICAgIG1vZGVsTmFtZTogXCJDb2xsZWN0aW9uQ29tbWFuZFwiXG4gIH0pXG4gIGNvbnN0IG5vcm1hbGl6ZWRCdWlsdEluTWVtYmVyQ29tbWFuZHMgPSBub3JtYWxpemVGcm9udGVuZE1vZGVsQnVpbHRJbkNvbW1hbmRzKHtcbiAgICBjb21tYW5kRGVmYXVsdHM6IHtcbiAgICAgIGF0dGFjaDogXCJhdHRhY2hcIixcbiAgICAgIGF0dGFjaG1lbnRMaXN0OiBcImF0dGFjaG1lbnRMaXN0XCIsXG4gICAgICBkZXN0cm95OiBcImRlc3Ryb3lcIixcbiAgICAgIGRvd25sb2FkOiBcImRvd25sb2FkXCIsXG4gICAgICBmaW5kOiBcImZpbmRcIixcbiAgICAgIHVwZGF0ZTogXCJ1cGRhdGVcIixcbiAgICAgIHVybDogXCJ1cmxcIlxuICAgIH0sXG4gICAgY29tbWFuZHNDb25maWc6IGJ1aWx0SW5NZW1iZXJDb21tYW5kcyxcbiAgICBtb2RlbE5hbWU6IFwiTWVtYmVyQ29tbWFuZFwiXG4gIH0pXG5cbiAgY29uc3Qgbm9ybWFsaXplZENvbGxlY3Rpb25Db21tYW5kcyA9IG5vcm1hbGl6ZUZyb250ZW5kTW9kZWxDdXN0b21Db21tYW5kcyh7Y29tbWFuZHNDb25maWc6IGN1c3RvbUNvbGxlY3Rpb25Db21tYW5kcywgbW9kZWxOYW1lOiBcIkNvbGxlY3Rpb25Db21tYW5kXCJ9KVxuICBjb25zdCBub3JtYWxpemVkTWVtYmVyQ29tbWFuZHMgPSBub3JtYWxpemVGcm9udGVuZE1vZGVsQ3VzdG9tQ29tbWFuZHMoe2NvbW1hbmRzQ29uZmlnOiBjdXN0b21NZW1iZXJDb21tYW5kcywgbW9kZWxOYW1lOiBcIk1lbWJlckNvbW1hbmRcIn0pXG5cbiAgcmV0dXJuIHtcbiAgICBidWlsdEluQ29sbGVjdGlvbkNvbW1hbmRzOiBub3JtYWxpemVkQnVpbHRJbkNvbGxlY3Rpb25Db21tYW5kcyxcbiAgICBidWlsdEluTWVtYmVyQ29tbWFuZHM6IG5vcm1hbGl6ZWRCdWlsdEluTWVtYmVyQ29tbWFuZHMsXG4gICAgY29sbGVjdGlvbkNvbW1hbmRzOiBub3JtYWxpemVkQ29sbGVjdGlvbkNvbW1hbmRzLmNvbW1hbmRzLFxuICAgIGNvbW1hbmRNZXRhZGF0YTogey4uLm5vcm1hbGl6ZWRDb2xsZWN0aW9uQ29tbWFuZHMubWV0YWRhdGEsIC4uLm5vcm1hbGl6ZWRNZW1iZXJDb21tYW5kcy5tZXRhZGF0YX0sXG4gICAgbWVtYmVyQ29tbWFuZHM6IG5vcm1hbGl6ZWRNZW1iZXJDb21tYW5kcy5jb21tYW5kc1xuICB9XG59XG5cbi8qKlxuICogUnVucyBub3JtYWxpemUgZnJvbnRlbmQgbW9kZWwgYnVpbHQgaW4gY29tbWFuZHMuXG4gKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEFyZ3VtZW50cy5cbiAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgc3RyaW5nPn0gYXJncy5jb21tYW5kRGVmYXVsdHMgLSBCdWlsdC1pbiBkZWZhdWx0IGNvbW1hbmQgbmFtZXMuXG4gKiBAcGFyYW0ge3N0cmluZ1tdIHwgdW5kZWZpbmVkfSBhcmdzLmNvbW1hbmRzQ29uZmlnIC0gQnVpbHQtaW4gY29tbWFuZHMgY29uZmlnIChjYW1lbENhc2UgY29tbWFuZCB0eXBlIGxpc3QpLlxuICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MubW9kZWxOYW1lIC0gRGlhZ25vc3RpYyBtb2RlbCBuYW1lLlxuICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIHN0cmluZz59IC0gTm9ybWFsaXplZCBidWlsdC1pbiBjb21tYW5kIGNvbmZpZy5cbiAqL1xuZnVuY3Rpb24gbm9ybWFsaXplRnJvbnRlbmRNb2RlbEJ1aWx0SW5Db21tYW5kcyh7Y29tbWFuZERlZmF1bHRzLCBjb21tYW5kc0NvbmZpZywgbW9kZWxOYW1lfSkge1xuICBpZiAoIWNvbW1hbmRzQ29uZmlnKSB7XG4gICAgcmV0dXJuIGNvbW1hbmREZWZhdWx0c1xuICB9XG5cbiAgaWYgKCFBcnJheS5pc0FycmF5KGNvbW1hbmRzQ29uZmlnKSkge1xuICAgIHRocm93IG5ldyBFcnJvcihgJHttb2RlbE5hbWV9IGNvbmZpZ3VyYXRpb24gbXVzdCB1c2UgdGhlIGFycmF5IGZvcm0uIE9iamVjdCBmb3JtIGlzIG5vIGxvbmdlciBzdXBwb3J0ZWQuYClcbiAgfVxuXG4gIC8qKlxuICAgKiBOb3JtYWxpemVkIGNvbW1hbmRzLlxuICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgc3RyaW5nPn0gKi9cbiAgY29uc3Qgbm9ybWFsaXplZENvbW1hbmRzID0ge31cblxuICBmb3IgKGNvbnN0IGNvbW1hbmRUeXBlIG9mIGNvbW1hbmRzQ29uZmlnKSB7XG4gICAgY29uc3QgZGVmYXVsdENvbW1hbmROYW1lID0gY29tbWFuZERlZmF1bHRzW2NvbW1hbmRUeXBlXVxuXG4gICAgaWYgKCFkZWZhdWx0Q29tbWFuZE5hbWUpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgVW5rbm93biBidWlsdC1pbiBmcm9udGVuZCBtb2RlbCBjb21tYW5kICcke2NvbW1hbmRUeXBlfScgZm9yICR7bW9kZWxOYW1lfWApXG4gICAgfVxuXG4gICAgbm9ybWFsaXplZENvbW1hbmRzW2NvbW1hbmRUeXBlXSA9IHZhbGlkYXRlRnJvbnRlbmRNb2RlbFJlc291cmNlQ29tbWFuZE5hbWUoe1xuICAgICAgY29tbWFuZE5hbWU6IGRlZmF1bHRDb21tYW5kTmFtZSxcbiAgICAgIGNvbW1hbmRUeXBlOiBkZWZhdWx0Q29tbWFuZE5hbWUsXG4gICAgICBtb2RlbE5hbWVcbiAgICB9KVxuICB9XG5cbiAgcmV0dXJuIG5vcm1hbGl6ZWRDb21tYW5kc1xufVxuXG4vKipcbiAqIFJ1bnMgbm9ybWFsaXplIGZyb250ZW5kIG1vZGVsIGN1c3RvbSBjb21tYW5kcy4gRW50cmllcyBhcmUgZWl0aGVyIGEgcGxhaW5cbiAqIGNhbWVsQ2FzZSBtZXRob2QtbmFtZSBzdHJpbmcgb3IgYSBge25hbWUsIGFyZ3M/LCByZXR1cm5UeXBlP31gIG9iamVjdCB0aGF0XG4gKiBhbHNvIGRlY2xhcmVzIHRoZSBjb21tYW5kJ3MgdHlwZWQgYXJndW1lbnRzIGFuZC9vciByZXNwb25zZSB0eXBlLlxuICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBBcmd1bWVudHMuXG4gKiBAcGFyYW0ge0FycmF5PHN0cmluZyB8IHtuYW1lOiBzdHJpbmcsIGFyZ3M/OiBBcnJheTx7bmFtZTogc3RyaW5nLCB0eXBlOiBzdHJpbmd9PiwgcmV0dXJuVHlwZT86IHN0cmluZ30+IHwgdW5kZWZpbmVkfSBhcmdzLmNvbW1hbmRzQ29uZmlnIC0gQ3VzdG9tIGNvbW1hbmRzIGNvbmZpZy5cbiAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLm1vZGVsTmFtZSAtIERpYWdub3N0aWMgbW9kZWwgbmFtZS5cbiAqIEByZXR1cm5zIHt7Y29tbWFuZHM6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4sIG1ldGFkYXRhOiBSZWNvcmQ8c3RyaW5nLCB7YXJnczogQXJyYXk8e25hbWU6IHN0cmluZywgdHlwZTogc3RyaW5nfT4sIHJldHVyblR5cGU6IHN0cmluZyB8IG51bGx9Pn19IC0gUm91dGUgbWFwIChtZXRob2QgbmFtZSDihpIga2ViYWIgc2x1ZykgKyBwZXItY29tbWFuZCBtZXRhZGF0YS5cbiAqL1xuZnVuY3Rpb24gbm9ybWFsaXplRnJvbnRlbmRNb2RlbEN1c3RvbUNvbW1hbmRzKHtjb21tYW5kc0NvbmZpZywgbW9kZWxOYW1lfSkge1xuICBpZiAoIWNvbW1hbmRzQ29uZmlnKSB7XG4gICAgcmV0dXJuIHtjb21tYW5kczoge30sIG1ldGFkYXRhOiB7fX1cbiAgfVxuXG4gIGlmICghQXJyYXkuaXNBcnJheShjb21tYW5kc0NvbmZpZykpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYCR7bW9kZWxOYW1lfSBjb25maWd1cmF0aW9uIG11c3QgdXNlIHRoZSBhcnJheSBmb3JtLiBPYmplY3QgZm9ybSBpcyBubyBsb25nZXIgc3VwcG9ydGVkLmApXG4gIH1cblxuICAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIHN0cmluZz59ICovXG4gIGNvbnN0IGNvbW1hbmRzID0ge31cbiAgLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCB7YXJnczogQXJyYXk8e25hbWU6IHN0cmluZywgdHlwZTogc3RyaW5nfT4sIHJldHVyblR5cGU6IHN0cmluZyB8IG51bGx9Pn0gKi9cbiAgY29uc3QgbWV0YWRhdGEgPSB7fVxuXG4gIGZvciAoY29uc3QgY29tbWFuZEVudHJ5IG9mIGNvbW1hbmRzQ29uZmlnKSB7XG4gICAgY29uc3Qge21ldGhvZE5hbWUsIGFyZ3MsIHJldHVyblR5cGV9ID0gbm9ybWFsaXplRnJvbnRlbmRNb2RlbEN1c3RvbUNvbW1hbmRFbnRyeSh7Y29tbWFuZEVudHJ5LCBtb2RlbE5hbWV9KVxuICAgIGNvbnN0IHZhbGlkYXRlZE1ldGhvZE5hbWUgPSB2YWxpZGF0ZUZyb250ZW5kTW9kZWxSZXNvdXJjZUNvbW1hbmROYW1lKHtcbiAgICAgIGNvbW1hbmROYW1lOiBtZXRob2ROYW1lLFxuICAgICAgY29tbWFuZFR5cGU6IG1ldGhvZE5hbWUsXG4gICAgICBtb2RlbE5hbWVcbiAgICB9KVxuICAgIGNvbnN0IGNvbW1hbmRTbHVnID0gaW5mbGVjdGlvbi5kYXNoZXJpemUoaW5mbGVjdGlvbi51bmRlcnNjb3JlKHZhbGlkYXRlZE1ldGhvZE5hbWUpKVxuXG4gICAgY29tbWFuZHNbdmFsaWRhdGVkTWV0aG9kTmFtZV0gPSBjb21tYW5kU2x1Z1xuICAgIG1ldGFkYXRhW3ZhbGlkYXRlZE1ldGhvZE5hbWVdID0ge2FyZ3MsIHJldHVyblR5cGV9XG4gIH1cblxuICByZXR1cm4ge2NvbW1hbmRzLCBtZXRhZGF0YX1cbn1cblxuLyoqXG4gKiBOb3JtYWxpemVzIG9uZSBjdXN0b20tY29tbWFuZCBlbnRyeSAoc3RyaW5nIHNob3J0aGFuZCBvciBjb250cmFjdCBvYmplY3QpLlxuICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBBcmd1bWVudHMuXG4gKiBAcGFyYW0ge3Vua25vd259IGFyZ3MuY29tbWFuZEVudHJ5IC0gUmF3IGNvbW1hbmQgZW50cnkuXG4gKiBAcGFyYW0ge3N0cmluZ30gYXJncy5tb2RlbE5hbWUgLSBEaWFnbm9zdGljIG1vZGVsIG5hbWUuXG4gKiBAcmV0dXJucyB7e21ldGhvZE5hbWU6IHN0cmluZywgYXJnczogQXJyYXk8e25hbWU6IHN0cmluZywgdHlwZTogc3RyaW5nfT4sIHJldHVyblR5cGU6IHN0cmluZyB8IG51bGx9fSAtIE1ldGhvZCBuYW1lICsgbWV0YWRhdGEuXG4gKi9cbmZ1bmN0aW9uIG5vcm1hbGl6ZUZyb250ZW5kTW9kZWxDdXN0b21Db21tYW5kRW50cnkoe2NvbW1hbmRFbnRyeSwgbW9kZWxOYW1lfSkge1xuICBpZiAodHlwZW9mIGNvbW1hbmRFbnRyeSA9PT0gXCJzdHJpbmdcIikge1xuICAgIHJldHVybiB7bWV0aG9kTmFtZTogY29tbWFuZEVudHJ5LCBhcmdzOiBbXSwgcmV0dXJuVHlwZTogbnVsbH1cbiAgfVxuXG4gIGlmICghY29tbWFuZEVudHJ5IHx8IHR5cGVvZiBjb21tYW5kRW50cnkgIT09IFwib2JqZWN0XCIgfHwgQXJyYXkuaXNBcnJheShjb21tYW5kRW50cnkpKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGAke21vZGVsTmFtZX0gZW50cmllcyBtdXN0IGJlIGEgY2FtZWxDYXNlIG5hbWUgc3RyaW5nIG9yIGEge25hbWUsIGFyZ3M/LCByZXR1cm5UeXBlP30gb2JqZWN0YClcbiAgfVxuXG4gIGNvbnN0IHtuYW1lLCBhcmdzLCByZXR1cm5UeXBlLCAuLi5yZXN0fSA9IC8qKiBAdHlwZSB7e25hbWU/OiB1bmtub3duLCBhcmdzPzogdW5rbm93biwgcmV0dXJuVHlwZT86IHVua25vd259fSAqLyAoY29tbWFuZEVudHJ5KVxuXG4gIGlmIChPYmplY3Qua2V5cyhyZXN0KS5sZW5ndGggPiAwKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGBVbmV4cGVjdGVkICR7bW9kZWxOYW1lfSBrZXlzOiAke09iamVjdC5rZXlzKHJlc3QpLmpvaW4oXCIsIFwiKX0uIEFsbG93ZWQ6IG5hbWUsIGFyZ3MsIHJldHVyblR5cGVgKVxuICB9XG5cbiAgaWYgKHR5cGVvZiBuYW1lICE9PSBcInN0cmluZ1wiIHx8IG5hbWUubGVuZ3RoIDwgMSkge1xuICAgIHRocm93IG5ldyBFcnJvcihgJHttb2RlbE5hbWV9IG9iamVjdCBlbnRyaWVzIHJlcXVpcmUgYSBub24tZW1wdHkgJ25hbWUnIHN0cmluZ2ApXG4gIH1cblxuICByZXR1cm4ge1xuICAgIG1ldGhvZE5hbWU6IG5hbWUsXG4gICAgYXJnczogbm9ybWFsaXplRnJvbnRlbmRNb2RlbENvbW1hbmRBcmdzKHthcmdzLCBjb21tYW5kTmFtZTogbmFtZSwgbW9kZWxOYW1lfSksXG4gICAgcmV0dXJuVHlwZTogbm9ybWFsaXplRnJvbnRlbmRNb2RlbENvbW1hbmRSZXR1cm5UeXBlKHtjb21tYW5kTmFtZTogbmFtZSwgbW9kZWxOYW1lLCByZXR1cm5UeXBlfSlcbiAgfVxufVxuXG4vKipcbiAqIFZhbGlkYXRlcyBhbmQgbm9ybWFsaXplcyBhIGN1c3RvbSBjb21tYW5kJ3MgdHlwZWQtYXJndW1lbnQgbGlzdC5cbiAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gQXJndW1lbnRzLlxuICogQHBhcmFtIHt1bmtub3dufSBhcmdzLmFyZ3MgLSBSYXcgY29tbWFuZCBhcmdzLlxuICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MuY29tbWFuZE5hbWUgLSBDb21tYW5kIG5hbWUgZm9yIGRpYWdub3N0aWNzLlxuICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MubW9kZWxOYW1lIC0gRGlhZ25vc3RpYyBtb2RlbCBuYW1lLlxuICogQHJldHVybnMge0FycmF5PHtuYW1lOiBzdHJpbmcsIHR5cGU6IHN0cmluZ30+fSAtIE5vcm1hbGl6ZWQgdHlwZWQgY29tbWFuZCBhcmd1bWVudHMuXG4gKi9cbmZ1bmN0aW9uIG5vcm1hbGl6ZUZyb250ZW5kTW9kZWxDb21tYW5kQXJncyh7YXJncywgY29tbWFuZE5hbWUsIG1vZGVsTmFtZX0pIHtcbiAgaWYgKGFyZ3MgPT09IHVuZGVmaW5lZCB8fCBhcmdzID09PSBudWxsKSB7XG4gICAgcmV0dXJuIFtdXG4gIH1cblxuICBpZiAoIUFycmF5LmlzQXJyYXkoYXJncykpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYCR7bW9kZWxOYW1lfSAnJHtjb21tYW5kTmFtZX0nIGFyZ3MgbXVzdCBiZSBhbiBhcnJheSBvZiB7bmFtZSwgdHlwZX0gb2JqZWN0c2ApXG4gIH1cblxuICByZXR1cm4gYXJncy5tYXAoKGFyZykgPT4ge1xuICAgIGlmICghYXJnIHx8IHR5cGVvZiBhcmcgIT09IFwib2JqZWN0XCIgfHwgdHlwZW9mIGFyZy5uYW1lICE9PSBcInN0cmluZ1wiIHx8IGFyZy5uYW1lLmxlbmd0aCA8IDEgfHwgdHlwZW9mIGFyZy50eXBlICE9PSBcInN0cmluZ1wiIHx8IGFyZy50eXBlLnRyaW0oKS5sZW5ndGggPCAxKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYCR7bW9kZWxOYW1lfSAnJHtjb21tYW5kTmFtZX0nIGFyZ3MgZW50cmllcyByZXF1aXJlIG5vbi1lbXB0eSAnbmFtZScgYW5kIEpTRG9jLXR5cGUgJ3R5cGUnIHN0cmluZ3NgKVxuICAgIH1cblxuICAgIHJldHVybiB7bmFtZTogYXJnLm5hbWUsIHR5cGU6IGFyZy50eXBlLnRyaW0oKX1cbiAgfSlcbn1cblxuLyoqXG4gKiBWYWxpZGF0ZXMgYW5kIG5vcm1hbGl6ZXMgYSBjdXN0b20gY29tbWFuZCdzIGRlY2xhcmVkIEpTRG9jIHJldHVybiB0eXBlLlxuICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBBcmd1bWVudHMuXG4gKiBAcGFyYW0ge3N0cmluZ30gYXJncy5jb21tYW5kTmFtZSAtIENvbW1hbmQgbmFtZSBmb3IgZGlhZ25vc3RpY3MuXG4gKiBAcGFyYW0ge3N0cmluZ30gYXJncy5tb2RlbE5hbWUgLSBEaWFnbm9zdGljIG1vZGVsIG5hbWUuXG4gKiBAcGFyYW0ge3Vua25vd259IGFyZ3MucmV0dXJuVHlwZSAtIFJhdyByZXR1cm4gdHlwZS5cbiAqIEByZXR1cm5zIHtzdHJpbmcgfCBudWxsfSAtIE5vcm1hbGl6ZWQgSlNEb2MgcmV0dXJuIHR5cGUuXG4gKi9cbmZ1bmN0aW9uIG5vcm1hbGl6ZUZyb250ZW5kTW9kZWxDb21tYW5kUmV0dXJuVHlwZSh7Y29tbWFuZE5hbWUsIG1vZGVsTmFtZSwgcmV0dXJuVHlwZX0pIHtcbiAgaWYgKHJldHVyblR5cGUgPT09IHVuZGVmaW5lZCB8fCByZXR1cm5UeXBlID09PSBudWxsKSB7XG4gICAgcmV0dXJuIG51bGxcbiAgfVxuXG4gIGlmICh0eXBlb2YgcmV0dXJuVHlwZSAhPT0gXCJzdHJpbmdcIiB8fCByZXR1cm5UeXBlLnRyaW0oKS5sZW5ndGggPCAxKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGAke21vZGVsTmFtZX0gJyR7Y29tbWFuZE5hbWV9JyByZXR1cm5UeXBlIG11c3QgYmUgYSBub24tZW1wdHkgSlNEb2MgdHlwZSBzdHJpbmdgKVxuICB9XG5cbiAgcmV0dXJuIHJldHVyblR5cGUudHJpbSgpXG59XG5cbi8qKlxuICogUnVucyB0aGUgZnJvbnRlbmRNb2RlbFJlc291cmNlUGF0aCBoZWxwZXIuXG4gKiBAcGFyYW0ge3N0cmluZ30gbW9kZWxOYW1lIC0gTW9kZWwgY2xhc3MgbmFtZS5cbiAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHJlc291cmNlRGVmaW5pdGlvbiAtIFJlc291cmNlIGRlZmluaXRpb24uXG4gKiBAcmV0dXJucyB7c3RyaW5nfSAtIE5vcm1hbGl6ZWQgcmVzb3VyY2UgcGF0aC5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGZyb250ZW5kTW9kZWxSZXNvdXJjZVBhdGgobW9kZWxOYW1lLCByZXNvdXJjZURlZmluaXRpb24pIHtcbiAgY29uc3QgcmVzb3VyY2VDb25maWd1cmF0aW9uID0gZnJvbnRlbmRNb2RlbFJlc291cmNlQ29uZmlndXJhdGlvbkZyb21EZWZpbml0aW9uKHJlc291cmNlRGVmaW5pdGlvbilcblxuICBpZiAoIXJlc291cmNlQ29uZmlndXJhdGlvbikge1xuICAgIHRocm93IG5ldyBFcnJvcihgSW52YWxpZCBmcm9udGVuZCBtb2RlbCByZXNvdXJjZSBkZWZpbml0aW9uIGZvciAke21vZGVsTmFtZX1gKVxuICB9XG5cbiAgcmV0dXJuIGAvJHtpbmZsZWN0aW9uLmRhc2hlcml6ZShpbmZsZWN0aW9uLnBsdXJhbGl6ZShpbmZsZWN0aW9uLnVuZGVyc2NvcmUobW9kZWxOYW1lKSkpfWBcbn1cblxuLyoqXG4gKiBSdW5zIHRoZSBmcm9udGVuZE1vZGVsQWN0aW9uRm9yQ29tbWFuZCBoZWxwZXIuXG4gKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEFyZ3VtZW50cy5cbiAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmNvbW1hbmROYW1lIC0gQ29tbWFuZCBwYXRoIHNlZ21lbnQuXG4gKiBAcGFyYW0ge3N0cmluZ30gYXJncy5tb2RlbE5hbWUgLSBNb2RlbCBjbGFzcyBuYW1lLlxuICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gYXJncy5yZXNvdXJjZURlZmluaXRpb24gLSBSZXNvdXJjZSBkZWZpbml0aW9uLlxuICogQHJldHVybnMge1wiZGVzdHJveVwiIHwgXCJmaW5kXCIgfCBcImluZGV4XCIgfCBcImNyZWF0ZVwiIHwgXCJ1cGRhdGVcIiB8IFwiYXR0YWNoXCIgfCBcImRvd25sb2FkXCIgfCBcInVybFwiIHwgbnVsbH0gLSBGcm9udGVuZCBhY3Rpb24uXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBmcm9udGVuZE1vZGVsQWN0aW9uRm9yQ29tbWFuZCh7Y29tbWFuZE5hbWUsIG1vZGVsTmFtZSwgcmVzb3VyY2VEZWZpbml0aW9ufSkge1xuICBjb25zdCByZXNvdXJjZUNvbmZpZ3VyYXRpb24gPSBmcm9udGVuZE1vZGVsUmVzb3VyY2VDb25maWd1cmF0aW9uRnJvbURlZmluaXRpb24ocmVzb3VyY2VEZWZpbml0aW9uKVxuXG4gIGlmICghcmVzb3VyY2VDb25maWd1cmF0aW9uKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGBJbnZhbGlkIGZyb250ZW5kIG1vZGVsIHJlc291cmNlIGRlZmluaXRpb24gZm9yICR7bW9kZWxOYW1lfWApXG4gIH1cblxuICBmb3IgKGNvbnN0IFthY3Rpb24sIGNvbmZpZ3VyZWRDb21tYW5kTmFtZV0gb2YgT2JqZWN0LmVudHJpZXMoe1xuICAgIC4uLnJlc291cmNlQ29uZmlndXJhdGlvbi5idWlsdEluQ29sbGVjdGlvbkNvbW1hbmRzLFxuICAgIC4uLnJlc291cmNlQ29uZmlndXJhdGlvbi5idWlsdEluTWVtYmVyQ29tbWFuZHNcbiAgfSkpIHtcbiAgICBpZiAoY29uZmlndXJlZENvbW1hbmROYW1lID09PSB1bmRlZmluZWQpIGNvbnRpbnVlXG5cbiAgICBjb25zdCB2YWxpZGF0ZWRDb21tYW5kTmFtZSA9IHZhbGlkYXRlRnJvbnRlbmRNb2RlbFJlc291cmNlQ29tbWFuZE5hbWUoe1xuICAgICAgY29tbWFuZE5hbWU6IGNvbmZpZ3VyZWRDb21tYW5kTmFtZSxcbiAgICAgIGNvbW1hbmRUeXBlOiAvKiogQHR5cGUge1wiYXR0YWNoXCIgfCBcImNyZWF0ZVwiIHwgXCJkZXN0cm95XCIgfCBcImRvd25sb2FkXCIgfCBcImZpbmRcIiB8IFwiaW5kZXhcIiB8IFwidXBkYXRlXCIgfCBcInVybFwifSAqLyAoYWN0aW9uKSxcbiAgICAgIG1vZGVsTmFtZVxuICAgIH0pXG5cbiAgICBpZiAoY29tbWFuZE5hbWUgPT09IHZhbGlkYXRlZENvbW1hbmROYW1lKSB7XG4gICAgICByZXR1cm4gLyoqIEB0eXBlIHtcImF0dGFjaFwiIHwgXCJjcmVhdGVcIiB8IFwiZGVzdHJveVwiIHwgXCJkb3dubG9hZFwiIHwgXCJmaW5kXCIgfCBcImluZGV4XCIgfCBcInVwZGF0ZVwiIHwgXCJ1cmxcIn0gKi8gKGFjdGlvbilcbiAgICB9XG4gIH1cblxuICByZXR1cm4gbnVsbFxufVxuXG4vKipcbiAqIFJ1bnMgdGhlIGZyb250ZW5kTW9kZWxDdXN0b21Db21tYW5kRm9yUGF0aCBoZWxwZXIuXG4gKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEFyZ3VtZW50cy5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5CYWNrZW5kUHJvamVjdENvbmZpZ3VyYXRpb25bXX0gYXJncy5iYWNrZW5kUHJvamVjdHMgLSBCYWNrZW5kIHByb2plY3RzIHRvIHNjYW4uXG4gKiBAcGFyYW0ge3N0cmluZ30gYXJncy5jdXJyZW50UGF0aCAtIFJlcXVlc3QgcGF0aCB3aXRob3V0IHF1ZXJ5LlxuICogQHJldHVybnMge3tjb21tYW5kTmFtZTogc3RyaW5nLCBtZW1iZXJJZD86IHN0cmluZywgbWV0aG9kTmFtZTogc3RyaW5nLCBtb2RlbE5hbWU6IHN0cmluZywgcmVzb3VyY2VQYXRoOiBzdHJpbmcsIHNjb3BlOiBcImNvbGxlY3Rpb25cIiB8IFwibWVtYmVyXCJ9IHwgbnVsbH0gLSBNYXRjaGVkIGN1c3RvbSBjb21tYW5kIG1ldGFkYXRhLlxuICovXG5leHBvcnQgZnVuY3Rpb24gZnJvbnRlbmRNb2RlbEN1c3RvbUNvbW1hbmRGb3JQYXRoKHtiYWNrZW5kUHJvamVjdHMsIGN1cnJlbnRQYXRofSkge1xuICBjb25zdCBub3JtYWxpemVkQ3VycmVudFBhdGggPSBub3JtYWxpemVGcm9udGVuZE1vZGVsUmVzb3VyY2VQYXRoRm9yTWF0Y2goY3VycmVudFBhdGgpXG5cbiAgZm9yIChjb25zdCBiYWNrZW5kUHJvamVjdCBvZiBiYWNrZW5kUHJvamVjdHMpIHtcbiAgICBjb25zdCByZXNvdXJjZXMgPSBmcm9udGVuZE1vZGVsUmVzb3VyY2VzRm9yQmFja2VuZFByb2plY3QoYmFja2VuZFByb2plY3QpXG5cbiAgICBmb3IgKGNvbnN0IG1vZGVsTmFtZSBpbiByZXNvdXJjZXMpIHtcbiAgICAgIGNvbnN0IHJlc291cmNlRGVmaW5pdGlvbiA9IHJlc291cmNlc1ttb2RlbE5hbWVdXG4gICAgICBjb25zdCByZXNvdXJjZUNvbmZpZ3VyYXRpb24gPSBmcm9udGVuZE1vZGVsUmVzb3VyY2VDb25maWd1cmF0aW9uRnJvbURlZmluaXRpb24ocmVzb3VyY2VEZWZpbml0aW9uKVxuXG4gICAgICBpZiAoIXJlc291cmNlQ29uZmlndXJhdGlvbikge1xuICAgICAgICBjb250aW51ZVxuICAgICAgfVxuXG4gICAgICBjb25zdCByZXNvdXJjZVBhdGggPSBub3JtYWxpemVGcm9udGVuZE1vZGVsUmVzb3VyY2VQYXRoRm9yTWF0Y2goZnJvbnRlbmRNb2RlbFJlc291cmNlUGF0aChtb2RlbE5hbWUsIHJlc291cmNlRGVmaW5pdGlvbikpXG4gICAgICBjb25zdCBleHBlY3RlZFByZWZpeCA9IGAke3Jlc291cmNlUGF0aH0vYFxuXG4gICAgICBpZiAoIW5vcm1hbGl6ZWRDdXJyZW50UGF0aC5zdGFydHNXaXRoKGV4cGVjdGVkUHJlZml4KSkge1xuICAgICAgICBjb250aW51ZVxuICAgICAgfVxuXG4gICAgICBjb25zdCBwYXRoU2VnbWVudHMgPSBub3JtYWxpemVkQ3VycmVudFBhdGhcbiAgICAgICAgLnNsaWNlKGV4cGVjdGVkUHJlZml4Lmxlbmd0aClcbiAgICAgICAgLnNwbGl0KFwiL1wiKVxuICAgICAgICAuZmlsdGVyKEJvb2xlYW4pXG5cbiAgICAgIGlmIChwYXRoU2VnbWVudHMubGVuZ3RoID09PSAxKSB7XG4gICAgICAgIGNvbnN0IG1hdGNoZWRDb2xsZWN0aW9uQ29tbWFuZCA9IE9iamVjdC5lbnRyaWVzKHJlc291cmNlQ29uZmlndXJhdGlvbi5jb2xsZWN0aW9uQ29tbWFuZHMpXG4gICAgICAgICAgLmZpbmQoKFssIGNvbW1hbmROYW1lXSkgPT4gY29tbWFuZE5hbWUgPT09IHBhdGhTZWdtZW50c1swXSlcblxuICAgICAgICBpZiAobWF0Y2hlZENvbGxlY3Rpb25Db21tYW5kKSB7XG4gICAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIGNvbW1hbmROYW1lOiBtYXRjaGVkQ29sbGVjdGlvbkNvbW1hbmRbMV0sXG4gICAgICAgICAgICBtZXRob2ROYW1lOiBtYXRjaGVkQ29sbGVjdGlvbkNvbW1hbmRbMF0sXG4gICAgICAgICAgICBtb2RlbE5hbWUsXG4gICAgICAgICAgICByZXNvdXJjZVBhdGgsXG4gICAgICAgICAgICBzY29wZTogXCJjb2xsZWN0aW9uXCJcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgaWYgKHBhdGhTZWdtZW50cy5sZW5ndGggPT09IDIpIHtcbiAgICAgICAgY29uc3QgbWF0Y2hlZE1lbWJlckNvbW1hbmQgPSBPYmplY3QuZW50cmllcyhyZXNvdXJjZUNvbmZpZ3VyYXRpb24ubWVtYmVyQ29tbWFuZHMpXG4gICAgICAgICAgLmZpbmQoKFssIGNvbW1hbmROYW1lXSkgPT4gY29tbWFuZE5hbWUgPT09IHBhdGhTZWdtZW50c1sxXSlcblxuICAgICAgICBpZiAobWF0Y2hlZE1lbWJlckNvbW1hbmQpIHtcbiAgICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgY29tbWFuZE5hbWU6IG1hdGNoZWRNZW1iZXJDb21tYW5kWzFdLFxuICAgICAgICAgICAgbWVtYmVySWQ6IGRlY29kZVVSSUNvbXBvbmVudChwYXRoU2VnbWVudHNbMF0pLFxuICAgICAgICAgICAgbWV0aG9kTmFtZTogbWF0Y2hlZE1lbWJlckNvbW1hbmRbMF0sXG4gICAgICAgICAgICBtb2RlbE5hbWUsXG4gICAgICAgICAgICByZXNvdXJjZVBhdGgsXG4gICAgICAgICAgICBzY29wZTogXCJtZW1iZXJcIlxuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIHJldHVybiBudWxsXG59XG5cbi8qKlxuICogUnVucyBub3JtYWxpemUgZnJvbnRlbmQgbW9kZWwgcmVzb3VyY2UgcGF0aCBmb3IgbWF0Y2guXG4gKiBAcGFyYW0ge3N0cmluZ30gcGF0aCAtIFBhdGggdmFsdWUuXG4gKiBAcmV0dXJucyB7c3RyaW5nfSAtIE5vcm1hbGl6ZWQgcGF0aCB3aXRoIGxlYWRpbmcgc2xhc2ggYW5kIG5vIHRyYWlsaW5nIHNsYXNoLlxuICovXG5mdW5jdGlvbiBub3JtYWxpemVGcm9udGVuZE1vZGVsUmVzb3VyY2VQYXRoRm9yTWF0Y2gocGF0aCkge1xuICBjb25zdCB3aXRoTGVhZGluZ1NsYXNoID0gcGF0aC5zdGFydHNXaXRoKFwiL1wiKSA/IHBhdGggOiBgLyR7cGF0aH1gXG5cbiAgaWYgKHdpdGhMZWFkaW5nU2xhc2gubGVuZ3RoID4gMSkge1xuICAgIHJldHVybiB3aXRoTGVhZGluZ1NsYXNoLnJlcGxhY2UoL1xcLyskLywgXCJcIilcbiAgfVxuXG4gIHJldHVybiB3aXRoTGVhZGluZ1NsYXNoXG59XG5cbi8qKlxuICogUmVzb2x2ZXMgdGhlIHJlZ2lzdGVyZWQgZnJvbnRlbmQtbW9kZWwgcmVzb3VyY2UgY2xhc3MgZm9yIGEgcmVzb3VyY2UgdHlwZVxuICogYWNyb3NzIGFsbCBiYWNrZW5kIHByb2plY3RzLiBBIHJlc291cmNlJ3MgZWZmZWN0aXZlIG5hbWUgaXMgaXRzXG4gKiBgbW9kZWxOYW1lYCBvdmVycmlkZSB3aGVuIGRlY2xhcmVkLCBvdGhlcndpc2UgaXRzIHJlZ2lzdHJ5IGtleSDigJQgbWF0Y2hpbmdcbiAqIHtAbGluayBmcm9udGVuZE1vZGVsU3luY01hbmlmZXN0Rm9yQmFja2VuZFByb2plY3RzfS4gQSByZWdpc3RyeSBrZXkgc2hhZG93ZWRcbiAqIGJ5IGEgYG1vZGVsTmFtZWAgb3ZlcnJpZGUgZG9lcyBub3QgcmVzb2x2ZS5cbiAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAqIEBwYXJhbSB7e2dldEJhY2tlbmRQcm9qZWN0czogKCkgPT4gaW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5CYWNrZW5kUHJvamVjdENvbmZpZ3VyYXRpb25bXX19IGFyZ3MuY29uZmlndXJhdGlvbiAtIENvbmZpZ3VyYXRpb24gZXhwb3NpbmcgdGhlIGJhY2tlbmQgcHJvamVjdHMuXG4gKiBAcGFyYW0ge3N0cmluZ30gYXJncy5yZXNvdXJjZVR5cGUgLSBGcm9udGVuZCBtb2RlbCBuYW1lIHRvIHJlc29sdmUuXG4gKiBAcmV0dXJucyB7RnJvbnRlbmRNb2RlbFJlc29sdmVkUmVzb3VyY2VSZWdpc3RyYXRpb24gfCBudWxsfSBSZXNvbHZlZCByZWdpc3RyYXRpb24gb3IgbnVsbCB3aGVuIHRoZSByZXNvdXJjZSB0eXBlIGlzIG5vdCByZWdpc3RlcmVkLlxuICovXG5leHBvcnQgZnVuY3Rpb24gcmVzb2x2ZUZyb250ZW5kTW9kZWxSZXNvdXJjZUNsYXNzKHtjb25maWd1cmF0aW9uLCByZXNvdXJjZVR5cGV9KSB7XG4gIGZvciAoY29uc3QgYmFja2VuZFByb2plY3Qgb2YgY29uZmlndXJhdGlvbi5nZXRCYWNrZW5kUHJvamVjdHMoKSkge1xuICAgIGNvbnN0IHJlc291cmNlcyA9IGZyb250ZW5kTW9kZWxSZXNvdXJjZXNGb3JCYWNrZW5kUHJvamVjdChiYWNrZW5kUHJvamVjdClcblxuICAgIGZvciAoY29uc3QgY29uZmlndXJlZE1vZGVsTmFtZSBvZiBPYmplY3Qua2V5cyhyZXNvdXJjZXMpKSB7XG4gICAgICBjb25zdCByZXNvdXJjZURlZmluaXRpb24gPSByZXNvdXJjZXNbY29uZmlndXJlZE1vZGVsTmFtZV1cbiAgICAgIGNvbnN0IHJlc291cmNlQ2xhc3MgPSBmcm9udGVuZE1vZGVsUmVzb3VyY2VDbGFzc0Zyb21EZWZpbml0aW9uKHJlc291cmNlRGVmaW5pdGlvbilcblxuICAgICAgaWYgKCFyZXNvdXJjZUNsYXNzKSBjb250aW51ZVxuXG4gICAgICAvLyBDaGVhcCBkaXJlY3Qta2V5IG1pc21hdGNoIHNraXA6IG9ubHkgbm9ybWFsaXplIGNvbmZpZ3VyYXRpb25zIGZvciB0aGVcbiAgICAgIC8vIG1hdGNoaW5nIGtleSBvciB3aGVuIGEgbW9kZWxOYW1lIG92ZXJyaWRlIGNvdWxkIHJlbmFtZSB0aGUgcmVzb3VyY2UuXG4gICAgICBpZiAoY29uZmlndXJlZE1vZGVsTmFtZSAhPT0gcmVzb3VyY2VUeXBlICYmICFyZXNvdXJjZUNsYXNzLnNoYXJlZFJlc291cmNlU3RhdGljVmFsdWUoXCJtb2RlbE5hbWVcIikpIGNvbnRpbnVlXG5cbiAgICAgIGNvbnN0IHJlc291cmNlQ29uZmlndXJhdGlvbiA9IGZyb250ZW5kTW9kZWxSZXNvdXJjZUNvbmZpZ3VyYXRpb25Gcm9tRGVmaW5pdGlvbihyZXNvdXJjZURlZmluaXRpb24pXG5cbiAgICAgIGlmICghcmVzb3VyY2VDb25maWd1cmF0aW9uKSBjb250aW51ZVxuICAgICAgaWYgKChyZXNvdXJjZUNvbmZpZ3VyYXRpb24ubW9kZWxOYW1lIHx8IGNvbmZpZ3VyZWRNb2RlbE5hbWUpICE9PSByZXNvdXJjZVR5cGUpIGNvbnRpbnVlXG5cbiAgICAgIHJldHVybiB7bW9kZWxOYW1lOiByZXNvdXJjZVR5cGUsIHJlc291cmNlQ2xhc3MsIHJlc291cmNlQ29uZmlndXJhdGlvbn1cbiAgICB9XG4gIH1cblxuICByZXR1cm4gbnVsbFxufVxuIl19