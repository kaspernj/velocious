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
            if (!resourceConfiguration)
                continue;
            const modelName = resourceConfiguration.modelName || configuredModelName;
            const resourcePath = `/${inflection.dasherize(inflection.pluralize(inflection.underscore(configuredModelName)))}`;
            /** @type {Record<string, unknown>} */
            const entry = {
                modelName,
                path: resourcePath,
                primaryKey: resourceConfiguration.primaryKey || "id",
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicmVzb3VyY2UtZGVmaW5pdGlvbi5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9mcm9udGVuZC1tb2RlbHMvcmVzb3VyY2UtZGVmaW5pdGlvbi5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxZQUFZO0FBRVosT0FBTyxLQUFLLFVBQVUsTUFBTSxZQUFZLENBQUE7QUFDeEMsT0FBTyx5QkFBeUIsTUFBTSw2Q0FBNkMsQ0FBQTtBQUNuRixPQUFPLGFBQWEsTUFBTSw2QkFBNkIsQ0FBQTtBQUN2RCxPQUFPLFNBQVMsTUFBTSx3QkFBd0IsQ0FBQTtBQUM5QyxPQUFPLEVBQUMsd0NBQXdDLEVBQUMsTUFBTSxpQ0FBaUMsQ0FBQTtBQUV4Rjs7Ozs7O0dBTUc7QUFDSCxNQUFNLG1DQUFtQyxHQUFHLENBQUMsUUFBUSxFQUFFLFNBQVMsRUFBRSxNQUFNLEVBQUUsUUFBUSxDQUFDLENBQUE7QUFDbkYsTUFBTSwyQkFBMkIsR0FBRyxJQUFJLEdBQUcsQ0FBQztJQUMxQyxXQUFXO0lBQ1gsYUFBYTtJQUNiLFlBQVk7SUFDWiwyQkFBMkI7SUFDM0IsdUJBQXVCO0lBQ3ZCLG9CQUFvQjtJQUNwQixVQUFVO0lBQ1YsZ0JBQWdCO0lBQ2hCLFdBQVc7SUFDWCxZQUFZO0lBQ1osWUFBWTtJQUNaLG9CQUFvQjtJQUNwQixlQUFlO0lBQ2Ysb0JBQW9CO0lBQ3BCLFFBQVE7SUFDUixnQkFBZ0I7SUFDaEIsTUFBTTtJQUNOLHNCQUFzQjtJQUN0QixvQkFBb0I7Q0FDckIsQ0FBQyxDQUFBO0FBRUY7Ozs7R0FJRztBQUNILE1BQU0sVUFBVSx1Q0FBdUMsQ0FBQyxjQUFjO0lBQ3BFLE1BQU0sU0FBUyxHQUFHLGNBQWMsQ0FBQyxjQUFjLENBQUE7SUFFL0MsSUFBSSxTQUFTLEtBQUssU0FBUyxFQUFFLENBQUM7UUFDNUIsSUFBSSxDQUFDLFNBQVMsSUFBSSxPQUFPLFNBQVMsS0FBSyxRQUFRLEVBQUUsQ0FBQztZQUNoRCxNQUFNLElBQUksS0FBSyxD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QztnQkFBRSxTQUFRO1lBRTNHLE1BQU0scUJBQXFCLEdBQUcsZ0RBQWdELENBQUMsa0JBQWtCLENBQUMsQ0FBQTtZQUVsRyxJQUFJLENBQUMscUJBQXFCO2dCQUFFLFNBQVE7WUFDcEMsSUFBSSxDQUFDLHFCQUFxQixDQUFDLFNBQVMsSUFBSSxtQkFBbUIsQ0FBQyxLQUFLLFlBQVk7Z0JBQUUsU0FBUTtZQUV2RixPQUFPLEVBQUMsU0FBUyxFQUFFLFlBQVksRUFBRSxhQUFhLEVBQUUscUJBQXFCLEVBQUMsQ0FBQTtRQUN4RSxDQUFDO0lBQ0gsQ0FBQztJQUVELE9BQU8sSUFBSSxDQUFBO0FBQ2IsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG5pbXBvcnQgKiBhcyBpbmZsZWN0aW9uIGZyb20gXCJpbmZsZWN0aW9uXCJcbmltcG9ydCBGcm9udGVuZE1vZGVsQmFzZVJlc291cmNlIGZyb20gXCIuLi9mcm9udGVuZC1tb2RlbC1yZXNvdXJjZS9iYXNlLXJlc291cmNlLmpzXCJcbmltcG9ydCByZXN0QXJnc0Vycm9yIGZyb20gXCIuLi91dGlscy9yZXN0LWFyZ3MtZXJyb3IuanNcIlxuaW1wb3J0IHNoYTI1NkhleCBmcm9tIFwiLi4vdXRpbHMvc2hhMjU2LWhleC5qc1wiXG5pbXBvcnQge3ZhbGlkYXRlRnJvbnRlbmRNb2RlbFJlc291cmNlQ29tbWFuZE5hbWV9IGZyb20gXCIuL3Jlc291cmNlLWNvbmZpZy12YWxpZGF0aW9uLmpzXCJcblxuLyoqXG4gKiBSZXNvbHZlZCBmcm9udGVuZC1tb2RlbCByZXNvdXJjZSByZWdpc3RyYXRpb24gZm9yIGEgcmVwbGF5IHJlc291cmNlIHR5cGUuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBGcm9udGVuZE1vZGVsUmVzb2x2ZWRSZXNvdXJjZVJlZ2lzdHJhdGlvblxuICogQHByb3BlcnR5IHtzdHJpbmd9IG1vZGVsTmFtZSAtIEVmZmVjdGl2ZSBmcm9udGVuZCBtb2RlbCBuYW1lIChtb2RlbE5hbWUgb3ZlcnJpZGUgb3IgcmVnaXN0cnkga2V5KS5cbiAqIEBwcm9wZXJ0eSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Gcm9udGVuZE1vZGVsUmVzb3VyY2VDbGFzc1R5cGV9IHJlc291cmNlQ2xhc3MgLSBSZWdpc3RlcmVkIHJlc291cmNlIGNsYXNzLlxuICogQHByb3BlcnR5IHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLk5vcm1hbGl6ZWRGcm9udGVuZE1vZGVsUmVzb3VyY2VDb25maWd1cmF0aW9ufSByZXNvdXJjZUNvbmZpZ3VyYXRpb24gLSBOb3JtYWxpemVkIHJlc291cmNlIGNvbmZpZ3VyYXRpb24uXG4gKi9cbmNvbnN0IEJBU0VfRlJPTlRFTkRfTU9ERUxfQUJJTElUWV9BQ1RJT05TID0gW1wiY3JlYXRlXCIsIFwiZGVzdHJveVwiLCBcInJlYWRcIiwgXCJ1cGRhdGVcIl1cbmNvbnN0IFJFU09VUkNFX1NUQVRJQ19DT05GSUdfS0VZUyA9IG5ldyBTZXQoW1xuICBcImFiaWxpdGllc1wiLFxuICBcImF0dGFjaG1lbnRzXCIsXG4gIFwiYXR0cmlidXRlc1wiLFxuICBcImJ1aWx0SW5Db2xsZWN0aW9uQ29tbWFuZHNcIixcbiAgXCJidWlsdEluTWVtYmVyQ29tbWFuZHNcIixcbiAgXCJjb2xsZWN0aW9uQ29tbWFuZHNcIixcbiAgXCJjb21tYW5kc1wiLFxuICBcIm1lbWJlckNvbW1hbmRzXCIsXG4gIFwibW9kZWxOYW1lXCIsXG4gIFwiTW9kZWxDbGFzc1wiLFxuICBcInByaW1hcnlLZXlcIixcbiAgXCJxdWlja1NlYXJjaENvbHVtbnNcIixcbiAgXCJyZWxhdGlvbnNoaXBzXCIsXG4gIFwiUmVwbGF5U2VydmljZUNsYXNzXCIsXG4gIFwic2VydmVyXCIsXG4gIFwiU2hhcmVkUmVzb3VyY2VcIixcbiAgXCJzeW5jXCIsXG4gIFwidHJhbnNsYXRlZEF0dHJpYnV0ZXNcIixcbiAgXCJ3cml0YWJsZUF0dHJpYnV0ZXNcIlxuXSlcblxuLyoqXG4gKiBSdW5zIHRoZSBmcm9udGVuZE1vZGVsUmVzb3VyY2VzRm9yQmFja2VuZFByb2plY3QgaGVscGVyLlxuICogQHBhcmFtIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkJhY2tlbmRQcm9qZWN0Q29uZmlndXJhdGlvbn0gYmFja2VuZFByb2plY3QgLSBCYWNrZW5kIHByb2plY3QgY29uZmlnLlxuICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIGltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRnJvbnRlbmRNb2RlbFJlc291cmNlQ2xhc3NUeXBlPn0gLSBSZXNvdXJjZSBkZWZpbml0aW9ucyBrZXllZCBieSBtb2RlbCBuYW1lLlxuICovXG5leHBvcnQgZnVuY3Rpb24gZnJvbnRlbmRNb2RlbFJlc291cmNlc0ZvckJhY2tlbmRQcm9qZWN0KGJhY2tlbmRQcm9qZWN0KSB7XG4gIGNvbnN0IHJlc291cmNlcyA9IGJhY2tlbmRQcm9qZWN0LmZyb250ZW5kTW9kZWxzXG5cbiAgaWYgKHJlc291cmNlcyAhPT0gdW5kZWZpbmVkKSB7XG4gICAgaWYgKCFyZXNvdXJjZXMgfHwgdHlwZW9mIHJlc291cmNlcyAhPT0gXCJvYmplY3RcIikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBFeHBlY3RlZCBiYWNrZW5kIHByb2plY3QgZnJvbnRlbmRNb2RlbHMgb2JqZWN0IGJ1dCBnb3Q6ICR7cmVzb3VyY2VzfWApXG4gICAgfVxuXG4gICAgcmV0dXJuIHJlc291cmNlc1xuICB9XG5cbiAgcmV0dXJuIHt9XG59XG5cbi8qKlxuICogUnVucyB0aGUgZnJvbnRlbmRNb2RlbFJlc291cmNlRGVmaW5pdGlvbklzQ2xhc3MgaGVscGVyLlxuICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gdmFsdWUgLSBDYW5kaWRhdGUgcmVzb3VyY2UgZGVmaW5pdGlvbi5cbiAqIEByZXR1cm5zIHt2YWx1ZSBpcyBpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkZyb250ZW5kTW9kZWxSZXNvdXJjZUNsYXNzVHlwZX0gLSBXaGV0aGVyIHZhbHVlIGlzIGEgcmVzb3VyY2UgY2xhc3MuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBmcm9udGVuZE1vZGVsUmVzb3VyY2VEZWZpbml0aW9uSXNDbGFzcyh2YWx1ZSkge1xuICByZXR1cm4gdHlwZW9mIHZhbHVlID09PSBcImZ1bmN0aW9uXCIgJiYgKHZhbHVlID09PSBGcm9udGVuZE1vZGVsQmFzZVJlc291cmNlIHx8IHZhbHVlLnByb3RvdHlwZSBpbnN0YW5jZW9mIEZyb250ZW5kTW9kZWxCYXNlUmVzb3VyY2UpXG59XG5cbi8qKlxuICogUnVucyB0aGUgZnJvbnRlbmRNb2RlbFJlc291cmNlQ2xhc3NGcm9tRGVmaW5pdGlvbiBoZWxwZXIuXG4gKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSByZXNvdXJjZURlZmluaXRpb24gLSBSZXNvdXJjZSBkZWZpbml0aW9uLlxuICogQHJldHVybnMge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRnJvbnRlbmRNb2RlbFJlc291cmNlQ2xhc3NUeXBlIHwgbnVsbH0gLSBSZXNvdXJjZSBjbGFzcyB3aGVuIGRlZmluaXRpb24gaXMgY2xhc3MtYmFzZWQuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBmcm9udGVuZE1vZGVsUmVzb3VyY2VDbGFzc0Zyb21EZWZpbml0aW9uKHJlc291cmNlRGVmaW5pdGlvbikge1xuICByZXR1cm4gZnJvbnRlbmRNb2RlbFJlc291cmNlRGVmaW5pdGlvbklzQ2xhc3MocmVzb3VyY2VEZWZpbml0aW9uKSA/IHJlc291cmNlRGVmaW5pdGlvbiA6IG51bGxcbn1cblxuLyoqXG4gKiBSdW5zIHRoZSBmcm9udGVuZE1vZGVsUmVzb3VyY2VDb25maWd1cmF0aW9uRnJvbURlZmluaXRpb24gaGVscGVyLlxuICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gcmVzb3VyY2VEZWZpbml0aW9uIC0gUmVzb3VyY2UgZGVmaW5pdGlvbi5cbiAqIEByZXR1cm5zIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLk5vcm1hbGl6ZWRGcm9udGVuZE1vZGVsUmVzb3VyY2VDb25maWd1cmF0aW9uIHwgbnVsbH0gLSBOb3JtYWxpemVkIHJlc291cmNlIGNvbmZpZ3VyYXRpb24uXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBmcm9udGVuZE1vZGVsUmVzb3VyY2VDb25maWd1cmF0aW9uRnJvbURlZmluaXRpb24ocmVzb3VyY2VEZWZpbml0aW9uKSB7XG4gIGlmICghZnJvbnRlbmRNb2RlbFJlc291cmNlRGVmaW5pdGlvbklzQ2xhc3MocmVzb3VyY2VEZWZpbml0aW9uKSkgcmV0dXJuIG51bGxcblxuICBhc3NlcnRSZXNvdXJjZUNvbmZpZ0lzRnJhbWV3b3JrRGVmaW5lZChyZXNvdXJjZURlZmluaXRpb24pXG5cbiAgcmV0dXJuIG5vcm1hbGl6ZUZyb250ZW5kTW9kZWxSZXNvdXJjZUNvbmZpZ3VyYXRpb24ocmVzb3VyY2VEZWZpbml0aW9uLnJlc291cmNlQ29uZmlnKCkpXG59XG5cbi8qKlxuICogRW5zdXJlcyByZXNvdXJjZXMgdXNlIGRlY2xhcmF0aXZlIHN0YXRpYyBjb25maWcgcHJvcGVydGllcyBpbnN0ZWFkIG9mIG92ZXJyaWRpbmcgcmVzb3VyY2VDb25maWcoKS5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Gcm9udGVuZE1vZGVsUmVzb3VyY2VDbGFzc1R5cGV9IFJlc291cmNlQ2xhc3MgLSBSZXNvdXJjZSBjbGFzcy5cbiAqIEBwYXJhbSB7U2V0PGltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRnJvbnRlbmRNb2RlbFJlc291cmNlQ2xhc3NUeXBlPn0gW3Zpc2l0ZWRdIC0gQWxyZWFkeSBpbnNwZWN0ZWQgc2hhcmVkIHJlc291cmNlcy5cbiAqIEByZXR1cm5zIHt2b2lkfVxuICovXG5mdW5jdGlvbiBhc3NlcnRSZXNvdXJjZUNvbmZpZ0lzRnJhbWV3b3JrRGVmaW5lZChSZXNvdXJjZUNsYXNzLCB2aXNpdGVkID0gbmV3IFNldCgpKSB7XG4gIGlmICh2aXNpdGVkLmhhcyhSZXNvdXJjZUNsYXNzKSkgcmV0dXJuXG5cbiAgdmlzaXRlZC5hZGQoUmVzb3VyY2VDbGFzcylcbiAgYXNzZXJ0S25vd25SZXNvdXJjZVN0YXRpY0NvbmZpZ1Byb3BlcnRpZXMoUmVzb3VyY2VDbGFzcylcblxuICBjb25zdCBvd25lciA9IHN0YXRpY01ldGhvZE93bmVyRm9yKFJlc291cmNlQ2xhc3MsIFwicmVzb3VyY2VDb25maWdcIilcblxuICBpZiAob3duZXIgJiYgb3duZXIgIT09IEZyb250ZW5kTW9kZWxCYXNlUmVzb3VyY2UpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYCR7UmVzb3VyY2VDbGFzcy5uYW1lfSBvdmVycmlkZXMgc3RhdGljIHJlc291cmNlQ29uZmlnKCksIHdoaWNoIGlzIG5vdCBzdXBwb3J0ZWQuIFVzZSBzdGF0aWMgcmVzb3VyY2UgcHJvcGVydGllcyBpbnN0ZWFkLmApXG4gIH1cblxuICBjb25zdCBTaGFyZWRSZXNvdXJjZSA9IFJlc291cmNlQ2xhc3Muc2hhcmVkUmVzb3VyY2VDbGFzcygpXG5cbiAgaWYgKFNoYXJlZFJlc291cmNlKSBhc3NlcnRSZXNvdXJjZUNvbmZpZ0lzRnJhbWV3b3JrRGVmaW5lZChTaGFyZWRSZXNvdXJjZSwgdmlzaXRlZClcbn1cblxuLyoqXG4gKiBFbnN1cmVzIGRlY2xhcmF0aXZlIHN0YXRpYyByZXNvdXJjZSBjb25maWcgZG9lcyBub3Qgc2lsZW50bHkgaWdub3JlIHR5cG9zIG9yIHJlbW92ZWQga2V5cy5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Gcm9udGVuZE1vZGVsUmVzb3VyY2VDbGFzc1R5cGV9IFJlc291cmNlQ2xhc3MgLSBSZXNvdXJjZSBjbGFzcy5cbiAqIEByZXR1cm5zIHt2b2lkfVxuICovXG5mdW5jdGlvbiBhc3NlcnRLbm93blJlc291cmNlU3RhdGljQ29uZmlnUHJvcGVydGllcyhSZXNvdXJjZUNsYXNzKSB7XG4gIGxldCBjdXJyZW50Q2xhc3MgPSBSZXNvdXJjZUNsYXNzXG5cbiAgd2hpbGUgKGN1cnJlbnRDbGFzcyAmJiBjdXJyZW50Q2xhc3MgIT09IEZyb250ZW5kTW9kZWxCYXNlUmVzb3VyY2UgJiYgY3VycmVudENsYXNzICE9PSBGdW5jdGlvbi5wcm90b3R5cGUpIHtcbiAgICAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi9cbiAgICBjb25zdCB1bmtub3duU3RhdGljQ29uZmlnID0ge31cblxuICAgIGZvciAoY29uc3Qga2V5IG9mIE9iamVjdC5rZXlzKGN1cnJlbnRDbGFzcykpIHtcbiAgICAgIGlmICghUkVTT1VSQ0VfU1RBVElDX0NPTkZJR19LRVlTLmhhcyhrZXkpKSB1bmtub3duU3RhdGljQ29uZmlnW2tleV0gPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKC8qKiBAdHlwZSB7dW5rbm93bn0gKi8gKGN1cnJlbnRDbGFzcykpW2tleV1cbiAgICB9XG5cbiAgICByZXN0QXJnc0Vycm9yKHVua25vd25TdGF0aWNDb25maWcpXG5cbiAgICBjdXJyZW50Q2xhc3MgPSBPYmplY3QuZ2V0UHJvdG90eXBlT2YoY3VycmVudENsYXNzKVxuICB9XG59XG5cbi8qKlxuICogTG9jYXRlcyB3aGljaCBjb25zdHJ1Y3RvciBvd25zIGEgc3RhdGljIG1ldGhvZCBpbXBsZW1lbnRhdGlvbi5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Gcm9udGVuZE1vZGVsUmVzb3VyY2VDbGFzc1R5cGV9IFJlc291cmNlQ2xhc3MgLSBSZXNvdXJjZSBjbGFzcy5cbiAqIEBwYXJhbSB7c3RyaW5nfSBtZXRob2ROYW1lIC0gTWV0aG9kIG5hbWUuXG4gKiBAcmV0dXJucyB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Gcm9udGVuZE1vZGVsUmVzb3VyY2VDbGFzc1R5cGUgfCB0eXBlb2YgRnJvbnRlbmRNb2RlbEJhc2VSZXNvdXJjZSB8IG51bGx9IC0gQ2xhc3MgdGhhdCBvd25zIHRoZSBzdGF0aWMgbWV0aG9kLlxuICovXG5mdW5jdGlvbiBzdGF0aWNNZXRob2RPd25lckZvcihSZXNvdXJjZUNsYXNzLCBtZXRob2ROYW1lKSB7XG4gIGxldCBjdXJyZW50Q2xhc3MgPSBSZXNvdXJjZUNsYXNzXG5cbiAgd2hpbGUgKGN1cnJlbnRDbGFzcyAmJiBjdXJyZW50Q2xhc3MgIT09IEZ1bmN0aW9uLnByb3RvdHlwZSkge1xuICAgIGlmIChPYmplY3QucHJvdG90eXBlLmhhc093blByb3BlcnR5LmNhbGwoY3VycmVudENsYXNzLCBtZXRob2ROYW1lKSkgcmV0dXJuIGN1cnJlbnRDbGFzc1xuXG4gICAgY3VycmVudENsYXNzID0gT2JqZWN0LmdldFByb3RvdHlwZU9mKGN1cnJlbnRDbGFzcylcbiAgfVxuXG4gIHJldHVybiBudWxsXG59XG5cbi8qKlxuICogUnVucyBub3JtYWxpemUgZnJvbnRlbmQgbW9kZWwgcmVzb3VyY2UgY29uZmlndXJhdGlvbi5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Gcm9udGVuZE1vZGVsUmVzb3VyY2VDb25maWd1cmF0aW9ufSByZXNvdXJjZUNvbmZpZ3VyYXRpb24gLSBSYXcgcmVzb3VyY2UgY29uZmlndXJhdGlvbi5cbiAqIEByZXR1cm5zIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLk5vcm1hbGl6ZWRGcm9udGVuZE1vZGVsUmVzb3VyY2VDb25maWd1cmF0aW9ufSAtIE5vcm1hbGl6ZWQgcmVzb3VyY2UgY29uZmlndXJhdGlvbi5cbiAqL1xuZnVuY3Rpb24gbm9ybWFsaXplRnJvbnRlbmRNb2RlbFJlc291cmNlQ29uZmlndXJhdGlvbihyZXNvdXJjZUNvbmZpZ3VyYXRpb24pIHtcbiAgY29uc3QgcmVzdEFyZ3MgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKHsuLi5yZXNvdXJjZUNvbmZpZ3VyYXRpb259KVxuXG4gIGZvciAoY29uc3Qga2V5IG9mIFtcbiAgICBcImFiaWxpdGllc1wiLFxuICAgIFwiYXR0cmlidXRlc1wiLFxuICAgIFwiYXR0YWNobWVudHNcIixcbiAgICBcImJ1aWx0SW5Db2xsZWN0aW9uQ29tbWFuZHNcIixcbiAgICBcImJ1aWx0SW5NZW1iZXJDb21tYW5kc1wiLFxuICAgIFwiY29sbGVjdGlvbkNvbW1hbmRzXCIsXG4gICAgXCJjb21tYW5kc1wiLFxuICAgIFwibWVtYmVyQ29tbWFuZHNcIixcbiAgICBcIm1vZGVsTmFtZVwiLFxuICAgIFwicHJpbWFyeUtleVwiLFxuICAgIFwicmVsYXRpb25zaGlwc1wiLFxuICAgIFwic2VydmVyXCIsXG4gICAgXCJzeW5jXCJcbiAgXSkge1xuICAgIGRlbGV0ZSByZXN0QXJnc1trZXldXG4gIH1cblxuICByZXN0QXJnc0Vycm9yKHJlc3RBcmdzKVxuICB2YWxpZGF0ZUZyb250ZW5kTW9kZWxSZXNvdXJjZVByaW1hcnlLZXkocmVzb3VyY2VDb25maWd1cmF0aW9uLnByaW1hcnlLZXkpXG5cbiAgY29uc3Qgbm9ybWFsaXplZENvbW1hbmRzID0gbm9ybWFsaXplRnJvbnRlbmRNb2RlbFJlc291cmNlQ29tbWFuZHMocmVzb3VyY2VDb25maWd1cmF0aW9uKVxuICBjb25zdCBzeW5jID0gbm9ybWFsaXplRnJvbnRlbmRNb2RlbFJlc291cmNlU3luYyhyZXNvdXJjZUNvbmZpZ3VyYXRpb24pXG5cbiAgcmV0dXJuIHtcbiAgICAuLi5yZXNvdXJjZUNvbmZpZ3VyYXRpb24sXG4gICAgYWJpbGl0aWVzOiBub3JtYWxpemVGcm9udGVuZE1vZGVsUmVzb3VyY2VBYmlsaXRpZXMocmVzb3VyY2VDb25maWd1cmF0aW9uLmFiaWxpdGllcyksXG4gICAgYnVpbHRJbkNvbGxlY3Rpb25Db21tYW5kczogbm9ybWFsaXplZENvbW1hbmRzLmJ1aWx0SW5Db2xsZWN0aW9uQ29tbWFuZHMsXG4gICAgYnVpbHRJbk1lbWJlckNvbW1hbmRzOiBub3JtYWxpemVkQ29tbWFuZHMuYnVpbHRJbk1lbWJlckNvbW1hbmRzLFxuICAgIGNvbGxlY3Rpb25Db21tYW5kczogbm9ybWFsaXplZENvbW1hbmRzLmNvbGxlY3Rpb25Db21tYW5kcyxcbiAgICAvLyBQZXItY29tbWFuZCBtZXRhZGF0YSAodHlwZWQgYXJncyArIGRlY2xhcmVkIHJldHVybiB0eXBlKSBrZXllZCBieSBtZXRob2RcbiAgICAvLyBuYW1lLCBkZXJpdmVkIGZyb20gYHtuYW1lLCBhcmdzPywgcmV0dXJuVHlwZT99YCBjb21tYW5kIGVudHJpZXMuIFRoZVxuICAgIC8vIGdlbmVyYXRvciB1c2VzIGl0IHRvIHR5cGUgZWFjaCBjdXN0b20gY29tbWFuZCBtZXRob2QuXG4gICAgY29tbWFuZE1ldGFkYXRhOiBub3JtYWxpemVkQ29tbWFuZHMuY29tbWFuZE1ldGFkYXRhLFxuICAgIG1lbWJlckNvbW1hbmRzOiBub3JtYWxpemVkQ29tbWFuZHMubWVtYmVyQ29tbWFuZHMsXG4gICAgc3luY1xuICB9XG59XG5cbi8qKlxuICogVmFsaWRhdGVzIGEgcmVzb3VyY2UgcHJpbWFyeS1rZXkgZGVmaW5pdGlvbiBiZWZvcmUgaXQgY2FuIGJlIHVzZWQgdG8gYnVpbGQgQ1JVRCBjb25kaXRpb25zLlxuICogQHBhcmFtIHtpbXBvcnQoXCIuLi91dGlscy9tb2RlbC1wcmltYXJ5LWtleS5qc1wiKS5Nb2RlbFByaW1hcnlLZXlEZWZpbml0aW9uIHwgdW5kZWZpbmVkfSBwcmltYXJ5S2V5IC0gUmVzb3VyY2UgcHJpbWFyeSBrZXkuXG4gKiBAcmV0dXJucyB7dm9pZH1cbiAqL1xuZnVuY3Rpb24gdmFsaWRhdGVGcm9udGVuZE1vZGVsUmVzb3VyY2VQcmltYXJ5S2V5KHByaW1hcnlLZXkpIHtcbiAgaWYgKCFBcnJheS5pc0FycmF5KHByaW1hcnlLZXkpKSByZXR1cm5cblxuICBpZiAocHJpbWFyeUtleS5sZW5ndGggPT09IDApIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXCJSZXNvdXJjZSBwcmltYXJ5S2V5IGFycmF5cyBtdXN0IGNvbnRhaW4gYXQgbGVhc3Qgb25lIGF0dHJpYnV0ZS5cIilcbiAgfVxuXG4gIGlmIChuZXcgU2V0KHByaW1hcnlLZXkpLnNpemUgIT09IHByaW1hcnlLZXkubGVuZ3RoKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFwiUmVzb3VyY2UgcHJpbWFyeUtleSBhcnJheXMgbXVzdCBjb250YWluIHVuaXF1ZSBhdHRyaWJ1dGVzLlwiKVxuICB9XG59XG5cbi8qKlxuICogUnVucyBub3JtYWxpemUgZnJvbnRlbmQgbW9kZWwgcmVzb3VyY2UgYWJpbGl0aWVzLlxuICogQHBhcmFtIHtzdHJpbmdbXSB8IHVuZGVmaW5lZH0gYWJpbGl0aWVzIC0gUmVzb3VyY2UgYWJpbGl0aWVzIGNvbmZpZyAoY2FtZWxDYXNlIGFjdGlvbiBsaXN0KS5cbiAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+fSAtIE5vcm1hbGl6ZWQgYWJpbGl0aWVzIGNvbmZpZy5cbiAqL1xuZnVuY3Rpb24gbm9ybWFsaXplRnJvbnRlbmRNb2RlbFJlc291cmNlQWJpbGl0aWVzKGFiaWxpdGllcykge1xuICBjb25zdCBub3JtYWxpemVkID0gZGVmYXVsdENydWRBYmlsaXRpZXMoKVxuXG4gIGlmIChhYmlsaXRpZXMgPT09IHVuZGVmaW5lZCkgcmV0dXJuIG5vcm1hbGl6ZWRcblxuICBpZiAoIUFycmF5LmlzQXJyYXkoYWJpbGl0aWVzKSkge1xuICAgIHRocm93IG5ldyBFcnJvcihcIlJlc291cmNlIGFiaWxpdGllcyBtdXN0IGJlIGFuIGFycmF5IG9mIGFjdGlvbiBuYW1lcy4gT2JqZWN0IGZvcm0gaXMgbm8gbG9uZ2VyIHN1cHBvcnRlZC5cIilcbiAgfVxuXG4gIGNvbnN0IGR1cGxpY2F0ZWRCYXNlQWJpbGl0aWVzID0gYWJpbGl0aWVzLmZpbHRlcigoYWJpbGl0eSkgPT4gQkFTRV9GUk9OVEVORF9NT0RFTF9BQklMSVRZX0FDVElPTlMuaW5jbHVkZXMoYWJpbGl0eSkpXG5cbiAgaWYgKGR1cGxpY2F0ZWRCYXNlQWJpbGl0aWVzLmxlbmd0aCA+IDApIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYFJlc291cmNlIGFiaWxpdGllcyBtdXN0IG5vdCBpbmNsdWRlIGJhc2UgYWN0aW9uczogJHtkdXBsaWNhdGVkQmFzZUFiaWxpdGllcy5qb2luKFwiLCBcIil9YClcbiAgfVxuXG4gIGZvciAoY29uc3QgYWJpbGl0eSBvZiBhYmlsaXRpZXMpIHtcbiAgICBpZiAodHlwZW9mIGFiaWxpdHkgIT09IFwic3RyaW5nXCIgfHwgYWJpbGl0eS5sZW5ndGggPCAxKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJSZXNvdXJjZSBhYmlsaXRpZXMgZW50cmllcyBtdXN0IGJlIG5vbi1lbXB0eSBzdHJpbmdzLlwiKVxuICAgIH1cblxuICAgIG5vcm1hbGl6ZWRbYWJpbGl0eV0gPSBhYmlsaXR5XG4gIH1cblxuICByZXR1cm4gbm9ybWFsaXplZFxufVxuXG4vKipcbiAqIFJ1bnMgZGVmYXVsdCBjcnVkIGFiaWxpdGllcy5cbiAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+fSAtIERlZmF1bHQgQ1JVRCBhYmlsaXR5IG1hcC5cbiAqL1xuZnVuY3Rpb24gZGVmYXVsdENydWRBYmlsaXRpZXMoKSB7XG4gIHJldHVybiB7XG4gICAgY3JlYXRlOiBcImNyZWF0ZVwiLFxuICAgIGRlc3Ryb3k6IFwiZGVzdHJveVwiLFxuICAgIGZpbmQ6IFwicmVhZFwiLFxuICAgIGluZGV4OiBcInJlYWRcIixcbiAgICB1cGRhdGU6IFwidXBkYXRlXCJcbiAgfVxufVxuXG4vKipcbiAqIEJ1aWxkcyBhIGZyb250ZW5kLXNhZmUgc3luYyBtYW5pZmVzdCBmb3IgYWxsIHN5bmMtZW5hYmxlZCBmcm9udGVuZC1tb2RlbCByZXNvdXJjZXMuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuQmFja2VuZFByb2plY3RDb25maWd1cmF0aW9uW119IGJhY2tlbmRQcm9qZWN0cyAtIEJhY2tlbmQgcHJvamVjdHMgdG8gc2Nhbi5cbiAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLk5vcm1hbGl6ZWRGcm9udGVuZE1vZGVsUmVzb3VyY2VTeW5jQ29uZmlndXJhdGlvbj59IC0gU3luYyBtZXRhZGF0YSBrZXllZCBieSBtb2RlbCBuYW1lLlxuICovXG5leHBvcnQgZnVuY3Rpb24gZnJvbnRlbmRNb2RlbFN5bmNNYW5pZmVzdEZvckJhY2tlbmRQcm9qZWN0cyhiYWNrZW5kUHJvamVjdHMpIHtcbiAgLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLk5vcm1hbGl6ZWRGcm9udGVuZE1vZGVsUmVzb3VyY2VTeW5jQ29uZmlndXJhdGlvbj59ICovXG4gIGNvbnN0IG1hbmlmZXN0ID0ge31cblxuICBmb3IgKGNvbnN0IGJhY2tlbmRQcm9qZWN0IG9mIGJhY2tlbmRQcm9qZWN0cykge1xuICAgIGNvbnN0IHJlc291cmNlcyA9IGZyb250ZW5kTW9kZWxSZXNvdXJjZXNGb3JCYWNrZW5kUHJvamVjdChiYWNrZW5kUHJvamVjdClcblxuICAgIGZvciAoY29uc3QgY29uZmlndXJlZE1vZGVsTmFtZSBvZiBPYmplY3Qua2V5cyhyZXNvdXJjZXMpLnNvcnQoKSkge1xuICAgICAgY29uc3QgcmVzb3VyY2VEZWZpbml0aW9uID0gcmVzb3VyY2VzW2NvbmZpZ3VyZWRNb2RlbE5hbWVdXG4gICAgICBjb25zdCByZXNvdXJjZUNvbmZpZ3VyYXRpb24gPSBmcm9udGVuZE1vZGVsUmVzb3VyY2VDb25maWd1cmF0aW9uRnJvbURlZmluaXRpb24ocmVzb3VyY2VEZWZpbml0aW9uKVxuXG4gICAgICBpZiAoIXJlc291cmNlQ29uZmlndXJhdGlvbikgY29udGludWVcbiAgICAgIGlmICghcmVzb3VyY2VDb25maWd1cmF0aW9uLnN5bmM/LmVuYWJsZWQpIGNvbnRpbnVlXG5cbiAgICAgIGNvbnN0IG1vZGVsTmFtZSA9IHJlc291cmNlQ29uZmlndXJhdGlvbi5tb2RlbE5hbWUgfHwgY29uZmlndXJlZE1vZGVsTmFtZVxuXG4gICAgICBtYW5pZmVzdFttb2RlbE5hbWVdID0gcmVzb3VyY2VDb25maWd1cmF0aW9uLnN5bmNcbiAgICB9XG4gIH1cblxuICByZXR1cm4gbWFuaWZlc3Rcbn1cblxuLyoqXG4gKiBCdWlsZHMgYSBmcm9udGVuZC1zYWZlIEFQSSBtYW5pZmVzdCBmb3IgYWxsIHJlZ2lzdGVyZWQgZnJvbnRlbmQtbW9kZWxcbiAqIHJlc291cmNlcy4gVGhlIG1hbmlmZXN0IGlzIGRldGVybWluaXN0aWMgKHNvcnRlZCBtb2RlbCBuYW1lcywgc29ydGVkXG4gKiBhdHRyaWJ1dGVzLCBzb3J0ZWQgY29tbWFuZHMpIGFuZCBpbmNsdWRlcyBvbmx5IHB1YmxpYy1zYWZlIG1ldGFkYXRhOiBub1xuICogc2VjcmV0cywgbm8gc2VydmVyIGNhbGxiYWNrcywgbm8gYmFja2VuZCBmaWxlIHBhdGhzLlxuICogQHBhcmFtIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkJhY2tlbmRQcm9qZWN0Q29uZmlndXJhdGlvbltdfSBiYWNrZW5kUHJvamVjdHMgLSBCYWNrZW5kIHByb2plY3RzIHRvIHNjYW4uXG4gKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgdW5rbm93bj59IC0gRnJvbnRlbmQtc2FmZSBBUEkgbWFuaWZlc3QuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBmcm9udGVuZE1vZGVsQXBpTWFuaWZlc3QoYmFja2VuZFByb2plY3RzKSB7XG4gIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgdW5rbm93bj59ICovXG4gIGNvbnN0IHJlc291cmNlcyA9IHt9XG5cbiAgZm9yIChjb25zdCBiYWNrZW5kUHJvamVjdCBvZiBiYWNrZW5kUHJvamVjdHMpIHtcbiAgICBjb25zdCBwcm9qZWN0UmVzb3VyY2VzID0gZnJvbnRlbmRNb2RlbFJlc291cmNlc0ZvckJhY2tlbmRQcm9qZWN0KGJhY2tlbmRQcm9qZWN0KVxuXG4gICAgZm9yIChjb25zdCBjb25maWd1cmVkTW9kZWxOYW1lIG9mIE9iamVjdC5rZXlzKHByb2plY3RSZXNvdXJjZXMpLnNvcnQoKSkge1xuICAgICAgY29uc3QgcmVzb3VyY2VEZWZpbml0aW9uID0gcHJvamVjdFJlc291cmNlc1tjb25maWd1cmVkTW9kZWxOYW1lXVxuICAgICAgY29uc3QgcmVzb3VyY2VDb25maWd1cmF0aW9uID0gZnJvbnRlbmRNb2RlbFJlc291cmNlQ29uZmlndXJhdGlvbkZyb21EZWZpbml0aW9uKHJlc291cmNlRGVmaW5pdGlvbilcblxuICAgICAgaWYgKCFyZXNvdXJjZUNvbmZpZ3VyYXRpb24pIGNvbnRpbnVlXG5cbiAgICAgIGNvbnN0IG1vZGVsTmFtZSA9IHJlc291cmNlQ29uZmlndXJhdGlvbi5tb2RlbE5hbWUgfHwgY29uZmlndXJlZE1vZGVsTmFtZVxuICAgICAgY29uc3QgcmVzb3VyY2VQYXRoID0gYC8ke2luZmxlY3Rpb24uZGFzaGVyaXplKGluZmxlY3Rpb24ucGx1cmFsaXplKGluZmxlY3Rpb24udW5kZXJzY29yZShjb25maWd1cmVkTW9kZWxOYW1lKSkpfWBcblxuICAgICAgLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCB1bmtub3duPn0gKi9cbiAgICAgIGNvbnN0IGVudHJ5ID0ge1xuICAgICAgICBtb2RlbE5hbWUsXG4gICAgICAgIHBhdGg6IHJlc291cmNlUGF0aCxcbiAgICAgICAgcHJpbWFyeUtleTogcmVzb3VyY2VDb25maWd1cmF0aW9uLnByaW1hcnlLZXkgfHwgXCJpZFwiLFxuICAgICAgICBhdHRyaWJ1dGVzOiBtYW5pZmVzdEF0dHJpYnV0ZXMocmVzb3VyY2VDb25maWd1cmF0aW9uLmF0dHJpYnV0ZXMpLFxuICAgICAgICBhYmlsaXRpZXM6IHJlc291cmNlQ29uZmlndXJhdGlvbi5hYmlsaXRpZXMsXG4gICAgICAgIGJ1aWx0SW5Db21tYW5kczoge1xuICAgICAgICAgIGNvbGxlY3Rpb246IHJlc291cmNlQ29uZmlndXJhdGlvbi5idWlsdEluQ29sbGVjdGlvbkNvbW1hbmRzLFxuICAgICAgICAgIG1lbWJlcjogcmVzb3VyY2VDb25maWd1cmF0aW9uLmJ1aWx0SW5NZW1iZXJDb21tYW5kc1xuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIGNvbnN0IHJlbGF0aW9uc2hpcHMgPSByZXNvdXJjZUNvbmZpZ3VyYXRpb24ucmVsYXRpb25zaGlwc1xuICAgICAgaWYgKHJlbGF0aW9uc2hpcHMgJiYgcmVsYXRpb25zaGlwcy5sZW5ndGggPiAwKSB7XG4gICAgICAgIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgdW5rbm93bj59ICovXG4gICAgICAgIGNvbnN0IHJlbHMgPSB7fVxuICAgICAgICBmb3IgKGNvbnN0IHJlbE5hbWUgb2YgcmVsYXRpb25zaGlwcykge1xuICAgICAgICAgIHJlbHNbcmVsTmFtZV0gPSB7fVxuICAgICAgICB9XG4gICAgICAgIGVudHJ5LnJlbGF0aW9uc2hpcHMgPSByZWxzXG4gICAgICB9XG5cbiAgICAgIGNvbnN0IGF0dGFjaG1lbnRzID0gcmVzb3VyY2VDb25maWd1cmF0aW9uLmF0dGFjaG1lbnRzXG4gICAgICBpZiAoYXR0YWNobWVudHMgJiYgT2JqZWN0LmtleXMoYXR0YWNobWVudHMpLmxlbmd0aCA+IDApIHtcbiAgICAgICAgZW50cnkuYXR0YWNobWVudHMgPSBhdHRhY2htZW50c1xuICAgICAgfVxuXG4gICAgICBjb25zdCBjb2xsZWN0aW9uQ29tbWFuZHMgPSBtYW5pZmVzdENvbW1hbmRFbnRyaWVzKHtcbiAgICAgICAgY29tbWFuZE1ldGFkYXRhOiByZXNvdXJjZUNvbmZpZ3VyYXRpb24uY29tbWFuZE1ldGFkYXRhIHx8IHt9LFxuICAgICAgICBjb21tYW5kczogcmVzb3VyY2VDb25maWd1cmF0aW9uLmNvbGxlY3Rpb25Db21tYW5kcyxcbiAgICAgICAgcmVzb3VyY2VQYXRoLFxuICAgICAgICBzY29wZTogXCJjb2xsZWN0aW9uXCJcbiAgICAgIH0pXG4gICAgICBjb25zdCBtZW1iZXJDb21tYW5kcyA9IG1hbmlmZXN0Q29tbWFuZEVudHJpZXMoe1xuICAgICAgICBjb21tYW5kTWV0YWRhdGE6IHJlc291cmNlQ29uZmlndXJhdGlvbi5jb21tYW5kTWV0YWRhdGEgfHwge30sXG4gICAgICAgIGNvbW1hbmRzOiByZXNvdXJjZUNvbmZpZ3VyYXRpb24ubWVtYmVyQ29tbWFuZHMsXG4gICAgICAgIHJlc291cmNlUGF0aCxcbiAgICAgICAgc2NvcGU6IFwibWVtYmVyXCJcbiAgICAgIH0pXG5cbiAgICAgIGlmIChjb2xsZWN0aW9uQ29tbWFuZHMubGVuZ3RoID4gMCB8fCBtZW1iZXJDb21tYW5kcy5sZW5ndGggPiAwKSB7XG4gICAgICAgIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgdW5rbm93bj59ICovXG4gICAgICAgIGNvbnN0IGNtZHMgPSB7fVxuICAgICAgICBpZiAoY29sbGVjdGlvbkNvbW1hbmRzLmxlbmd0aCA+IDApIGNtZHNbXCJjb2xsZWN0aW9uXCJdID0gY29sbGVjdGlvbkNvbW1hbmRzXG4gICAgICAgIGlmIChtZW1iZXJDb21tYW5kcy5sZW5ndGggPiAwKSBjbWRzW1wibWVtYmVyXCJdID0gbWVtYmVyQ29tbWFuZHNcbiAgICAgICAgZW50cnkuY29tbWFuZHMgPSBjbWRzXG4gICAgICB9XG5cbiAgICAgIGlmIChyZXNvdXJjZUNvbmZpZ3VyYXRpb24uc3luYz8uZW5hYmxlZCkge1xuICAgICAgICBlbnRyeS5zeW5jID0gcmVzb3VyY2VDb25maWd1cmF0aW9uLnN5bmNcbiAgICAgIH1cblxuICAgICAgcmVzb3VyY2VzW2NvbmZpZ3VyZWRNb2RlbE5hbWVdID0gZW50cnlcbiAgICB9XG4gIH1cblxuICByZXR1cm4ge1xuICAgIGZvcm1hdFZlcnNpb246IDEsXG4gICAgcmVzb3VyY2VzOiBPYmplY3Qua2V5cyhyZXNvdXJjZXMpLnNvcnQoKS5yZWR1Y2UoKHNvcnRlZCwga2V5KSA9PiB7XG4gICAgICAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIHVua25vd24+fSAqLyAoc29ydGVkKVtrZXldID0gcmVzb3VyY2VzW2tleV1cbiAgICAgIHJldHVybiBzb3J0ZWRcbiAgICB9LCAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIHVua25vd24+fSAqLyAoe30pKVxuICB9XG59XG5cbi8qKlxuICogTm9ybWFsaXplcyByZXNvdXJjZSBhdHRyaWJ1dGUgZGVmaW5pdGlvbnMgaW50byBhIHNvcnRlZCBhcnJheSBvZiBzdHJpbmdzLlxuICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gYXR0cmlidXRlcyAtIFJhdyBhdHRyaWJ1dGVzIGNvbmZpZyAoYXJyYXkgb3Igb2JqZWN0KS5cbiAqIEByZXR1cm5zIHtzdHJpbmdbXX0gLSBTb3J0ZWQgYXR0cmlidXRlIG5hbWVzLlxuICovXG5mdW5jdGlvbiBtYW5pZmVzdEF0dHJpYnV0ZXMoYXR0cmlidXRlcykge1xuICBpZiAoIWF0dHJpYnV0ZXMpIHJldHVybiBbXVxuXG4gIGxldCBuYW1lc1xuXG4gIGlmIChBcnJheS5pc0FycmF5KGF0dHJpYnV0ZXMpKSB7XG4gICAgbmFtZXMgPSBhdHRyaWJ1dGVzLm1hcCgoZW50cnkpID0+IHR5cGVvZiBlbnRyeSA9PT0gXCJzdHJpbmdcIiA/IGVudHJ5IDogZW50cnkubmFtZSkuZmlsdGVyKEJvb2xlYW4pXG4gIH0gZWxzZSBpZiAoYXR0cmlidXRlcyAmJiB0eXBlb2YgYXR0cmlidXRlcyA9PT0gXCJvYmplY3RcIikge1xuICAgIG5hbWVzID0gT2JqZWN0LmtleXMoYXR0cmlidXRlcylcbiAgfSBlbHNlIHtcbiAgICByZXR1cm4gW11cbiAgfVxuXG4gIHJldHVybiBuYW1lcy5zb3J0KClcbn1cblxuLyoqXG4gKiBCdWlsZHMgbWFuaWZlc3Qtc2FmZSBjb21tYW5kIGVudHJ5IGxpc3QuXG4gKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEFyZ3VtZW50cy5cbiAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywge2FyZ3M6IEFycmF5PHtuYW1lOiBzdHJpbmcsIHR5cGU6IHN0cmluZ30+LCByZXR1cm5UeXBlOiBzdHJpbmcgfCBudWxsfT59IGFyZ3MuY29tbWFuZE1ldGFkYXRhIC0gUGVyLWNvbW1hbmQgbWV0YWRhdGEuXG4gKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIHN0cmluZz59IGFyZ3MuY29tbWFuZHMgLSBNZXRob2QgbmFtZSDihpIga2ViYWIgc2x1ZyBtYXAuXG4gKiBAcGFyYW0ge3N0cmluZ30gYXJncy5yZXNvdXJjZVBhdGggLSBSZXNvdXJjZSBwYXRoLlxuICogQHBhcmFtIHtcImNvbGxlY3Rpb25cIiB8IFwibWVtYmVyXCJ9IGFyZ3Muc2NvcGUgLSBDb21tYW5kIHNjb3BlLlxuICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIHVua25vd24+W119IC0gTWFuaWZlc3QgY29tbWFuZCBlbnRyaWVzLlxuICovXG5mdW5jdGlvbiBtYW5pZmVzdENvbW1hbmRFbnRyaWVzKHtjb21tYW5kTWV0YWRhdGEsIGNvbW1hbmRzLCByZXNvdXJjZVBhdGgsIHNjb3BlfSkge1xuICByZXR1cm4gT2JqZWN0LmtleXMoY29tbWFuZHMpLnNvcnQoKS5tYXAoKG1ldGhvZE5hbWUpID0+IHtcbiAgICBjb25zdCBzbHVnID0gY29tbWFuZHNbbWV0aG9kTmFtZV1cbiAgICBjb25zdCBtZXRhZGF0YSA9IGNvbW1hbmRNZXRhZGF0YVttZXRob2ROYW1lXSB8fCB7YXJnczogW10sIHJldHVyblR5cGU6IG51bGx9XG4gICAgY29uc3QgcGF0aCA9IHNjb3BlID09PSBcIm1lbWJlclwiXG4gICAgICA/IGAke3Jlc291cmNlUGF0aH0vPGlkPi8ke3NsdWd9YFxuICAgICAgOiBgJHtyZXNvdXJjZVBhdGh9LyR7c2x1Z31gXG5cbiAgICAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIHVua25vd24+fSAqL1xuICAgIGNvbnN0IGVudHJ5ID0ge1xuICAgICAgbWV0aG9kTmFtZSxcbiAgICAgIHNjb3BlLFxuICAgICAgcGF0aCxcbiAgICAgIGFyZ3M6IG1ldGFkYXRhLmFyZ3NcbiAgICB9XG5cbiAgICBpZiAobWV0YWRhdGEucmV0dXJuVHlwZSkge1xuICAgICAgZW50cnkucmV0dXJuVHlwZSA9IG1ldGFkYXRhLnJldHVyblR5cGVcbiAgICB9XG5cbiAgICByZXR1cm4gZW50cnlcbiAgfSlcbn1cblxuLyoqXG4gKiBOb3JtYWxpemVzIHN5bmMgcG9saWN5IG1ldGFkYXRhIGFuZCBjb21wdXRlcyBhIGRldGVybWluaXN0aWMgaGFzaCBmcm9tIHNhZmUgcG9saWN5IGlucHV0cy5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Gcm9udGVuZE1vZGVsUmVzb3VyY2VDb25maWd1cmF0aW9ufSByZXNvdXJjZUNvbmZpZ3VyYXRpb24gLSBSYXcgcmVzb3VyY2UgY29uZmlndXJhdGlvbi5cbiAqIEByZXR1cm5zIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLk5vcm1hbGl6ZWRGcm9udGVuZE1vZGVsUmVzb3VyY2VTeW5jQ29uZmlndXJhdGlvbiB8IHVuZGVmaW5lZH0gLSBGcm9udGVuZC1zYWZlIHN5bmMgbWV0YWRhdGEuXG4gKi9cbmZ1bmN0aW9uIG5vcm1hbGl6ZUZyb250ZW5kTW9kZWxSZXNvdXJjZVN5bmMocmVzb3VyY2VDb25maWd1cmF0aW9uKSB7XG4gIGNvbnN0IHN5bmMgPSByZXNvdXJjZUNvbmZpZ3VyYXRpb24uc3luY1xuXG4gIGlmIChzeW5jID09PSB1bmRlZmluZWQgfHwgc3luYyA9PT0gbnVsbCkgcmV0dXJuIHVuZGVmaW5lZFxuICBpZiAoc3luYyA9PT0gZmFsc2UpIHJldHVybiB7Y29uZmxpY3RTdHJhdGVneTogXCJvcHRpbWlzdGljVmVyc2lvblwiLCBlbmFibGVkOiBmYWxzZSwgb3BlcmF0aW9uczogW10sIHBvbGljeUhhc2g6IHN5bmNQb2xpY3lIYXNoKHtjb25mbGljdFN0cmF0ZWd5OiBcIm9wdGltaXN0aWNWZXJzaW9uXCIsIGVuYWJsZWQ6IGZhbHNlfSksIHBvbGljeVZlcnNpb246IG51bGx9XG4gIGlmIChzeW5jID09PSB0cnVlKSB7XG4gICAgcmV0dXJuIG5vcm1hbGl6ZUZyb250ZW5kTW9kZWxSZXNvdXJjZVN5bmMoe1xuICAgICAgLi4ucmVzb3VyY2VDb25maWd1cmF0aW9uLFxuICAgICAgc3luYzoge29wZXJhdGlvbnM6IFtcImluZGV4XCIsIFwiZmluZFwiXX1cbiAgICB9KVxuICB9XG4gIGlmICghc3luYyB8fCB0eXBlb2Ygc3luYyAhPT0gXCJvYmplY3RcIiB8fCBBcnJheS5pc0FycmF5KHN5bmMpKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFwiUmVzb3VyY2Ugc3luYyBjb25maWd1cmF0aW9uIG11c3QgYmUgdHJ1ZSwgZmFsc2UsIG9yIGFuIG9iamVjdC5cIilcbiAgfVxuXG4gIGNvbnN0IHtjb25mbGljdFN0cmF0ZWd5LCBlbmFibGVkID0gdHJ1ZSwgbWV0YWRhdGEsIG9wZXJhdGlvbnMsIHBvbGljeSwgcG9saWN5VmVyc2lvbiwgLi4ucmVzdH0gPSAvKiogQHR5cGUge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRnJvbnRlbmRNb2RlbFJlc291cmNlU3luY0NvbmZpZ3VyYXRpb259ICovIChzeW5jKVxuXG4gIGlmIChPYmplY3Qua2V5cyhyZXN0KS5sZW5ndGggPiAwKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGBVbmV4cGVjdGVkIHN5bmMga2V5czogJHtPYmplY3Qua2V5cyhyZXN0KS5qb2luKFwiLCBcIil9LiBBbGxvd2VkOiBjb25mbGljdFN0cmF0ZWd5LCBlbmFibGVkLCBtZXRhZGF0YSwgb3BlcmF0aW9ucywgcG9saWN5LCBwb2xpY3lWZXJzaW9uYClcbiAgfVxuICBpZiAoZW5hYmxlZCAhPT0gdHJ1ZSAmJiBlbmFibGVkICE9PSBmYWxzZSkgdGhyb3cgbmV3IEVycm9yKFwiUmVzb3VyY2Ugc3luYyBlbmFibGVkIG11c3QgYmUgdHJ1ZSBvciBmYWxzZSB3aGVuIHByb3ZpZGVkLlwiKVxuXG4gIGNvbnN0IG5vcm1hbGl6ZWRDb25mbGljdFN0cmF0ZWd5ID0gbm9ybWFsaXplU3luY0NvbmZsaWN0U3RyYXRlZ3koY29uZmxpY3RTdHJhdGVneSlcbiAgY29uc3Qgbm9ybWFsaXplZE9wZXJhdGlvbnMgPSBub3JtYWxpemVTeW5jT3BlcmF0aW9ucyhvcGVyYXRpb25zKVxuICBjb25zdCBub3JtYWxpemVkTWV0YWRhdGEgPSBtZXRhZGF0YSA9PT0gdW5kZWZpbmVkID8gdW5kZWZpbmVkIDogZGV0ZXJtaW5pc3RpY1N5bmNKc29uKHtsYWJlbDogXCJtZXRhZGF0YVwiLCB2YWx1ZTogbWV0YWRhdGF9KVxuICBjb25zdCBub3JtYWxpemVkUG9saWN5ID0gcG9saWN5ID09PSB1bmRlZmluZWQgPyB1bmRlZmluZWQgOiBkZXRlcm1pbmlzdGljU3luY0pzb24oe2xhYmVsOiBcInBvbGljeVwiLCB2YWx1ZTogcG9saWN5fSlcbiAgY29uc3Qgbm9ybWFsaXplZFBvbGljeVZlcnNpb24gPSBwb2xpY3lWZXJzaW9uID09PSB1bmRlZmluZWQgfHwgcG9saWN5VmVyc2lvbiA9PT0gbnVsbCA/IG51bGwgOiBTdHJpbmcocG9saWN5VmVyc2lvbilcbiAgY29uc3QgaGFzaElucHV0ID0ge1xuICAgIGNvbmZsaWN0U3RyYXRlZ3k6IG5vcm1hbGl6ZWRDb25mbGljdFN0cmF0ZWd5LFxuICAgIGVuYWJsZWQsXG4gICAgbWV0YWRhdGE6IG5vcm1hbGl6ZWRNZXRhZGF0YSxcbiAgICBtb2RlbE5hbWU6IHJlc291cmNlQ29uZmlndXJhdGlvbi5tb2RlbE5hbWUgfHwgbnVsbCxcbiAgICBvcGVyYXRpb25zOiBub3JtYWxpemVkT3BlcmF0aW9ucyxcbiAgICBwb2xpY3k6IG5vcm1hbGl6ZWRQb2xpY3ksXG4gICAgcG9saWN5VmVyc2lvbjogbm9ybWFsaXplZFBvbGljeVZlcnNpb25cbiAgfVxuICAvKiogQHR5cGUge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuTm9ybWFsaXplZEZyb250ZW5kTW9kZWxSZXNvdXJjZVN5bmNDb25maWd1cmF0aW9ufSAqL1xuICBjb25zdCBub3JtYWxpemVkID0ge1xuICAgIGNvbmZsaWN0U3RyYXRlZ3k6IG5vcm1hbGl6ZWRDb25mbGljdFN0cmF0ZWd5LFxuICAgIGVuYWJsZWQsXG4gICAgb3BlcmF0aW9uczogbm9ybWFsaXplZE9wZXJhdGlvbnMsXG4gICAgcG9saWN5SGFzaDogc3luY1BvbGljeUhhc2goaGFzaElucHV0KSxcbiAgICBwb2xpY3lWZXJzaW9uOiBub3JtYWxpemVkUG9saWN5VmVyc2lvblxuICB9XG5cbiAgaWYgKG5vcm1hbGl6ZWRNZXRhZGF0YSAhPT0gdW5kZWZpbmVkKSBub3JtYWxpemVkLm1ldGFkYXRhID0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkZyb250ZW5kTW9kZWxTeW5jSnNvblZhbHVlPn0gKi8gKG5vcm1hbGl6ZWRNZXRhZGF0YSlcblxuICByZXR1cm4gbm9ybWFsaXplZFxufVxuXG4vKipcbiAqIE5vcm1hbGl6ZXMgdGhlIHN5bmMgY29uZmxpY3Qgc3RyYXRlZ3kgZm9yIHJlcGxheSBjbGllbnRzL3NlcnZlcnMuXG4gKiBAcGFyYW0ge3Vua25vd259IGNvbmZsaWN0U3RyYXRlZ3kgLSBSYXcgc3RyYXRlZ3kuXG4gKiBAcmV0dXJucyB7XCJvcHRpbWlzdGljVmVyc2lvblwiIHwgXCJzZXJ2ZXJXaW5zXCIgfCBcImxhc3RXcml0ZXJXaW5zXCIgfCBcImZpZWxkVGhyZWVXYXlcIiB8IFwiYXBwZW5kT25seVwifSAtIE5vcm1hbGl6ZWQgc3RyYXRlZ3kuXG4gKi9cbmZ1bmN0aW9uIG5vcm1hbGl6ZVN5bmNDb25mbGljdFN0cmF0ZWd5KGNvbmZsaWN0U3RyYXRlZ3kpIHtcbiAgaWYgKGNvbmZsaWN0U3RyYXRlZ3kgPT09IHVuZGVmaW5lZCB8fCBjb25mbGljdFN0cmF0ZWd5ID09PSBudWxsKSByZXR1cm4gXCJvcHRpbWlzdGljVmVyc2lvblwiXG4gIGlmIChbXCJvcHRpbWlzdGljVmVyc2lvblwiLCBcInNlcnZlcldpbnNcIiwgXCJsYXN0V3JpdGVyV2luc1wiLCBcImZpZWxkVGhyZWVXYXlcIiwgXCJhcHBlbmRPbmx5XCJdLmluY2x1ZGVzKFN0cmluZyhjb25mbGljdFN0cmF0ZWd5KSkpIHtcbiAgICByZXR1cm4gLyoqIEB0eXBlIHtcIm9wdGltaXN0aWNWZXJzaW9uXCIgfCBcInNlcnZlcldpbnNcIiB8IFwibGFzdFdyaXRlcldpbnNcIiB8IFwiZmllbGRUaHJlZVdheVwiIHwgXCJhcHBlbmRPbmx5XCJ9ICovIChjb25mbGljdFN0cmF0ZWd5KVxuICB9XG5cbiAgdGhyb3cgbmV3IEVycm9yKGBVbmtub3duIHJlc291cmNlIHN5bmMgY29uZmxpY3RTdHJhdGVneTogJHtTdHJpbmcoY29uZmxpY3RTdHJhdGVneSl9YClcbn1cblxuLyoqXG4gKiBOb3JtYWxpemVzIHN5bmMgb3BlcmF0aW9ucyBpbnRvIGEgc3RhYmxlLCBkdXBsaWNhdGUtZnJlZSBsaXN0LlxuICogQHBhcmFtIHt1bmtub3dufSBvcGVyYXRpb25zIC0gUmF3IG9wZXJhdGlvbnMgdmFsdWUuXG4gKiBAcmV0dXJucyB7c3RyaW5nW119IC0gTm9ybWFsaXplZCBvcGVyYXRpb25zLlxuICovXG5mdW5jdGlvbiBub3JtYWxpemVTeW5jT3BlcmF0aW9ucyhvcGVyYXRpb25zKSB7XG4gIGlmIChvcGVyYXRpb25zID09PSB1bmRlZmluZWQpIHJldHVybiBbXVxuICBpZiAoIUFycmF5LmlzQXJyYXkob3BlcmF0aW9ucykpIHRocm93IG5ldyBFcnJvcihcIlJlc291cmNlIHN5bmMgb3BlcmF0aW9ucyBtdXN0IGJlIGFuIGFycmF5IG9mIG9wZXJhdGlvbiBuYW1lcy5cIilcblxuICBjb25zdCBub3JtYWxpemVkID0gb3BlcmF0aW9ucy5tYXAoKG9wZXJhdGlvbikgPT4ge1xuICAgIGlmICh0eXBlb2Ygb3BlcmF0aW9uICE9PSBcInN0cmluZ1wiIHx8IG9wZXJhdGlvbi5sZW5ndGggPCAxKSB0aHJvdyBuZXcgRXJyb3IoXCJSZXNvdXJjZSBzeW5jIG9wZXJhdGlvbnMgZW50cmllcyBtdXN0IGJlIG5vbi1lbXB0eSBzdHJpbmdzLlwiKVxuXG4gICAgcmV0dXJuIG9wZXJhdGlvblxuICB9KVxuXG4gIHJldHVybiBbLi4ubmV3IFNldChub3JtYWxpemVkKV0uc29ydCgpXG59XG5cbi8qKlxuICogQnVpbGRzIGEgZGV0ZXJtaW5pc3RpYyBwb2xpY3kgaGFzaC5cbiAqIEBwYXJhbSB7dW5rbm93bn0gdmFsdWUgLSBIYXNoIGlucHV0LlxuICogQHJldHVybnMge3N0cmluZ30gLSBzaGEyNTYtcHJlZml4ZWQgaGFzaC5cbiAqL1xuZnVuY3Rpb24gc3luY1BvbGljeUhhc2godmFsdWUpIHtcbiAgcmV0dXJuIGBzaGEyNTYtJHtzaGEyNTZIZXgoc3RhYmxlSnNvblN0cmluZ2lmeSh2YWx1ZSkpfWBcbn1cblxuLyoqXG4gKiBWYWxpZGF0ZXMgdGhhdCBhIHN5bmMgY29uZmlnIHN1YnRyZWUgaXMgZGV0ZXJtaW5pc3RpYyBKU09OIGFuZCBkb2VzIG5vdCBjb250YWluIG9idmlvdXMgc2VjcmV0cy5cbiAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gQXJndW1lbnRzLlxuICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MubGFiZWwgLSBEaWFnbm9zdGljIHBhdGggbGFiZWwuXG4gKiBAcGFyYW0ge3Vua25vd259IGFyZ3MudmFsdWUgLSBWYWx1ZSB0byB2YWxpZGF0ZS5cbiAqIEByZXR1cm5zIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkZyb250ZW5kTW9kZWxTeW5jSnNvblZhbHVlfSAtIFN0YWJsZSBKU09OIHZhbHVlLlxuICovXG5mdW5jdGlvbiBkZXRlcm1pbmlzdGljU3luY0pzb24oe2xhYmVsLCB2YWx1ZX0pIHtcbiAgaWYgKHZhbHVlID09PSBudWxsIHx8IHR5cGVvZiB2YWx1ZSA9PT0gXCJzdHJpbmdcIiB8fCB0eXBlb2YgdmFsdWUgPT09IFwibnVtYmVyXCIgfHwgdHlwZW9mIHZhbHVlID09PSBcImJvb2xlYW5cIikgcmV0dXJuIHZhbHVlXG5cbiAgaWYgKEFycmF5LmlzQXJyYXkodmFsdWUpKSB7XG4gICAgcmV0dXJuIHZhbHVlLm1hcCgoZW50cnksIGluZGV4KSA9PiBkZXRlcm1pbmlzdGljU3luY0pzb24oe2xhYmVsOiBgJHtsYWJlbH0vJHtpbmRleH1gLCB2YWx1ZTogZW50cnl9KSlcbiAgfVxuXG4gIGlmICh2YWx1ZSAmJiB0eXBlb2YgdmFsdWUgPT09IFwib2JqZWN0XCIgJiYgT2JqZWN0LmdldFByb3RvdHlwZU9mKHZhbHVlKSA9PT0gT2JqZWN0LnByb3RvdHlwZSkge1xuICAgIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Gcm9udGVuZE1vZGVsU3luY0pzb25WYWx1ZT59ICovXG4gICAgY29uc3Qgbm9ybWFsaXplZCA9IHt9XG5cbiAgICBmb3IgKGNvbnN0IGtleSBvZiBPYmplY3Qua2V5cyh2YWx1ZSkuc29ydCgpKSB7XG4gICAgICBjb25zdCBjaGlsZFZhbHVlID0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCB1bmtub3duPn0gKi8gKHZhbHVlKVtrZXldXG5cbiAgICAgIGlmIChjaGlsZFZhbHVlID09PSB1bmRlZmluZWQpIGNvbnRpbnVlXG4gICAgICBpZiAoc3luY0NvbmZpZ0tleUxvb2tzU2VjcmV0KGtleSkpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBTeW5jIHBvbGljeSAke2xhYmVsfS8ke2tleX0gaXMgbm90IGFsbG93ZWQgaW4gZnJvbnRlbmQtdmlzaWJsZSBzeW5jIHBvbGljeSBjb25maWdgKVxuICAgICAgfVxuXG4gICAgICBub3JtYWxpemVkW2tleV0gPSBkZXRlcm1pbmlzdGljU3luY0pzb24oe2xhYmVsOiBgJHtsYWJlbH0vJHtrZXl9YCwgdmFsdWU6IGNoaWxkVmFsdWV9KVxuICAgIH1cblxuICAgIHJldHVybiBub3JtYWxpemVkXG4gIH1cblxuICB0aHJvdyBuZXcgRXJyb3IoXCJTeW5jIHBvbGljeSBpbnB1dCBtdXN0IGJlIGRldGVybWluaXN0aWMgSlNPTlwiKVxufVxuXG4vKipcbiAqIFN0YWJsZSBKU09OIHN0cmluZ2lmaWVyIHdpdGggc29ydGVkIG9iamVjdCBrZXlzLlxuICogQHBhcmFtIHt1bmtub3dufSB2YWx1ZSAtIFZhbHVlIHRvIHN0cmluZ2lmeS5cbiAqIEByZXR1cm5zIHtzdHJpbmd9IC0gU3RhYmxlIEpTT04uXG4gKi9cbmZ1bmN0aW9uIHN0YWJsZUpzb25TdHJpbmdpZnkodmFsdWUpIHtcbiAgcmV0dXJuIEpTT04uc3RyaW5naWZ5KGRldGVybWluaXN0aWNTeW5jSnNvbih7bGFiZWw6IFwiaGFzaFwiLCB2YWx1ZX0pKVxufVxuXG4vKipcbiAqIFJldHVybnMgd2hldGhlciBhIHN5bmMgY29uZmlnIGtleSBsb29rcyBsaWtlIGEgY3JlZGVudGlhbC9zZWNyZXQuXG4gKiBAcGFyYW0ge3N0cmluZ30ga2V5IC0gT2JqZWN0IGtleS5cbiAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIga2V5IGlzIGRpc2FsbG93ZWQuXG4gKi9cbmZ1bmN0aW9uIHN5bmNDb25maWdLZXlMb29rc1NlY3JldChrZXkpIHtcbiAgcmV0dXJuIC9zZWNyZXR8dG9rZW58cGFzc3dvcmR8cHJpdmF0ZS4/a2V5fHNpZ25pbmcuP2tleS9pLnRlc3Qoa2V5KVxufVxuXG4vKipcbiAqIFJ1bnMgbm9ybWFsaXplIGZyb250ZW5kIG1vZGVsIHJlc291cmNlIGNvbW1hbmRzLlxuICogQHBhcmFtIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkZyb250ZW5kTW9kZWxSZXNvdXJjZUNvbmZpZ3VyYXRpb259IHJlc291cmNlQ29uZmlndXJhdGlvbiAtIFJhdyByZXNvdXJjZSBjb25maWd1cmF0aW9uLlxuICogQHJldHVybnMge3tidWlsdEluQ29sbGVjdGlvbkNvbW1hbmRzOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+LCBidWlsdEluTWVtYmVyQ29tbWFuZHM6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4sIGNvbGxlY3Rpb25Db21tYW5kczogUmVjb3JkPHN0cmluZywgc3RyaW5nPiwgY29tbWFuZE1ldGFkYXRhOiBSZWNvcmQ8c3RyaW5nLCB7YXJnczogQXJyYXk8e25hbWU6IHN0cmluZywgdHlwZTogc3RyaW5nfT4sIHJldHVyblR5cGU6IHN0cmluZyB8IG51bGx9PiwgbWVtYmVyQ29tbWFuZHM6IFJlY29yZDxzdHJpbmcsIHN0cmluZz59fSAtIE5vcm1hbGl6ZWQgY29tbWFuZCBjb25maWd1cmF0aW9uLlxuICovXG5mdW5jdGlvbiBub3JtYWxpemVGcm9udGVuZE1vZGVsUmVzb3VyY2VDb21tYW5kcyhyZXNvdXJjZUNvbmZpZ3VyYXRpb24pIHtcbiAgY29uc3QgYnVpbHRJbkNvbGxlY3Rpb25Db21tYW5kcyA9IHJlc291cmNlQ29uZmlndXJhdGlvbi5idWlsdEluQ29sbGVjdGlvbkNvbW1hbmRzXG4gIGNvbnN0IGJ1aWx0SW5NZW1iZXJDb21tYW5kcyA9IHJlc291cmNlQ29uZmlndXJhdGlvbi5idWlsdEluTWVtYmVyQ29tbWFuZHNcbiAgY29uc3QgY3VzdG9tQ29sbGVjdGlvbkNvbW1hbmRzID0gcmVzb3VyY2VDb25maWd1cmF0aW9uLmNvbGxlY3Rpb25Db21tYW5kc1xuICBjb25zdCBjdXN0b21NZW1iZXJDb21tYW5kcyA9IHJlc291cmNlQ29uZmlndXJhdGlvbi5tZW1iZXJDb21tYW5kc1xuICBjb25zdCBub3JtYWxpemVkQnVpbHRJbkNvbGxlY3Rpb25Db21tYW5kcyA9IG5vcm1hbGl6ZUZyb250ZW5kTW9kZWxCdWlsdEluQ29tbWFuZHMoe1xuICAgIGNvbW1hbmREZWZhdWx0czoge1xuICAgICAgY3JlYXRlOiBcImNyZWF0ZVwiLFxuICAgICAgaW5kZXg6IFwiaW5kZXhcIlxuICAgIH0sXG4gICAgY29tbWFuZHNDb25maWc6IGJ1aWx0SW5Db2xsZWN0aW9uQ29tbWFuZHMsXG4gICAgbW9kZWxOYW1lOiBcIkNvbGxlY3Rpb25Db21tYW5kXCJcbiAgfSlcbiAgY29uc3Qgbm9ybWFsaXplZEJ1aWx0SW5NZW1iZXJDb21tYW5kcyA9IG5vcm1hbGl6ZUZyb250ZW5kTW9kZWxCdWlsdEluQ29tbWFuZHMoe1xuICAgIGNvbW1hbmREZWZhdWx0czoge1xuICAgICAgYXR0YWNoOiBcImF0dGFjaFwiLFxuICAgICAgYXR0YWNobWVudExpc3Q6IFwiYXR0YWNobWVudExpc3RcIixcbiAgICAgIGRlc3Ryb3k6IFwiZGVzdHJveVwiLFxuICAgICAgZG93bmxvYWQ6IFwiZG93bmxvYWRcIixcbiAgICAgIGZpbmQ6IFwiZmluZFwiLFxuICAgICAgdXBkYXRlOiBcInVwZGF0ZVwiLFxuICAgICAgdXJsOiBcInVybFwiXG4gICAgfSxcbiAgICBjb21tYW5kc0NvbmZpZzogYnVpbHRJbk1lbWJlckNvbW1hbmRzLFxuICAgIG1vZGVsTmFtZTogXCJNZW1iZXJDb21tYW5kXCJcbiAgfSlcblxuICBjb25zdCBub3JtYWxpemVkQ29sbGVjdGlvbkNvbW1hbmRzID0gbm9ybWFsaXplRnJvbnRlbmRNb2RlbEN1c3RvbUNvbW1hbmRzKHtjb21tYW5kc0NvbmZpZzogY3VzdG9tQ29sbGVjdGlvbkNvbW1hbmRzLCBtb2RlbE5hbWU6IFwiQ29sbGVjdGlvbkNvbW1hbmRcIn0pXG4gIGNvbnN0IG5vcm1hbGl6ZWRNZW1iZXJDb21tYW5kcyA9IG5vcm1hbGl6ZUZyb250ZW5kTW9kZWxDdXN0b21Db21tYW5kcyh7Y29tbWFuZHNDb25maWc6IGN1c3RvbU1lbWJlckNvbW1hbmRzLCBtb2RlbE5hbWU6IFwiTWVtYmVyQ29tbWFuZFwifSlcblxuICByZXR1cm4ge1xuICAgIGJ1aWx0SW5Db2xsZWN0aW9uQ29tbWFuZHM6IG5vcm1hbGl6ZWRCdWlsdEluQ29sbGVjdGlvbkNvbW1hbmRzLFxuICAgIGJ1aWx0SW5NZW1iZXJDb21tYW5kczogbm9ybWFsaXplZEJ1aWx0SW5NZW1iZXJDb21tYW5kcyxcbiAgICBjb2xsZWN0aW9uQ29tbWFuZHM6IG5vcm1hbGl6ZWRDb2xsZWN0aW9uQ29tbWFuZHMuY29tbWFuZHMsXG4gICAgY29tbWFuZE1ldGFkYXRhOiB7Li4ubm9ybWFsaXplZENvbGxlY3Rpb25Db21tYW5kcy5tZXRhZGF0YSwgLi4ubm9ybWFsaXplZE1lbWJlckNvbW1hbmRzLm1ldGFkYXRhfSxcbiAgICBtZW1iZXJDb21tYW5kczogbm9ybWFsaXplZE1lbWJlckNvbW1hbmRzLmNvbW1hbmRzXG4gIH1cbn1cblxuLyoqXG4gKiBSdW5zIG5vcm1hbGl6ZSBmcm9udGVuZCBtb2RlbCBidWlsdCBpbiBjb21tYW5kcy5cbiAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gQXJndW1lbnRzLlxuICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+fSBhcmdzLmNvbW1hbmREZWZhdWx0cyAtIEJ1aWx0LWluIGRlZmF1bHQgY29tbWFuZCBuYW1lcy5cbiAqIEBwYXJhbSB7c3RyaW5nW10gfCB1bmRlZmluZWR9IGFyZ3MuY29tbWFuZHNDb25maWcgLSBCdWlsdC1pbiBjb21tYW5kcyBjb25maWcgKGNhbWVsQ2FzZSBjb21tYW5kIHR5cGUgbGlzdCkuXG4gKiBAcGFyYW0ge3N0cmluZ30gYXJncy5tb2RlbE5hbWUgLSBEaWFnbm9zdGljIG1vZGVsIG5hbWUuXG4gKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgc3RyaW5nPn0gLSBOb3JtYWxpemVkIGJ1aWx0LWluIGNvbW1hbmQgY29uZmlnLlxuICovXG5mdW5jdGlvbiBub3JtYWxpemVGcm9udGVuZE1vZGVsQnVpbHRJbkNvbW1hbmRzKHtjb21tYW5kRGVmYXVsdHMsIGNvbW1hbmRzQ29uZmlnLCBtb2RlbE5hbWV9KSB7XG4gIGlmICghY29tbWFuZHNDb25maWcpIHtcbiAgICByZXR1cm4gY29tbWFuZERlZmF1bHRzXG4gIH1cblxuICBpZiAoIUFycmF5LmlzQXJyYXkoY29tbWFuZHNDb25maWcpKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGAke21vZGVsTmFtZX0gY29uZmlndXJhdGlvbiBtdXN0IHVzZSB0aGUgYXJyYXkgZm9ybS4gT2JqZWN0IGZvcm0gaXMgbm8gbG9uZ2VyIHN1cHBvcnRlZC5gKVxuICB9XG5cbiAgLyoqXG4gICAqIE5vcm1hbGl6ZWQgY29tbWFuZHMuXG4gICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+fSAqL1xuICBjb25zdCBub3JtYWxpemVkQ29tbWFuZHMgPSB7fVxuXG4gIGZvciAoY29uc3QgY29tbWFuZFR5cGUgb2YgY29tbWFuZHNDb25maWcpIHtcbiAgICBjb25zdCBkZWZhdWx0Q29tbWFuZE5hbWUgPSBjb21tYW5kRGVmYXVsdHNbY29tbWFuZFR5cGVdXG5cbiAgICBpZiAoIWRlZmF1bHRDb21tYW5kTmFtZSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBVbmtub3duIGJ1aWx0LWluIGZyb250ZW5kIG1vZGVsIGNvbW1hbmQgJyR7Y29tbWFuZFR5cGV9JyBmb3IgJHttb2RlbE5hbWV9YClcbiAgICB9XG5cbiAgICBub3JtYWxpemVkQ29tbWFuZHNbY29tbWFuZFR5cGVdID0gdmFsaWRhdGVGcm9udGVuZE1vZGVsUmVzb3VyY2VDb21tYW5kTmFtZSh7XG4gICAgICBjb21tYW5kTmFtZTogZGVmYXVsdENvbW1hbmROYW1lLFxuICAgICAgY29tbWFuZFR5cGU6IGRlZmF1bHRDb21tYW5kTmFtZSxcbiAgICAgIG1vZGVsTmFtZVxuICAgIH0pXG4gIH1cblxuICByZXR1cm4gbm9ybWFsaXplZENvbW1hbmRzXG59XG5cbi8qKlxuICogUnVucyBub3JtYWxpemUgZnJvbnRlbmQgbW9kZWwgY3VzdG9tIGNvbW1hbmRzLiBFbnRyaWVzIGFyZSBlaXRoZXIgYSBwbGFpblxuICogY2FtZWxDYXNlIG1ldGhvZC1uYW1lIHN0cmluZyBvciBhIGB7bmFtZSwgYXJncz8sIHJldHVyblR5cGU/fWAgb2JqZWN0IHRoYXRcbiAqIGFsc28gZGVjbGFyZXMgdGhlIGNvbW1hbmQncyB0eXBlZCBhcmd1bWVudHMgYW5kL29yIHJlc3BvbnNlIHR5cGUuXG4gKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEFyZ3VtZW50cy5cbiAqIEBwYXJhbSB7QXJyYXk8c3RyaW5nIHwge25hbWU6IHN0cmluZywgYXJncz86IEFycmF5PHtuYW1lOiBzdHJpbmcsIHR5cGU6IHN0cmluZ30+LCByZXR1cm5UeXBlPzogc3RyaW5nfT4gfCB1bmRlZmluZWR9IGFyZ3MuY29tbWFuZHNDb25maWcgLSBDdXN0b20gY29tbWFuZHMgY29uZmlnLlxuICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MubW9kZWxOYW1lIC0gRGlhZ25vc3RpYyBtb2RlbCBuYW1lLlxuICogQHJldHVybnMge3tjb21tYW5kczogUmVjb3JkPHN0cmluZywgc3RyaW5nPiwgbWV0YWRhdGE6IFJlY29yZDxzdHJpbmcsIHthcmdzOiBBcnJheTx7bmFtZTogc3RyaW5nLCB0eXBlOiBzdHJpbmd9PiwgcmV0dXJuVHlwZTogc3RyaW5nIHwgbnVsbH0+fX0gLSBSb3V0ZSBtYXAgKG1ldGhvZCBuYW1lIOKGkiBrZWJhYiBzbHVnKSArIHBlci1jb21tYW5kIG1ldGFkYXRhLlxuICovXG5mdW5jdGlvbiBub3JtYWxpemVGcm9udGVuZE1vZGVsQ3VzdG9tQ29tbWFuZHMoe2NvbW1hbmRzQ29uZmlnLCBtb2RlbE5hbWV9KSB7XG4gIGlmICghY29tbWFuZHNDb25maWcpIHtcbiAgICByZXR1cm4ge2NvbW1hbmRzOiB7fSwgbWV0YWRhdGE6IHt9fVxuICB9XG5cbiAgaWYgKCFBcnJheS5pc0FycmF5KGNvbW1hbmRzQ29uZmlnKSkge1xuICAgIHRocm93IG5ldyBFcnJvcihgJHttb2RlbE5hbWV9IGNvbmZpZ3VyYXRpb24gbXVzdCB1c2UgdGhlIGFycmF5IGZvcm0uIE9iamVjdCBmb3JtIGlzIG5vIGxvbmdlciBzdXBwb3J0ZWQuYClcbiAgfVxuXG4gIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgc3RyaW5nPn0gKi9cbiAgY29uc3QgY29tbWFuZHMgPSB7fVxuICAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIHthcmdzOiBBcnJheTx7bmFtZTogc3RyaW5nLCB0eXBlOiBzdHJpbmd9PiwgcmV0dXJuVHlwZTogc3RyaW5nIHwgbnVsbH0+fSAqL1xuICBjb25zdCBtZXRhZGF0YSA9IHt9XG5cbiAgZm9yIChjb25zdCBjb21tYW5kRW50cnkgb2YgY29tbWFuZHNDb25maWcpIHtcbiAgICBjb25zdCB7bWV0aG9kTmFtZSwgYXJncywgcmV0dXJuVHlwZX0gPSBub3JtYWxpemVGcm9udGVuZE1vZGVsQ3VzdG9tQ29tbWFuZEVudHJ5KHtjb21tYW5kRW50cnksIG1vZGVsTmFtZX0pXG4gICAgY29uc3QgdmFsaWRhdGVkTWV0aG9kTmFtZSA9IHZhbGlkYXRlRnJvbnRlbmRNb2RlbFJlc291cmNlQ29tbWFuZE5hbWUoe1xuICAgICAgY29tbWFuZE5hbWU6IG1ldGhvZE5hbWUsXG4gICAgICBjb21tYW5kVHlwZTogbWV0aG9kTmFtZSxcbiAgICAgIG1vZGVsTmFtZVxuICAgIH0pXG4gICAgY29uc3QgY29tbWFuZFNsdWcgPSBpbmZsZWN0aW9uLmRhc2hlcml6ZShpbmZsZWN0aW9uLnVuZGVyc2NvcmUodmFsaWRhdGVkTWV0aG9kTmFtZSkpXG5cbiAgICBjb21tYW5kc1t2YWxpZGF0ZWRNZXRob2ROYW1lXSA9IGNvbW1hbmRTbHVnXG4gICAgbWV0YWRhdGFbdmFsaWRhdGVkTWV0aG9kTmFtZV0gPSB7YXJncywgcmV0dXJuVHlwZX1cbiAgfVxuXG4gIHJldHVybiB7Y29tbWFuZHMsIG1ldGFkYXRhfVxufVxuXG4vKipcbiAqIE5vcm1hbGl6ZXMgb25lIGN1c3RvbS1jb21tYW5kIGVudHJ5IChzdHJpbmcgc2hvcnRoYW5kIG9yIGNvbnRyYWN0IG9iamVjdCkuXG4gKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEFyZ3VtZW50cy5cbiAqIEBwYXJhbSB7dW5rbm93bn0gYXJncy5jb21tYW5kRW50cnkgLSBSYXcgY29tbWFuZCBlbnRyeS5cbiAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLm1vZGVsTmFtZSAtIERpYWdub3N0aWMgbW9kZWwgbmFtZS5cbiAqIEByZXR1cm5zIHt7bWV0aG9kTmFtZTogc3RyaW5nLCBhcmdzOiBBcnJheTx7bmFtZTogc3RyaW5nLCB0eXBlOiBzdHJpbmd9PiwgcmV0dXJuVHlwZTogc3RyaW5nIHwgbnVsbH19IC0gTWV0aG9kIG5hbWUgKyBtZXRhZGF0YS5cbiAqL1xuZnVuY3Rpb24gbm9ybWFsaXplRnJvbnRlbmRNb2RlbEN1c3RvbUNvbW1hbmRFbnRyeSh7Y29tbWFuZEVudHJ5LCBtb2RlbE5hbWV9KSB7XG4gIGlmICh0eXBlb2YgY29tbWFuZEVudHJ5ID09PSBcInN0cmluZ1wiKSB7XG4gICAgcmV0dXJuIHttZXRob2ROYW1lOiBjb21tYW5kRW50cnksIGFyZ3M6IFtdLCByZXR1cm5UeXBlOiBudWxsfVxuICB9XG5cbiAgaWYgKCFjb21tYW5kRW50cnkgfHwgdHlwZW9mIGNvbW1hbmRFbnRyeSAhPT0gXCJvYmplY3RcIiB8fCBBcnJheS5pc0FycmF5KGNvbW1hbmRFbnRyeSkpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYCR7bW9kZWxOYW1lfSBlbnRyaWVzIG11c3QgYmUgYSBjYW1lbENhc2UgbmFtZSBzdHJpbmcgb3IgYSB7bmFtZSwgYXJncz8sIHJldHVyblR5cGU/fSBvYmplY3RgKVxuICB9XG5cbiAgY29uc3Qge25hbWUsIGFyZ3MsIHJldHVyblR5cGUsIC4uLnJlc3R9ID0gLyoqIEB0eXBlIHt7bmFtZT86IHVua25vd24sIGFyZ3M/OiB1bmtub3duLCByZXR1cm5UeXBlPzogdW5rbm93bn19ICovIChjb21tYW5kRW50cnkpXG5cbiAgaWYgKE9iamVjdC5rZXlzKHJlc3QpLmxlbmd0aCA+IDApIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYFVuZXhwZWN0ZWQgJHttb2RlbE5hbWV9IGtleXM6ICR7T2JqZWN0LmtleXMocmVzdCkuam9pbihcIiwgXCIpfS4gQWxsb3dlZDogbmFtZSwgYXJncywgcmV0dXJuVHlwZWApXG4gIH1cblxuICBpZiAodHlwZW9mIG5hbWUgIT09IFwic3RyaW5nXCIgfHwgbmFtZS5sZW5ndGggPCAxKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGAke21vZGVsTmFtZX0gb2JqZWN0IGVudHJpZXMgcmVxdWlyZSBhIG5vbi1lbXB0eSAnbmFtZScgc3RyaW5nYClcbiAgfVxuXG4gIHJldHVybiB7XG4gICAgbWV0aG9kTmFtZTogbmFtZSxcbiAgICBhcmdzOiBub3JtYWxpemVGcm9udGVuZE1vZGVsQ29tbWFuZEFyZ3Moe2FyZ3MsIGNvbW1hbmROYW1lOiBuYW1lLCBtb2RlbE5hbWV9KSxcbiAgICByZXR1cm5UeXBlOiBub3JtYWxpemVGcm9udGVuZE1vZGVsQ29tbWFuZFJldHVyblR5cGUoe2NvbW1hbmROYW1lOiBuYW1lLCBtb2RlbE5hbWUsIHJldHVyblR5cGV9KVxuICB9XG59XG5cbi8qKlxuICogVmFsaWRhdGVzIGFuZCBub3JtYWxpemVzIGEgY3VzdG9tIGNvbW1hbmQncyB0eXBlZC1hcmd1bWVudCBsaXN0LlxuICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBBcmd1bWVudHMuXG4gKiBAcGFyYW0ge3Vua25vd259IGFyZ3MuYXJncyAtIFJhdyBjb21tYW5kIGFyZ3MuXG4gKiBAcGFyYW0ge3N0cmluZ30gYXJncy5jb21tYW5kTmFtZSAtIENvbW1hbmQgbmFtZSBmb3IgZGlhZ25vc3RpY3MuXG4gKiBAcGFyYW0ge3N0cmluZ30gYXJncy5tb2RlbE5hbWUgLSBEaWFnbm9zdGljIG1vZGVsIG5hbWUuXG4gKiBAcmV0dXJucyB7QXJyYXk8e25hbWU6IHN0cmluZywgdHlwZTogc3RyaW5nfT59IC0gTm9ybWFsaXplZCB0eXBlZCBjb21tYW5kIGFyZ3VtZW50cy5cbiAqL1xuZnVuY3Rpb24gbm9ybWFsaXplRnJvbnRlbmRNb2RlbENvbW1hbmRBcmdzKHthcmdzLCBjb21tYW5kTmFtZSwgbW9kZWxOYW1lfSkge1xuICBpZiAoYXJncyA9PT0gdW5kZWZpbmVkIHx8IGFyZ3MgPT09IG51bGwpIHtcbiAgICByZXR1cm4gW11cbiAgfVxuXG4gIGlmICghQXJyYXkuaXNBcnJheShhcmdzKSkge1xuICAgIHRocm93IG5ldyBFcnJvcihgJHttb2RlbE5hbWV9ICcke2NvbW1hbmROYW1lfScgYXJncyBtdXN0IGJlIGFuIGFycmF5IG9mIHtuYW1lLCB0eXBlfSBvYmplY3RzYClcbiAgfVxuXG4gIHJldHVybiBhcmdzLm1hcCgoYXJnKSA9PiB7XG4gICAgaWYgKCFhcmcgfHwgdHlwZW9mIGFyZyAhPT0gXCJvYmplY3RcIiB8fCB0eXBlb2YgYXJnLm5hbWUgIT09IFwic3RyaW5nXCIgfHwgYXJnLm5hbWUubGVuZ3RoIDwgMSB8fCB0eXBlb2YgYXJnLnR5cGUgIT09IFwic3RyaW5nXCIgfHwgYXJnLnR5cGUudHJpbSgpLmxlbmd0aCA8IDEpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgJHttb2RlbE5hbWV9ICcke2NvbW1hbmROYW1lfScgYXJncyBlbnRyaWVzIHJlcXVpcmUgbm9uLWVtcHR5ICduYW1lJyBhbmQgSlNEb2MtdHlwZSAndHlwZScgc3RyaW5nc2ApXG4gICAgfVxuXG4gICAgcmV0dXJuIHtuYW1lOiBhcmcubmFtZSwgdHlwZTogYXJnLnR5cGUudHJpbSgpfVxuICB9KVxufVxuXG4vKipcbiAqIFZhbGlkYXRlcyBhbmQgbm9ybWFsaXplcyBhIGN1c3RvbSBjb21tYW5kJ3MgZGVjbGFyZWQgSlNEb2MgcmV0dXJuIHR5cGUuXG4gKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEFyZ3VtZW50cy5cbiAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmNvbW1hbmROYW1lIC0gQ29tbWFuZCBuYW1lIGZvciBkaWFnbm9zdGljcy5cbiAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLm1vZGVsTmFtZSAtIERpYWdub3N0aWMgbW9kZWwgbmFtZS5cbiAqIEBwYXJhbSB7dW5rbm93bn0gYXJncy5yZXR1cm5UeXBlIC0gUmF3IHJldHVybiB0eXBlLlxuICogQHJldHVybnMge3N0cmluZyB8IG51bGx9IC0gTm9ybWFsaXplZCBKU0RvYyByZXR1cm4gdHlwZS5cbiAqL1xuZnVuY3Rpb24gbm9ybWFsaXplRnJvbnRlbmRNb2RlbENvbW1hbmRSZXR1cm5UeXBlKHtjb21tYW5kTmFtZSwgbW9kZWxOYW1lLCByZXR1cm5UeXBlfSkge1xuICBpZiAocmV0dXJuVHlwZSA9PT0gdW5kZWZpbmVkIHx8IHJldHVyblR5cGUgPT09IG51bGwpIHtcbiAgICByZXR1cm4gbnVsbFxuICB9XG5cbiAgaWYgKHR5cGVvZiByZXR1cm5UeXBlICE9PSBcInN0cmluZ1wiIHx8IHJldHVyblR5cGUudHJpbSgpLmxlbmd0aCA8IDEpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYCR7bW9kZWxOYW1lfSAnJHtjb21tYW5kTmFtZX0nIHJldHVyblR5cGUgbXVzdCBiZSBhIG5vbi1lbXB0eSBKU0RvYyB0eXBlIHN0cmluZ2ApXG4gIH1cblxuICByZXR1cm4gcmV0dXJuVHlwZS50cmltKClcbn1cblxuLyoqXG4gKiBSdW5zIHRoZSBmcm9udGVuZE1vZGVsUmVzb3VyY2VQYXRoIGhlbHBlci5cbiAqIEBwYXJhbSB7c3RyaW5nfSBtb2RlbE5hbWUgLSBNb2RlbCBjbGFzcyBuYW1lLlxuICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gcmVzb3VyY2VEZWZpbml0aW9uIC0gUmVzb3VyY2UgZGVmaW5pdGlvbi5cbiAqIEByZXR1cm5zIHtzdHJpbmd9IC0gTm9ybWFsaXplZCByZXNvdXJjZSBwYXRoLlxuICovXG5leHBvcnQgZnVuY3Rpb24gZnJvbnRlbmRNb2RlbFJlc291cmNlUGF0aChtb2RlbE5hbWUsIHJlc291cmNlRGVmaW5pdGlvbikge1xuICBjb25zdCByZXNvdXJjZUNvbmZpZ3VyYXRpb24gPSBmcm9udGVuZE1vZGVsUmVzb3VyY2VDb25maWd1cmF0aW9uRnJvbURlZmluaXRpb24ocmVzb3VyY2VEZWZpbml0aW9uKVxuXG4gIGlmICghcmVzb3VyY2VDb25maWd1cmF0aW9uKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGBJbnZhbGlkIGZyb250ZW5kIG1vZGVsIHJlc291cmNlIGRlZmluaXRpb24gZm9yICR7bW9kZWxOYW1lfWApXG4gIH1cblxuICByZXR1cm4gYC8ke2luZmxlY3Rpb24uZGFzaGVyaXplKGluZmxlY3Rpb24ucGx1cmFsaXplKGluZmxlY3Rpb24udW5kZXJzY29yZShtb2RlbE5hbWUpKSl9YFxufVxuXG4vKipcbiAqIFJ1bnMgdGhlIGZyb250ZW5kTW9kZWxBY3Rpb25Gb3JDb21tYW5kIGhlbHBlci5cbiAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gQXJndW1lbnRzLlxuICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MuY29tbWFuZE5hbWUgLSBDb21tYW5kIHBhdGggc2VnbWVudC5cbiAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLm1vZGVsTmFtZSAtIE1vZGVsIGNsYXNzIG5hbWUuXG4gKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBhcmdzLnJlc291cmNlRGVmaW5pdGlvbiAtIFJlc291cmNlIGRlZmluaXRpb24uXG4gKiBAcmV0dXJucyB7XCJkZXN0cm95XCIgfCBcImZpbmRcIiB8IFwiaW5kZXhcIiB8IFwiY3JlYXRlXCIgfCBcInVwZGF0ZVwiIHwgXCJhdHRhY2hcIiB8IFwiZG93bmxvYWRcIiB8IFwidXJsXCIgfCBudWxsfSAtIEZyb250ZW5kIGFjdGlvbi5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGZyb250ZW5kTW9kZWxBY3Rpb25Gb3JDb21tYW5kKHtjb21tYW5kTmFtZSwgbW9kZWxOYW1lLCByZXNvdXJjZURlZmluaXRpb259KSB7XG4gIGNvbnN0IHJlc291cmNlQ29uZmlndXJhdGlvbiA9IGZyb250ZW5kTW9kZWxSZXNvdXJjZUNvbmZpZ3VyYXRpb25Gcm9tRGVmaW5pdGlvbihyZXNvdXJjZURlZmluaXRpb24pXG5cbiAgaWYgKCFyZXNvdXJjZUNvbmZpZ3VyYXRpb24pIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYEludmFsaWQgZnJvbnRlbmQgbW9kZWwgcmVzb3VyY2UgZGVmaW5pdGlvbiBmb3IgJHttb2RlbE5hbWV9YClcbiAgfVxuXG4gIGZvciAoY29uc3QgW2FjdGlvbiwgY29uZmlndXJlZENvbW1hbmROYW1lXSBvZiBPYmplY3QuZW50cmllcyh7XG4gICAgLi4ucmVzb3VyY2VDb25maWd1cmF0aW9uLmJ1aWx0SW5Db2xsZWN0aW9uQ29tbWFuZHMsXG4gICAgLi4ucmVzb3VyY2VDb25maWd1cmF0aW9uLmJ1aWx0SW5NZW1iZXJDb21tYW5kc1xuICB9KSkge1xuICAgIGlmIChjb25maWd1cmVkQ29tbWFuZE5hbWUgPT09IHVuZGVmaW5lZCkgY29udGludWVcblxuICAgIGNvbnN0IHZhbGlkYXRlZENvbW1hbmROYW1lID0gdmFsaWRhdGVGcm9udGVuZE1vZGVsUmVzb3VyY2VDb21tYW5kTmFtZSh7XG4gICAgICBjb21tYW5kTmFtZTogY29uZmlndXJlZENvbW1hbmROYW1lLFxuICAgICAgY29tbWFuZFR5cGU6IC8qKiBAdHlwZSB7XCJhdHRhY2hcIiB8IFwiY3JlYXRlXCIgfCBcImRlc3Ryb3lcIiB8IFwiZG93bmxvYWRcIiB8IFwiZmluZFwiIHwgXCJpbmRleFwiIHwgXCJ1cGRhdGVcIiB8IFwidXJsXCJ9ICovIChhY3Rpb24pLFxuICAgICAgbW9kZWxOYW1lXG4gICAgfSlcblxuICAgIGlmIChjb21tYW5kTmFtZSA9PT0gdmFsaWRhdGVkQ29tbWFuZE5hbWUpIHtcbiAgICAgIHJldHVybiAvKiogQHR5cGUge1wiYXR0YWNoXCIgfCBcImNyZWF0ZVwiIHwgXCJkZXN0cm95XCIgfCBcImRvd25sb2FkXCIgfCBcImZpbmRcIiB8IFwiaW5kZXhcIiB8IFwidXBkYXRlXCIgfCBcInVybFwifSAqLyAoYWN0aW9uKVxuICAgIH1cbiAgfVxuXG4gIHJldHVybiBudWxsXG59XG5cbi8qKlxuICogUnVucyB0aGUgZnJvbnRlbmRNb2RlbEN1c3RvbUNvbW1hbmRGb3JQYXRoIGhlbHBlci5cbiAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gQXJndW1lbnRzLlxuICogQHBhcmFtIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkJhY2tlbmRQcm9qZWN0Q29uZmlndXJhdGlvbltdfSBhcmdzLmJhY2tlbmRQcm9qZWN0cyAtIEJhY2tlbmQgcHJvamVjdHMgdG8gc2Nhbi5cbiAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmN1cnJlbnRQYXRoIC0gUmVxdWVzdCBwYXRoIHdpdGhvdXQgcXVlcnkuXG4gKiBAcmV0dXJucyB7e2NvbW1hbmROYW1lOiBzdHJpbmcsIG1lbWJlcklkPzogc3RyaW5nLCBtZXRob2ROYW1lOiBzdHJpbmcsIG1vZGVsTmFtZTogc3RyaW5nLCByZXNvdXJjZVBhdGg6IHN0cmluZywgc2NvcGU6IFwiY29sbGVjdGlvblwiIHwgXCJtZW1iZXJcIn0gfCBudWxsfSAtIE1hdGNoZWQgY3VzdG9tIGNvbW1hbmQgbWV0YWRhdGEuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBmcm9udGVuZE1vZGVsQ3VzdG9tQ29tbWFuZEZvclBhdGgoe2JhY2tlbmRQcm9qZWN0cywgY3VycmVudFBhdGh9KSB7XG4gIGNvbnN0IG5vcm1hbGl6ZWRDdXJyZW50UGF0aCA9IG5vcm1hbGl6ZUZyb250ZW5kTW9kZWxSZXNvdXJjZVBhdGhGb3JNYXRjaChjdXJyZW50UGF0aClcblxuICBmb3IgKGNvbnN0IGJhY2tlbmRQcm9qZWN0IG9mIGJhY2tlbmRQcm9qZWN0cykge1xuICAgIGNvbnN0IHJlc291cmNlcyA9IGZyb250ZW5kTW9kZWxSZXNvdXJjZXNGb3JCYWNrZW5kUHJvamVjdChiYWNrZW5kUHJvamVjdClcblxuICAgIGZvciAoY29uc3QgbW9kZWxOYW1lIGluIHJlc291cmNlcykge1xuICAgICAgY29uc3QgcmVzb3VyY2VEZWZpbml0aW9uID0gcmVzb3VyY2VzW21vZGVsTmFtZV1cbiAgICAgIGNvbnN0IHJlc291cmNlQ29uZmlndXJhdGlvbiA9IGZyb250ZW5kTW9kZWxSZXNvdXJjZUNvbmZpZ3VyYXRpb25Gcm9tRGVmaW5pdGlvbihyZXNvdXJjZURlZmluaXRpb24pXG5cbiAgICAgIGlmICghcmVzb3VyY2VDb25maWd1cmF0aW9uKSB7XG4gICAgICAgIGNvbnRpbnVlXG4gICAgICB9XG5cbiAgICAgIGNvbnN0IHJlc291cmNlUGF0aCA9IG5vcm1hbGl6ZUZyb250ZW5kTW9kZWxSZXNvdXJjZVBhdGhGb3JNYXRjaChmcm9udGVuZE1vZGVsUmVzb3VyY2VQYXRoKG1vZGVsTmFtZSwgcmVzb3VyY2VEZWZpbml0aW9uKSlcbiAgICAgIGNvbnN0IGV4cGVjdGVkUHJlZml4ID0gYCR7cmVzb3VyY2VQYXRofS9gXG5cbiAgICAgIGlmICghbm9ybWFsaXplZEN1cnJlbnRQYXRoLnN0YXJ0c1dpdGgoZXhwZWN0ZWRQcmVmaXgpKSB7XG4gICAgICAgIGNvbnRpbnVlXG4gICAgICB9XG5cbiAgICAgIGNvbnN0IHBhdGhTZWdtZW50cyA9IG5vcm1hbGl6ZWRDdXJyZW50UGF0aFxuICAgICAgICAuc2xpY2UoZXhwZWN0ZWRQcmVmaXgubGVuZ3RoKVxuICAgICAgICAuc3BsaXQoXCIvXCIpXG4gICAgICAgIC5maWx0ZXIoQm9vbGVhbilcblxuICAgICAgaWYgKHBhdGhTZWdtZW50cy5sZW5ndGggPT09IDEpIHtcbiAgICAgICAgY29uc3QgbWF0Y2hlZENvbGxlY3Rpb25Db21tYW5kID0gT2JqZWN0LmVudHJpZXMocmVzb3VyY2VDb25maWd1cmF0aW9uLmNvbGxlY3Rpb25Db21tYW5kcylcbiAgICAgICAgICAuZmluZCgoWywgY29tbWFuZE5hbWVdKSA9PiBjb21tYW5kTmFtZSA9PT0gcGF0aFNlZ21lbnRzWzBdKVxuXG4gICAgICAgIGlmIChtYXRjaGVkQ29sbGVjdGlvbkNvbW1hbmQpIHtcbiAgICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgY29tbWFuZE5hbWU6IG1hdGNoZWRDb2xsZWN0aW9uQ29tbWFuZFsxXSxcbiAgICAgICAgICAgIG1ldGhvZE5hbWU6IG1hdGNoZWRDb2xsZWN0aW9uQ29tbWFuZFswXSxcbiAgICAgICAgICAgIG1vZGVsTmFtZSxcbiAgICAgICAgICAgIHJlc291cmNlUGF0aCxcbiAgICAgICAgICAgIHNjb3BlOiBcImNvbGxlY3Rpb25cIlxuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICBpZiAocGF0aFNlZ21lbnRzLmxlbmd0aCA9PT0gMikge1xuICAgICAgICBjb25zdCBtYXRjaGVkTWVtYmVyQ29tbWFuZCA9IE9iamVjdC5lbnRyaWVzKHJlc291cmNlQ29uZmlndXJhdGlvbi5tZW1iZXJDb21tYW5kcylcbiAgICAgICAgICAuZmluZCgoWywgY29tbWFuZE5hbWVdKSA9PiBjb21tYW5kTmFtZSA9PT0gcGF0aFNlZ21lbnRzWzFdKVxuXG4gICAgICAgIGlmIChtYXRjaGVkTWVtYmVyQ29tbWFuZCkge1xuICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICBjb21tYW5kTmFtZTogbWF0Y2hlZE1lbWJlckNvbW1hbmRbMV0sXG4gICAgICAgICAgICBtZW1iZXJJZDogZGVjb2RlVVJJQ29tcG9uZW50KHBhdGhTZWdtZW50c1swXSksXG4gICAgICAgICAgICBtZXRob2ROYW1lOiBtYXRjaGVkTWVtYmVyQ29tbWFuZFswXSxcbiAgICAgICAgICAgIG1vZGVsTmFtZSxcbiAgICAgICAgICAgIHJlc291cmNlUGF0aCxcbiAgICAgICAgICAgIHNjb3BlOiBcIm1lbWJlclwiXG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIG51bGxcbn1cblxuLyoqXG4gKiBSdW5zIG5vcm1hbGl6ZSBmcm9udGVuZCBtb2RlbCByZXNvdXJjZSBwYXRoIGZvciBtYXRjaC5cbiAqIEBwYXJhbSB7c3RyaW5nfSBwYXRoIC0gUGF0aCB2YWx1ZS5cbiAqIEByZXR1cm5zIHtzdHJpbmd9IC0gTm9ybWFsaXplZCBwYXRoIHdpdGggbGVhZGluZyBzbGFzaCBhbmQgbm8gdHJhaWxpbmcgc2xhc2guXG4gKi9cbmZ1bmN0aW9uIG5vcm1hbGl6ZUZyb250ZW5kTW9kZWxSZXNvdXJjZVBhdGhGb3JNYXRjaChwYXRoKSB7XG4gIGNvbnN0IHdpdGhMZWFkaW5nU2xhc2ggPSBwYXRoLnN0YXJ0c1dpdGgoXCIvXCIpID8gcGF0aCA6IGAvJHtwYXRofWBcblxuICBpZiAod2l0aExlYWRpbmdTbGFzaC5sZW5ndGggPiAxKSB7XG4gICAgcmV0dXJuIHdpdGhMZWFkaW5nU2xhc2gucmVwbGFjZSgvXFwvKyQvLCBcIlwiKVxuICB9XG5cbiAgcmV0dXJuIHdpdGhMZWFkaW5nU2xhc2hcbn1cblxuLyoqXG4gKiBSZXNvbHZlcyB0aGUgcmVnaXN0ZXJlZCBmcm9udGVuZC1tb2RlbCByZXNvdXJjZSBjbGFzcyBmb3IgYSByZXNvdXJjZSB0eXBlXG4gKiBhY3Jvc3MgYWxsIGJhY2tlbmQgcHJvamVjdHMuIEEgcmVzb3VyY2UncyBlZmZlY3RpdmUgbmFtZSBpcyBpdHNcbiAqIGBtb2RlbE5hbWVgIG92ZXJyaWRlIHdoZW4gZGVjbGFyZWQsIG90aGVyd2lzZSBpdHMgcmVnaXN0cnkga2V5IOKAlCBtYXRjaGluZ1xuICoge0BsaW5rIGZyb250ZW5kTW9kZWxTeW5jTWFuaWZlc3RGb3JCYWNrZW5kUHJvamVjdHN9LiBBIHJlZ2lzdHJ5IGtleSBzaGFkb3dlZFxuICogYnkgYSBgbW9kZWxOYW1lYCBvdmVycmlkZSBkb2VzIG5vdCByZXNvbHZlLlxuICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICogQHBhcmFtIHt7Z2V0QmFja2VuZFByb2plY3RzOiAoKSA9PiBpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkJhY2tlbmRQcm9qZWN0Q29uZmlndXJhdGlvbltdfX0gYXJncy5jb25maWd1cmF0aW9uIC0gQ29uZmlndXJhdGlvbiBleHBvc2luZyB0aGUgYmFja2VuZCBwcm9qZWN0cy5cbiAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLnJlc291cmNlVHlwZSAtIEZyb250ZW5kIG1vZGVsIG5hbWUgdG8gcmVzb2x2ZS5cbiAqIEByZXR1cm5zIHtGcm9udGVuZE1vZGVsUmVzb2x2ZWRSZXNvdXJjZVJlZ2lzdHJhdGlvbiB8IG51bGx9IFJlc29sdmVkIHJlZ2lzdHJhdGlvbiBvciBudWxsIHdoZW4gdGhlIHJlc291cmNlIHR5cGUgaXMgbm90IHJlZ2lzdGVyZWQuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiByZXNvbHZlRnJvbnRlbmRNb2RlbFJlc291cmNlQ2xhc3Moe2NvbmZpZ3VyYXRpb24sIHJlc291cmNlVHlwZX0pIHtcbiAgZm9yIChjb25zdCBiYWNrZW5kUHJvamVjdCBvZiBjb25maWd1cmF0aW9uLmdldEJhY2tlbmRQcm9qZWN0cygpKSB7XG4gICAgY29uc3QgcmVzb3VyY2VzID0gZnJvbnRlbmRNb2RlbFJlc291cmNlc0ZvckJhY2tlbmRQcm9qZWN0KGJhY2tlbmRQcm9qZWN0KVxuXG4gICAgZm9yIChjb25zdCBjb25maWd1cmVkTW9kZWxOYW1lIG9mIE9iamVjdC5rZXlzKHJlc291cmNlcykpIHtcbiAgICAgIGNvbnN0IHJlc291cmNlRGVmaW5pdGlvbiA9IHJlc291cmNlc1tjb25maWd1cmVkTW9kZWxOYW1lXVxuICAgICAgY29uc3QgcmVzb3VyY2VDbGFzcyA9IGZyb250ZW5kTW9kZWxSZXNvdXJjZUNsYXNzRnJvbURlZmluaXRpb24ocmVzb3VyY2VEZWZpbml0aW9uKVxuXG4gICAgICBpZiAoIXJlc291cmNlQ2xhc3MpIGNvbnRpbnVlXG5cbiAgICAgIC8vIENoZWFwIGRpcmVjdC1rZXkgbWlzbWF0Y2ggc2tpcDogb25seSBub3JtYWxpemUgY29uZmlndXJhdGlvbnMgZm9yIHRoZVxuICAgICAgLy8gbWF0Y2hpbmcga2V5IG9yIHdoZW4gYSBtb2RlbE5hbWUgb3ZlcnJpZGUgY291bGQgcmVuYW1lIHRoZSByZXNvdXJjZS5cbiAgICAgIGlmIChjb25maWd1cmVkTW9kZWxOYW1lICE9PSByZXNvdXJjZVR5cGUgJiYgIXJlc291cmNlQ2xhc3Muc2hhcmVkUmVzb3VyY2VTdGF0aWNWYWx1ZShcIm1vZGVsTmFtZVwiKSkgY29udGludWVcblxuICAgICAgY29uc3QgcmVzb3VyY2VDb25maWd1cmF0aW9uID0gZnJvbnRlbmRNb2RlbFJlc291cmNlQ29uZmlndXJhdGlvbkZyb21EZWZpbml0aW9uKHJlc291cmNlRGVmaW5pdGlvbilcblxuICAgICAgaWYgKCFyZXNvdXJjZUNvbmZpZ3VyYXRpb24pIGNvbnRpbnVlXG4gICAgICBpZiAoKHJlc291cmNlQ29uZmlndXJhdGlvbi5tb2RlbE5hbWUgfHwgY29uZmlndXJlZE1vZGVsTmFtZSkgIT09IHJlc291cmNlVHlwZSkgY29udGludWVcblxuICAgICAgcmV0dXJuIHttb2RlbE5hbWU6IHJlc291cmNlVHlwZSwgcmVzb3VyY2VDbGFzcywgcmVzb3VyY2VDb25maWd1cmF0aW9ufVxuICAgIH1cbiAgfVxuXG4gIHJldHVybiBudWxsXG59XG4iXX0=