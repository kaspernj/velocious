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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicmVzb3VyY2UtZGVmaW5pdGlvbi5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9mcm9udGVuZC1tb2RlbHMvcmVzb3VyY2UtZGVmaW5pdGlvbi5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxZQUFZO0FBRVosT0FBTyxLQUFLLFVBQVUsTUFBTSxZQUFZLENBQUE7QUFDeEMsT0FBTyx5QkFBeUIsTUFBTSw2Q0FBNkMsQ0FBQTtBQUNuRixPQUFPLGFBQWEsTUFBTSw2QkFBNkIsQ0FBQTtBQUN2RCxPQUFPLFNBQVMsTUFBTSx3QkFBd0IsQ0FBQTtBQUM5QyxPQUFPLEVBQUMsd0NBQXdDLEVBQUMsTUFBTSxpQ0FBaUMsQ0FBQTtBQUV4Rjs7Ozs7O0dBTUc7QUFDSCxNQUFNLG1DQUFtQyxHQUFHLENBQUMsUUFBUSxFQUFFLFNBQVMsRUFBRSxNQUFNLEVBQUUsUUFBUSxDQUFDLENBQUE7QUFDbkYsTUFBTSwyQkFBMkIsR0FBRyxJQUFJLEdBQUcsQ0FBQztJQUMxQyxXQUFXO0lBQ1gsYUFBYTtJQUNiLFlBQVk7SUFDWiwyQkFBMkI7SUFDM0IsdUJBQXVCO0lBQ3ZCLG9CQUFvQjtJQUNwQixVQUFVO0lBQ1YsZ0JBQWdCO0lBQ2hCLFdBQVc7SUFDWCxZQUFZO0lBQ1osWUFBWTtJQUNaLG9CQUFvQjtJQUNwQixlQUFlO0lBQ2Ysb0JBQW9CO0lBQ3BCLFFBQVE7SUFDUixnQkFBZ0I7SUFDaEIsTUFBTTtJQUNOLHNCQUFzQjtJQUN0QixvQkFBb0I7Q0FDckIsQ0FBQyxDQUFBO0FBRUY7Ozs7R0FJRztBQUNILE1BQU0sVUFBVSx1Q0FBdUMsQ0FBQyxjQUFjO0lBQ3BFLE1BQU0sU0FBUyxHQUFHLGNBQWMsQ0FBQyxjQUFjLENBQUE7SUFFL0MsSUFBSSxTQUFTLEtBQUssU0FBUyxFQUFFLENBQUM7UUFDNUIsSUFBSSxDQUFDLFNBQVMsSUFBSSxPQUFPLFNBQVMsS0FBSyxRQUFRLEVBQUUsQ0FBQztZQUNoRCxNQUFNLElBQUksS0FBSyxD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Q0FBQTtJQUM3QyxDQUFDO0lBRUQsT0FBTyxnQkFBZ0IsQ0FBQTtBQUN6QixDQUFDO0FBRUQ7Ozs7Ozs7Ozs7R0FVRztBQUNILE1BQU0sVUFBVSxpQ0FBaUMsQ0FBQyxFQUFDLGFBQWEsRUFBRSxZQUFZLEVBQUM7SUFDN0UsS0FBSyxNQUFNLGNBQWMsSUFBSSxhQUFhLENBQUMsa0JBQWtCLEVBQUUsRUFBRSxDQUFDO1FBQ2hFLE1BQU0sU0FBUyxHQUFHLHVDQUF1QyxDQUFDLGNBQWMsQ0FBQyxDQUFBO1FBRXpFLEtBQUssTUFBTSxtQkFBbUIsSUFBSSxNQUFNLENBQUMsSUFBSSxDQUFDLFNBQVMsQ0FBQyxFQUFFLENBQUM7WUFDekQsTUFBTSxrQkFBa0IsR0FBRyxTQUFTLENBQUMsbUJBQW1CLENBQUMsQ0FBQTtZQUN6RCxNQUFNLGFBQWEsR0FBRyx3Q0FBd0MsQ0FBQyxrQkFBa0IsQ0FBQyxDQUFBO1lBRWxGLElBQUksQ0FBQyxhQUFhO2dCQUFFLFNBQVE7WUFFNUIsd0VBQXdFO1lBQ3hFLHVFQUF1RTtZQUN2RSxJQUFJLG1CQUFtQixLQUFLLFlBQVksSUFBSSxDQUFDLGFBQWEsQ0FBQyx5QkFBeUIsQ0FBQyxXQUFXLENBQUM7Z0JBQUUsU0FBUTtZQUUzRyxNQUFNLHFCQUFxQixHQUFHLGdEQUFnRCxDQUFDLGtCQUFrQixDQUFDLENBQUE7WUFFbEcsSUFBSSxDQUFDLHFCQUFxQjtnQkFBRSxTQUFRO1lBQ3BDLElBQUksQ0FBQyxxQkFBcUIsQ0FBQyxTQUFTLElBQUksbUJBQW1CLENBQUMsS0FBSyxZQUFZO2dCQUFFLFNBQVE7WUFFdkYsT0FBTyxFQUFDLFNBQVMsRUFBRSxZQUFZLEVBQUUsYUFBYSxFQUFFLHFCQUFxQixFQUFDLENBQUE7UUFDeEUsQ0FBQztJQUNILENBQUM7SUFFRCxPQUFPLElBQUksQ0FBQTtBQUNiLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuaW1wb3J0ICogYXMgaW5mbGVjdGlvbiBmcm9tIFwiaW5mbGVjdGlvblwiXG5pbXBvcnQgRnJvbnRlbmRNb2RlbEJhc2VSZXNvdXJjZSBmcm9tIFwiLi4vZnJvbnRlbmQtbW9kZWwtcmVzb3VyY2UvYmFzZS1yZXNvdXJjZS5qc1wiXG5pbXBvcnQgcmVzdEFyZ3NFcnJvciBmcm9tIFwiLi4vdXRpbHMvcmVzdC1hcmdzLWVycm9yLmpzXCJcbmltcG9ydCBzaGEyNTZIZXggZnJvbSBcIi4uL3V0aWxzL3NoYTI1Ni1oZXguanNcIlxuaW1wb3J0IHt2YWxpZGF0ZUZyb250ZW5kTW9kZWxSZXNvdXJjZUNvbW1hbmROYW1lfSBmcm9tIFwiLi9yZXNvdXJjZS1jb25maWctdmFsaWRhdGlvbi5qc1wiXG5cbi8qKlxuICogUmVzb2x2ZWQgZnJvbnRlbmQtbW9kZWwgcmVzb3VyY2UgcmVnaXN0cmF0aW9uIGZvciBhIHJlcGxheSByZXNvdXJjZSB0eXBlLlxuICogQHR5cGVkZWYge29iamVjdH0gRnJvbnRlbmRNb2RlbFJlc29sdmVkUmVzb3VyY2VSZWdpc3RyYXRpb25cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBtb2RlbE5hbWUgLSBFZmZlY3RpdmUgZnJvbnRlbmQgbW9kZWwgbmFtZSAobW9kZWxOYW1lIG92ZXJyaWRlIG9yIHJlZ2lzdHJ5IGtleSkuXG4gKiBAcHJvcGVydHkge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRnJvbnRlbmRNb2RlbFJlc291cmNlQ2xhc3NUeXBlfSByZXNvdXJjZUNsYXNzIC0gUmVnaXN0ZXJlZCByZXNvdXJjZSBjbGFzcy5cbiAqIEBwcm9wZXJ0eSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Ob3JtYWxpemVkRnJvbnRlbmRNb2RlbFJlc291cmNlQ29uZmlndXJhdGlvbn0gcmVzb3VyY2VDb25maWd1cmF0aW9uIC0gTm9ybWFsaXplZCByZXNvdXJjZSBjb25maWd1cmF0aW9uLlxuICovXG5jb25zdCBCQVNFX0ZST05URU5EX01PREVMX0FCSUxJVFlfQUNUSU9OUyA9IFtcImNyZWF0ZVwiLCBcImRlc3Ryb3lcIiwgXCJyZWFkXCIsIFwidXBkYXRlXCJdXG5jb25zdCBSRVNPVVJDRV9TVEFUSUNfQ09ORklHX0tFWVMgPSBuZXcgU2V0KFtcbiAgXCJhYmlsaXRpZXNcIixcbiAgXCJhdHRhY2htZW50c1wiLFxuICBcImF0dHJpYnV0ZXNcIixcbiAgXCJidWlsdEluQ29sbGVjdGlvbkNvbW1hbmRzXCIsXG4gIFwiYnVpbHRJbk1lbWJlckNvbW1hbmRzXCIsXG4gIFwiY29sbGVjdGlvbkNvbW1hbmRzXCIsXG4gIFwiY29tbWFuZHNcIixcbiAgXCJtZW1iZXJDb21tYW5kc1wiLFxuICBcIm1vZGVsTmFtZVwiLFxuICBcIk1vZGVsQ2xhc3NcIixcbiAgXCJwcmltYXJ5S2V5XCIsXG4gIFwicXVpY2tTZWFyY2hDb2x1bW5zXCIsXG4gIFwicmVsYXRpb25zaGlwc1wiLFxuICBcIlJlcGxheVNlcnZpY2VDbGFzc1wiLFxuICBcInNlcnZlclwiLFxuICBcIlNoYXJlZFJlc291cmNlXCIsXG4gIFwic3luY1wiLFxuICBcInRyYW5zbGF0ZWRBdHRyaWJ1dGVzXCIsXG4gIFwid3JpdGFibGVBdHRyaWJ1dGVzXCJcbl0pXG5cbi8qKlxuICogUnVucyB0aGUgZnJvbnRlbmRNb2RlbFJlc291cmNlc0ZvckJhY2tlbmRQcm9qZWN0IGhlbHBlci5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5CYWNrZW5kUHJvamVjdENvbmZpZ3VyYXRpb259IGJhY2tlbmRQcm9qZWN0IC0gQmFja2VuZCBwcm9qZWN0IGNvbmZpZy5cbiAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkZyb250ZW5kTW9kZWxSZXNvdXJjZUNsYXNzVHlwZT59IC0gUmVzb3VyY2UgZGVmaW5pdGlvbnMga2V5ZWQgYnkgbW9kZWwgbmFtZS5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGZyb250ZW5kTW9kZWxSZXNvdXJjZXNGb3JCYWNrZW5kUHJvamVjdChiYWNrZW5kUHJvamVjdCkge1xuICBjb25zdCByZXNvdXJjZXMgPSBiYWNrZW5kUHJvamVjdC5mcm9udGVuZE1vZGVsc1xuXG4gIGlmIChyZXNvdXJjZXMgIT09IHVuZGVmaW5lZCkge1xuICAgIGlmICghcmVzb3VyY2VzIHx8IHR5cGVvZiByZXNvdXJjZXMgIT09IFwib2JqZWN0XCIpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgRXhwZWN0ZWQgYmFja2VuZCBwcm9qZWN0IGZyb250ZW5kTW9kZWxzIG9iamVjdCBidXQgZ290OiAke3Jlc291cmNlc31gKVxuICAgIH1cblxuICAgIHJldHVybiByZXNvdXJjZXNcbiAgfVxuXG4gIHJldHVybiB7fVxufVxuXG4vKipcbiAqIFJ1bnMgdGhlIGZyb250ZW5kTW9kZWxSZXNvdXJjZURlZmluaXRpb25Jc0NsYXNzIGhlbHBlci5cbiAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHZhbHVlIC0gQ2FuZGlkYXRlIHJlc291cmNlIGRlZmluaXRpb24uXG4gKiBAcmV0dXJucyB7dmFsdWUgaXMgaW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Gcm9udGVuZE1vZGVsUmVzb3VyY2VDbGFzc1R5cGV9IC0gV2hldGhlciB2YWx1ZSBpcyBhIHJlc291cmNlIGNsYXNzLlxuICovXG5leHBvcnQgZnVuY3Rpb24gZnJvbnRlbmRNb2RlbFJlc291cmNlRGVmaW5pdGlvbklzQ2xhc3ModmFsdWUpIHtcbiAgcmV0dXJuIHR5cGVvZiB2YWx1ZSA9PT0gXCJmdW5jdGlvblwiICYmICh2YWx1ZSA9PT0gRnJvbnRlbmRNb2RlbEJhc2VSZXNvdXJjZSB8fCB2YWx1ZS5wcm90b3R5cGUgaW5zdGFuY2VvZiBGcm9udGVuZE1vZGVsQmFzZVJlc291cmNlKVxufVxuXG4vKipcbiAqIFJ1bnMgdGhlIGZyb250ZW5kTW9kZWxSZXNvdXJjZUNsYXNzRnJvbURlZmluaXRpb24gaGVscGVyLlxuICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gcmVzb3VyY2VEZWZpbml0aW9uIC0gUmVzb3VyY2UgZGVmaW5pdGlvbi5cbiAqIEByZXR1cm5zIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkZyb250ZW5kTW9kZWxSZXNvdXJjZUNsYXNzVHlwZSB8IG51bGx9IC0gUmVzb3VyY2UgY2xhc3Mgd2hlbiBkZWZpbml0aW9uIGlzIGNsYXNzLWJhc2VkLlxuICovXG5leHBvcnQgZnVuY3Rpb24gZnJvbnRlbmRNb2RlbFJlc291cmNlQ2xhc3NGcm9tRGVmaW5pdGlvbihyZXNvdXJjZURlZmluaXRpb24pIHtcbiAgcmV0dXJuIGZyb250ZW5kTW9kZWxSZXNvdXJjZURlZmluaXRpb25Jc0NsYXNzKHJlc291cmNlRGVmaW5pdGlvbikgPyByZXNvdXJjZURlZmluaXRpb24gOiBudWxsXG59XG5cbi8qKlxuICogUnVucyB0aGUgZnJvbnRlbmRNb2RlbFJlc291cmNlQ29uZmlndXJhdGlvbkZyb21EZWZpbml0aW9uIGhlbHBlci5cbiAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHJlc291cmNlRGVmaW5pdGlvbiAtIFJlc291cmNlIGRlZmluaXRpb24uXG4gKiBAcmV0dXJucyB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Ob3JtYWxpemVkRnJvbnRlbmRNb2RlbFJlc291cmNlQ29uZmlndXJhdGlvbiB8IG51bGx9IC0gTm9ybWFsaXplZCByZXNvdXJjZSBjb25maWd1cmF0aW9uLlxuICovXG5leHBvcnQgZnVuY3Rpb24gZnJvbnRlbmRNb2RlbFJlc291cmNlQ29uZmlndXJhdGlvbkZyb21EZWZpbml0aW9uKHJlc291cmNlRGVmaW5pdGlvbikge1xuICBpZiAoIWZyb250ZW5kTW9kZWxSZXNvdXJjZURlZmluaXRpb25Jc0NsYXNzKHJlc291cmNlRGVmaW5pdGlvbikpIHJldHVybiBudWxsXG5cbiAgYXNzZXJ0UmVzb3VyY2VDb25maWdJc0ZyYW1ld29ya0RlZmluZWQocmVzb3VyY2VEZWZpbml0aW9uKVxuXG4gIHJldHVybiBub3JtYWxpemVGcm9udGVuZE1vZGVsUmVzb3VyY2VDb25maWd1cmF0aW9uKHJlc291cmNlRGVmaW5pdGlvbi5yZXNvdXJjZUNvbmZpZygpKVxufVxuXG4vKipcbiAqIEVuc3VyZXMgcmVzb3VyY2VzIHVzZSBkZWNsYXJhdGl2ZSBzdGF0aWMgY29uZmlnIHByb3BlcnRpZXMgaW5zdGVhZCBvZiBvdmVycmlkaW5nIHJlc291cmNlQ29uZmlnKCkuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRnJvbnRlbmRNb2RlbFJlc291cmNlQ2xhc3NUeXBlfSBSZXNvdXJjZUNsYXNzIC0gUmVzb3VyY2UgY2xhc3MuXG4gKiBAcGFyYW0ge1NldDxpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkZyb250ZW5kTW9kZWxSZXNvdXJjZUNsYXNzVHlwZT59IFt2aXNpdGVkXSAtIEFscmVhZHkgaW5zcGVjdGVkIHNoYXJlZCByZXNvdXJjZXMuXG4gKiBAcmV0dXJucyB7dm9pZH1cbiAqL1xuZnVuY3Rpb24gYXNzZXJ0UmVzb3VyY2VDb25maWdJc0ZyYW1ld29ya0RlZmluZWQoUmVzb3VyY2VDbGFzcywgdmlzaXRlZCA9IG5ldyBTZXQoKSkge1xuICBpZiAodmlzaXRlZC5oYXMoUmVzb3VyY2VDbGFzcykpIHJldHVyblxuXG4gIHZpc2l0ZWQuYWRkKFJlc291cmNlQ2xhc3MpXG4gIGFzc2VydEtub3duUmVzb3VyY2VTdGF0aWNDb25maWdQcm9wZXJ0aWVzKFJlc291cmNlQ2xhc3MpXG5cbiAgY29uc3Qgb3duZXIgPSBzdGF0aWNNZXRob2RPd25lckZvcihSZXNvdXJjZUNsYXNzLCBcInJlc291cmNlQ29uZmlnXCIpXG5cbiAgaWYgKG93bmVyICYmIG93bmVyICE9PSBGcm9udGVuZE1vZGVsQmFzZVJlc291cmNlKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGAke1Jlc291cmNlQ2xhc3MubmFtZX0gb3ZlcnJpZGVzIHN0YXRpYyByZXNvdXJjZUNvbmZpZygpLCB3aGljaCBpcyBub3Qgc3VwcG9ydGVkLiBVc2Ugc3RhdGljIHJlc291cmNlIHByb3BlcnRpZXMgaW5zdGVhZC5gKVxuICB9XG5cbiAgY29uc3QgU2hhcmVkUmVzb3VyY2UgPSBSZXNvdXJjZUNsYXNzLnNoYXJlZFJlc291cmNlQ2xhc3MoKVxuXG4gIGlmIChTaGFyZWRSZXNvdXJjZSkgYXNzZXJ0UmVzb3VyY2VDb25maWdJc0ZyYW1ld29ya0RlZmluZWQoU2hhcmVkUmVzb3VyY2UsIHZpc2l0ZWQpXG59XG5cbi8qKlxuICogRW5zdXJlcyBkZWNsYXJhdGl2ZSBzdGF0aWMgcmVzb3VyY2UgY29uZmlnIGRvZXMgbm90IHNpbGVudGx5IGlnbm9yZSB0eXBvcyBvciByZW1vdmVkIGtleXMuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRnJvbnRlbmRNb2RlbFJlc291cmNlQ2xhc3NUeXBlfSBSZXNvdXJjZUNsYXNzIC0gUmVzb3VyY2UgY2xhc3MuXG4gKiBAcmV0dXJucyB7dm9pZH1cbiAqL1xuZnVuY3Rpb24gYXNzZXJ0S25vd25SZXNvdXJjZVN0YXRpY0NvbmZpZ1Byb3BlcnRpZXMoUmVzb3VyY2VDbGFzcykge1xuICBsZXQgY3VycmVudENsYXNzID0gUmVzb3VyY2VDbGFzc1xuXG4gIHdoaWxlIChjdXJyZW50Q2xhc3MgJiYgY3VycmVudENsYXNzICE9PSBGcm9udGVuZE1vZGVsQmFzZVJlc291cmNlICYmIGN1cnJlbnRDbGFzcyAhPT0gRnVuY3Rpb24ucHJvdG90eXBlKSB7XG4gICAgLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovXG4gICAgY29uc3QgdW5rbm93blN0YXRpY0NvbmZpZyA9IHt9XG5cbiAgICBmb3IgKGNvbnN0IGtleSBvZiBPYmplY3Qua2V5cyhjdXJyZW50Q2xhc3MpKSB7XG4gICAgICBpZiAoIVJFU09VUkNFX1NUQVRJQ19DT05GSUdfS0VZUy5oYXMoa2V5KSkgdW5rbm93blN0YXRpY0NvbmZpZ1trZXldID0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovICgvKiogQHR5cGUge3Vua25vd259ICovIChjdXJyZW50Q2xhc3MpKVtrZXldXG4gICAgfVxuXG4gICAgcmVzdEFyZ3NFcnJvcih1bmtub3duU3RhdGljQ29uZmlnKVxuXG4gICAgY3VycmVudENsYXNzID0gT2JqZWN0LmdldFByb3RvdHlwZU9mKGN1cnJlbnRDbGFzcylcbiAgfVxufVxuXG4vKipcbiAqIExvY2F0ZXMgd2hpY2ggY29uc3RydWN0b3Igb3ducyBhIHN0YXRpYyBtZXRob2QgaW1wbGVtZW50YXRpb24uXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRnJvbnRlbmRNb2RlbFJlc291cmNlQ2xhc3NUeXBlfSBSZXNvdXJjZUNsYXNzIC0gUmVzb3VyY2UgY2xhc3MuXG4gKiBAcGFyYW0ge3N0cmluZ30gbWV0aG9kTmFtZSAtIE1ldGhvZCBuYW1lLlxuICogQHJldHVybnMge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRnJvbnRlbmRNb2RlbFJlc291cmNlQ2xhc3NUeXBlIHwgdHlwZW9mIEZyb250ZW5kTW9kZWxCYXNlUmVzb3VyY2UgfCBudWxsfSAtIENsYXNzIHRoYXQgb3ducyB0aGUgc3RhdGljIG1ldGhvZC5cbiAqL1xuZnVuY3Rpb24gc3RhdGljTWV0aG9kT3duZXJGb3IoUmVzb3VyY2VDbGFzcywgbWV0aG9kTmFtZSkge1xuICBsZXQgY3VycmVudENsYXNzID0gUmVzb3VyY2VDbGFzc1xuXG4gIHdoaWxlIChjdXJyZW50Q2xhc3MgJiYgY3VycmVudENsYXNzICE9PSBGdW5jdGlvbi5wcm90b3R5cGUpIHtcbiAgICBpZiAoT2JqZWN0LnByb3RvdHlwZS5oYXNPd25Qcm9wZXJ0eS5jYWxsKGN1cnJlbnRDbGFzcywgbWV0aG9kTmFtZSkpIHJldHVybiBjdXJyZW50Q2xhc3NcblxuICAgIGN1cnJlbnRDbGFzcyA9IE9iamVjdC5nZXRQcm90b3R5cGVPZihjdXJyZW50Q2xhc3MpXG4gIH1cblxuICByZXR1cm4gbnVsbFxufVxuXG4vKipcbiAqIFJ1bnMgbm9ybWFsaXplIGZyb250ZW5kIG1vZGVsIHJlc291cmNlIGNvbmZpZ3VyYXRpb24uXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRnJvbnRlbmRNb2RlbFJlc291cmNlQ29uZmlndXJhdGlvbn0gcmVzb3VyY2VDb25maWd1cmF0aW9uIC0gUmF3IHJlc291cmNlIGNvbmZpZ3VyYXRpb24uXG4gKiBAcmV0dXJucyB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Ob3JtYWxpemVkRnJvbnRlbmRNb2RlbFJlc291cmNlQ29uZmlndXJhdGlvbn0gLSBOb3JtYWxpemVkIHJlc291cmNlIGNvbmZpZ3VyYXRpb24uXG4gKi9cbmZ1bmN0aW9uIG5vcm1hbGl6ZUZyb250ZW5kTW9kZWxSZXNvdXJjZUNvbmZpZ3VyYXRpb24ocmVzb3VyY2VDb25maWd1cmF0aW9uKSB7XG4gIGNvbnN0IHJlc3RBcmdzID0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovICh7Li4ucmVzb3VyY2VDb25maWd1cmF0aW9ufSlcblxuICBmb3IgKGNvbnN0IGtleSBvZiBbXG4gICAgXCJhYmlsaXRpZXNcIixcbiAgICBcImF0dHJpYnV0ZXNcIixcbiAgICBcImF0dGFjaG1lbnRzXCIsXG4gICAgXCJidWlsdEluQ29sbGVjdGlvbkNvbW1hbmRzXCIsXG4gICAgXCJidWlsdEluTWVtYmVyQ29tbWFuZHNcIixcbiAgICBcImNvbGxlY3Rpb25Db21tYW5kc1wiLFxuICAgIFwiY29tbWFuZHNcIixcbiAgICBcIm1lbWJlckNvbW1hbmRzXCIsXG4gICAgXCJtb2RlbE5hbWVcIixcbiAgICBcInByaW1hcnlLZXlcIixcbiAgICBcInJlbGF0aW9uc2hpcHNcIixcbiAgICBcInNlcnZlclwiLFxuICAgIFwic3luY1wiXG4gIF0pIHtcbiAgICBkZWxldGUgcmVzdEFyZ3Nba2V5XVxuICB9XG5cbiAgcmVzdEFyZ3NFcnJvcihyZXN0QXJncylcblxuICBjb25zdCBub3JtYWxpemVkQ29tbWFuZHMgPSBub3JtYWxpemVGcm9udGVuZE1vZGVsUmVzb3VyY2VDb21tYW5kcyhyZXNvdXJjZUNvbmZpZ3VyYXRpb24pXG4gIGNvbnN0IHN5bmMgPSBub3JtYWxpemVGcm9udGVuZE1vZGVsUmVzb3VyY2VTeW5jKHJlc291cmNlQ29uZmlndXJhdGlvbilcblxuICByZXR1cm4ge1xuICAgIC4uLnJlc291cmNlQ29uZmlndXJhdGlvbixcbiAgICBhYmlsaXRpZXM6IG5vcm1hbGl6ZUZyb250ZW5kTW9kZWxSZXNvdXJjZUFiaWxpdGllcyhyZXNvdXJjZUNvbmZpZ3VyYXRpb24uYWJpbGl0aWVzKSxcbiAgICBidWlsdEluQ29sbGVjdGlvbkNvbW1hbmRzOiBub3JtYWxpemVkQ29tbWFuZHMuYnVpbHRJbkNvbGxlY3Rpb25Db21tYW5kcyxcbiAgICBidWlsdEluTWVtYmVyQ29tbWFuZHM6IG5vcm1hbGl6ZWRDb21tYW5kcy5idWlsdEluTWVtYmVyQ29tbWFuZHMsXG4gICAgY29sbGVjdGlvbkNvbW1hbmRzOiBub3JtYWxpemVkQ29tbWFuZHMuY29sbGVjdGlvbkNvbW1hbmRzLFxuICAgIC8vIFBlci1jb21tYW5kIG1ldGFkYXRhICh0eXBlZCBhcmdzICsgZGVjbGFyZWQgcmV0dXJuIHR5cGUpIGtleWVkIGJ5IG1ldGhvZFxuICAgIC8vIG5hbWUsIGRlcml2ZWQgZnJvbSBge25hbWUsIGFyZ3M/LCByZXR1cm5UeXBlP31gIGNvbW1hbmQgZW50cmllcy4gVGhlXG4gICAgLy8gZ2VuZXJhdG9yIHVzZXMgaXQgdG8gdHlwZSBlYWNoIGN1c3RvbSBjb21tYW5kIG1ldGhvZC5cbiAgICBjb21tYW5kTWV0YWRhdGE6IG5vcm1hbGl6ZWRDb21tYW5kcy5jb21tYW5kTWV0YWRhdGEsXG4gICAgbWVtYmVyQ29tbWFuZHM6IG5vcm1hbGl6ZWRDb21tYW5kcy5tZW1iZXJDb21tYW5kcyxcbiAgICBzeW5jXG4gIH1cbn1cblxuLyoqXG4gKiBSdW5zIG5vcm1hbGl6ZSBmcm9udGVuZCBtb2RlbCByZXNvdXJjZSBhYmlsaXRpZXMuXG4gKiBAcGFyYW0ge3N0cmluZ1tdIHwgdW5kZWZpbmVkfSBhYmlsaXRpZXMgLSBSZXNvdXJjZSBhYmlsaXRpZXMgY29uZmlnIChjYW1lbENhc2UgYWN0aW9uIGxpc3QpLlxuICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIHN0cmluZz59IC0gTm9ybWFsaXplZCBhYmlsaXRpZXMgY29uZmlnLlxuICovXG5mdW5jdGlvbiBub3JtYWxpemVGcm9udGVuZE1vZGVsUmVzb3VyY2VBYmlsaXRpZXMoYWJpbGl0aWVzKSB7XG4gIGNvbnN0IG5vcm1hbGl6ZWQgPSBkZWZhdWx0Q3J1ZEFiaWxpdGllcygpXG5cbiAgaWYgKGFiaWxpdGllcyA9PT0gdW5kZWZpbmVkKSByZXR1cm4gbm9ybWFsaXplZFxuXG4gIGlmICghQXJyYXkuaXNBcnJheShhYmlsaXRpZXMpKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFwiUmVzb3VyY2UgYWJpbGl0aWVzIG11c3QgYmUgYW4gYXJyYXkgb2YgYWN0aW9uIG5hbWVzLiBPYmplY3QgZm9ybSBpcyBubyBsb25nZXIgc3VwcG9ydGVkLlwiKVxuICB9XG5cbiAgY29uc3QgZHVwbGljYXRlZEJhc2VBYmlsaXRpZXMgPSBhYmlsaXRpZXMuZmlsdGVyKChhYmlsaXR5KSA9PiBCQVNFX0ZST05URU5EX01PREVMX0FCSUxJVFlfQUNUSU9OUy5pbmNsdWRlcyhhYmlsaXR5KSlcblxuICBpZiAoZHVwbGljYXRlZEJhc2VBYmlsaXRpZXMubGVuZ3RoID4gMCkge1xuICAgIHRocm93IG5ldyBFcnJvcihgUmVzb3VyY2UgYWJpbGl0aWVzIG11c3Qgbm90IGluY2x1ZGUgYmFzZSBhY3Rpb25zOiAke2R1cGxpY2F0ZWRCYXNlQWJpbGl0aWVzLmpvaW4oXCIsIFwiKX1gKVxuICB9XG5cbiAgZm9yIChjb25zdCBhYmlsaXR5IG9mIGFiaWxpdGllcykge1xuICAgIGlmICh0eXBlb2YgYWJpbGl0eSAhPT0gXCJzdHJpbmdcIiB8fCBhYmlsaXR5Lmxlbmd0aCA8IDEpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIlJlc291cmNlIGFiaWxpdGllcyBlbnRyaWVzIG11c3QgYmUgbm9uLWVtcHR5IHN0cmluZ3MuXCIpXG4gICAgfVxuXG4gICAgbm9ybWFsaXplZFthYmlsaXR5XSA9IGFiaWxpdHlcbiAgfVxuXG4gIHJldHVybiBub3JtYWxpemVkXG59XG5cbi8qKlxuICogUnVucyBkZWZhdWx0IGNydWQgYWJpbGl0aWVzLlxuICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIHN0cmluZz59IC0gRGVmYXVsdCBDUlVEIGFiaWxpdHkgbWFwLlxuICovXG5mdW5jdGlvbiBkZWZhdWx0Q3J1ZEFiaWxpdGllcygpIHtcbiAgcmV0dXJuIHtcbiAgICBjcmVhdGU6IFwiY3JlYXRlXCIsXG4gICAgZGVzdHJveTogXCJkZXN0cm95XCIsXG4gICAgZmluZDogXCJyZWFkXCIsXG4gICAgaW5kZXg6IFwicmVhZFwiLFxuICAgIHVwZGF0ZTogXCJ1cGRhdGVcIlxuICB9XG59XG5cbi8qKlxuICogQnVpbGRzIGEgZnJvbnRlbmQtc2FmZSBzeW5jIG1hbmlmZXN0IGZvciBhbGwgc3luYy1lbmFibGVkIGZyb250ZW5kLW1vZGVsIHJlc291cmNlcy5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5CYWNrZW5kUHJvamVjdENvbmZpZ3VyYXRpb25bXX0gYmFja2VuZFByb2plY3RzIC0gQmFja2VuZCBwcm9qZWN0cyB0byBzY2FuLlxuICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIGltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuTm9ybWFsaXplZEZyb250ZW5kTW9kZWxSZXNvdXJjZVN5bmNDb25maWd1cmF0aW9uPn0gLSBTeW5jIG1ldGFkYXRhIGtleWVkIGJ5IG1vZGVsIG5hbWUuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBmcm9udGVuZE1vZGVsU3luY01hbmlmZXN0Rm9yQmFja2VuZFByb2plY3RzKGJhY2tlbmRQcm9qZWN0cykge1xuICAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIGltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuTm9ybWFsaXplZEZyb250ZW5kTW9kZWxSZXNvdXJjZVN5bmNDb25maWd1cmF0aW9uPn0gKi9cbiAgY29uc3QgbWFuaWZlc3QgPSB7fVxuXG4gIGZvciAoY29uc3QgYmFja2VuZFByb2plY3Qgb2YgYmFja2VuZFByb2plY3RzKSB7XG4gICAgY29uc3QgcmVzb3VyY2VzID0gZnJvbnRlbmRNb2RlbFJlc291cmNlc0ZvckJhY2tlbmRQcm9qZWN0KGJhY2tlbmRQcm9qZWN0KVxuXG4gICAgZm9yIChjb25zdCBjb25maWd1cmVkTW9kZWxOYW1lIG9mIE9iamVjdC5rZXlzKHJlc291cmNlcykuc29ydCgpKSB7XG4gICAgICBjb25zdCByZXNvdXJjZURlZmluaXRpb24gPSByZXNvdXJjZXNbY29uZmlndXJlZE1vZGVsTmFtZV1cbiAgICAgIGNvbnN0IHJlc291cmNlQ29uZmlndXJhdGlvbiA9IGZyb250ZW5kTW9kZWxSZXNvdXJjZUNvbmZpZ3VyYXRpb25Gcm9tRGVmaW5pdGlvbihyZXNvdXJjZURlZmluaXRpb24pXG5cbiAgICAgIGlmICghcmVzb3VyY2VDb25maWd1cmF0aW9uKSBjb250aW51ZVxuICAgICAgaWYgKCFyZXNvdXJjZUNvbmZpZ3VyYXRpb24uc3luYz8uZW5hYmxlZCkgY29udGludWVcblxuICAgICAgY29uc3QgbW9kZWxOYW1lID0gcmVzb3VyY2VDb25maWd1cmF0aW9uLm1vZGVsTmFtZSB8fCBjb25maWd1cmVkTW9kZWxOYW1lXG5cbiAgICAgIG1hbmlmZXN0W21vZGVsTmFtZV0gPSByZXNvdXJjZUNvbmZpZ3VyYXRpb24uc3luY1xuICAgIH1cbiAgfVxuXG4gIHJldHVybiBtYW5pZmVzdFxufVxuXG4vKipcbiAqIEJ1aWxkcyBhIGZyb250ZW5kLXNhZmUgQVBJIG1hbmlmZXN0IGZvciBhbGwgcmVnaXN0ZXJlZCBmcm9udGVuZC1tb2RlbFxuICogcmVzb3VyY2VzLiBUaGUgbWFuaWZlc3QgaXMgZGV0ZXJtaW5pc3RpYyAoc29ydGVkIG1vZGVsIG5hbWVzLCBzb3J0ZWRcbiAqIGF0dHJpYnV0ZXMsIHNvcnRlZCBjb21tYW5kcykgYW5kIGluY2x1ZGVzIG9ubHkgcHVibGljLXNhZmUgbWV0YWRhdGE6IG5vXG4gKiBzZWNyZXRzLCBubyBzZXJ2ZXIgY2FsbGJhY2tzLCBubyBiYWNrZW5kIGZpbGUgcGF0aHMuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuQmFja2VuZFByb2plY3RDb25maWd1cmF0aW9uW119IGJhY2tlbmRQcm9qZWN0cyAtIEJhY2tlbmQgcHJvamVjdHMgdG8gc2Nhbi5cbiAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCB1bmtub3duPn0gLSBGcm9udGVuZC1zYWZlIEFQSSBtYW5pZmVzdC5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGZyb250ZW5kTW9kZWxBcGlNYW5pZmVzdChiYWNrZW5kUHJvamVjdHMpIHtcbiAgLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCB1bmtub3duPn0gKi9cbiAgY29uc3QgcmVzb3VyY2VzID0ge31cblxuICBmb3IgKGNvbnN0IGJhY2tlbmRQcm9qZWN0IG9mIGJhY2tlbmRQcm9qZWN0cykge1xuICAgIGNvbnN0IHByb2plY3RSZXNvdXJjZXMgPSBmcm9udGVuZE1vZGVsUmVzb3VyY2VzRm9yQmFja2VuZFByb2plY3QoYmFja2VuZFByb2plY3QpXG5cbiAgICBmb3IgKGNvbnN0IGNvbmZpZ3VyZWRNb2RlbE5hbWUgb2YgT2JqZWN0LmtleXMocHJvamVjdFJlc291cmNlcykuc29ydCgpKSB7XG4gICAgICBjb25zdCByZXNvdXJjZURlZmluaXRpb24gPSBwcm9qZWN0UmVzb3VyY2VzW2NvbmZpZ3VyZWRNb2RlbE5hbWVdXG4gICAgICBjb25zdCByZXNvdXJjZUNvbmZpZ3VyYXRpb24gPSBmcm9udGVuZE1vZGVsUmVzb3VyY2VDb25maWd1cmF0aW9uRnJvbURlZmluaXRpb24ocmVzb3VyY2VEZWZpbml0aW9uKVxuXG4gICAgICBpZiAoIXJlc291cmNlQ29uZmlndXJhdGlvbikgY29udGludWVcblxuICAgICAgY29uc3QgbW9kZWxOYW1lID0gcmVzb3VyY2VDb25maWd1cmF0aW9uLm1vZGVsTmFtZSB8fCBjb25maWd1cmVkTW9kZWxOYW1lXG4gICAgICBjb25zdCByZXNvdXJjZVBhdGggPSBgLyR7aW5mbGVjdGlvbi5kYXNoZXJpemUoaW5mbGVjdGlvbi5wbHVyYWxpemUoaW5mbGVjdGlvbi51bmRlcnNjb3JlKGNvbmZpZ3VyZWRNb2RlbE5hbWUpKSl9YFxuXG4gICAgICAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIHVua25vd24+fSAqL1xuICAgICAgY29uc3QgZW50cnkgPSB7XG4gICAgICAgIG1vZGVsTmFtZSxcbiAgICAgICAgcGF0aDogcmVzb3VyY2VQYXRoLFxuICAgICAgICBwcmltYXJ5S2V5OiByZXNvdXJjZUNvbmZpZ3VyYXRpb24ucHJpbWFyeUtleSB8fCBcImlkXCIsXG4gICAgICAgIGF0dHJpYnV0ZXM6IG1hbmlmZXN0QXR0cmlidXRlcyhyZXNvdXJjZUNvbmZpZ3VyYXRpb24uYXR0cmlidXRlcyksXG4gICAgICAgIGFiaWxpdGllczogcmVzb3VyY2VDb25maWd1cmF0aW9uLmFiaWxpdGllcyxcbiAgICAgICAgYnVpbHRJbkNvbW1hbmRzOiB7XG4gICAgICAgICAgY29sbGVjdGlvbjogcmVzb3VyY2VDb25maWd1cmF0aW9uLmJ1aWx0SW5Db2xsZWN0aW9uQ29tbWFuZHMsXG4gICAgICAgICAgbWVtYmVyOiByZXNvdXJjZUNvbmZpZ3VyYXRpb24uYnVpbHRJbk1lbWJlckNvbW1hbmRzXG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgY29uc3QgcmVsYXRpb25zaGlwcyA9IHJlc291cmNlQ29uZmlndXJhdGlvbi5yZWxhdGlvbnNoaXBzXG4gICAgICBpZiAocmVsYXRpb25zaGlwcyAmJiByZWxhdGlvbnNoaXBzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCB1bmtub3duPn0gKi9cbiAgICAgICAgY29uc3QgcmVscyA9IHt9XG4gICAgICAgIGZvciAoY29uc3QgcmVsTmFtZSBvZiByZWxhdGlvbnNoaXBzKSB7XG4gICAgICAgICAgcmVsc1tyZWxOYW1lXSA9IHt9XG4gICAgICAgIH1cbiAgICAgICAgZW50cnkucmVsYXRpb25zaGlwcyA9IHJlbHNcbiAgICAgIH1cblxuICAgICAgY29uc3QgYXR0YWNobWVudHMgPSByZXNvdXJjZUNvbmZpZ3VyYXRpb24uYXR0YWNobWVudHNcbiAgICAgIGlmIChhdHRhY2htZW50cyAmJiBPYmplY3Qua2V5cyhhdHRhY2htZW50cykubGVuZ3RoID4gMCkge1xuICAgICAgICBlbnRyeS5hdHRhY2htZW50cyA9IGF0dGFjaG1lbnRzXG4gICAgICB9XG5cbiAgICAgIGNvbnN0IGNvbGxlY3Rpb25Db21tYW5kcyA9IG1hbmlmZXN0Q29tbWFuZEVudHJpZXMoe1xuICAgICAgICBjb21tYW5kTWV0YWRhdGE6IHJlc291cmNlQ29uZmlndXJhdGlvbi5jb21tYW5kTWV0YWRhdGEgfHwge30sXG4gICAgICAgIGNvbW1hbmRzOiByZXNvdXJjZUNvbmZpZ3VyYXRpb24uY29sbGVjdGlvbkNvbW1hbmRzLFxuICAgICAgICByZXNvdXJjZVBhdGgsXG4gICAgICAgIHNjb3BlOiBcImNvbGxlY3Rpb25cIlxuICAgICAgfSlcbiAgICAgIGNvbnN0IG1lbWJlckNvbW1hbmRzID0gbWFuaWZlc3RDb21tYW5kRW50cmllcyh7XG4gICAgICAgIGNvbW1hbmRNZXRhZGF0YTogcmVzb3VyY2VDb25maWd1cmF0aW9uLmNvbW1hbmRNZXRhZGF0YSB8fCB7fSxcbiAgICAgICAgY29tbWFuZHM6IHJlc291cmNlQ29uZmlndXJhdGlvbi5tZW1iZXJDb21tYW5kcyxcbiAgICAgICAgcmVzb3VyY2VQYXRoLFxuICAgICAgICBzY29wZTogXCJtZW1iZXJcIlxuICAgICAgfSlcblxuICAgICAgaWYgKGNvbGxlY3Rpb25Db21tYW5kcy5sZW5ndGggPiAwIHx8IG1lbWJlckNvbW1hbmRzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCB1bmtub3duPn0gKi9cbiAgICAgICAgY29uc3QgY21kcyA9IHt9XG4gICAgICAgIGlmIChjb2xsZWN0aW9uQ29tbWFuZHMubGVuZ3RoID4gMCkgY21kc1tcImNvbGxlY3Rpb25cIl0gPSBjb2xsZWN0aW9uQ29tbWFuZHNcbiAgICAgICAgaWYgKG1lbWJlckNvbW1hbmRzLmxlbmd0aCA+IDApIGNtZHNbXCJtZW1iZXJcIl0gPSBtZW1iZXJDb21tYW5kc1xuICAgICAgICBlbnRyeS5jb21tYW5kcyA9IGNtZHNcbiAgICAgIH1cblxuICAgICAgaWYgKHJlc291cmNlQ29uZmlndXJhdGlvbi5zeW5jPy5lbmFibGVkKSB7XG4gICAgICAgIGVudHJ5LnN5bmMgPSByZXNvdXJjZUNvbmZpZ3VyYXRpb24uc3luY1xuICAgICAgfVxuXG4gICAgICByZXNvdXJjZXNbY29uZmlndXJlZE1vZGVsTmFtZV0gPSBlbnRyeVxuICAgIH1cbiAgfVxuXG4gIHJldHVybiB7XG4gICAgZm9ybWF0VmVyc2lvbjogMSxcbiAgICByZXNvdXJjZXM6IE9iamVjdC5rZXlzKHJlc291cmNlcykuc29ydCgpLnJlZHVjZSgoc29ydGVkLCBrZXkpID0+IHtcbiAgICAgIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgdW5rbm93bj59ICovIChzb3J0ZWQpW2tleV0gPSByZXNvdXJjZXNba2V5XVxuICAgICAgcmV0dXJuIHNvcnRlZFxuICAgIH0sIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgdW5rbm93bj59ICovICh7fSkpXG4gIH1cbn1cblxuLyoqXG4gKiBOb3JtYWxpemVzIHJlc291cmNlIGF0dHJpYnV0ZSBkZWZpbml0aW9ucyBpbnRvIGEgc29ydGVkIGFycmF5IG9mIHN0cmluZ3MuXG4gKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBhdHRyaWJ1dGVzIC0gUmF3IGF0dHJpYnV0ZXMgY29uZmlnIChhcnJheSBvciBvYmplY3QpLlxuICogQHJldHVybnMge3N0cmluZ1tdfSAtIFNvcnRlZCBhdHRyaWJ1dGUgbmFtZXMuXG4gKi9cbmZ1bmN0aW9uIG1hbmlmZXN0QXR0cmlidXRlcyhhdHRyaWJ1dGVzKSB7XG4gIGlmICghYXR0cmlidXRlcykgcmV0dXJuIFtdXG5cbiAgbGV0IG5hbWVzXG5cbiAgaWYgKEFycmF5LmlzQXJyYXkoYXR0cmlidXRlcykpIHtcbiAgICBuYW1lcyA9IGF0dHJpYnV0ZXMubWFwKChlbnRyeSkgPT4gdHlwZW9mIGVudHJ5ID09PSBcInN0cmluZ1wiID8gZW50cnkgOiBlbnRyeS5uYW1lKS5maWx0ZXIoQm9vbGVhbilcbiAgfSBlbHNlIGlmIChhdHRyaWJ1dGVzICYmIHR5cGVvZiBhdHRyaWJ1dGVzID09PSBcIm9iamVjdFwiKSB7XG4gICAgbmFtZXMgPSBPYmplY3Qua2V5cyhhdHRyaWJ1dGVzKVxuICB9IGVsc2Uge1xuICAgIHJldHVybiBbXVxuICB9XG5cbiAgcmV0dXJuIG5hbWVzLnNvcnQoKVxufVxuXG4vKipcbiAqIEJ1aWxkcyBtYW5pZmVzdC1zYWZlIGNvbW1hbmQgZW50cnkgbGlzdC5cbiAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gQXJndW1lbnRzLlxuICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCB7YXJnczogQXJyYXk8e25hbWU6IHN0cmluZywgdHlwZTogc3RyaW5nfT4sIHJldHVyblR5cGU6IHN0cmluZyB8IG51bGx9Pn0gYXJncy5jb21tYW5kTWV0YWRhdGEgLSBQZXItY29tbWFuZCBtZXRhZGF0YS5cbiAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgc3RyaW5nPn0gYXJncy5jb21tYW5kcyAtIE1ldGhvZCBuYW1lIOKGkiBrZWJhYiBzbHVnIG1hcC5cbiAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLnJlc291cmNlUGF0aCAtIFJlc291cmNlIHBhdGguXG4gKiBAcGFyYW0ge1wiY29sbGVjdGlvblwiIHwgXCJtZW1iZXJcIn0gYXJncy5zY29wZSAtIENvbW1hbmQgc2NvcGUuXG4gKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgdW5rbm93bj5bXX0gLSBNYW5pZmVzdCBjb21tYW5kIGVudHJpZXMuXG4gKi9cbmZ1bmN0aW9uIG1hbmlmZXN0Q29tbWFuZEVudHJpZXMoe2NvbW1hbmRNZXRhZGF0YSwgY29tbWFuZHMsIHJlc291cmNlUGF0aCwgc2NvcGV9KSB7XG4gIHJldHVybiBPYmplY3Qua2V5cyhjb21tYW5kcykuc29ydCgpLm1hcCgobWV0aG9kTmFtZSkgPT4ge1xuICAgIGNvbnN0IHNsdWcgPSBjb21tYW5kc1ttZXRob2ROYW1lXVxuICAgIGNvbnN0IG1ldGFkYXRhID0gY29tbWFuZE1ldGFkYXRhW21ldGhvZE5hbWVdIHx8IHthcmdzOiBbXSwgcmV0dXJuVHlwZTogbnVsbH1cbiAgICBjb25zdCBwYXRoID0gc2NvcGUgPT09IFwibWVtYmVyXCJcbiAgICAgID8gYCR7cmVzb3VyY2VQYXRofS88aWQ+LyR7c2x1Z31gXG4gICAgICA6IGAke3Jlc291cmNlUGF0aH0vJHtzbHVnfWBcblxuICAgIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgdW5rbm93bj59ICovXG4gICAgY29uc3QgZW50cnkgPSB7XG4gICAgICBtZXRob2ROYW1lLFxuICAgICAgc2NvcGUsXG4gICAgICBwYXRoLFxuICAgICAgYXJnczogbWV0YWRhdGEuYXJnc1xuICAgIH1cblxuICAgIGlmIChtZXRhZGF0YS5yZXR1cm5UeXBlKSB7XG4gICAgICBlbnRyeS5yZXR1cm5UeXBlID0gbWV0YWRhdGEucmV0dXJuVHlwZVxuICAgIH1cblxuICAgIHJldHVybiBlbnRyeVxuICB9KVxufVxuXG4vKipcbiAqIE5vcm1hbGl6ZXMgc3luYyBwb2xpY3kgbWV0YWRhdGEgYW5kIGNvbXB1dGVzIGEgZGV0ZXJtaW5pc3RpYyBoYXNoIGZyb20gc2FmZSBwb2xpY3kgaW5wdXRzLlxuICogQHBhcmFtIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkZyb250ZW5kTW9kZWxSZXNvdXJjZUNvbmZpZ3VyYXRpb259IHJlc291cmNlQ29uZmlndXJhdGlvbiAtIFJhdyByZXNvdXJjZSBjb25maWd1cmF0aW9uLlxuICogQHJldHVybnMge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuTm9ybWFsaXplZEZyb250ZW5kTW9kZWxSZXNvdXJjZVN5bmNDb25maWd1cmF0aW9uIHwgdW5kZWZpbmVkfSAtIEZyb250ZW5kLXNhZmUgc3luYyBtZXRhZGF0YS5cbiAqL1xuZnVuY3Rpb24gbm9ybWFsaXplRnJvbnRlbmRNb2RlbFJlc291cmNlU3luYyhyZXNvdXJjZUNvbmZpZ3VyYXRpb24pIHtcbiAgY29uc3Qgc3luYyA9IHJlc291cmNlQ29uZmlndXJhdGlvbi5zeW5jXG5cbiAgaWYgKHN5bmMgPT09IHVuZGVmaW5lZCB8fCBzeW5jID09PSBudWxsKSByZXR1cm4gdW5kZWZpbmVkXG4gIGlmIChzeW5jID09PSBmYWxzZSkgcmV0dXJuIHtjb25mbGljdFN0cmF0ZWd5OiBcIm9wdGltaXN0aWNWZXJzaW9uXCIsIGVuYWJsZWQ6IGZhbHNlLCBvcGVyYXRpb25zOiBbXSwgcG9saWN5SGFzaDogc3luY1BvbGljeUhhc2goe2NvbmZsaWN0U3RyYXRlZ3k6IFwib3B0aW1pc3RpY1ZlcnNpb25cIiwgZW5hYmxlZDogZmFsc2V9KSwgcG9saWN5VmVyc2lvbjogbnVsbH1cbiAgaWYgKHN5bmMgPT09IHRydWUpIHtcbiAgICByZXR1cm4gbm9ybWFsaXplRnJvbnRlbmRNb2RlbFJlc291cmNlU3luYyh7XG4gICAgICAuLi5yZXNvdXJjZUNvbmZpZ3VyYXRpb24sXG4gICAgICBzeW5jOiB7b3BlcmF0aW9uczogW1wiaW5kZXhcIiwgXCJmaW5kXCJdfVxuICAgIH0pXG4gIH1cbiAgaWYgKCFzeW5jIHx8IHR5cGVvZiBzeW5jICE9PSBcIm9iamVjdFwiIHx8IEFycmF5LmlzQXJyYXkoc3luYykpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXCJSZXNvdXJjZSBzeW5jIGNvbmZpZ3VyYXRpb24gbXVzdCBiZSB0cnVlLCBmYWxzZSwgb3IgYW4gb2JqZWN0LlwiKVxuICB9XG5cbiAgY29uc3Qge2NvbmZsaWN0U3RyYXRlZ3ksIGVuYWJsZWQgPSB0cnVlLCBtZXRhZGF0YSwgb3BlcmF0aW9ucywgcG9saWN5LCBwb2xpY3lWZXJzaW9uLCAuLi5yZXN0fSA9IC8qKiBAdHlwZSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Gcm9udGVuZE1vZGVsUmVzb3VyY2VTeW5jQ29uZmlndXJhdGlvbn0gKi8gKHN5bmMpXG5cbiAgaWYgKE9iamVjdC5rZXlzKHJlc3QpLmxlbmd0aCA+IDApIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYFVuZXhwZWN0ZWQgc3luYyBrZXlzOiAke09iamVjdC5rZXlzKHJlc3QpLmpvaW4oXCIsIFwiKX0uIEFsbG93ZWQ6IGNvbmZsaWN0U3RyYXRlZ3ksIGVuYWJsZWQsIG1ldGFkYXRhLCBvcGVyYXRpb25zLCBwb2xpY3ksIHBvbGljeVZlcnNpb25gKVxuICB9XG4gIGlmIChlbmFibGVkICE9PSB0cnVlICYmIGVuYWJsZWQgIT09IGZhbHNlKSB0aHJvdyBuZXcgRXJyb3IoXCJSZXNvdXJjZSBzeW5jIGVuYWJsZWQgbXVzdCBiZSB0cnVlIG9yIGZhbHNlIHdoZW4gcHJvdmlkZWQuXCIpXG5cbiAgY29uc3Qgbm9ybWFsaXplZENvbmZsaWN0U3RyYXRlZ3kgPSBub3JtYWxpemVTeW5jQ29uZmxpY3RTdHJhdGVneShjb25mbGljdFN0cmF0ZWd5KVxuICBjb25zdCBub3JtYWxpemVkT3BlcmF0aW9ucyA9IG5vcm1hbGl6ZVN5bmNPcGVyYXRpb25zKG9wZXJhdGlvbnMpXG4gIGNvbnN0IG5vcm1hbGl6ZWRNZXRhZGF0YSA9IG1ldGFkYXRhID09PSB1bmRlZmluZWQgPyB1bmRlZmluZWQgOiBkZXRlcm1pbmlzdGljU3luY0pzb24oe2xhYmVsOiBcIm1ldGFkYXRhXCIsIHZhbHVlOiBtZXRhZGF0YX0pXG4gIGNvbnN0IG5vcm1hbGl6ZWRQb2xpY3kgPSBwb2xpY3kgPT09IHVuZGVmaW5lZCA/IHVuZGVmaW5lZCA6IGRldGVybWluaXN0aWNTeW5jSnNvbih7bGFiZWw6IFwicG9saWN5XCIsIHZhbHVlOiBwb2xpY3l9KVxuICBjb25zdCBub3JtYWxpemVkUG9saWN5VmVyc2lvbiA9IHBvbGljeVZlcnNpb24gPT09IHVuZGVmaW5lZCB8fCBwb2xpY3lWZXJzaW9uID09PSBudWxsID8gbnVsbCA6IFN0cmluZyhwb2xpY3lWZXJzaW9uKVxuICBjb25zdCBoYXNoSW5wdXQgPSB7XG4gICAgY29uZmxpY3RTdHJhdGVneTogbm9ybWFsaXplZENvbmZsaWN0U3RyYXRlZ3ksXG4gICAgZW5hYmxlZCxcbiAgICBtZXRhZGF0YTogbm9ybWFsaXplZE1ldGFkYXRhLFxuICAgIG1vZGVsTmFtZTogcmVzb3VyY2VDb25maWd1cmF0aW9uLm1vZGVsTmFtZSB8fCBudWxsLFxuICAgIG9wZXJhdGlvbnM6IG5vcm1hbGl6ZWRPcGVyYXRpb25zLFxuICAgIHBvbGljeTogbm9ybWFsaXplZFBvbGljeSxcbiAgICBwb2xpY3lWZXJzaW9uOiBub3JtYWxpemVkUG9saWN5VmVyc2lvblxuICB9XG4gIC8qKiBAdHlwZSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Ob3JtYWxpemVkRnJvbnRlbmRNb2RlbFJlc291cmNlU3luY0NvbmZpZ3VyYXRpb259ICovXG4gIGNvbnN0IG5vcm1hbGl6ZWQgPSB7XG4gICAgY29uZmxpY3RTdHJhdGVneTogbm9ybWFsaXplZENvbmZsaWN0U3RyYXRlZ3ksXG4gICAgZW5hYmxlZCxcbiAgICBvcGVyYXRpb25zOiBub3JtYWxpemVkT3BlcmF0aW9ucyxcbiAgICBwb2xpY3lIYXNoOiBzeW5jUG9saWN5SGFzaChoYXNoSW5wdXQpLFxuICAgIHBvbGljeVZlcnNpb246IG5vcm1hbGl6ZWRQb2xpY3lWZXJzaW9uXG4gIH1cblxuICBpZiAobm9ybWFsaXplZE1ldGFkYXRhICE9PSB1bmRlZmluZWQpIG5vcm1hbGl6ZWQubWV0YWRhdGEgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIGltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRnJvbnRlbmRNb2RlbFN5bmNKc29uVmFsdWU+fSAqLyAobm9ybWFsaXplZE1ldGFkYXRhKVxuXG4gIHJldHVybiBub3JtYWxpemVkXG59XG5cbi8qKlxuICogTm9ybWFsaXplcyB0aGUgc3luYyBjb25mbGljdCBzdHJhdGVneSBmb3IgcmVwbGF5IGNsaWVudHMvc2VydmVycy5cbiAqIEBwYXJhbSB7dW5rbm93bn0gY29uZmxpY3RTdHJhdGVneSAtIFJhdyBzdHJhdGVneS5cbiAqIEByZXR1cm5zIHtcIm9wdGltaXN0aWNWZXJzaW9uXCIgfCBcInNlcnZlcldpbnNcIiB8IFwibGFzdFdyaXRlcldpbnNcIiB8IFwiZmllbGRUaHJlZVdheVwiIHwgXCJhcHBlbmRPbmx5XCJ9IC0gTm9ybWFsaXplZCBzdHJhdGVneS5cbiAqL1xuZnVuY3Rpb24gbm9ybWFsaXplU3luY0NvbmZsaWN0U3RyYXRlZ3koY29uZmxpY3RTdHJhdGVneSkge1xuICBpZiAoY29uZmxpY3RTdHJhdGVneSA9PT0gdW5kZWZpbmVkIHx8IGNvbmZsaWN0U3RyYXRlZ3kgPT09IG51bGwpIHJldHVybiBcIm9wdGltaXN0aWNWZXJzaW9uXCJcbiAgaWYgKFtcIm9wdGltaXN0aWNWZXJzaW9uXCIsIFwic2VydmVyV2luc1wiLCBcImxhc3RXcml0ZXJXaW5zXCIsIFwiZmllbGRUaHJlZVdheVwiLCBcImFwcGVuZE9ubHlcIl0uaW5jbHVkZXMoU3RyaW5nKGNvbmZsaWN0U3RyYXRlZ3kpKSkge1xuICAgIHJldHVybiAvKiogQHR5cGUge1wib3B0aW1pc3RpY1ZlcnNpb25cIiB8IFwic2VydmVyV2luc1wiIHwgXCJsYXN0V3JpdGVyV2luc1wiIHwgXCJmaWVsZFRocmVlV2F5XCIgfCBcImFwcGVuZE9ubHlcIn0gKi8gKGNvbmZsaWN0U3RyYXRlZ3kpXG4gIH1cblxuICB0aHJvdyBuZXcgRXJyb3IoYFVua25vd24gcmVzb3VyY2Ugc3luYyBjb25mbGljdFN0cmF0ZWd5OiAke1N0cmluZyhjb25mbGljdFN0cmF0ZWd5KX1gKVxufVxuXG4vKipcbiAqIE5vcm1hbGl6ZXMgc3luYyBvcGVyYXRpb25zIGludG8gYSBzdGFibGUsIGR1cGxpY2F0ZS1mcmVlIGxpc3QuXG4gKiBAcGFyYW0ge3Vua25vd259IG9wZXJhdGlvbnMgLSBSYXcgb3BlcmF0aW9ucyB2YWx1ZS5cbiAqIEByZXR1cm5zIHtzdHJpbmdbXX0gLSBOb3JtYWxpemVkIG9wZXJhdGlvbnMuXG4gKi9cbmZ1bmN0aW9uIG5vcm1hbGl6ZVN5bmNPcGVyYXRpb25zKG9wZXJhdGlvbnMpIHtcbiAgaWYgKG9wZXJhdGlvbnMgPT09IHVuZGVmaW5lZCkgcmV0dXJuIFtdXG4gIGlmICghQXJyYXkuaXNBcnJheShvcGVyYXRpb25zKSkgdGhyb3cgbmV3IEVycm9yKFwiUmVzb3VyY2Ugc3luYyBvcGVyYXRpb25zIG11c3QgYmUgYW4gYXJyYXkgb2Ygb3BlcmF0aW9uIG5hbWVzLlwiKVxuXG4gIGNvbnN0IG5vcm1hbGl6ZWQgPSBvcGVyYXRpb25zLm1hcCgob3BlcmF0aW9uKSA9PiB7XG4gICAgaWYgKHR5cGVvZiBvcGVyYXRpb24gIT09IFwic3RyaW5nXCIgfHwgb3BlcmF0aW9uLmxlbmd0aCA8IDEpIHRocm93IG5ldyBFcnJvcihcIlJlc291cmNlIHN5bmMgb3BlcmF0aW9ucyBlbnRyaWVzIG11c3QgYmUgbm9uLWVtcHR5IHN0cmluZ3MuXCIpXG5cbiAgICByZXR1cm4gb3BlcmF0aW9uXG4gIH0pXG5cbiAgcmV0dXJuIFsuLi5uZXcgU2V0KG5vcm1hbGl6ZWQpXS5zb3J0KClcbn1cblxuLyoqXG4gKiBCdWlsZHMgYSBkZXRlcm1pbmlzdGljIHBvbGljeSBoYXNoLlxuICogQHBhcmFtIHt1bmtub3dufSB2YWx1ZSAtIEhhc2ggaW5wdXQuXG4gKiBAcmV0dXJucyB7c3RyaW5nfSAtIHNoYTI1Ni1wcmVmaXhlZCBoYXNoLlxuICovXG5mdW5jdGlvbiBzeW5jUG9saWN5SGFzaCh2YWx1ZSkge1xuICByZXR1cm4gYHNoYTI1Ni0ke3NoYTI1NkhleChzdGFibGVKc29uU3RyaW5naWZ5KHZhbHVlKSl9YFxufVxuXG4vKipcbiAqIFZhbGlkYXRlcyB0aGF0IGEgc3luYyBjb25maWcgc3VidHJlZSBpcyBkZXRlcm1pbmlzdGljIEpTT04gYW5kIGRvZXMgbm90IGNvbnRhaW4gb2J2aW91cyBzZWNyZXRzLlxuICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBBcmd1bWVudHMuXG4gKiBAcGFyYW0ge3N0cmluZ30gYXJncy5sYWJlbCAtIERpYWdub3N0aWMgcGF0aCBsYWJlbC5cbiAqIEBwYXJhbSB7dW5rbm93bn0gYXJncy52YWx1ZSAtIFZhbHVlIHRvIHZhbGlkYXRlLlxuICogQHJldHVybnMge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRnJvbnRlbmRNb2RlbFN5bmNKc29uVmFsdWV9IC0gU3RhYmxlIEpTT04gdmFsdWUuXG4gKi9cbmZ1bmN0aW9uIGRldGVybWluaXN0aWNTeW5jSnNvbih7bGFiZWwsIHZhbHVlfSkge1xuICBpZiAodmFsdWUgPT09IG51bGwgfHwgdHlwZW9mIHZhbHVlID09PSBcInN0cmluZ1wiIHx8IHR5cGVvZiB2YWx1ZSA9PT0gXCJudW1iZXJcIiB8fCB0eXBlb2YgdmFsdWUgPT09IFwiYm9vbGVhblwiKSByZXR1cm4gdmFsdWVcblxuICBpZiAoQXJyYXkuaXNBcnJheSh2YWx1ZSkpIHtcbiAgICByZXR1cm4gdmFsdWUubWFwKChlbnRyeSwgaW5kZXgpID0+IGRldGVybWluaXN0aWNTeW5jSnNvbih7bGFiZWw6IGAke2xhYmVsfS8ke2luZGV4fWAsIHZhbHVlOiBlbnRyeX0pKVxuICB9XG5cbiAgaWYgKHZhbHVlICYmIHR5cGVvZiB2YWx1ZSA9PT0gXCJvYmplY3RcIiAmJiBPYmplY3QuZ2V0UHJvdG90eXBlT2YodmFsdWUpID09PSBPYmplY3QucHJvdG90eXBlKSB7XG4gICAgLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkZyb250ZW5kTW9kZWxTeW5jSnNvblZhbHVlPn0gKi9cbiAgICBjb25zdCBub3JtYWxpemVkID0ge31cblxuICAgIGZvciAoY29uc3Qga2V5IG9mIE9iamVjdC5rZXlzKHZhbHVlKS5zb3J0KCkpIHtcbiAgICAgIGNvbnN0IGNoaWxkVmFsdWUgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIHVua25vd24+fSAqLyAodmFsdWUpW2tleV1cblxuICAgICAgaWYgKGNoaWxkVmFsdWUgPT09IHVuZGVmaW5lZCkgY29udGludWVcbiAgICAgIGlmIChzeW5jQ29uZmlnS2V5TG9va3NTZWNyZXQoa2V5KSkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYFN5bmMgcG9saWN5ICR7bGFiZWx9LyR7a2V5fSBpcyBub3QgYWxsb3dlZCBpbiBmcm9udGVuZC12aXNpYmxlIHN5bmMgcG9saWN5IGNvbmZpZ2ApXG4gICAgICB9XG5cbiAgICAgIG5vcm1hbGl6ZWRba2V5XSA9IGRldGVybWluaXN0aWNTeW5jSnNvbih7bGFiZWw6IGAke2xhYmVsfS8ke2tleX1gLCB2YWx1ZTogY2hpbGRWYWx1ZX0pXG4gICAgfVxuXG4gICAgcmV0dXJuIG5vcm1hbGl6ZWRcbiAgfVxuXG4gIHRocm93IG5ldyBFcnJvcihcIlN5bmMgcG9saWN5IGlucHV0IG11c3QgYmUgZGV0ZXJtaW5pc3RpYyBKU09OXCIpXG59XG5cbi8qKlxuICogU3RhYmxlIEpTT04gc3RyaW5naWZpZXIgd2l0aCBzb3J0ZWQgb2JqZWN0IGtleXMuXG4gKiBAcGFyYW0ge3Vua25vd259IHZhbHVlIC0gVmFsdWUgdG8gc3RyaW5naWZ5LlxuICogQHJldHVybnMge3N0cmluZ30gLSBTdGFibGUgSlNPTi5cbiAqL1xuZnVuY3Rpb24gc3RhYmxlSnNvblN0cmluZ2lmeSh2YWx1ZSkge1xuICByZXR1cm4gSlNPTi5zdHJpbmdpZnkoZGV0ZXJtaW5pc3RpY1N5bmNKc29uKHtsYWJlbDogXCJoYXNoXCIsIHZhbHVlfSkpXG59XG5cbi8qKlxuICogUmV0dXJucyB3aGV0aGVyIGEgc3luYyBjb25maWcga2V5IGxvb2tzIGxpa2UgYSBjcmVkZW50aWFsL3NlY3JldC5cbiAqIEBwYXJhbSB7c3RyaW5nfSBrZXkgLSBPYmplY3Qga2V5LlxuICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciBrZXkgaXMgZGlzYWxsb3dlZC5cbiAqL1xuZnVuY3Rpb24gc3luY0NvbmZpZ0tleUxvb2tzU2VjcmV0KGtleSkge1xuICByZXR1cm4gL3NlY3JldHx0b2tlbnxwYXNzd29yZHxwcml2YXRlLj9rZXl8c2lnbmluZy4/a2V5L2kudGVzdChrZXkpXG59XG5cbi8qKlxuICogUnVucyBub3JtYWxpemUgZnJvbnRlbmQgbW9kZWwgcmVzb3VyY2UgY29tbWFuZHMuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRnJvbnRlbmRNb2RlbFJlc291cmNlQ29uZmlndXJhdGlvbn0gcmVzb3VyY2VDb25maWd1cmF0aW9uIC0gUmF3IHJlc291cmNlIGNvbmZpZ3VyYXRpb24uXG4gKiBAcmV0dXJucyB7e2J1aWx0SW5Db2xsZWN0aW9uQ29tbWFuZHM6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4sIGJ1aWx0SW5NZW1iZXJDb21tYW5kczogUmVjb3JkPHN0cmluZywgc3RyaW5nPiwgY29sbGVjdGlvbkNvbW1hbmRzOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+LCBjb21tYW5kTWV0YWRhdGE6IFJlY29yZDxzdHJpbmcsIHthcmdzOiBBcnJheTx7bmFtZTogc3RyaW5nLCB0eXBlOiBzdHJpbmd9PiwgcmV0dXJuVHlwZTogc3RyaW5nIHwgbnVsbH0+LCBtZW1iZXJDb21tYW5kczogUmVjb3JkPHN0cmluZywgc3RyaW5nPn19IC0gTm9ybWFsaXplZCBjb21tYW5kIGNvbmZpZ3VyYXRpb24uXG4gKi9cbmZ1bmN0aW9uIG5vcm1hbGl6ZUZyb250ZW5kTW9kZWxSZXNvdXJjZUNvbW1hbmRzKHJlc291cmNlQ29uZmlndXJhdGlvbikge1xuICBjb25zdCBidWlsdEluQ29sbGVjdGlvbkNvbW1hbmRzID0gcmVzb3VyY2VDb25maWd1cmF0aW9uLmJ1aWx0SW5Db2xsZWN0aW9uQ29tbWFuZHNcbiAgY29uc3QgYnVpbHRJbk1lbWJlckNvbW1hbmRzID0gcmVzb3VyY2VDb25maWd1cmF0aW9uLmJ1aWx0SW5NZW1iZXJDb21tYW5kc1xuICBjb25zdCBjdXN0b21Db2xsZWN0aW9uQ29tbWFuZHMgPSByZXNvdXJjZUNvbmZpZ3VyYXRpb24uY29sbGVjdGlvbkNvbW1hbmRzXG4gIGNvbnN0IGN1c3RvbU1lbWJlckNvbW1hbmRzID0gcmVzb3VyY2VDb25maWd1cmF0aW9uLm1lbWJlckNvbW1hbmRzXG4gIGNvbnN0IG5vcm1hbGl6ZWRCdWlsdEluQ29sbGVjdGlvbkNvbW1hbmRzID0gbm9ybWFsaXplRnJvbnRlbmRNb2RlbEJ1aWx0SW5Db21tYW5kcyh7XG4gICAgY29tbWFuZERlZmF1bHRzOiB7XG4gICAgICBjcmVhdGU6IFwiY3JlYXRlXCIsXG4gICAgICBpbmRleDogXCJpbmRleFwiXG4gICAgfSxcbiAgICBjb21tYW5kc0NvbmZpZzogYnVpbHRJbkNvbGxlY3Rpb25Db21tYW5kcyxcbiAgICBtb2RlbE5hbWU6IFwiQ29sbGVjdGlvbkNvbW1hbmRcIlxuICB9KVxuICBjb25zdCBub3JtYWxpemVkQnVpbHRJbk1lbWJlckNvbW1hbmRzID0gbm9ybWFsaXplRnJvbnRlbmRNb2RlbEJ1aWx0SW5Db21tYW5kcyh7XG4gICAgY29tbWFuZERlZmF1bHRzOiB7XG4gICAgICBhdHRhY2g6IFwiYXR0YWNoXCIsXG4gICAgICBhdHRhY2htZW50TGlzdDogXCJhdHRhY2htZW50TGlzdFwiLFxuICAgICAgZGVzdHJveTogXCJkZXN0cm95XCIsXG4gICAgICBkb3dubG9hZDogXCJkb3dubG9hZFwiLFxuICAgICAgZmluZDogXCJmaW5kXCIsXG4gICAgICB1cGRhdGU6IFwidXBkYXRlXCIsXG4gICAgICB1cmw6IFwidXJsXCJcbiAgICB9LFxuICAgIGNvbW1hbmRzQ29uZmlnOiBidWlsdEluTWVtYmVyQ29tbWFuZHMsXG4gICAgbW9kZWxOYW1lOiBcIk1lbWJlckNvbW1hbmRcIlxuICB9KVxuXG4gIGNvbnN0IG5vcm1hbGl6ZWRDb2xsZWN0aW9uQ29tbWFuZHMgPSBub3JtYWxpemVGcm9udGVuZE1vZGVsQ3VzdG9tQ29tbWFuZHMoe2NvbW1hbmRzQ29uZmlnOiBjdXN0b21Db2xsZWN0aW9uQ29tbWFuZHMsIG1vZGVsTmFtZTogXCJDb2xsZWN0aW9uQ29tbWFuZFwifSlcbiAgY29uc3Qgbm9ybWFsaXplZE1lbWJlckNvbW1hbmRzID0gbm9ybWFsaXplRnJvbnRlbmRNb2RlbEN1c3RvbUNvbW1hbmRzKHtjb21tYW5kc0NvbmZpZzogY3VzdG9tTWVtYmVyQ29tbWFuZHMsIG1vZGVsTmFtZTogXCJNZW1iZXJDb21tYW5kXCJ9KVxuXG4gIHJldHVybiB7XG4gICAgYnVpbHRJbkNvbGxlY3Rpb25Db21tYW5kczogbm9ybWFsaXplZEJ1aWx0SW5Db2xsZWN0aW9uQ29tbWFuZHMsXG4gICAgYnVpbHRJbk1lbWJlckNvbW1hbmRzOiBub3JtYWxpemVkQnVpbHRJbk1lbWJlckNvbW1hbmRzLFxuICAgIGNvbGxlY3Rpb25Db21tYW5kczogbm9ybWFsaXplZENvbGxlY3Rpb25Db21tYW5kcy5jb21tYW5kcyxcbiAgICBjb21tYW5kTWV0YWRhdGE6IHsuLi5ub3JtYWxpemVkQ29sbGVjdGlvbkNvbW1hbmRzLm1ldGFkYXRhLCAuLi5ub3JtYWxpemVkTWVtYmVyQ29tbWFuZHMubWV0YWRhdGF9LFxuICAgIG1lbWJlckNvbW1hbmRzOiBub3JtYWxpemVkTWVtYmVyQ29tbWFuZHMuY29tbWFuZHNcbiAgfVxufVxuXG4vKipcbiAqIFJ1bnMgbm9ybWFsaXplIGZyb250ZW5kIG1vZGVsIGJ1aWx0IGluIGNvbW1hbmRzLlxuICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBBcmd1bWVudHMuXG4gKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIHN0cmluZz59IGFyZ3MuY29tbWFuZERlZmF1bHRzIC0gQnVpbHQtaW4gZGVmYXVsdCBjb21tYW5kIG5hbWVzLlxuICogQHBhcmFtIHtzdHJpbmdbXSB8IHVuZGVmaW5lZH0gYXJncy5jb21tYW5kc0NvbmZpZyAtIEJ1aWx0LWluIGNvbW1hbmRzIGNvbmZpZyAoY2FtZWxDYXNlIGNvbW1hbmQgdHlwZSBsaXN0KS5cbiAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLm1vZGVsTmFtZSAtIERpYWdub3N0aWMgbW9kZWwgbmFtZS5cbiAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+fSAtIE5vcm1hbGl6ZWQgYnVpbHQtaW4gY29tbWFuZCBjb25maWcuXG4gKi9cbmZ1bmN0aW9uIG5vcm1hbGl6ZUZyb250ZW5kTW9kZWxCdWlsdEluQ29tbWFuZHMoe2NvbW1hbmREZWZhdWx0cywgY29tbWFuZHNDb25maWcsIG1vZGVsTmFtZX0pIHtcbiAgaWYgKCFjb21tYW5kc0NvbmZpZykge1xuICAgIHJldHVybiBjb21tYW5kRGVmYXVsdHNcbiAgfVxuXG4gIGlmICghQXJyYXkuaXNBcnJheShjb21tYW5kc0NvbmZpZykpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYCR7bW9kZWxOYW1lfSBjb25maWd1cmF0aW9uIG11c3QgdXNlIHRoZSBhcnJheSBmb3JtLiBPYmplY3QgZm9ybSBpcyBubyBsb25nZXIgc3VwcG9ydGVkLmApXG4gIH1cblxuICAvKipcbiAgICogTm9ybWFsaXplZCBjb21tYW5kcy5cbiAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIHN0cmluZz59ICovXG4gIGNvbnN0IG5vcm1hbGl6ZWRDb21tYW5kcyA9IHt9XG5cbiAgZm9yIChjb25zdCBjb21tYW5kVHlwZSBvZiBjb21tYW5kc0NvbmZpZykge1xuICAgIGNvbnN0IGRlZmF1bHRDb21tYW5kTmFtZSA9IGNvbW1hbmREZWZhdWx0c1tjb21tYW5kVHlwZV1cblxuICAgIGlmICghZGVmYXVsdENvbW1hbmROYW1lKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYFVua25vd24gYnVpbHQtaW4gZnJvbnRlbmQgbW9kZWwgY29tbWFuZCAnJHtjb21tYW5kVHlwZX0nIGZvciAke21vZGVsTmFtZX1gKVxuICAgIH1cblxuICAgIG5vcm1hbGl6ZWRDb21tYW5kc1tjb21tYW5kVHlwZV0gPSB2YWxpZGF0ZUZyb250ZW5kTW9kZWxSZXNvdXJjZUNvbW1hbmROYW1lKHtcbiAgICAgIGNvbW1hbmROYW1lOiBkZWZhdWx0Q29tbWFuZE5hbWUsXG4gICAgICBjb21tYW5kVHlwZTogZGVmYXVsdENvbW1hbmROYW1lLFxuICAgICAgbW9kZWxOYW1lXG4gICAgfSlcbiAgfVxuXG4gIHJldHVybiBub3JtYWxpemVkQ29tbWFuZHNcbn1cblxuLyoqXG4gKiBSdW5zIG5vcm1hbGl6ZSBmcm9udGVuZCBtb2RlbCBjdXN0b20gY29tbWFuZHMuIEVudHJpZXMgYXJlIGVpdGhlciBhIHBsYWluXG4gKiBjYW1lbENhc2UgbWV0aG9kLW5hbWUgc3RyaW5nIG9yIGEgYHtuYW1lLCBhcmdzPywgcmV0dXJuVHlwZT99YCBvYmplY3QgdGhhdFxuICogYWxzbyBkZWNsYXJlcyB0aGUgY29tbWFuZCdzIHR5cGVkIGFyZ3VtZW50cyBhbmQvb3IgcmVzcG9uc2UgdHlwZS5cbiAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gQXJndW1lbnRzLlxuICogQHBhcmFtIHtBcnJheTxzdHJpbmcgfCB7bmFtZTogc3RyaW5nLCBhcmdzPzogQXJyYXk8e25hbWU6IHN0cmluZywgdHlwZTogc3RyaW5nfT4sIHJldHVyblR5cGU/OiBzdHJpbmd9PiB8IHVuZGVmaW5lZH0gYXJncy5jb21tYW5kc0NvbmZpZyAtIEN1c3RvbSBjb21tYW5kcyBjb25maWcuXG4gKiBAcGFyYW0ge3N0cmluZ30gYXJncy5tb2RlbE5hbWUgLSBEaWFnbm9zdGljIG1vZGVsIG5hbWUuXG4gKiBAcmV0dXJucyB7e2NvbW1hbmRzOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+LCBtZXRhZGF0YTogUmVjb3JkPHN0cmluZywge2FyZ3M6IEFycmF5PHtuYW1lOiBzdHJpbmcsIHR5cGU6IHN0cmluZ30+LCByZXR1cm5UeXBlOiBzdHJpbmcgfCBudWxsfT59fSAtIFJvdXRlIG1hcCAobWV0aG9kIG5hbWUg4oaSIGtlYmFiIHNsdWcpICsgcGVyLWNvbW1hbmQgbWV0YWRhdGEuXG4gKi9cbmZ1bmN0aW9uIG5vcm1hbGl6ZUZyb250ZW5kTW9kZWxDdXN0b21Db21tYW5kcyh7Y29tbWFuZHNDb25maWcsIG1vZGVsTmFtZX0pIHtcbiAgaWYgKCFjb21tYW5kc0NvbmZpZykge1xuICAgIHJldHVybiB7Y29tbWFuZHM6IHt9LCBtZXRhZGF0YToge319XG4gIH1cblxuICBpZiAoIUFycmF5LmlzQXJyYXkoY29tbWFuZHNDb25maWcpKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGAke21vZGVsTmFtZX0gY29uZmlndXJhdGlvbiBtdXN0IHVzZSB0aGUgYXJyYXkgZm9ybS4gT2JqZWN0IGZvcm0gaXMgbm8gbG9uZ2VyIHN1cHBvcnRlZC5gKVxuICB9XG5cbiAgLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+fSAqL1xuICBjb25zdCBjb21tYW5kcyA9IHt9XG4gIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywge2FyZ3M6IEFycmF5PHtuYW1lOiBzdHJpbmcsIHR5cGU6IHN0cmluZ30+LCByZXR1cm5UeXBlOiBzdHJpbmcgfCBudWxsfT59ICovXG4gIGNvbnN0IG1ldGFkYXRhID0ge31cblxuICBmb3IgKGNvbnN0IGNvbW1hbmRFbnRyeSBvZiBjb21tYW5kc0NvbmZpZykge1xuICAgIGNvbnN0IHttZXRob2ROYW1lLCBhcmdzLCByZXR1cm5UeXBlfSA9IG5vcm1hbGl6ZUZyb250ZW5kTW9kZWxDdXN0b21Db21tYW5kRW50cnkoe2NvbW1hbmRFbnRyeSwgbW9kZWxOYW1lfSlcbiAgICBjb25zdCB2YWxpZGF0ZWRNZXRob2ROYW1lID0gdmFsaWRhdGVGcm9udGVuZE1vZGVsUmVzb3VyY2VDb21tYW5kTmFtZSh7XG4gICAgICBjb21tYW5kTmFtZTogbWV0aG9kTmFtZSxcbiAgICAgIGNvbW1hbmRUeXBlOiBtZXRob2ROYW1lLFxuICAgICAgbW9kZWxOYW1lXG4gICAgfSlcbiAgICBjb25zdCBjb21tYW5kU2x1ZyA9IGluZmxlY3Rpb24uZGFzaGVyaXplKGluZmxlY3Rpb24udW5kZXJzY29yZSh2YWxpZGF0ZWRNZXRob2ROYW1lKSlcblxuICAgIGNvbW1hbmRzW3ZhbGlkYXRlZE1ldGhvZE5hbWVdID0gY29tbWFuZFNsdWdcbiAgICBtZXRhZGF0YVt2YWxpZGF0ZWRNZXRob2ROYW1lXSA9IHthcmdzLCByZXR1cm5UeXBlfVxuICB9XG5cbiAgcmV0dXJuIHtjb21tYW5kcywgbWV0YWRhdGF9XG59XG5cbi8qKlxuICogTm9ybWFsaXplcyBvbmUgY3VzdG9tLWNvbW1hbmQgZW50cnkgKHN0cmluZyBzaG9ydGhhbmQgb3IgY29udHJhY3Qgb2JqZWN0KS5cbiAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gQXJndW1lbnRzLlxuICogQHBhcmFtIHt1bmtub3dufSBhcmdzLmNvbW1hbmRFbnRyeSAtIFJhdyBjb21tYW5kIGVudHJ5LlxuICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MubW9kZWxOYW1lIC0gRGlhZ25vc3RpYyBtb2RlbCBuYW1lLlxuICogQHJldHVybnMge3ttZXRob2ROYW1lOiBzdHJpbmcsIGFyZ3M6IEFycmF5PHtuYW1lOiBzdHJpbmcsIHR5cGU6IHN0cmluZ30+LCByZXR1cm5UeXBlOiBzdHJpbmcgfCBudWxsfX0gLSBNZXRob2QgbmFtZSArIG1ldGFkYXRhLlxuICovXG5mdW5jdGlvbiBub3JtYWxpemVGcm9udGVuZE1vZGVsQ3VzdG9tQ29tbWFuZEVudHJ5KHtjb21tYW5kRW50cnksIG1vZGVsTmFtZX0pIHtcbiAgaWYgKHR5cGVvZiBjb21tYW5kRW50cnkgPT09IFwic3RyaW5nXCIpIHtcbiAgICByZXR1cm4ge21ldGhvZE5hbWU6IGNvbW1hbmRFbnRyeSwgYXJnczogW10sIHJldHVyblR5cGU6IG51bGx9XG4gIH1cblxuICBpZiAoIWNvbW1hbmRFbnRyeSB8fCB0eXBlb2YgY29tbWFuZEVudHJ5ICE9PSBcIm9iamVjdFwiIHx8IEFycmF5LmlzQXJyYXkoY29tbWFuZEVudHJ5KSkge1xuICAgIHRocm93IG5ldyBFcnJvcihgJHttb2RlbE5hbWV9IGVudHJpZXMgbXVzdCBiZSBhIGNhbWVsQ2FzZSBuYW1lIHN0cmluZyBvciBhIHtuYW1lLCBhcmdzPywgcmV0dXJuVHlwZT99IG9iamVjdGApXG4gIH1cblxuICBjb25zdCB7bmFtZSwgYXJncywgcmV0dXJuVHlwZSwgLi4ucmVzdH0gPSAvKiogQHR5cGUge3tuYW1lPzogdW5rbm93biwgYXJncz86IHVua25vd24sIHJldHVyblR5cGU/OiB1bmtub3dufX0gKi8gKGNvbW1hbmRFbnRyeSlcblxuICBpZiAoT2JqZWN0LmtleXMocmVzdCkubGVuZ3RoID4gMCkge1xuICAgIHRocm93IG5ldyBFcnJvcihgVW5leHBlY3RlZCAke21vZGVsTmFtZX0ga2V5czogJHtPYmplY3Qua2V5cyhyZXN0KS5qb2luKFwiLCBcIil9LiBBbGxvd2VkOiBuYW1lLCBhcmdzLCByZXR1cm5UeXBlYClcbiAgfVxuXG4gIGlmICh0eXBlb2YgbmFtZSAhPT0gXCJzdHJpbmdcIiB8fCBuYW1lLmxlbmd0aCA8IDEpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYCR7bW9kZWxOYW1lfSBvYmplY3QgZW50cmllcyByZXF1aXJlIGEgbm9uLWVtcHR5ICduYW1lJyBzdHJpbmdgKVxuICB9XG5cbiAgcmV0dXJuIHtcbiAgICBtZXRob2ROYW1lOiBuYW1lLFxuICAgIGFyZ3M6IG5vcm1hbGl6ZUZyb250ZW5kTW9kZWxDb21tYW5kQXJncyh7YXJncywgY29tbWFuZE5hbWU6IG5hbWUsIG1vZGVsTmFtZX0pLFxuICAgIHJldHVyblR5cGU6IG5vcm1hbGl6ZUZyb250ZW5kTW9kZWxDb21tYW5kUmV0dXJuVHlwZSh7Y29tbWFuZE5hbWU6IG5hbWUsIG1vZGVsTmFtZSwgcmV0dXJuVHlwZX0pXG4gIH1cbn1cblxuLyoqXG4gKiBWYWxpZGF0ZXMgYW5kIG5vcm1hbGl6ZXMgYSBjdXN0b20gY29tbWFuZCdzIHR5cGVkLWFyZ3VtZW50IGxpc3QuXG4gKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEFyZ3VtZW50cy5cbiAqIEBwYXJhbSB7dW5rbm93bn0gYXJncy5hcmdzIC0gUmF3IGNvbW1hbmQgYXJncy5cbiAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmNvbW1hbmROYW1lIC0gQ29tbWFuZCBuYW1lIGZvciBkaWFnbm9zdGljcy5cbiAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLm1vZGVsTmFtZSAtIERpYWdub3N0aWMgbW9kZWwgbmFtZS5cbiAqIEByZXR1cm5zIHtBcnJheTx7bmFtZTogc3RyaW5nLCB0eXBlOiBzdHJpbmd9Pn0gLSBOb3JtYWxpemVkIHR5cGVkIGNvbW1hbmQgYXJndW1lbnRzLlxuICovXG5mdW5jdGlvbiBub3JtYWxpemVGcm9udGVuZE1vZGVsQ29tbWFuZEFyZ3Moe2FyZ3MsIGNvbW1hbmROYW1lLCBtb2RlbE5hbWV9KSB7XG4gIGlmIChhcmdzID09PSB1bmRlZmluZWQgfHwgYXJncyA9PT0gbnVsbCkge1xuICAgIHJldHVybiBbXVxuICB9XG5cbiAgaWYgKCFBcnJheS5pc0FycmF5KGFyZ3MpKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGAke21vZGVsTmFtZX0gJyR7Y29tbWFuZE5hbWV9JyBhcmdzIG11c3QgYmUgYW4gYXJyYXkgb2Yge25hbWUsIHR5cGV9IG9iamVjdHNgKVxuICB9XG5cbiAgcmV0dXJuIGFyZ3MubWFwKChhcmcpID0+IHtcbiAgICBpZiAoIWFyZyB8fCB0eXBlb2YgYXJnICE9PSBcIm9iamVjdFwiIHx8IHR5cGVvZiBhcmcubmFtZSAhPT0gXCJzdHJpbmdcIiB8fCBhcmcubmFtZS5sZW5ndGggPCAxIHx8IHR5cGVvZiBhcmcudHlwZSAhPT0gXCJzdHJpbmdcIiB8fCBhcmcudHlwZS50cmltKCkubGVuZ3RoIDwgMSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGAke21vZGVsTmFtZX0gJyR7Y29tbWFuZE5hbWV9JyBhcmdzIGVudHJpZXMgcmVxdWlyZSBub24tZW1wdHkgJ25hbWUnIGFuZCBKU0RvYy10eXBlICd0eXBlJyBzdHJpbmdzYClcbiAgICB9XG5cbiAgICByZXR1cm4ge25hbWU6IGFyZy5uYW1lLCB0eXBlOiBhcmcudHlwZS50cmltKCl9XG4gIH0pXG59XG5cbi8qKlxuICogVmFsaWRhdGVzIGFuZCBub3JtYWxpemVzIGEgY3VzdG9tIGNvbW1hbmQncyBkZWNsYXJlZCBKU0RvYyByZXR1cm4gdHlwZS5cbiAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gQXJndW1lbnRzLlxuICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MuY29tbWFuZE5hbWUgLSBDb21tYW5kIG5hbWUgZm9yIGRpYWdub3N0aWNzLlxuICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MubW9kZWxOYW1lIC0gRGlhZ25vc3RpYyBtb2RlbCBuYW1lLlxuICogQHBhcmFtIHt1bmtub3dufSBhcmdzLnJldHVyblR5cGUgLSBSYXcgcmV0dXJuIHR5cGUuXG4gKiBAcmV0dXJucyB7c3RyaW5nIHwgbnVsbH0gLSBOb3JtYWxpemVkIEpTRG9jIHJldHVybiB0eXBlLlxuICovXG5mdW5jdGlvbiBub3JtYWxpemVGcm9udGVuZE1vZGVsQ29tbWFuZFJldHVyblR5cGUoe2NvbW1hbmROYW1lLCBtb2RlbE5hbWUsIHJldHVyblR5cGV9KSB7XG4gIGlmIChyZXR1cm5UeXBlID09PSB1bmRlZmluZWQgfHwgcmV0dXJuVHlwZSA9PT0gbnVsbCkge1xuICAgIHJldHVybiBudWxsXG4gIH1cblxuICBpZiAodHlwZW9mIHJldHVyblR5cGUgIT09IFwic3RyaW5nXCIgfHwgcmV0dXJuVHlwZS50cmltKCkubGVuZ3RoIDwgMSkge1xuICAgIHRocm93IG5ldyBFcnJvcihgJHttb2RlbE5hbWV9ICcke2NvbW1hbmROYW1lfScgcmV0dXJuVHlwZSBtdXN0IGJlIGEgbm9uLWVtcHR5IEpTRG9jIHR5cGUgc3RyaW5nYClcbiAgfVxuXG4gIHJldHVybiByZXR1cm5UeXBlLnRyaW0oKVxufVxuXG4vKipcbiAqIFJ1bnMgdGhlIGZyb250ZW5kTW9kZWxSZXNvdXJjZVBhdGggaGVscGVyLlxuICogQHBhcmFtIHtzdHJpbmd9IG1vZGVsTmFtZSAtIE1vZGVsIGNsYXNzIG5hbWUuXG4gKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSByZXNvdXJjZURlZmluaXRpb24gLSBSZXNvdXJjZSBkZWZpbml0aW9uLlxuICogQHJldHVybnMge3N0cmluZ30gLSBOb3JtYWxpemVkIHJlc291cmNlIHBhdGguXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBmcm9udGVuZE1vZGVsUmVzb3VyY2VQYXRoKG1vZGVsTmFtZSwgcmVzb3VyY2VEZWZpbml0aW9uKSB7XG4gIGNvbnN0IHJlc291cmNlQ29uZmlndXJhdGlvbiA9IGZyb250ZW5kTW9kZWxSZXNvdXJjZUNvbmZpZ3VyYXRpb25Gcm9tRGVmaW5pdGlvbihyZXNvdXJjZURlZmluaXRpb24pXG5cbiAgaWYgKCFyZXNvdXJjZUNvbmZpZ3VyYXRpb24pIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYEludmFsaWQgZnJvbnRlbmQgbW9kZWwgcmVzb3VyY2UgZGVmaW5pdGlvbiBmb3IgJHttb2RlbE5hbWV9YClcbiAgfVxuXG4gIHJldHVybiBgLyR7aW5mbGVjdGlvbi5kYXNoZXJpemUoaW5mbGVjdGlvbi5wbHVyYWxpemUoaW5mbGVjdGlvbi51bmRlcnNjb3JlKG1vZGVsTmFtZSkpKX1gXG59XG5cbi8qKlxuICogUnVucyB0aGUgZnJvbnRlbmRNb2RlbEFjdGlvbkZvckNvbW1hbmQgaGVscGVyLlxuICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBBcmd1bWVudHMuXG4gKiBAcGFyYW0ge3N0cmluZ30gYXJncy5jb21tYW5kTmFtZSAtIENvbW1hbmQgcGF0aCBzZWdtZW50LlxuICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MubW9kZWxOYW1lIC0gTW9kZWwgY2xhc3MgbmFtZS5cbiAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGFyZ3MucmVzb3VyY2VEZWZpbml0aW9uIC0gUmVzb3VyY2UgZGVmaW5pdGlvbi5cbiAqIEByZXR1cm5zIHtcImRlc3Ryb3lcIiB8IFwiZmluZFwiIHwgXCJpbmRleFwiIHwgXCJjcmVhdGVcIiB8IFwidXBkYXRlXCIgfCBcImF0dGFjaFwiIHwgXCJkb3dubG9hZFwiIHwgXCJ1cmxcIiB8IG51bGx9IC0gRnJvbnRlbmQgYWN0aW9uLlxuICovXG5leHBvcnQgZnVuY3Rpb24gZnJvbnRlbmRNb2RlbEFjdGlvbkZvckNvbW1hbmQoe2NvbW1hbmROYW1lLCBtb2RlbE5hbWUsIHJlc291cmNlRGVmaW5pdGlvbn0pIHtcbiAgY29uc3QgcmVzb3VyY2VDb25maWd1cmF0aW9uID0gZnJvbnRlbmRNb2RlbFJlc291cmNlQ29uZmlndXJhdGlvbkZyb21EZWZpbml0aW9uKHJlc291cmNlRGVmaW5pdGlvbilcblxuICBpZiAoIXJlc291cmNlQ29uZmlndXJhdGlvbikge1xuICAgIHRocm93IG5ldyBFcnJvcihgSW52YWxpZCBmcm9udGVuZCBtb2RlbCByZXNvdXJjZSBkZWZpbml0aW9uIGZvciAke21vZGVsTmFtZX1gKVxuICB9XG5cbiAgZm9yIChjb25zdCBbYWN0aW9uLCBjb25maWd1cmVkQ29tbWFuZE5hbWVdIG9mIE9iamVjdC5lbnRyaWVzKHtcbiAgICAuLi5yZXNvdXJjZUNvbmZpZ3VyYXRpb24uYnVpbHRJbkNvbGxlY3Rpb25Db21tYW5kcyxcbiAgICAuLi5yZXNvdXJjZUNvbmZpZ3VyYXRpb24uYnVpbHRJbk1lbWJlckNvbW1hbmRzXG4gIH0pKSB7XG4gICAgaWYgKGNvbmZpZ3VyZWRDb21tYW5kTmFtZSA9PT0gdW5kZWZpbmVkKSBjb250aW51ZVxuXG4gICAgY29uc3QgdmFsaWRhdGVkQ29tbWFuZE5hbWUgPSB2YWxpZGF0ZUZyb250ZW5kTW9kZWxSZXNvdXJjZUNvbW1hbmROYW1lKHtcbiAgICAgIGNvbW1hbmROYW1lOiBjb25maWd1cmVkQ29tbWFuZE5hbWUsXG4gICAgICBjb21tYW5kVHlwZTogLyoqIEB0eXBlIHtcImF0dGFjaFwiIHwgXCJjcmVhdGVcIiB8IFwiZGVzdHJveVwiIHwgXCJkb3dubG9hZFwiIHwgXCJmaW5kXCIgfCBcImluZGV4XCIgfCBcInVwZGF0ZVwiIHwgXCJ1cmxcIn0gKi8gKGFjdGlvbiksXG4gICAgICBtb2RlbE5hbWVcbiAgICB9KVxuXG4gICAgaWYgKGNvbW1hbmROYW1lID09PSB2YWxpZGF0ZWRDb21tYW5kTmFtZSkge1xuICAgICAgcmV0dXJuIC8qKiBAdHlwZSB7XCJhdHRhY2hcIiB8IFwiY3JlYXRlXCIgfCBcImRlc3Ryb3lcIiB8IFwiZG93bmxvYWRcIiB8IFwiZmluZFwiIHwgXCJpbmRleFwiIHwgXCJ1cGRhdGVcIiB8IFwidXJsXCJ9ICovIChhY3Rpb24pXG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIG51bGxcbn1cblxuLyoqXG4gKiBSdW5zIHRoZSBmcm9udGVuZE1vZGVsQ3VzdG9tQ29tbWFuZEZvclBhdGggaGVscGVyLlxuICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBBcmd1bWVudHMuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuQmFja2VuZFByb2plY3RDb25maWd1cmF0aW9uW119IGFyZ3MuYmFja2VuZFByb2plY3RzIC0gQmFja2VuZCBwcm9qZWN0cyB0byBzY2FuLlxuICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MuY3VycmVudFBhdGggLSBSZXF1ZXN0IHBhdGggd2l0aG91dCBxdWVyeS5cbiAqIEByZXR1cm5zIHt7Y29tbWFuZE5hbWU6IHN0cmluZywgbWVtYmVySWQ/OiBzdHJpbmcsIG1ldGhvZE5hbWU6IHN0cmluZywgbW9kZWxOYW1lOiBzdHJpbmcsIHJlc291cmNlUGF0aDogc3RyaW5nLCBzY29wZTogXCJjb2xsZWN0aW9uXCIgfCBcIm1lbWJlclwifSB8IG51bGx9IC0gTWF0Y2hlZCBjdXN0b20gY29tbWFuZCBtZXRhZGF0YS5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGZyb250ZW5kTW9kZWxDdXN0b21Db21tYW5kRm9yUGF0aCh7YmFja2VuZFByb2plY3RzLCBjdXJyZW50UGF0aH0pIHtcbiAgY29uc3Qgbm9ybWFsaXplZEN1cnJlbnRQYXRoID0gbm9ybWFsaXplRnJvbnRlbmRNb2RlbFJlc291cmNlUGF0aEZvck1hdGNoKGN1cnJlbnRQYXRoKVxuXG4gIGZvciAoY29uc3QgYmFja2VuZFByb2plY3Qgb2YgYmFja2VuZFByb2plY3RzKSB7XG4gICAgY29uc3QgcmVzb3VyY2VzID0gZnJvbnRlbmRNb2RlbFJlc291cmNlc0ZvckJhY2tlbmRQcm9qZWN0KGJhY2tlbmRQcm9qZWN0KVxuXG4gICAgZm9yIChjb25zdCBtb2RlbE5hbWUgaW4gcmVzb3VyY2VzKSB7XG4gICAgICBjb25zdCByZXNvdXJjZURlZmluaXRpb24gPSByZXNvdXJjZXNbbW9kZWxOYW1lXVxuICAgICAgY29uc3QgcmVzb3VyY2VDb25maWd1cmF0aW9uID0gZnJvbnRlbmRNb2RlbFJlc291cmNlQ29uZmlndXJhdGlvbkZyb21EZWZpbml0aW9uKHJlc291cmNlRGVmaW5pdGlvbilcblxuICAgICAgaWYgKCFyZXNvdXJjZUNvbmZpZ3VyYXRpb24pIHtcbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgY29uc3QgcmVzb3VyY2VQYXRoID0gbm9ybWFsaXplRnJvbnRlbmRNb2RlbFJlc291cmNlUGF0aEZvck1hdGNoKGZyb250ZW5kTW9kZWxSZXNvdXJjZVBhdGgobW9kZWxOYW1lLCByZXNvdXJjZURlZmluaXRpb24pKVxuICAgICAgY29uc3QgZXhwZWN0ZWRQcmVmaXggPSBgJHtyZXNvdXJjZVBhdGh9L2BcblxuICAgICAgaWYgKCFub3JtYWxpemVkQ3VycmVudFBhdGguc3RhcnRzV2l0aChleHBlY3RlZFByZWZpeCkpIHtcbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgY29uc3QgcGF0aFNlZ21lbnRzID0gbm9ybWFsaXplZEN1cnJlbnRQYXRoXG4gICAgICAgIC5zbGljZShleHBlY3RlZFByZWZpeC5sZW5ndGgpXG4gICAgICAgIC5zcGxpdChcIi9cIilcbiAgICAgICAgLmZpbHRlcihCb29sZWFuKVxuXG4gICAgICBpZiAocGF0aFNlZ21lbnRzLmxlbmd0aCA9PT0gMSkge1xuICAgICAgICBjb25zdCBtYXRjaGVkQ29sbGVjdGlvbkNvbW1hbmQgPSBPYmplY3QuZW50cmllcyhyZXNvdXJjZUNvbmZpZ3VyYXRpb24uY29sbGVjdGlvbkNvbW1hbmRzKVxuICAgICAgICAgIC5maW5kKChbLCBjb21tYW5kTmFtZV0pID0+IGNvbW1hbmROYW1lID09PSBwYXRoU2VnbWVudHNbMF0pXG5cbiAgICAgICAgaWYgKG1hdGNoZWRDb2xsZWN0aW9uQ29tbWFuZCkge1xuICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICBjb21tYW5kTmFtZTogbWF0Y2hlZENvbGxlY3Rpb25Db21tYW5kWzFdLFxuICAgICAgICAgICAgbWV0aG9kTmFtZTogbWF0Y2hlZENvbGxlY3Rpb25Db21tYW5kWzBdLFxuICAgICAgICAgICAgbW9kZWxOYW1lLFxuICAgICAgICAgICAgcmVzb3VyY2VQYXRoLFxuICAgICAgICAgICAgc2NvcGU6IFwiY29sbGVjdGlvblwiXG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIGlmIChwYXRoU2VnbWVudHMubGVuZ3RoID09PSAyKSB7XG4gICAgICAgIGNvbnN0IG1hdGNoZWRNZW1iZXJDb21tYW5kID0gT2JqZWN0LmVudHJpZXMocmVzb3VyY2VDb25maWd1cmF0aW9uLm1lbWJlckNvbW1hbmRzKVxuICAgICAgICAgIC5maW5kKChbLCBjb21tYW5kTmFtZV0pID0+IGNvbW1hbmROYW1lID09PSBwYXRoU2VnbWVudHNbMV0pXG5cbiAgICAgICAgaWYgKG1hdGNoZWRNZW1iZXJDb21tYW5kKSB7XG4gICAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIGNvbW1hbmROYW1lOiBtYXRjaGVkTWVtYmVyQ29tbWFuZFsxXSxcbiAgICAgICAgICAgIG1lbWJlcklkOiBkZWNvZGVVUklDb21wb25lbnQocGF0aFNlZ21lbnRzWzBdKSxcbiAgICAgICAgICAgIG1ldGhvZE5hbWU6IG1hdGNoZWRNZW1iZXJDb21tYW5kWzBdLFxuICAgICAgICAgICAgbW9kZWxOYW1lLFxuICAgICAgICAgICAgcmVzb3VyY2VQYXRoLFxuICAgICAgICAgICAgc2NvcGU6IFwibWVtYmVyXCJcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICByZXR1cm4gbnVsbFxufVxuXG4vKipcbiAqIFJ1bnMgbm9ybWFsaXplIGZyb250ZW5kIG1vZGVsIHJlc291cmNlIHBhdGggZm9yIG1hdGNoLlxuICogQHBhcmFtIHtzdHJpbmd9IHBhdGggLSBQYXRoIHZhbHVlLlxuICogQHJldHVybnMge3N0cmluZ30gLSBOb3JtYWxpemVkIHBhdGggd2l0aCBsZWFkaW5nIHNsYXNoIGFuZCBubyB0cmFpbGluZyBzbGFzaC5cbiAqL1xuZnVuY3Rpb24gbm9ybWFsaXplRnJvbnRlbmRNb2RlbFJlc291cmNlUGF0aEZvck1hdGNoKHBhdGgpIHtcbiAgY29uc3Qgd2l0aExlYWRpbmdTbGFzaCA9IHBhdGguc3RhcnRzV2l0aChcIi9cIikgPyBwYXRoIDogYC8ke3BhdGh9YFxuXG4gIGlmICh3aXRoTGVhZGluZ1NsYXNoLmxlbmd0aCA+IDEpIHtcbiAgICByZXR1cm4gd2l0aExlYWRpbmdTbGFzaC5yZXBsYWNlKC9cXC8rJC8sIFwiXCIpXG4gIH1cblxuICByZXR1cm4gd2l0aExlYWRpbmdTbGFzaFxufVxuXG4vKipcbiAqIFJlc29sdmVzIHRoZSByZWdpc3RlcmVkIGZyb250ZW5kLW1vZGVsIHJlc291cmNlIGNsYXNzIGZvciBhIHJlc291cmNlIHR5cGVcbiAqIGFjcm9zcyBhbGwgYmFja2VuZCBwcm9qZWN0cy4gQSByZXNvdXJjZSdzIGVmZmVjdGl2ZSBuYW1lIGlzIGl0c1xuICogYG1vZGVsTmFtZWAgb3ZlcnJpZGUgd2hlbiBkZWNsYXJlZCwgb3RoZXJ3aXNlIGl0cyByZWdpc3RyeSBrZXkg4oCUIG1hdGNoaW5nXG4gKiB7QGxpbmsgZnJvbnRlbmRNb2RlbFN5bmNNYW5pZmVzdEZvckJhY2tlbmRQcm9qZWN0c30uIEEgcmVnaXN0cnkga2V5IHNoYWRvd2VkXG4gKiBieSBhIGBtb2RlbE5hbWVgIG92ZXJyaWRlIGRvZXMgbm90IHJlc29sdmUuXG4gKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gKiBAcGFyYW0ge3tnZXRCYWNrZW5kUHJvamVjdHM6ICgpID0+IGltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuQmFja2VuZFByb2plY3RDb25maWd1cmF0aW9uW119fSBhcmdzLmNvbmZpZ3VyYXRpb24gLSBDb25maWd1cmF0aW9uIGV4cG9zaW5nIHRoZSBiYWNrZW5kIHByb2plY3RzLlxuICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MucmVzb3VyY2VUeXBlIC0gRnJvbnRlbmQgbW9kZWwgbmFtZSB0byByZXNvbHZlLlxuICogQHJldHVybnMge0Zyb250ZW5kTW9kZWxSZXNvbHZlZFJlc291cmNlUmVnaXN0cmF0aW9uIHwgbnVsbH0gUmVzb2x2ZWQgcmVnaXN0cmF0aW9uIG9yIG51bGwgd2hlbiB0aGUgcmVzb3VyY2UgdHlwZSBpcyBub3QgcmVnaXN0ZXJlZC5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHJlc29sdmVGcm9udGVuZE1vZGVsUmVzb3VyY2VDbGFzcyh7Y29uZmlndXJhdGlvbiwgcmVzb3VyY2VUeXBlfSkge1xuICBmb3IgKGNvbnN0IGJhY2tlbmRQcm9qZWN0IG9mIGNvbmZpZ3VyYXRpb24uZ2V0QmFja2VuZFByb2plY3RzKCkpIHtcbiAgICBjb25zdCByZXNvdXJjZXMgPSBmcm9udGVuZE1vZGVsUmVzb3VyY2VzRm9yQmFja2VuZFByb2plY3QoYmFja2VuZFByb2plY3QpXG5cbiAgICBmb3IgKGNvbnN0IGNvbmZpZ3VyZWRNb2RlbE5hbWUgb2YgT2JqZWN0LmtleXMocmVzb3VyY2VzKSkge1xuICAgICAgY29uc3QgcmVzb3VyY2VEZWZpbml0aW9uID0gcmVzb3VyY2VzW2NvbmZpZ3VyZWRNb2RlbE5hbWVdXG4gICAgICBjb25zdCByZXNvdXJjZUNsYXNzID0gZnJvbnRlbmRNb2RlbFJlc291cmNlQ2xhc3NGcm9tRGVmaW5pdGlvbihyZXNvdXJjZURlZmluaXRpb24pXG5cbiAgICAgIGlmICghcmVzb3VyY2VDbGFzcykgY29udGludWVcblxuICAgICAgLy8gQ2hlYXAgZGlyZWN0LWtleSBtaXNtYXRjaCBza2lwOiBvbmx5IG5vcm1hbGl6ZSBjb25maWd1cmF0aW9ucyBmb3IgdGhlXG4gICAgICAvLyBtYXRjaGluZyBrZXkgb3Igd2hlbiBhIG1vZGVsTmFtZSBvdmVycmlkZSBjb3VsZCByZW5hbWUgdGhlIHJlc291cmNlLlxuICAgICAgaWYgKGNvbmZpZ3VyZWRNb2RlbE5hbWUgIT09IHJlc291cmNlVHlwZSAmJiAhcmVzb3VyY2VDbGFzcy5zaGFyZWRSZXNvdXJjZVN0YXRpY1ZhbHVlKFwibW9kZWxOYW1lXCIpKSBjb250aW51ZVxuXG4gICAgICBjb25zdCByZXNvdXJjZUNvbmZpZ3VyYXRpb24gPSBmcm9udGVuZE1vZGVsUmVzb3VyY2VDb25maWd1cmF0aW9uRnJvbURlZmluaXRpb24ocmVzb3VyY2VEZWZpbml0aW9uKVxuXG4gICAgICBpZiAoIXJlc291cmNlQ29uZmlndXJhdGlvbikgY29udGludWVcbiAgICAgIGlmICgocmVzb3VyY2VDb25maWd1cmF0aW9uLm1vZGVsTmFtZSB8fCBjb25maWd1cmVkTW9kZWxOYW1lKSAhPT0gcmVzb3VyY2VUeXBlKSBjb250aW51ZVxuXG4gICAgICByZXR1cm4ge21vZGVsTmFtZTogcmVzb3VyY2VUeXBlLCByZXNvdXJjZUNsYXNzLCByZXNvdXJjZUNvbmZpZ3VyYXRpb259XG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIG51bGxcbn1cbiJdfQ==