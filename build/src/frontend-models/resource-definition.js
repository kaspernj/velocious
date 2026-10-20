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
    "quickSearchNumericColumns",
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
        "quickSearchColumns",
        "quickSearchNumericColumns",
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
    const quickSearchColumns = normalizeFrontendModelQuickSearchColumns(resourceConfiguration.quickSearchColumns, "quickSearchColumns");
    const quickSearchNumericColumns = normalizeFrontendModelQuickSearchColumns(resourceConfiguration.quickSearchNumericColumns, "quickSearchNumericColumns");
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
        quickSearchColumns,
        quickSearchNumericColumns,
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
 * Normalizes declarative quick-search column entries into a stable list.
 * Each entry is a plain column-name string or a `{path, column}` object whose
 * path is a relationship path from the root model.
 * @param {unknown} columns - Raw quick-search column declarations.
 * @param {string} label - Config key label for error messages.
 * @returns {Array<import("../configuration-types.js").FrontendModelQuickSearchColumn> | null} - Normalized columns, or null when undeclared.
 */
function normalizeFrontendModelQuickSearchColumns(columns, label) {
    if (columns === undefined || columns === null)
        return null;
    if (!Array.isArray(columns))
        throw new Error(`Resource ${label} must be an array of column names or {path, column} objects.`);
    return columns.map((entry) => {
        if (typeof entry === "string") {
            if (entry.length < 1)
                throw new Error(`Resource ${label} entries must be non-empty column names.`);
            return { column: entry };
        }
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
            throw new Error(`Resource ${label} entries must be column names or {path, column} objects, got: ${JSON.stringify(entry)}`);
        }
        const entryRecord = /** @type {Record<string, unknown>} */ (entry);
        const column = entryRecord.column;
        const path = entryRecord.path;
        if (typeof column !== "string" || column.length < 1)
            throw new Error(`Resource ${label} entries require a non-empty column name.`);
        if (path === undefined || path === null)
            return { column };
        if (!Array.isArray(path) || path.some((pathSegment) => typeof pathSegment !== "string" || pathSegment.length < 1)) {
            throw new Error(`Resource ${label} entry paths must be arrays of non-empty relationship names.`);
        }
        return { column, path: [...path] };
    });
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicmVzb3VyY2UtZGVmaW5pdGlvbi5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9mcm9udGVuZC1tb2RlbHMvcmVzb3VyY2UtZGVmaW5pdGlvbi5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxZQUFZO0FBRVosT0FBTyxLQUFLLFVBQVUsTUFBTSxZQUFZLENBQUE7QUFDeEMsT0FBTyx5QkFBeUIsTUFBTSw2Q0FBNkMsQ0FBQTtBQUNuRixPQUFPLGFBQWEsTUFBTSw2QkFBNkIsQ0FBQTtBQUN2RCxPQUFPLFNBQVMsTUFBTSx3QkFBd0IsQ0FBQTtBQUM5QyxPQUFPLEVBQUMsd0NBQXdDLEVBQUMsTUFBTSxpQ0FBaUMsQ0FBQTtBQUV4Rjs7Ozs7O0dBTUc7QUFDSCxNQUFNLG1DQUFtQyxHQUFHLENBQUMsUUFBUSxFQUFFLFNBQVMsRUFBRSxNQUFNLEVBQUUsUUFBUSxDQUFDLENBQUE7QUFDbkYsTUFBTSwyQkFBMkIsR0FBRyxJQUFJLEdBQUcsQ0FBQztJQUMxQyxXQUFXO0lBQ1gsYUFBYTtJQUNiLFlBQVk7SUFDWiwyQkFBMkI7SUFDM0IsdUJBQXVCO0lBQ3ZCLG9CQUFvQjtJQUNwQixVQUFVO0lBQ1YsZ0JBQWdCO0lBQ2hCLFdBQVc7SUFDWCxZQUFZO0lBQ1osWUFBWTtJQUNaLG9CQUFvQjtJQUNwQiwyQkFBMkI7SUFDM0IsZUFBZTtJQUNmLG9CQUFvQjtJQUNwQixRQUFRO0lBQ1IsZ0JBQWdCO0lBQ2hCLE1BQU07SUFDTixzQkFBc0I7SUFDdEIsb0JBQW9CO0NBQ3JCLENBQUMsQ0FBQTtBQUVGOzs7O0dBSUc7QUFDSCxNQUFNLFVBQVUsdUNBQXVDLENBQUMsY0FBYztJQUNwRSxNQUFNLFNBQVMsR0FBRyxjQUFjLENBQUMsY0FBYyxDQUFBO0lBRS9DLElBQUksU0FBUyxLQUFLLFNBQVMsRUFBRSxDQUFDO1FBQzVCLElBQUksQ0FBQyxTQUFTLElBQUksT0FBTyxTQUFTLEtBQUssUUFBUSxFQUFFLENBQUM7WUFDaEQsTUFB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Q0FBQTtRQUN4RSxDQUFDO0lBQ0gsQ0FBQztJQUVELE9BQU8sSUFBSSxDQUFBO0FBQ2IsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG5pbXBvcnQgKiBhcyBpbmZsZWN0aW9uIGZyb20gXCJpbmZsZWN0aW9uXCJcbmltcG9ydCBGcm9udGVuZE1vZGVsQmFzZVJlc291cmNlIGZyb20gXCIuLi9mcm9udGVuZC1tb2RlbC1yZXNvdXJjZS9iYXNlLXJlc291cmNlLmpzXCJcbmltcG9ydCByZXN0QXJnc0Vycm9yIGZyb20gXCIuLi91dGlscy9yZXN0LWFyZ3MtZXJyb3IuanNcIlxuaW1wb3J0IHNoYTI1NkhleCBmcm9tIFwiLi4vdXRpbHMvc2hhMjU2LWhleC5qc1wiXG5pbXBvcnQge3ZhbGlkYXRlRnJvbnRlbmRNb2RlbFJlc291cmNlQ29tbWFuZE5hbWV9IGZyb20gXCIuL3Jlc291cmNlLWNvbmZpZy12YWxpZGF0aW9uLmpzXCJcblxuLyoqXG4gKiBSZXNvbHZlZCBmcm9udGVuZC1tb2RlbCByZXNvdXJjZSByZWdpc3RyYXRpb24gZm9yIGEgcmVwbGF5IHJlc291cmNlIHR5cGUuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBGcm9udGVuZE1vZGVsUmVzb2x2ZWRSZXNvdXJjZVJlZ2lzdHJhdGlvblxuICogQHByb3BlcnR5IHtzdHJpbmd9IG1vZGVsTmFtZSAtIEVmZmVjdGl2ZSBmcm9udGVuZCBtb2RlbCBuYW1lIChtb2RlbE5hbWUgb3ZlcnJpZGUgb3IgcmVnaXN0cnkga2V5KS5cbiAqIEBwcm9wZXJ0eSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Gcm9udGVuZE1vZGVsUmVzb3VyY2VDbGFzc1R5cGV9IHJlc291cmNlQ2xhc3MgLSBSZWdpc3RlcmVkIHJlc291cmNlIGNsYXNzLlxuICogQHByb3BlcnR5IHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLk5vcm1hbGl6ZWRGcm9udGVuZE1vZGVsUmVzb3VyY2VDb25maWd1cmF0aW9ufSByZXNvdXJjZUNvbmZpZ3VyYXRpb24gLSBOb3JtYWxpemVkIHJlc291cmNlIGNvbmZpZ3VyYXRpb24uXG4gKi9cbmNvbnN0IEJBU0VfRlJPTlRFTkRfTU9ERUxfQUJJTElUWV9BQ1RJT05TID0gW1wiY3JlYXRlXCIsIFwiZGVzdHJveVwiLCBcInJlYWRcIiwgXCJ1cGRhdGVcIl1cbmNvbnN0IFJFU09VUkNFX1NUQVRJQ19DT05GSUdfS0VZUyA9IG5ldyBTZXQoW1xuICBcImFiaWxpdGllc1wiLFxuICBcImF0dGFjaG1lbnRzXCIsXG4gIFwiYXR0cmlidXRlc1wiLFxuICBcImJ1aWx0SW5Db2xsZWN0aW9uQ29tbWFuZHNcIixcbiAgXCJidWlsdEluTWVtYmVyQ29tbWFuZHNcIixcbiAgXCJjb2xsZWN0aW9uQ29tbWFuZHNcIixcbiAgXCJjb21tYW5kc1wiLFxuICBcIm1lbWJlckNvbW1hbmRzXCIsXG4gIFwibW9kZWxOYW1lXCIsXG4gIFwiTW9kZWxDbGFzc1wiLFxuICBcInByaW1hcnlLZXlcIixcbiAgXCJxdWlja1NlYXJjaENvbHVtbnNcIixcbiAgXCJxdWlja1NlYXJjaE51bWVyaWNDb2x1bW5zXCIsXG4gIFwicmVsYXRpb25zaGlwc1wiLFxuICBcIlJlcGxheVNlcnZpY2VDbGFzc1wiLFxuICBcInNlcnZlclwiLFxuICBcIlNoYXJlZFJlc291cmNlXCIsXG4gIFwic3luY1wiLFxuICBcInRyYW5zbGF0ZWRBdHRyaWJ1dGVzXCIsXG4gIFwid3JpdGFibGVBdHRyaWJ1dGVzXCJcbl0pXG5cbi8qKlxuICogUnVucyB0aGUgZnJvbnRlbmRNb2RlbFJlc291cmNlc0ZvckJhY2tlbmRQcm9qZWN0IGhlbHBlci5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5CYWNrZW5kUHJvamVjdENvbmZpZ3VyYXRpb259IGJhY2tlbmRQcm9qZWN0IC0gQmFja2VuZCBwcm9qZWN0IGNvbmZpZy5cbiAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkZyb250ZW5kTW9kZWxSZXNvdXJjZUNsYXNzVHlwZT59IC0gUmVzb3VyY2UgZGVmaW5pdGlvbnMga2V5ZWQgYnkgbW9kZWwgbmFtZS5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGZyb250ZW5kTW9kZWxSZXNvdXJjZXNGb3JCYWNrZW5kUHJvamVjdChiYWNrZW5kUHJvamVjdCkge1xuICBjb25zdCByZXNvdXJjZXMgPSBiYWNrZW5kUHJvamVjdC5mcm9udGVuZE1vZGVsc1xuXG4gIGlmIChyZXNvdXJjZXMgIT09IHVuZGVmaW5lZCkge1xuICAgIGlmICghcmVzb3VyY2VzIHx8IHR5cGVvZiByZXNvdXJjZXMgIT09IFwib2JqZWN0XCIpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgRXhwZWN0ZWQgYmFja2VuZCBwcm9qZWN0IGZyb250ZW5kTW9kZWxzIG9iamVjdCBidXQgZ290OiAke3Jlc291cmNlc31gKVxuICAgIH1cblxuICAgIHJldHVybiByZXNvdXJjZXNcbiAgfVxuXG4gIHJldHVybiB7fVxufVxuXG4vKipcbiAqIFJ1bnMgdGhlIGZyb250ZW5kTW9kZWxSZXNvdXJjZURlZmluaXRpb25Jc0NsYXNzIGhlbHBlci5cbiAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHZhbHVlIC0gQ2FuZGlkYXRlIHJlc291cmNlIGRlZmluaXRpb24uXG4gKiBAcmV0dXJucyB7dmFsdWUgaXMgaW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Gcm9udGVuZE1vZGVsUmVzb3VyY2VDbGFzc1R5cGV9IC0gV2hldGhlciB2YWx1ZSBpcyBhIHJlc291cmNlIGNsYXNzLlxuICovXG5leHBvcnQgZnVuY3Rpb24gZnJvbnRlbmRNb2RlbFJlc291cmNlRGVmaW5pdGlvbklzQ2xhc3ModmFsdWUpIHtcbiAgcmV0dXJuIHR5cGVvZiB2YWx1ZSA9PT0gXCJmdW5jdGlvblwiICYmICh2YWx1ZSA9PT0gRnJvbnRlbmRNb2RlbEJhc2VSZXNvdXJjZSB8fCB2YWx1ZS5wcm90b3R5cGUgaW5zdGFuY2VvZiBGcm9udGVuZE1vZGVsQmFzZVJlc291cmNlKVxufVxuXG4vKipcbiAqIFJ1bnMgdGhlIGZyb250ZW5kTW9kZWxSZXNvdXJjZUNsYXNzRnJvbURlZmluaXRpb24gaGVscGVyLlxuICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gcmVzb3VyY2VEZWZpbml0aW9uIC0gUmVzb3VyY2UgZGVmaW5pdGlvbi5cbiAqIEByZXR1cm5zIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkZyb250ZW5kTW9kZWxSZXNvdXJjZUNsYXNzVHlwZSB8IG51bGx9IC0gUmVzb3VyY2UgY2xhc3Mgd2hlbiBkZWZpbml0aW9uIGlzIGNsYXNzLWJhc2VkLlxuICovXG5leHBvcnQgZnVuY3Rpb24gZnJvbnRlbmRNb2RlbFJlc291cmNlQ2xhc3NGcm9tRGVmaW5pdGlvbihyZXNvdXJjZURlZmluaXRpb24pIHtcbiAgcmV0dXJuIGZyb250ZW5kTW9kZWxSZXNvdXJjZURlZmluaXRpb25Jc0NsYXNzKHJlc291cmNlRGVmaW5pdGlvbikgPyByZXNvdXJjZURlZmluaXRpb24gOiBudWxsXG59XG5cbi8qKlxuICogUnVucyB0aGUgZnJvbnRlbmRNb2RlbFJlc291cmNlQ29uZmlndXJhdGlvbkZyb21EZWZpbml0aW9uIGhlbHBlci5cbiAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHJlc291cmNlRGVmaW5pdGlvbiAtIFJlc291cmNlIGRlZmluaXRpb24uXG4gKiBAcmV0dXJucyB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Ob3JtYWxpemVkRnJvbnRlbmRNb2RlbFJlc291cmNlQ29uZmlndXJhdGlvbiB8IG51bGx9IC0gTm9ybWFsaXplZCByZXNvdXJjZSBjb25maWd1cmF0aW9uLlxuICovXG5leHBvcnQgZnVuY3Rpb24gZnJvbnRlbmRNb2RlbFJlc291cmNlQ29uZmlndXJhdGlvbkZyb21EZWZpbml0aW9uKHJlc291cmNlRGVmaW5pdGlvbikge1xuICBpZiAoIWZyb250ZW5kTW9kZWxSZXNvdXJjZURlZmluaXRpb25Jc0NsYXNzKHJlc291cmNlRGVmaW5pdGlvbikpIHJldHVybiBudWxsXG5cbiAgYXNzZXJ0UmVzb3VyY2VDb25maWdJc0ZyYW1ld29ya0RlZmluZWQocmVzb3VyY2VEZWZpbml0aW9uKVxuXG4gIHJldHVybiBub3JtYWxpemVGcm9udGVuZE1vZGVsUmVzb3VyY2VDb25maWd1cmF0aW9uKHJlc291cmNlRGVmaW5pdGlvbi5yZXNvdXJjZUNvbmZpZygpKVxufVxuXG4vKipcbiAqIEVuc3VyZXMgcmVzb3VyY2VzIHVzZSBkZWNsYXJhdGl2ZSBzdGF0aWMgY29uZmlnIHByb3BlcnRpZXMgaW5zdGVhZCBvZiBvdmVycmlkaW5nIHJlc291cmNlQ29uZmlnKCkuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRnJvbnRlbmRNb2RlbFJlc291cmNlQ2xhc3NUeXBlfSBSZXNvdXJjZUNsYXNzIC0gUmVzb3VyY2UgY2xhc3MuXG4gKiBAcGFyYW0ge1NldDxpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkZyb250ZW5kTW9kZWxSZXNvdXJjZUNsYXNzVHlwZT59IFt2aXNpdGVkXSAtIEFscmVhZHkgaW5zcGVjdGVkIHNoYXJlZCByZXNvdXJjZXMuXG4gKiBAcmV0dXJucyB7dm9pZH1cbiAqL1xuZnVuY3Rpb24gYXNzZXJ0UmVzb3VyY2VDb25maWdJc0ZyYW1ld29ya0RlZmluZWQoUmVzb3VyY2VDbGFzcywgdmlzaXRlZCA9IG5ldyBTZXQoKSkge1xuICBpZiAodmlzaXRlZC5oYXMoUmVzb3VyY2VDbGFzcykpIHJldHVyblxuXG4gIHZpc2l0ZWQuYWRkKFJlc291cmNlQ2xhc3MpXG4gIGFzc2VydEtub3duUmVzb3VyY2VTdGF0aWNDb25maWdQcm9wZXJ0aWVzKFJlc291cmNlQ2xhc3MpXG5cbiAgY29uc3Qgb3duZXIgPSBzdGF0aWNNZXRob2RPd25lckZvcihSZXNvdXJjZUNsYXNzLCBcInJlc291cmNlQ29uZmlnXCIpXG5cbiAgaWYgKG93bmVyICYmIG93bmVyICE9PSBGcm9udGVuZE1vZGVsQmFzZVJlc291cmNlKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGAke1Jlc291cmNlQ2xhc3MubmFtZX0gb3ZlcnJpZGVzIHN0YXRpYyByZXNvdXJjZUNvbmZpZygpLCB3aGljaCBpcyBub3Qgc3VwcG9ydGVkLiBVc2Ugc3RhdGljIHJlc291cmNlIHByb3BlcnRpZXMgaW5zdGVhZC5gKVxuICB9XG5cbiAgY29uc3QgU2hhcmVkUmVzb3VyY2UgPSBSZXNvdXJjZUNsYXNzLnNoYXJlZFJlc291cmNlQ2xhc3MoKVxuXG4gIGlmIChTaGFyZWRSZXNvdXJjZSkgYXNzZXJ0UmVzb3VyY2VDb25maWdJc0ZyYW1ld29ya0RlZmluZWQoU2hhcmVkUmVzb3VyY2UsIHZpc2l0ZWQpXG59XG5cbi8qKlxuICogRW5zdXJlcyBkZWNsYXJhdGl2ZSBzdGF0aWMgcmVzb3VyY2UgY29uZmlnIGRvZXMgbm90IHNpbGVudGx5IGlnbm9yZSB0eXBvcyBvciByZW1vdmVkIGtleXMuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRnJvbnRlbmRNb2RlbFJlc291cmNlQ2xhc3NUeXBlfSBSZXNvdXJjZUNsYXNzIC0gUmVzb3VyY2UgY2xhc3MuXG4gKiBAcmV0dXJucyB7dm9pZH1cbiAqL1xuZnVuY3Rpb24gYXNzZXJ0S25vd25SZXNvdXJjZVN0YXRpY0NvbmZpZ1Byb3BlcnRpZXMoUmVzb3VyY2VDbGFzcykge1xuICBsZXQgY3VycmVudENsYXNzID0gUmVzb3VyY2VDbGFzc1xuXG4gIHdoaWxlIChjdXJyZW50Q2xhc3MgJiYgY3VycmVudENsYXNzICE9PSBGcm9udGVuZE1vZGVsQmFzZVJlc291cmNlICYmIGN1cnJlbnRDbGFzcyAhPT0gRnVuY3Rpb24ucHJvdG90eXBlKSB7XG4gICAgLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovXG4gICAgY29uc3QgdW5rbm93blN0YXRpY0NvbmZpZyA9IHt9XG5cbiAgICBmb3IgKGNvbnN0IGtleSBvZiBPYmplY3Qua2V5cyhjdXJyZW50Q2xhc3MpKSB7XG4gICAgICBpZiAoIVJFU09VUkNFX1NUQVRJQ19DT05GSUdfS0VZUy5oYXMoa2V5KSkgdW5rbm93blN0YXRpY0NvbmZpZ1trZXldID0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovICgvKiogQHR5cGUge3Vua25vd259ICovIChjdXJyZW50Q2xhc3MpKVtrZXldXG4gICAgfVxuXG4gICAgcmVzdEFyZ3NFcnJvcih1bmtub3duU3RhdGljQ29uZmlnKVxuXG4gICAgY3VycmVudENsYXNzID0gT2JqZWN0LmdldFByb3RvdHlwZU9mKGN1cnJlbnRDbGFzcylcbiAgfVxufVxuXG4vKipcbiAqIExvY2F0ZXMgd2hpY2ggY29uc3RydWN0b3Igb3ducyBhIHN0YXRpYyBtZXRob2QgaW1wbGVtZW50YXRpb24uXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRnJvbnRlbmRNb2RlbFJlc291cmNlQ2xhc3NUeXBlfSBSZXNvdXJjZUNsYXNzIC0gUmVzb3VyY2UgY2xhc3MuXG4gKiBAcGFyYW0ge3N0cmluZ30gbWV0aG9kTmFtZSAtIE1ldGhvZCBuYW1lLlxuICogQHJldHVybnMge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRnJvbnRlbmRNb2RlbFJlc291cmNlQ2xhc3NUeXBlIHwgdHlwZW9mIEZyb250ZW5kTW9kZWxCYXNlUmVzb3VyY2UgfCBudWxsfSAtIENsYXNzIHRoYXQgb3ducyB0aGUgc3RhdGljIG1ldGhvZC5cbiAqL1xuZnVuY3Rpb24gc3RhdGljTWV0aG9kT3duZXJGb3IoUmVzb3VyY2VDbGFzcywgbWV0aG9kTmFtZSkge1xuICBsZXQgY3VycmVudENsYXNzID0gUmVzb3VyY2VDbGFzc1xuXG4gIHdoaWxlIChjdXJyZW50Q2xhc3MgJiYgY3VycmVudENsYXNzICE9PSBGdW5jdGlvbi5wcm90b3R5cGUpIHtcbiAgICBpZiAoT2JqZWN0LnByb3RvdHlwZS5oYXNPd25Qcm9wZXJ0eS5jYWxsKGN1cnJlbnRDbGFzcywgbWV0aG9kTmFtZSkpIHJldHVybiBjdXJyZW50Q2xhc3NcblxuICAgIGN1cnJlbnRDbGFzcyA9IE9iamVjdC5nZXRQcm90b3R5cGVPZihjdXJyZW50Q2xhc3MpXG4gIH1cblxuICByZXR1cm4gbnVsbFxufVxuXG4vKipcbiAqIFJ1bnMgbm9ybWFsaXplIGZyb250ZW5kIG1vZGVsIHJlc291cmNlIGNvbmZpZ3VyYXRpb24uXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRnJvbnRlbmRNb2RlbFJlc291cmNlQ29uZmlndXJhdGlvbn0gcmVzb3VyY2VDb25maWd1cmF0aW9uIC0gUmF3IHJlc291cmNlIGNvbmZpZ3VyYXRpb24uXG4gKiBAcmV0dXJucyB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Ob3JtYWxpemVkRnJvbnRlbmRNb2RlbFJlc291cmNlQ29uZmlndXJhdGlvbn0gLSBOb3JtYWxpemVkIHJlc291cmNlIGNvbmZpZ3VyYXRpb24uXG4gKi9cbmZ1bmN0aW9uIG5vcm1hbGl6ZUZyb250ZW5kTW9kZWxSZXNvdXJjZUNvbmZpZ3VyYXRpb24ocmVzb3VyY2VDb25maWd1cmF0aW9uKSB7XG4gIGNvbnN0IHJlc3RBcmdzID0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovICh7Li4ucmVzb3VyY2VDb25maWd1cmF0aW9ufSlcblxuICBmb3IgKGNvbnN0IGtleSBvZiBbXG4gICAgXCJhYmlsaXRpZXNcIixcbiAgICBcImF0dHJpYnV0ZXNcIixcbiAgICBcImF0dGFjaG1lbnRzXCIsXG4gICAgXCJidWlsdEluQ29sbGVjdGlvbkNvbW1hbmRzXCIsXG4gICAgXCJidWlsdEluTWVtYmVyQ29tbWFuZHNcIixcbiAgICBcImNvbGxlY3Rpb25Db21tYW5kc1wiLFxuICAgIFwiY29tbWFuZHNcIixcbiAgICBcIm1lbWJlckNvbW1hbmRzXCIsXG4gICAgXCJtb2RlbE5hbWVcIixcbiAgICBcInByaW1hcnlLZXlcIixcbiAgICBcInF1aWNrU2VhcmNoQ29sdW1uc1wiLFxuICAgIFwicXVpY2tTZWFyY2hOdW1lcmljQ29sdW1uc1wiLFxuICAgIFwicmVsYXRpb25zaGlwc1wiLFxuICAgIFwic2VydmVyXCIsXG4gICAgXCJzeW5jXCJcbiAgXSkge1xuICAgIGRlbGV0ZSByZXN0QXJnc1trZXldXG4gIH1cblxuICByZXN0QXJnc0Vycm9yKHJlc3RBcmdzKVxuICB2YWxpZGF0ZUZyb250ZW5kTW9kZWxSZXNvdXJjZVByaW1hcnlLZXkocmVzb3VyY2VDb25maWd1cmF0aW9uLnByaW1hcnlLZXkpXG5cbiAgY29uc3Qgbm9ybWFsaXplZENvbW1hbmRzID0gbm9ybWFsaXplRnJvbnRlbmRNb2RlbFJlc291cmNlQ29tbWFuZHMocmVzb3VyY2VDb25maWd1cmF0aW9uKVxuICBjb25zdCBzeW5jID0gbm9ybWFsaXplRnJvbnRlbmRNb2RlbFJlc291cmNlU3luYyhyZXNvdXJjZUNvbmZpZ3VyYXRpb24pXG4gIGNvbnN0IHF1aWNrU2VhcmNoQ29sdW1ucyA9IG5vcm1hbGl6ZUZyb250ZW5kTW9kZWxRdWlja1NlYXJjaENvbHVtbnMocmVzb3VyY2VDb25maWd1cmF0aW9uLnF1aWNrU2VhcmNoQ29sdW1ucywgXCJxdWlja1NlYXJjaENvbHVtbnNcIilcbiAgY29uc3QgcXVpY2tTZWFyY2hOdW1lcmljQ29sdW1ucyA9IG5vcm1hbGl6ZUZyb250ZW5kTW9kZWxRdWlja1NlYXJjaENvbHVtbnMocmVzb3VyY2VDb25maWd1cmF0aW9uLnF1aWNrU2VhcmNoTnVtZXJpY0NvbHVtbnMsIFwicXVpY2tTZWFyY2hOdW1lcmljQ29sdW1uc1wiKVxuXG4gIHJldHVybiB7XG4gICAgLi4ucmVzb3VyY2VDb25maWd1cmF0aW9uLFxuICAgIGFiaWxpdGllczogbm9ybWFsaXplRnJvbnRlbmRNb2RlbFJlc291cmNlQWJpbGl0aWVzKHJlc291cmNlQ29uZmlndXJhdGlvbi5hYmlsaXRpZXMpLFxuICAgIGJ1aWx0SW5Db2xsZWN0aW9uQ29tbWFuZHM6IG5vcm1hbGl6ZWRDb21tYW5kcy5idWlsdEluQ29sbGVjdGlvbkNvbW1hbmRzLFxuICAgIGJ1aWx0SW5NZW1iZXJDb21tYW5kczogbm9ybWFsaXplZENvbW1hbmRzLmJ1aWx0SW5NZW1iZXJDb21tYW5kcyxcbiAgICBjb2xsZWN0aW9uQ29tbWFuZHM6IG5vcm1hbGl6ZWRDb21tYW5kcy5jb2xsZWN0aW9uQ29tbWFuZHMsXG4gICAgLy8gUGVyLWNvbW1hbmQgbWV0YWRhdGEgKHR5cGVkIGFyZ3MgKyBkZWNsYXJlZCByZXR1cm4gdHlwZSkga2V5ZWQgYnkgbWV0aG9kXG4gICAgLy8gbmFtZSwgZGVyaXZlZCBmcm9tIGB7bmFtZSwgYXJncz8sIHJldHVyblR5cGU/fWAgY29tbWFuZCBlbnRyaWVzLiBUaGVcbiAgICAvLyBnZW5lcmF0b3IgdXNlcyBpdCB0byB0eXBlIGVhY2ggY3VzdG9tIGNvbW1hbmQgbWV0aG9kLlxuICAgIGNvbW1hbmRNZXRhZGF0YTogbm9ybWFsaXplZENvbW1hbmRzLmNvbW1hbmRNZXRhZGF0YSxcbiAgICBtZW1iZXJDb21tYW5kczogbm9ybWFsaXplZENvbW1hbmRzLm1lbWJlckNvbW1hbmRzLFxuICAgIHF1aWNrU2VhcmNoQ29sdW1ucyxcbiAgICBxdWlja1NlYXJjaE51bWVyaWNDb2x1bW5zLFxuICAgIHN5bmNcbiAgfVxufVxuXG4vKipcbiAqIFZhbGlkYXRlcyBhIHJlc291cmNlIHByaW1hcnkta2V5IGRlZmluaXRpb24gYmVmb3JlIGl0IGNhbiBiZSB1c2VkIHRvIGJ1aWxkIENSVUQgY29uZGl0aW9ucy5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vdXRpbHMvbW9kZWwtcHJpbWFyeS1rZXkuanNcIikuTW9kZWxQcmltYXJ5S2V5RGVmaW5pdGlvbiB8IHVuZGVmaW5lZH0gcHJpbWFyeUtleSAtIFJlc291cmNlIHByaW1hcnkga2V5LlxuICogQHJldHVybnMge3ZvaWR9XG4gKi9cbmZ1bmN0aW9uIHZhbGlkYXRlRnJvbnRlbmRNb2RlbFJlc291cmNlUHJpbWFyeUtleShwcmltYXJ5S2V5KSB7XG4gIGlmICghQXJyYXkuaXNBcnJheShwcmltYXJ5S2V5KSkgcmV0dXJuXG5cbiAgaWYgKHByaW1hcnlLZXkubGVuZ3RoID09PSAwKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFwiUmVzb3VyY2UgcHJpbWFyeUtleSBhcnJheXMgbXVzdCBjb250YWluIGF0IGxlYXN0IG9uZSBhdHRyaWJ1dGUuXCIpXG4gIH1cblxuICBpZiAobmV3IFNldChwcmltYXJ5S2V5KS5zaXplICE9PSBwcmltYXJ5S2V5Lmxlbmd0aCkge1xuICAgIHRocm93IG5ldyBFcnJvcihcIlJlc291cmNlIHByaW1hcnlLZXkgYXJyYXlzIG11c3QgY29udGFpbiB1bmlxdWUgYXR0cmlidXRlcy5cIilcbiAgfVxufVxuXG4vKipcbiAqIFJ1bnMgbm9ybWFsaXplIGZyb250ZW5kIG1vZGVsIHJlc291cmNlIGFiaWxpdGllcy5cbiAqIEBwYXJhbSB7c3RyaW5nW10gfCB1bmRlZmluZWR9IGFiaWxpdGllcyAtIFJlc291cmNlIGFiaWxpdGllcyBjb25maWcgKGNhbWVsQ2FzZSBhY3Rpb24gbGlzdCkuXG4gKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgc3RyaW5nPn0gLSBOb3JtYWxpemVkIGFiaWxpdGllcyBjb25maWcuXG4gKi9cbmZ1bmN0aW9uIG5vcm1hbGl6ZUZyb250ZW5kTW9kZWxSZXNvdXJjZUFiaWxpdGllcyhhYmlsaXRpZXMpIHtcbiAgY29uc3Qgbm9ybWFsaXplZCA9IGRlZmF1bHRDcnVkQWJpbGl0aWVzKClcblxuICBpZiAoYWJpbGl0aWVzID09PSB1bmRlZmluZWQpIHJldHVybiBub3JtYWxpemVkXG5cbiAgaWYgKCFBcnJheS5pc0FycmF5KGFiaWxpdGllcykpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXCJSZXNvdXJjZSBhYmlsaXRpZXMgbXVzdCBiZSBhbiBhcnJheSBvZiBhY3Rpb24gbmFtZXMuIE9iamVjdCBmb3JtIGlzIG5vIGxvbmdlciBzdXBwb3J0ZWQuXCIpXG4gIH1cblxuICBjb25zdCBkdXBsaWNhdGVkQmFzZUFiaWxpdGllcyA9IGFiaWxpdGllcy5maWx0ZXIoKGFiaWxpdHkpID0+IEJBU0VfRlJPTlRFTkRfTU9ERUxfQUJJTElUWV9BQ1RJT05TLmluY2x1ZGVzKGFiaWxpdHkpKVxuXG4gIGlmIChkdXBsaWNhdGVkQmFzZUFiaWxpdGllcy5sZW5ndGggPiAwKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGBSZXNvdXJjZSBhYmlsaXRpZXMgbXVzdCBub3QgaW5jbHVkZSBiYXNlIGFjdGlvbnM6ICR7ZHVwbGljYXRlZEJhc2VBYmlsaXRpZXMuam9pbihcIiwgXCIpfWApXG4gIH1cblxuICBmb3IgKGNvbnN0IGFiaWxpdHkgb2YgYWJpbGl0aWVzKSB7XG4gICAgaWYgKHR5cGVvZiBhYmlsaXR5ICE9PSBcInN0cmluZ1wiIHx8IGFiaWxpdHkubGVuZ3RoIDwgMSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiUmVzb3VyY2UgYWJpbGl0aWVzIGVudHJpZXMgbXVzdCBiZSBub24tZW1wdHkgc3RyaW5ncy5cIilcbiAgICB9XG5cbiAgICBub3JtYWxpemVkW2FiaWxpdHldID0gYWJpbGl0eVxuICB9XG5cbiAgcmV0dXJuIG5vcm1hbGl6ZWRcbn1cblxuLyoqXG4gKiBSdW5zIGRlZmF1bHQgY3J1ZCBhYmlsaXRpZXMuXG4gKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgc3RyaW5nPn0gLSBEZWZhdWx0IENSVUQgYWJpbGl0eSBtYXAuXG4gKi9cbmZ1bmN0aW9uIGRlZmF1bHRDcnVkQWJpbGl0aWVzKCkge1xuICByZXR1cm4ge1xuICAgIGNyZWF0ZTogXCJjcmVhdGVcIixcbiAgICBkZXN0cm95OiBcImRlc3Ryb3lcIixcbiAgICBmaW5kOiBcInJlYWRcIixcbiAgICBpbmRleDogXCJyZWFkXCIsXG4gICAgdXBkYXRlOiBcInVwZGF0ZVwiXG4gIH1cbn1cblxuLyoqXG4gKiBCdWlsZHMgYSBmcm9udGVuZC1zYWZlIHN5bmMgbWFuaWZlc3QgZm9yIGFsbCBzeW5jLWVuYWJsZWQgZnJvbnRlbmQtbW9kZWwgcmVzb3VyY2VzLlxuICogQHBhcmFtIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkJhY2tlbmRQcm9qZWN0Q29uZmlndXJhdGlvbltdfSBiYWNrZW5kUHJvamVjdHMgLSBCYWNrZW5kIHByb2plY3RzIHRvIHNjYW4uXG4gKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Ob3JtYWxpemVkRnJvbnRlbmRNb2RlbFJlc291cmNlU3luY0NvbmZpZ3VyYXRpb24+fSAtIFN5bmMgbWV0YWRhdGEga2V5ZWQgYnkgbW9kZWwgbmFtZS5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGZyb250ZW5kTW9kZWxTeW5jTWFuaWZlc3RGb3JCYWNrZW5kUHJvamVjdHMoYmFja2VuZFByb2plY3RzKSB7XG4gIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Ob3JtYWxpemVkRnJvbnRlbmRNb2RlbFJlc291cmNlU3luY0NvbmZpZ3VyYXRpb24+fSAqL1xuICBjb25zdCBtYW5pZmVzdCA9IHt9XG5cbiAgZm9yIChjb25zdCBiYWNrZW5kUHJvamVjdCBvZiBiYWNrZW5kUHJvamVjdHMpIHtcbiAgICBjb25zdCByZXNvdXJjZXMgPSBmcm9udGVuZE1vZGVsUmVzb3VyY2VzRm9yQmFja2VuZFByb2plY3QoYmFja2VuZFByb2plY3QpXG5cbiAgICBmb3IgKGNvbnN0IGNvbmZpZ3VyZWRNb2RlbE5hbWUgb2YgT2JqZWN0LmtleXMocmVzb3VyY2VzKS5zb3J0KCkpIHtcbiAgICAgIGNvbnN0IHJlc291cmNlRGVmaW5pdGlvbiA9IHJlc291cmNlc1tjb25maWd1cmVkTW9kZWxOYW1lXVxuICAgICAgY29uc3QgcmVzb3VyY2VDb25maWd1cmF0aW9uID0gZnJvbnRlbmRNb2RlbFJlc291cmNlQ29uZmlndXJhdGlvbkZyb21EZWZpbml0aW9uKHJlc291cmNlRGVmaW5pdGlvbilcblxuICAgICAgaWYgKCFyZXNvdXJjZUNvbmZpZ3VyYXRpb24pIGNvbnRpbnVlXG4gICAgICBpZiAoIXJlc291cmNlQ29uZmlndXJhdGlvbi5zeW5jPy5lbmFibGVkKSBjb250aW51ZVxuXG4gICAgICBjb25zdCBtb2RlbE5hbWUgPSByZXNvdXJjZUNvbmZpZ3VyYXRpb24ubW9kZWxOYW1lIHx8IGNvbmZpZ3VyZWRNb2RlbE5hbWVcblxuICAgICAgbWFuaWZlc3RbbW9kZWxOYW1lXSA9IHJlc291cmNlQ29uZmlndXJhdGlvbi5zeW5jXG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIG1hbmlmZXN0XG59XG5cbi8qKlxuICogQnVpbGRzIGEgZnJvbnRlbmQtc2FmZSBBUEkgbWFuaWZlc3QgZm9yIGFsbCByZWdpc3RlcmVkIGZyb250ZW5kLW1vZGVsXG4gKiByZXNvdXJjZXMuIFRoZSBtYW5pZmVzdCBpcyBkZXRlcm1pbmlzdGljIChzb3J0ZWQgbW9kZWwgbmFtZXMsIHNvcnRlZFxuICogYXR0cmlidXRlcywgc29ydGVkIGNvbW1hbmRzKSBhbmQgaW5jbHVkZXMgb25seSBwdWJsaWMtc2FmZSBtZXRhZGF0YTogbm9cbiAqIHNlY3JldHMsIG5vIHNlcnZlciBjYWxsYmFja3MsIG5vIGJhY2tlbmQgZmlsZSBwYXRocy5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5CYWNrZW5kUHJvamVjdENvbmZpZ3VyYXRpb25bXX0gYmFja2VuZFByb2plY3RzIC0gQmFja2VuZCBwcm9qZWN0cyB0byBzY2FuLlxuICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIHVua25vd24+fSAtIEZyb250ZW5kLXNhZmUgQVBJIG1hbmlmZXN0LlxuICovXG5leHBvcnQgZnVuY3Rpb24gZnJvbnRlbmRNb2RlbEFwaU1hbmlmZXN0KGJhY2tlbmRQcm9qZWN0cykge1xuICAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIHVua25vd24+fSAqL1xuICBjb25zdCByZXNvdXJjZXMgPSB7fVxuXG4gIGZvciAoY29uc3QgYmFja2VuZFByb2plY3Qgb2YgYmFja2VuZFByb2plY3RzKSB7XG4gICAgY29uc3QgcHJvamVjdFJlc291cmNlcyA9IGZyb250ZW5kTW9kZWxSZXNvdXJjZXNGb3JCYWNrZW5kUHJvamVjdChiYWNrZW5kUHJvamVjdClcblxuICAgIGZvciAoY29uc3QgY29uZmlndXJlZE1vZGVsTmFtZSBvZiBPYmplY3Qua2V5cyhwcm9qZWN0UmVzb3VyY2VzKS5zb3J0KCkpIHtcbiAgICAgIGNvbnN0IHJlc291cmNlRGVmaW5pdGlvbiA9IHByb2plY3RSZXNvdXJjZXNbY29uZmlndXJlZE1vZGVsTmFtZV1cbiAgICAgIGNvbnN0IHJlc291cmNlQ29uZmlndXJhdGlvbiA9IGZyb250ZW5kTW9kZWxSZXNvdXJjZUNvbmZpZ3VyYXRpb25Gcm9tRGVmaW5pdGlvbihyZXNvdXJjZURlZmluaXRpb24pXG4gICAgICBjb25zdCByZXNvdXJjZUNsYXNzID0gZnJvbnRlbmRNb2RlbFJlc291cmNlQ2xhc3NGcm9tRGVmaW5pdGlvbihyZXNvdXJjZURlZmluaXRpb24pXG5cbiAgICAgIGlmICghcmVzb3VyY2VDb25maWd1cmF0aW9uIHx8ICFyZXNvdXJjZUNsYXNzKSBjb250aW51ZVxuXG4gICAgICBjb25zdCBtb2RlbE5hbWUgPSByZXNvdXJjZUNvbmZpZ3VyYXRpb24ubW9kZWxOYW1lIHx8IGNvbmZpZ3VyZWRNb2RlbE5hbWVcbiAgICAgIGNvbnN0IHJlc291cmNlUGF0aCA9IGAvJHtpbmZsZWN0aW9uLmRhc2hlcml6ZShpbmZsZWN0aW9uLnBsdXJhbGl6ZShpbmZsZWN0aW9uLnVuZGVyc2NvcmUoY29uZmlndXJlZE1vZGVsTmFtZSkpKX1gXG5cbiAgICAgIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgdW5rbm93bj59ICovXG4gICAgICBjb25zdCBlbnRyeSA9IHtcbiAgICAgICAgbW9kZWxOYW1lLFxuICAgICAgICBwYXRoOiByZXNvdXJjZVBhdGgsXG4gICAgICAgIHByaW1hcnlLZXk6IHJlc291cmNlQ2xhc3MucmVzb2x2ZWRQcmltYXJ5S2V5KHJlc291cmNlQ29uZmlndXJhdGlvbiksXG4gICAgICAgIGF0dHJpYnV0ZXM6IG1hbmlmZXN0QXR0cmlidXRlcyhyZXNvdXJjZUNvbmZpZ3VyYXRpb24uYXR0cmlidXRlcyksXG4gICAgICAgIGFiaWxpdGllczogcmVzb3VyY2VDb25maWd1cmF0aW9uLmFiaWxpdGllcyxcbiAgICAgICAgYnVpbHRJbkNvbW1hbmRzOiB7XG4gICAgICAgICAgY29sbGVjdGlvbjogcmVzb3VyY2VDb25maWd1cmF0aW9uLmJ1aWx0SW5Db2xsZWN0aW9uQ29tbWFuZHMsXG4gICAgICAgICAgbWVtYmVyOiByZXNvdXJjZUNvbmZpZ3VyYXRpb24uYnVpbHRJbk1lbWJlckNvbW1hbmRzXG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgY29uc3QgcmVsYXRpb25zaGlwcyA9IHJlc291cmNlQ29uZmlndXJhdGlvbi5yZWxhdGlvbnNoaXBzXG4gICAgICBpZiAocmVsYXRpb25zaGlwcyAmJiByZWxhdGlvbnNoaXBzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCB1bmtub3duPn0gKi9cbiAgICAgICAgY29uc3QgcmVscyA9IHt9XG4gICAgICAgIGZvciAoY29uc3QgcmVsTmFtZSBvZiByZWxhdGlvbnNoaXBzKSB7XG4gICAgICAgICAgcmVsc1tyZWxOYW1lXSA9IHt9XG4gICAgICAgIH1cbiAgICAgICAgZW50cnkucmVsYXRpb25zaGlwcyA9IHJlbHNcbiAgICAgIH1cblxuICAgICAgY29uc3QgYXR0YWNobWVudHMgPSByZXNvdXJjZUNvbmZpZ3VyYXRpb24uYXR0YWNobWVudHNcbiAgICAgIGlmIChhdHRhY2htZW50cyAmJiBPYmplY3Qua2V5cyhhdHRhY2htZW50cykubGVuZ3RoID4gMCkge1xuICAgICAgICBlbnRyeS5hdHRhY2htZW50cyA9IGF0dGFjaG1lbnRzXG4gICAgICB9XG5cbiAgICAgIGNvbnN0IGNvbGxlY3Rpb25Db21tYW5kcyA9IG1hbmlmZXN0Q29tbWFuZEVudHJpZXMoe1xuICAgICAgICBjb21tYW5kTWV0YWRhdGE6IHJlc291cmNlQ29uZmlndXJhdGlvbi5jb21tYW5kTWV0YWRhdGEgfHwge30sXG4gICAgICAgIGNvbW1hbmRzOiByZXNvdXJjZUNvbmZpZ3VyYXRpb24uY29sbGVjdGlvbkNvbW1hbmRzLFxuICAgICAgICByZXNvdXJjZVBhdGgsXG4gICAgICAgIHNjb3BlOiBcImNvbGxlY3Rpb25cIlxuICAgICAgfSlcbiAgICAgIGNvbnN0IG1lbWJlckNvbW1hbmRzID0gbWFuaWZlc3RDb21tYW5kRW50cmllcyh7XG4gICAgICAgIGNvbW1hbmRNZXRhZGF0YTogcmVzb3VyY2VDb25maWd1cmF0aW9uLmNvbW1hbmRNZXRhZGF0YSB8fCB7fSxcbiAgICAgICAgY29tbWFuZHM6IHJlc291cmNlQ29uZmlndXJhdGlvbi5tZW1iZXJDb21tYW5kcyxcbiAgICAgICAgcmVzb3VyY2VQYXRoLFxuICAgICAgICBzY29wZTogXCJtZW1iZXJcIlxuICAgICAgfSlcblxuICAgICAgaWYgKGNvbGxlY3Rpb25Db21tYW5kcy5sZW5ndGggPiAwIHx8IG1lbWJlckNvbW1hbmRzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCB1bmtub3duPn0gKi9cbiAgICAgICAgY29uc3QgY21kcyA9IHt9XG4gICAgICAgIGlmIChjb2xsZWN0aW9uQ29tbWFuZHMubGVuZ3RoID4gMCkgY21kc1tcImNvbGxlY3Rpb25cIl0gPSBjb2xsZWN0aW9uQ29tbWFuZHNcbiAgICAgICAgaWYgKG1lbWJlckNvbW1hbmRzLmxlbmd0aCA+IDApIGNtZHNbXCJtZW1iZXJcIl0gPSBtZW1iZXJDb21tYW5kc1xuICAgICAgICBlbnRyeS5jb21tYW5kcyA9IGNtZHNcbiAgICAgIH1cblxuICAgICAgaWYgKHJlc291cmNlQ29uZmlndXJhdGlvbi5zeW5jPy5lbmFibGVkKSB7XG4gICAgICAgIGVudHJ5LnN5bmMgPSByZXNvdXJjZUNvbmZpZ3VyYXRpb24uc3luY1xuICAgICAgfVxuXG4gICAgICByZXNvdXJjZXNbY29uZmlndXJlZE1vZGVsTmFtZV0gPSBlbnRyeVxuICAgIH1cbiAgfVxuXG4gIHJldHVybiB7XG4gICAgZm9ybWF0VmVyc2lvbjogMSxcbiAgICByZXNvdXJjZXM6IE9iamVjdC5rZXlzKHJlc291cmNlcykuc29ydCgpLnJlZHVjZSgoc29ydGVkLCBrZXkpID0+IHtcbiAgICAgIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgdW5rbm93bj59ICovIChzb3J0ZWQpW2tleV0gPSByZXNvdXJjZXNba2V5XVxuICAgICAgcmV0dXJuIHNvcnRlZFxuICAgIH0sIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgdW5rbm93bj59ICovICh7fSkpXG4gIH1cbn1cblxuLyoqXG4gKiBOb3JtYWxpemVzIHJlc291cmNlIGF0dHJpYnV0ZSBkZWZpbml0aW9ucyBpbnRvIGEgc29ydGVkIGFycmF5IG9mIHN0cmluZ3MuXG4gKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBhdHRyaWJ1dGVzIC0gUmF3IGF0dHJpYnV0ZXMgY29uZmlnIChhcnJheSBvciBvYmplY3QpLlxuICogQHJldHVybnMge3N0cmluZ1tdfSAtIFNvcnRlZCBhdHRyaWJ1dGUgbmFtZXMuXG4gKi9cbmZ1bmN0aW9uIG1hbmlmZXN0QXR0cmlidXRlcyhhdHRyaWJ1dGVzKSB7XG4gIGlmICghYXR0cmlidXRlcykgcmV0dXJuIFtdXG5cbiAgbGV0IG5hbWVzXG5cbiAgaWYgKEFycmF5LmlzQXJyYXkoYXR0cmlidXRlcykpIHtcbiAgICBuYW1lcyA9IGF0dHJpYnV0ZXMubWFwKChlbnRyeSkgPT4gdHlwZW9mIGVudHJ5ID09PSBcInN0cmluZ1wiID8gZW50cnkgOiBlbnRyeS5uYW1lKS5maWx0ZXIoQm9vbGVhbilcbiAgfSBlbHNlIGlmIChhdHRyaWJ1dGVzICYmIHR5cGVvZiBhdHRyaWJ1dGVzID09PSBcIm9iamVjdFwiKSB7XG4gICAgbmFtZXMgPSBPYmplY3Qua2V5cyhhdHRyaWJ1dGVzKVxuICB9IGVsc2Uge1xuICAgIHJldHVybiBbXVxuICB9XG5cbiAgcmV0dXJuIG5hbWVzLnNvcnQoKVxufVxuXG4vKipcbiAqIEJ1aWxkcyBtYW5pZmVzdC1zYWZlIGNvbW1hbmQgZW50cnkgbGlzdC5cbiAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gQXJndW1lbnRzLlxuICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCB7YXJnczogQXJyYXk8e25hbWU6IHN0cmluZywgdHlwZTogc3RyaW5nfT4sIHJldHVyblR5cGU6IHN0cmluZyB8IG51bGx9Pn0gYXJncy5jb21tYW5kTWV0YWRhdGEgLSBQZXItY29tbWFuZCBtZXRhZGF0YS5cbiAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgc3RyaW5nPn0gYXJncy5jb21tYW5kcyAtIE1ldGhvZCBuYW1lIOKGkiBrZWJhYiBzbHVnIG1hcC5cbiAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLnJlc291cmNlUGF0aCAtIFJlc291cmNlIHBhdGguXG4gKiBAcGFyYW0ge1wiY29sbGVjdGlvblwiIHwgXCJtZW1iZXJcIn0gYXJncy5zY29wZSAtIENvbW1hbmQgc2NvcGUuXG4gKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgdW5rbm93bj5bXX0gLSBNYW5pZmVzdCBjb21tYW5kIGVudHJpZXMuXG4gKi9cbmZ1bmN0aW9uIG1hbmlmZXN0Q29tbWFuZEVudHJpZXMoe2NvbW1hbmRNZXRhZGF0YSwgY29tbWFuZHMsIHJlc291cmNlUGF0aCwgc2NvcGV9KSB7XG4gIHJldHVybiBPYmplY3Qua2V5cyhjb21tYW5kcykuc29ydCgpLm1hcCgobWV0aG9kTmFtZSkgPT4ge1xuICAgIGNvbnN0IHNsdWcgPSBjb21tYW5kc1ttZXRob2ROYW1lXVxuICAgIGNvbnN0IG1ldGFkYXRhID0gY29tbWFuZE1ldGFkYXRhW21ldGhvZE5hbWVdIHx8IHthcmdzOiBbXSwgcmV0dXJuVHlwZTogbnVsbH1cbiAgICBjb25zdCBwYXRoID0gc2NvcGUgPT09IFwibWVtYmVyXCJcbiAgICAgID8gYCR7cmVzb3VyY2VQYXRofS88aWQ+LyR7c2x1Z31gXG4gICAgICA6IGAke3Jlc291cmNlUGF0aH0vJHtzbHVnfWBcblxuICAgIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgdW5rbm93bj59ICovXG4gICAgY29uc3QgZW50cnkgPSB7XG4gICAgICBtZXRob2ROYW1lLFxuICAgICAgc2NvcGUsXG4gICAgICBwYXRoLFxuICAgICAgYXJnczogbWV0YWRhdGEuYXJnc1xuICAgIH1cblxuICAgIGlmIChtZXRhZGF0YS5yZXR1cm5UeXBlKSB7XG4gICAgICBlbnRyeS5yZXR1cm5UeXBlID0gbWV0YWRhdGEucmV0dXJuVHlwZVxuICAgIH1cblxuICAgIHJldHVybiBlbnRyeVxuICB9KVxufVxuXG4vKipcbiAqIE5vcm1hbGl6ZXMgc3luYyBwb2xpY3kgbWV0YWRhdGEgYW5kIGNvbXB1dGVzIGEgZGV0ZXJtaW5pc3RpYyBoYXNoIGZyb20gc2FmZSBwb2xpY3kgaW5wdXRzLlxuICogQHBhcmFtIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkZyb250ZW5kTW9kZWxSZXNvdXJjZUNvbmZpZ3VyYXRpb259IHJlc291cmNlQ29uZmlndXJhdGlvbiAtIFJhdyByZXNvdXJjZSBjb25maWd1cmF0aW9uLlxuICogQHJldHVybnMge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuTm9ybWFsaXplZEZyb250ZW5kTW9kZWxSZXNvdXJjZVN5bmNDb25maWd1cmF0aW9uIHwgdW5kZWZpbmVkfSAtIEZyb250ZW5kLXNhZmUgc3luYyBtZXRhZGF0YS5cbiAqL1xuZnVuY3Rpb24gbm9ybWFsaXplRnJvbnRlbmRNb2RlbFJlc291cmNlU3luYyhyZXNvdXJjZUNvbmZpZ3VyYXRpb24pIHtcbiAgY29uc3Qgc3luYyA9IHJlc291cmNlQ29uZmlndXJhdGlvbi5zeW5jXG5cbiAgaWYgKHN5bmMgPT09IHVuZGVmaW5lZCB8fCBzeW5jID09PSBudWxsKSByZXR1cm4gdW5kZWZpbmVkXG4gIGlmIChzeW5jID09PSBmYWxzZSkgcmV0dXJuIHtjb25mbGljdFN0cmF0ZWd5OiBcIm9wdGltaXN0aWNWZXJzaW9uXCIsIGVuYWJsZWQ6IGZhbHNlLCBvcGVyYXRpb25zOiBbXSwgcG9saWN5SGFzaDogc3luY1BvbGljeUhhc2goe2NvbmZsaWN0U3RyYXRlZ3k6IFwib3B0aW1pc3RpY1ZlcnNpb25cIiwgZW5hYmxlZDogZmFsc2V9KSwgcG9saWN5VmVyc2lvbjogbnVsbH1cbiAgaWYgKHN5bmMgPT09IHRydWUpIHtcbiAgICByZXR1cm4gbm9ybWFsaXplRnJvbnRlbmRNb2RlbFJlc291cmNlU3luYyh7XG4gICAgICAuLi5yZXNvdXJjZUNvbmZpZ3VyYXRpb24sXG4gICAgICBzeW5jOiB7b3BlcmF0aW9uczogW1wiaW5kZXhcIiwgXCJmaW5kXCJdfVxuICAgIH0pXG4gIH1cbiAgaWYgKCFzeW5jIHx8IHR5cGVvZiBzeW5jICE9PSBcIm9iamVjdFwiIHx8IEFycmF5LmlzQXJyYXkoc3luYykpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXCJSZXNvdXJjZSBzeW5jIGNvbmZpZ3VyYXRpb24gbXVzdCBiZSB0cnVlLCBmYWxzZSwgb3IgYW4gb2JqZWN0LlwiKVxuICB9XG5cbiAgY29uc3Qge2NvbmZsaWN0U3RyYXRlZ3ksIGVuYWJsZWQgPSB0cnVlLCBtZXRhZGF0YSwgb3BlcmF0aW9ucywgcG9saWN5LCBwb2xpY3lWZXJzaW9uLCAuLi5yZXN0fSA9IC8qKiBAdHlwZSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Gcm9udGVuZE1vZGVsUmVzb3VyY2VTeW5jQ29uZmlndXJhdGlvbn0gKi8gKHN5bmMpXG5cbiAgaWYgKE9iamVjdC5rZXlzKHJlc3QpLmxlbmd0aCA+IDApIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYFVuZXhwZWN0ZWQgc3luYyBrZXlzOiAke09iamVjdC5rZXlzKHJlc3QpLmpvaW4oXCIsIFwiKX0uIEFsbG93ZWQ6IGNvbmZsaWN0U3RyYXRlZ3ksIGVuYWJsZWQsIG1ldGFkYXRhLCBvcGVyYXRpb25zLCBwb2xpY3ksIHBvbGljeVZlcnNpb25gKVxuICB9XG4gIGlmIChlbmFibGVkICE9PSB0cnVlICYmIGVuYWJsZWQgIT09IGZhbHNlKSB0aHJvdyBuZXcgRXJyb3IoXCJSZXNvdXJjZSBzeW5jIGVuYWJsZWQgbXVzdCBiZSB0cnVlIG9yIGZhbHNlIHdoZW4gcHJvdmlkZWQuXCIpXG5cbiAgY29uc3Qgbm9ybWFsaXplZENvbmZsaWN0U3RyYXRlZ3kgPSBub3JtYWxpemVTeW5jQ29uZmxpY3RTdHJhdGVneShjb25mbGljdFN0cmF0ZWd5KVxuICBjb25zdCBub3JtYWxpemVkT3BlcmF0aW9ucyA9IG5vcm1hbGl6ZVN5bmNPcGVyYXRpb25zKG9wZXJhdGlvbnMpXG4gIGNvbnN0IG5vcm1hbGl6ZWRNZXRhZGF0YSA9IG1ldGFkYXRhID09PSB1bmRlZmluZWQgPyB1bmRlZmluZWQgOiBkZXRlcm1pbmlzdGljU3luY0pzb24oe2xhYmVsOiBcIm1ldGFkYXRhXCIsIHZhbHVlOiBtZXRhZGF0YX0pXG4gIGNvbnN0IG5vcm1hbGl6ZWRQb2xpY3kgPSBwb2xpY3kgPT09IHVuZGVmaW5lZCA/IHVuZGVmaW5lZCA6IGRldGVybWluaXN0aWNTeW5jSnNvbih7bGFiZWw6IFwicG9saWN5XCIsIHZhbHVlOiBwb2xpY3l9KVxuICBjb25zdCBub3JtYWxpemVkUG9saWN5VmVyc2lvbiA9IHBvbGljeVZlcnNpb24gPT09IHVuZGVmaW5lZCB8fCBwb2xpY3lWZXJzaW9uID09PSBudWxsID8gbnVsbCA6IFN0cmluZyhwb2xpY3lWZXJzaW9uKVxuICBjb25zdCBoYXNoSW5wdXQgPSB7XG4gICAgY29uZmxpY3RTdHJhdGVneTogbm9ybWFsaXplZENvbmZsaWN0U3RyYXRlZ3ksXG4gICAgZW5hYmxlZCxcbiAgICBtZXRhZGF0YTogbm9ybWFsaXplZE1ldGFkYXRhLFxuICAgIG1vZGVsTmFtZTogcmVzb3VyY2VDb25maWd1cmF0aW9uLm1vZGVsTmFtZSB8fCBudWxsLFxuICAgIG9wZXJhdGlvbnM6IG5vcm1hbGl6ZWRPcGVyYXRpb25zLFxuICAgIHBvbGljeTogbm9ybWFsaXplZFBvbGljeSxcbiAgICBwb2xpY3lWZXJzaW9uOiBub3JtYWxpemVkUG9saWN5VmVyc2lvblxuICB9XG4gIC8qKiBAdHlwZSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Ob3JtYWxpemVkRnJvbnRlbmRNb2RlbFJlc291cmNlU3luY0NvbmZpZ3VyYXRpb259ICovXG4gIGNvbnN0IG5vcm1hbGl6ZWQgPSB7XG4gICAgY29uZmxpY3RTdHJhdGVneTogbm9ybWFsaXplZENvbmZsaWN0U3RyYXRlZ3ksXG4gICAgZW5hYmxlZCxcbiAgICBvcGVyYXRpb25zOiBub3JtYWxpemVkT3BlcmF0aW9ucyxcbiAgICBwb2xpY3lIYXNoOiBzeW5jUG9saWN5SGFzaChoYXNoSW5wdXQpLFxuICAgIHBvbGljeVZlcnNpb246IG5vcm1hbGl6ZWRQb2xpY3lWZXJzaW9uXG4gIH1cblxuICBpZiAobm9ybWFsaXplZE1ldGFkYXRhICE9PSB1bmRlZmluZWQpIG5vcm1hbGl6ZWQubWV0YWRhdGEgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIGltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRnJvbnRlbmRNb2RlbFN5bmNKc29uVmFsdWU+fSAqLyAobm9ybWFsaXplZE1ldGFkYXRhKVxuXG4gIHJldHVybiBub3JtYWxpemVkXG59XG5cbi8qKlxuICogTm9ybWFsaXplcyB0aGUgc3luYyBjb25mbGljdCBzdHJhdGVneSBmb3IgcmVwbGF5IGNsaWVudHMvc2VydmVycy5cbiAqIEBwYXJhbSB7dW5rbm93bn0gY29uZmxpY3RTdHJhdGVneSAtIFJhdyBzdHJhdGVneS5cbiAqIEByZXR1cm5zIHtcIm9wdGltaXN0aWNWZXJzaW9uXCIgfCBcInNlcnZlcldpbnNcIiB8IFwibGFzdFdyaXRlcldpbnNcIiB8IFwiZmllbGRUaHJlZVdheVwiIHwgXCJhcHBlbmRPbmx5XCJ9IC0gTm9ybWFsaXplZCBzdHJhdGVneS5cbiAqL1xuZnVuY3Rpb24gbm9ybWFsaXplU3luY0NvbmZsaWN0U3RyYXRlZ3koY29uZmxpY3RTdHJhdGVneSkge1xuICBpZiAoY29uZmxpY3RTdHJhdGVneSA9PT0gdW5kZWZpbmVkIHx8IGNvbmZsaWN0U3RyYXRlZ3kgPT09IG51bGwpIHJldHVybiBcIm9wdGltaXN0aWNWZXJzaW9uXCJcbiAgaWYgKFtcIm9wdGltaXN0aWNWZXJzaW9uXCIsIFwic2VydmVyV2luc1wiLCBcImxhc3RXcml0ZXJXaW5zXCIsIFwiZmllbGRUaHJlZVdheVwiLCBcImFwcGVuZE9ubHlcIl0uaW5jbHVkZXMoU3RyaW5nKGNvbmZsaWN0U3RyYXRlZ3kpKSkge1xuICAgIHJldHVybiAvKiogQHR5cGUge1wib3B0aW1pc3RpY1ZlcnNpb25cIiB8IFwic2VydmVyV2luc1wiIHwgXCJsYXN0V3JpdGVyV2luc1wiIHwgXCJmaWVsZFRocmVlV2F5XCIgfCBcImFwcGVuZE9ubHlcIn0gKi8gKGNvbmZsaWN0U3RyYXRlZ3kpXG4gIH1cblxuICB0aHJvdyBuZXcgRXJyb3IoYFVua25vd24gcmVzb3VyY2Ugc3luYyBjb25mbGljdFN0cmF0ZWd5OiAke1N0cmluZyhjb25mbGljdFN0cmF0ZWd5KX1gKVxufVxuXG4vKipcbiAqIE5vcm1hbGl6ZXMgc3luYyBvcGVyYXRpb25zIGludG8gYSBzdGFibGUsIGR1cGxpY2F0ZS1mcmVlIGxpc3QuXG4gKiBAcGFyYW0ge3Vua25vd259IG9wZXJhdGlvbnMgLSBSYXcgb3BlcmF0aW9ucyB2YWx1ZS5cbiAqIEByZXR1cm5zIHtzdHJpbmdbXX0gLSBOb3JtYWxpemVkIG9wZXJhdGlvbnMuXG4gKi9cbmZ1bmN0aW9uIG5vcm1hbGl6ZVN5bmNPcGVyYXRpb25zKG9wZXJhdGlvbnMpIHtcbiAgaWYgKG9wZXJhdGlvbnMgPT09IHVuZGVmaW5lZCkgcmV0dXJuIFtdXG4gIGlmICghQXJyYXkuaXNBcnJheShvcGVyYXRpb25zKSkgdGhyb3cgbmV3IEVycm9yKFwiUmVzb3VyY2Ugc3luYyBvcGVyYXRpb25zIG11c3QgYmUgYW4gYXJyYXkgb2Ygb3BlcmF0aW9uIG5hbWVzLlwiKVxuXG4gIGNvbnN0IG5vcm1hbGl6ZWQgPSBvcGVyYXRpb25zLm1hcCgob3BlcmF0aW9uKSA9PiB7XG4gICAgaWYgKHR5cGVvZiBvcGVyYXRpb24gIT09IFwic3RyaW5nXCIgfHwgb3BlcmF0aW9uLmxlbmd0aCA8IDEpIHRocm93IG5ldyBFcnJvcihcIlJlc291cmNlIHN5bmMgb3BlcmF0aW9ucyBlbnRyaWVzIG11c3QgYmUgbm9uLWVtcHR5IHN0cmluZ3MuXCIpXG5cbiAgICByZXR1cm4gb3BlcmF0aW9uXG4gIH0pXG5cbiAgcmV0dXJuIFsuLi5uZXcgU2V0KG5vcm1hbGl6ZWQpXS5zb3J0KClcbn1cblxuLyoqXG4gKiBOb3JtYWxpemVzIGRlY2xhcmF0aXZlIHF1aWNrLXNlYXJjaCBjb2x1bW4gZW50cmllcyBpbnRvIGEgc3RhYmxlIGxpc3QuXG4gKiBFYWNoIGVudHJ5IGlzIGEgcGxhaW4gY29sdW1uLW5hbWUgc3RyaW5nIG9yIGEgYHtwYXRoLCBjb2x1bW59YCBvYmplY3Qgd2hvc2VcbiAqIHBhdGggaXMgYSByZWxhdGlvbnNoaXAgcGF0aCBmcm9tIHRoZSByb290IG1vZGVsLlxuICogQHBhcmFtIHt1bmtub3dufSBjb2x1bW5zIC0gUmF3IHF1aWNrLXNlYXJjaCBjb2x1bW4gZGVjbGFyYXRpb25zLlxuICogQHBhcmFtIHtzdHJpbmd9IGxhYmVsIC0gQ29uZmlnIGtleSBsYWJlbCBmb3IgZXJyb3IgbWVzc2FnZXMuXG4gKiBAcmV0dXJucyB7QXJyYXk8aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Gcm9udGVuZE1vZGVsUXVpY2tTZWFyY2hDb2x1bW4+IHwgbnVsbH0gLSBOb3JtYWxpemVkIGNvbHVtbnMsIG9yIG51bGwgd2hlbiB1bmRlY2xhcmVkLlxuICovXG5mdW5jdGlvbiBub3JtYWxpemVGcm9udGVuZE1vZGVsUXVpY2tTZWFyY2hDb2x1bW5zKGNvbHVtbnMsIGxhYmVsKSB7XG4gIGlmIChjb2x1bW5zID09PSB1bmRlZmluZWQgfHwgY29sdW1ucyA9PT0gbnVsbCkgcmV0dXJuIG51bGxcblxuICBpZiAoIUFycmF5LmlzQXJyYXkoY29sdW1ucykpIHRocm93IG5ldyBFcnJvcihgUmVzb3VyY2UgJHtsYWJlbH0gbXVzdCBiZSBhbiBhcnJheSBvZiBjb2x1bW4gbmFtZXMgb3Ige3BhdGgsIGNvbHVtbn0gb2JqZWN0cy5gKVxuXG4gIHJldHVybiBjb2x1bW5zLm1hcCgoZW50cnkpID0+IHtcbiAgICBpZiAodHlwZW9mIGVudHJ5ID09PSBcInN0cmluZ1wiKSB7XG4gICAgICBpZiAoZW50cnkubGVuZ3RoIDwgMSkgdGhyb3cgbmV3IEVycm9yKGBSZXNvdXJjZSAke2xhYmVsfSBlbnRyaWVzIG11c3QgYmUgbm9uLWVtcHR5IGNvbHVtbiBuYW1lcy5gKVxuXG4gICAgICByZXR1cm4ge2NvbHVtbjogZW50cnl9XG4gICAgfVxuXG4gICAgaWYgKCFlbnRyeSB8fCB0eXBlb2YgZW50cnkgIT09IFwib2JqZWN0XCIgfHwgQXJyYXkuaXNBcnJheShlbnRyeSkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgUmVzb3VyY2UgJHtsYWJlbH0gZW50cmllcyBtdXN0IGJlIGNvbHVtbiBuYW1lcyBvciB7cGF0aCwgY29sdW1ufSBvYmplY3RzLCBnb3Q6ICR7SlNPTi5zdHJpbmdpZnkoZW50cnkpfWApXG4gICAgfVxuXG4gICAgY29uc3QgZW50cnlSZWNvcmQgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIHVua25vd24+fSAqLyAoZW50cnkpXG4gICAgY29uc3QgY29sdW1uID0gZW50cnlSZWNvcmQuY29sdW1uXG4gICAgY29uc3QgcGF0aCA9IGVudHJ5UmVjb3JkLnBhdGhcblxuICAgIGlmICh0eXBlb2YgY29sdW1uICE9PSBcInN0cmluZ1wiIHx8IGNvbHVtbi5sZW5ndGggPCAxKSB0aHJvdyBuZXcgRXJyb3IoYFJlc291cmNlICR7bGFiZWx9IGVudHJpZXMgcmVxdWlyZSBhIG5vbi1lbXB0eSBjb2x1bW4gbmFtZS5gKVxuXG4gICAgaWYgKHBhdGggPT09IHVuZGVmaW5lZCB8fCBwYXRoID09PSBudWxsKSByZXR1cm4ge2NvbHVtbn1cblxuICAgIGlmICghQXJyYXkuaXNBcnJheShwYXRoKSB8fCBwYXRoLnNvbWUoKHBhdGhTZWdtZW50KSA9PiB0eXBlb2YgcGF0aFNlZ21lbnQgIT09IFwic3RyaW5nXCIgfHwgcGF0aFNlZ21lbnQubGVuZ3RoIDwgMSkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgUmVzb3VyY2UgJHtsYWJlbH0gZW50cnkgcGF0aHMgbXVzdCBiZSBhcnJheXMgb2Ygbm9uLWVtcHR5IHJlbGF0aW9uc2hpcCBuYW1lcy5gKVxuICAgIH1cblxuICAgIHJldHVybiB7Y29sdW1uLCBwYXRoOiBbLi4ucGF0aF19XG4gIH0pXG59XG5cbi8qKlxuICogQnVpbGRzIGEgZGV0ZXJtaW5pc3RpYyBwb2xpY3kgaGFzaC5cbiAqIEBwYXJhbSB7dW5rbm93bn0gdmFsdWUgLSBIYXNoIGlucHV0LlxuICogQHJldHVybnMge3N0cmluZ30gLSBzaGEyNTYtcHJlZml4ZWQgaGFzaC5cbiAqL1xuZnVuY3Rpb24gc3luY1BvbGljeUhhc2godmFsdWUpIHtcbiAgcmV0dXJuIGBzaGEyNTYtJHtzaGEyNTZIZXgoc3RhYmxlSnNvblN0cmluZ2lmeSh2YWx1ZSkpfWBcbn1cblxuLyoqXG4gKiBWYWxpZGF0ZXMgdGhhdCBhIHN5bmMgY29uZmlnIHN1YnRyZWUgaXMgZGV0ZXJtaW5pc3RpYyBKU09OIGFuZCBkb2VzIG5vdCBjb250YWluIG9idmlvdXMgc2VjcmV0cy5cbiAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gQXJndW1lbnRzLlxuICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MubGFiZWwgLSBEaWFnbm9zdGljIHBhdGggbGFiZWwuXG4gKiBAcGFyYW0ge3Vua25vd259IGFyZ3MudmFsdWUgLSBWYWx1ZSB0byB2YWxpZGF0ZS5cbiAqIEByZXR1cm5zIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkZyb250ZW5kTW9kZWxTeW5jSnNvblZhbHVlfSAtIFN0YWJsZSBKU09OIHZhbHVlLlxuICovXG5mdW5jdGlvbiBkZXRlcm1pbmlzdGljU3luY0pzb24oe2xhYmVsLCB2YWx1ZX0pIHtcbiAgaWYgKHZhbHVlID09PSBudWxsIHx8IHR5cGVvZiB2YWx1ZSA9PT0gXCJzdHJpbmdcIiB8fCB0eXBlb2YgdmFsdWUgPT09IFwibnVtYmVyXCIgfHwgdHlwZW9mIHZhbHVlID09PSBcImJvb2xlYW5cIikgcmV0dXJuIHZhbHVlXG5cbiAgaWYgKEFycmF5LmlzQXJyYXkodmFsdWUpKSB7XG4gICAgcmV0dXJuIHZhbHVlLm1hcCgoZW50cnksIGluZGV4KSA9PiBkZXRlcm1pbmlzdGljU3luY0pzb24oe2xhYmVsOiBgJHtsYWJlbH0vJHtpbmRleH1gLCB2YWx1ZTogZW50cnl9KSlcbiAgfVxuXG4gIGlmICh2YWx1ZSAmJiB0eXBlb2YgdmFsdWUgPT09IFwib2JqZWN0XCIgJiYgT2JqZWN0LmdldFByb3RvdHlwZU9mKHZhbHVlKSA9PT0gT2JqZWN0LnByb3RvdHlwZSkge1xuICAgIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Gcm9udGVuZE1vZGVsU3luY0pzb25WYWx1ZT59ICovXG4gICAgY29uc3Qgbm9ybWFsaXplZCA9IHt9XG5cbiAgICBmb3IgKGNvbnN0IGtleSBvZiBPYmplY3Qua2V5cyh2YWx1ZSkuc29ydCgpKSB7XG4gICAgICBjb25zdCBjaGlsZFZhbHVlID0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCB1bmtub3duPn0gKi8gKHZhbHVlKVtrZXldXG5cbiAgICAgIGlmIChjaGlsZFZhbHVlID09PSB1bmRlZmluZWQpIGNvbnRpbnVlXG4gICAgICBpZiAoc3luY0NvbmZpZ0tleUxvb2tzU2VjcmV0KGtleSkpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBTeW5jIHBvbGljeSAke2xhYmVsfS8ke2tleX0gaXMgbm90IGFsbG93ZWQgaW4gZnJvbnRlbmQtdmlzaWJsZSBzeW5jIHBvbGljeSBjb25maWdgKVxuICAgICAgfVxuXG4gICAgICBub3JtYWxpemVkW2tleV0gPSBkZXRlcm1pbmlzdGljU3luY0pzb24oe2xhYmVsOiBgJHtsYWJlbH0vJHtrZXl9YCwgdmFsdWU6IGNoaWxkVmFsdWV9KVxuICAgIH1cblxuICAgIHJldHVybiBub3JtYWxpemVkXG4gIH1cblxuICB0aHJvdyBuZXcgRXJyb3IoXCJTeW5jIHBvbGljeSBpbnB1dCBtdXN0IGJlIGRldGVybWluaXN0aWMgSlNPTlwiKVxufVxuXG4vKipcbiAqIFN0YWJsZSBKU09OIHN0cmluZ2lmaWVyIHdpdGggc29ydGVkIG9iamVjdCBrZXlzLlxuICogQHBhcmFtIHt1bmtub3dufSB2YWx1ZSAtIFZhbHVlIHRvIHN0cmluZ2lmeS5cbiAqIEByZXR1cm5zIHtzdHJpbmd9IC0gU3RhYmxlIEpTT04uXG4gKi9cbmZ1bmN0aW9uIHN0YWJsZUpzb25TdHJpbmdpZnkodmFsdWUpIHtcbiAgcmV0dXJuIEpTT04uc3RyaW5naWZ5KGRldGVybWluaXN0aWNTeW5jSnNvbih7bGFiZWw6IFwiaGFzaFwiLCB2YWx1ZX0pKVxufVxuXG4vKipcbiAqIFJldHVybnMgd2hldGhlciBhIHN5bmMgY29uZmlnIGtleSBsb29rcyBsaWtlIGEgY3JlZGVudGlhbC9zZWNyZXQuXG4gKiBAcGFyYW0ge3N0cmluZ30ga2V5IC0gT2JqZWN0IGtleS5cbiAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIga2V5IGlzIGRpc2FsbG93ZWQuXG4gKi9cbmZ1bmN0aW9uIHN5bmNDb25maWdLZXlMb29rc1NlY3JldChrZXkpIHtcbiAgcmV0dXJuIC9zZWNyZXR8dG9rZW58cGFzc3dvcmR8cHJpdmF0ZS4/a2V5fHNpZ25pbmcuP2tleS9pLnRlc3Qoa2V5KVxufVxuXG4vKipcbiAqIFJ1bnMgbm9ybWFsaXplIGZyb250ZW5kIG1vZGVsIHJlc291cmNlIGNvbW1hbmRzLlxuICogQHBhcmFtIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkZyb250ZW5kTW9kZWxSZXNvdXJjZUNvbmZpZ3VyYXRpb259IHJlc291cmNlQ29uZmlndXJhdGlvbiAtIFJhdyByZXNvdXJjZSBjb25maWd1cmF0aW9uLlxuICogQHJldHVybnMge3tidWlsdEluQ29sbGVjdGlvbkNvbW1hbmRzOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+LCBidWlsdEluTWVtYmVyQ29tbWFuZHM6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4sIGNvbGxlY3Rpb25Db21tYW5kczogUmVjb3JkPHN0cmluZywgc3RyaW5nPiwgY29tbWFuZE1ldGFkYXRhOiBSZWNvcmQ8c3RyaW5nLCB7YXJnczogQXJyYXk8e25hbWU6IHN0cmluZywgdHlwZTogc3RyaW5nfT4sIHJldHVyblR5cGU6IHN0cmluZyB8IG51bGx9PiwgbWVtYmVyQ29tbWFuZHM6IFJlY29yZDxzdHJpbmcsIHN0cmluZz59fSAtIE5vcm1hbGl6ZWQgY29tbWFuZCBjb25maWd1cmF0aW9uLlxuICovXG5mdW5jdGlvbiBub3JtYWxpemVGcm9udGVuZE1vZGVsUmVzb3VyY2VDb21tYW5kcyhyZXNvdXJjZUNvbmZpZ3VyYXRpb24pIHtcbiAgY29uc3QgYnVpbHRJbkNvbGxlY3Rpb25Db21tYW5kcyA9IHJlc291cmNlQ29uZmlndXJhdGlvbi5idWlsdEluQ29sbGVjdGlvbkNvbW1hbmRzXG4gIGNvbnN0IGJ1aWx0SW5NZW1iZXJDb21tYW5kcyA9IHJlc291cmNlQ29uZmlndXJhdGlvbi5idWlsdEluTWVtYmVyQ29tbWFuZHNcbiAgY29uc3QgY3VzdG9tQ29sbGVjdGlvbkNvbW1hbmRzID0gcmVzb3VyY2VDb25maWd1cmF0aW9uLmNvbGxlY3Rpb25Db21tYW5kc1xuICBjb25zdCBjdXN0b21NZW1iZXJDb21tYW5kcyA9IHJlc291cmNlQ29uZmlndXJhdGlvbi5tZW1iZXJDb21tYW5kc1xuICBjb25zdCBub3JtYWxpemVkQnVpbHRJbkNvbGxlY3Rpb25Db21tYW5kcyA9IG5vcm1hbGl6ZUZyb250ZW5kTW9kZWxCdWlsdEluQ29tbWFuZHMoe1xuICAgIGNvbW1hbmREZWZhdWx0czoge1xuICAgICAgY3JlYXRlOiBcImNyZWF0ZVwiLFxuICAgICAgaW5kZXg6IFwiaW5kZXhcIlxuICAgIH0sXG4gICAgY29tbWFuZHNDb25maWc6IGJ1aWx0SW5Db2xsZWN0aW9uQ29tbWFuZHMsXG4gICAgbW9kZWxOYW1lOiBcIkNvbGxlY3Rpb25Db21tYW5kXCJcbiAgfSlcbiAgY29uc3Qgbm9ybWFsaXplZEJ1aWx0SW5NZW1iZXJDb21tYW5kcyA9IG5vcm1hbGl6ZUZyb250ZW5kTW9kZWxCdWlsdEluQ29tbWFuZHMoe1xuICAgIGNvbW1hbmREZWZhdWx0czoge1xuICAgICAgYXR0YWNoOiBcImF0dGFjaFwiLFxuICAgICAgYXR0YWNobWVudExpc3Q6IFwiYXR0YWNobWVudExpc3RcIixcbiAgICAgIGRlc3Ryb3k6IFwiZGVzdHJveVwiLFxuICAgICAgZG93bmxvYWQ6IFwiZG93bmxvYWRcIixcbiAgICAgIGZpbmQ6IFwiZmluZFwiLFxuICAgICAgdXBkYXRlOiBcInVwZGF0ZVwiLFxuICAgICAgdXJsOiBcInVybFwiXG4gICAgfSxcbiAgICBjb21tYW5kc0NvbmZpZzogYnVpbHRJbk1lbWJlckNvbW1hbmRzLFxuICAgIG1vZGVsTmFtZTogXCJNZW1iZXJDb21tYW5kXCJcbiAgfSlcblxuICBjb25zdCBub3JtYWxpemVkQ29sbGVjdGlvbkNvbW1hbmRzID0gbm9ybWFsaXplRnJvbnRlbmRNb2RlbEN1c3RvbUNvbW1hbmRzKHtjb21tYW5kc0NvbmZpZzogY3VzdG9tQ29sbGVjdGlvbkNvbW1hbmRzLCBtb2RlbE5hbWU6IFwiQ29sbGVjdGlvbkNvbW1hbmRcIn0pXG4gIGNvbnN0IG5vcm1hbGl6ZWRNZW1iZXJDb21tYW5kcyA9IG5vcm1hbGl6ZUZyb250ZW5kTW9kZWxDdXN0b21Db21tYW5kcyh7Y29tbWFuZHNDb25maWc6IGN1c3RvbU1lbWJlckNvbW1hbmRzLCBtb2RlbE5hbWU6IFwiTWVtYmVyQ29tbWFuZFwifSlcblxuICByZXR1cm4ge1xuICAgIGJ1aWx0SW5Db2xsZWN0aW9uQ29tbWFuZHM6IG5vcm1hbGl6ZWRCdWlsdEluQ29sbGVjdGlvbkNvbW1hbmRzLFxuICAgIGJ1aWx0SW5NZW1iZXJDb21tYW5kczogbm9ybWFsaXplZEJ1aWx0SW5NZW1iZXJDb21tYW5kcyxcbiAgICBjb2xsZWN0aW9uQ29tbWFuZHM6IG5vcm1hbGl6ZWRDb2xsZWN0aW9uQ29tbWFuZHMuY29tbWFuZHMsXG4gICAgY29tbWFuZE1ldGFkYXRhOiB7Li4ubm9ybWFsaXplZENvbGxlY3Rpb25Db21tYW5kcy5tZXRhZGF0YSwgLi4ubm9ybWFsaXplZE1lbWJlckNvbW1hbmRzLm1ldGFkYXRhfSxcbiAgICBtZW1iZXJDb21tYW5kczogbm9ybWFsaXplZE1lbWJlckNvbW1hbmRzLmNvbW1hbmRzXG4gIH1cbn1cblxuLyoqXG4gKiBSdW5zIG5vcm1hbGl6ZSBmcm9udGVuZCBtb2RlbCBidWlsdCBpbiBjb21tYW5kcy5cbiAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gQXJndW1lbnRzLlxuICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+fSBhcmdzLmNvbW1hbmREZWZhdWx0cyAtIEJ1aWx0LWluIGRlZmF1bHQgY29tbWFuZCBuYW1lcy5cbiAqIEBwYXJhbSB7c3RyaW5nW10gfCB1bmRlZmluZWR9IGFyZ3MuY29tbWFuZHNDb25maWcgLSBCdWlsdC1pbiBjb21tYW5kcyBjb25maWcgKGNhbWVsQ2FzZSBjb21tYW5kIHR5cGUgbGlzdCkuXG4gKiBAcGFyYW0ge3N0cmluZ30gYXJncy5tb2RlbE5hbWUgLSBEaWFnbm9zdGljIG1vZGVsIG5hbWUuXG4gKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgc3RyaW5nPn0gLSBOb3JtYWxpemVkIGJ1aWx0LWluIGNvbW1hbmQgY29uZmlnLlxuICovXG5mdW5jdGlvbiBub3JtYWxpemVGcm9udGVuZE1vZGVsQnVpbHRJbkNvbW1hbmRzKHtjb21tYW5kRGVmYXVsdHMsIGNvbW1hbmRzQ29uZmlnLCBtb2RlbE5hbWV9KSB7XG4gIGlmICghY29tbWFuZHNDb25maWcpIHtcbiAgICByZXR1cm4gY29tbWFuZERlZmF1bHRzXG4gIH1cblxuICBpZiAoIUFycmF5LmlzQXJyYXkoY29tbWFuZHNDb25maWcpKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGAke21vZGVsTmFtZX0gY29uZmlndXJhdGlvbiBtdXN0IHVzZSB0aGUgYXJyYXkgZm9ybS4gT2JqZWN0IGZvcm0gaXMgbm8gbG9uZ2VyIHN1cHBvcnRlZC5gKVxuICB9XG5cbiAgLyoqXG4gICAqIE5vcm1hbGl6ZWQgY29tbWFuZHMuXG4gICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+fSAqL1xuICBjb25zdCBub3JtYWxpemVkQ29tbWFuZHMgPSB7fVxuXG4gIGZvciAoY29uc3QgY29tbWFuZFR5cGUgb2YgY29tbWFuZHNDb25maWcpIHtcbiAgICBjb25zdCBkZWZhdWx0Q29tbWFuZE5hbWUgPSBjb21tYW5kRGVmYXVsdHNbY29tbWFuZFR5cGVdXG5cbiAgICBpZiAoIWRlZmF1bHRDb21tYW5kTmFtZSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBVbmtub3duIGJ1aWx0LWluIGZyb250ZW5kIG1vZGVsIGNvbW1hbmQgJyR7Y29tbWFuZFR5cGV9JyBmb3IgJHttb2RlbE5hbWV9YClcbiAgICB9XG5cbiAgICBub3JtYWxpemVkQ29tbWFuZHNbY29tbWFuZFR5cGVdID0gdmFsaWRhdGVGcm9udGVuZE1vZGVsUmVzb3VyY2VDb21tYW5kTmFtZSh7XG4gICAgICBjb21tYW5kTmFtZTogZGVmYXVsdENvbW1hbmROYW1lLFxuICAgICAgY29tbWFuZFR5cGU6IGRlZmF1bHRDb21tYW5kTmFtZSxcbiAgICAgIG1vZGVsTmFtZVxuICAgIH0pXG4gIH1cblxuICByZXR1cm4gbm9ybWFsaXplZENvbW1hbmRzXG59XG5cbi8qKlxuICogUnVucyBub3JtYWxpemUgZnJvbnRlbmQgbW9kZWwgY3VzdG9tIGNvbW1hbmRzLiBFbnRyaWVzIGFyZSBlaXRoZXIgYSBwbGFpblxuICogY2FtZWxDYXNlIG1ldGhvZC1uYW1lIHN0cmluZyBvciBhIGB7bmFtZSwgYXJncz8sIHJldHVyblR5cGU/fWAgb2JqZWN0IHRoYXRcbiAqIGFsc28gZGVjbGFyZXMgdGhlIGNvbW1hbmQncyB0eXBlZCBhcmd1bWVudHMgYW5kL29yIHJlc3BvbnNlIHR5cGUuXG4gKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEFyZ3VtZW50cy5cbiAqIEBwYXJhbSB7QXJyYXk8c3RyaW5nIHwge25hbWU6IHN0cmluZywgYXJncz86IEFycmF5PHtuYW1lOiBzdHJpbmcsIHR5cGU6IHN0cmluZ30+LCByZXR1cm5UeXBlPzogc3RyaW5nfT4gfCB1bmRlZmluZWR9IGFyZ3MuY29tbWFuZHNDb25maWcgLSBDdXN0b20gY29tbWFuZHMgY29uZmlnLlxuICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MubW9kZWxOYW1lIC0gRGlhZ25vc3RpYyBtb2RlbCBuYW1lLlxuICogQHJldHVybnMge3tjb21tYW5kczogUmVjb3JkPHN0cmluZywgc3RyaW5nPiwgbWV0YWRhdGE6IFJlY29yZDxzdHJpbmcsIHthcmdzOiBBcnJheTx7bmFtZTogc3RyaW5nLCB0eXBlOiBzdHJpbmd9PiwgcmV0dXJuVHlwZTogc3RyaW5nIHwgbnVsbH0+fX0gLSBSb3V0ZSBtYXAgKG1ldGhvZCBuYW1lIOKGkiBrZWJhYiBzbHVnKSArIHBlci1jb21tYW5kIG1ldGFkYXRhLlxuICovXG5mdW5jdGlvbiBub3JtYWxpemVGcm9udGVuZE1vZGVsQ3VzdG9tQ29tbWFuZHMoe2NvbW1hbmRzQ29uZmlnLCBtb2RlbE5hbWV9KSB7XG4gIGlmICghY29tbWFuZHNDb25maWcpIHtcbiAgICByZXR1cm4ge2NvbW1hbmRzOiB7fSwgbWV0YWRhdGE6IHt9fVxuICB9XG5cbiAgaWYgKCFBcnJheS5pc0FycmF5KGNvbW1hbmRzQ29uZmlnKSkge1xuICAgIHRocm93IG5ldyBFcnJvcihgJHttb2RlbE5hbWV9IGNvbmZpZ3VyYXRpb24gbXVzdCB1c2UgdGhlIGFycmF5IGZvcm0uIE9iamVjdCBmb3JtIGlzIG5vIGxvbmdlciBzdXBwb3J0ZWQuYClcbiAgfVxuXG4gIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgc3RyaW5nPn0gKi9cbiAgY29uc3QgY29tbWFuZHMgPSB7fVxuICAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIHthcmdzOiBBcnJheTx7bmFtZTogc3RyaW5nLCB0eXBlOiBzdHJpbmd9PiwgcmV0dXJuVHlwZTogc3RyaW5nIHwgbnVsbH0+fSAqL1xuICBjb25zdCBtZXRhZGF0YSA9IHt9XG5cbiAgZm9yIChjb25zdCBjb21tYW5kRW50cnkgb2YgY29tbWFuZHNDb25maWcpIHtcbiAgICBjb25zdCB7bWV0aG9kTmFtZSwgYXJncywgcmV0dXJuVHlwZX0gPSBub3JtYWxpemVGcm9udGVuZE1vZGVsQ3VzdG9tQ29tbWFuZEVudHJ5KHtjb21tYW5kRW50cnksIG1vZGVsTmFtZX0pXG4gICAgY29uc3QgdmFsaWRhdGVkTWV0aG9kTmFtZSA9IHZhbGlkYXRlRnJvbnRlbmRNb2RlbFJlc291cmNlQ29tbWFuZE5hbWUoe1xuICAgICAgY29tbWFuZE5hbWU6IG1ldGhvZE5hbWUsXG4gICAgICBjb21tYW5kVHlwZTogbWV0aG9kTmFtZSxcbiAgICAgIG1vZGVsTmFtZVxuICAgIH0pXG4gICAgY29uc3QgY29tbWFuZFNsdWcgPSBpbmZsZWN0aW9uLmRhc2hlcml6ZShpbmZsZWN0aW9uLnVuZGVyc2NvcmUodmFsaWRhdGVkTWV0aG9kTmFtZSkpXG5cbiAgICBjb21tYW5kc1t2YWxpZGF0ZWRNZXRob2ROYW1lXSA9IGNvbW1hbmRTbHVnXG4gICAgbWV0YWRhdGFbdmFsaWRhdGVkTWV0aG9kTmFtZV0gPSB7YXJncywgcmV0dXJuVHlwZX1cbiAgfVxuXG4gIHJldHVybiB7Y29tbWFuZHMsIG1ldGFkYXRhfVxufVxuXG4vKipcbiAqIE5vcm1hbGl6ZXMgb25lIGN1c3RvbS1jb21tYW5kIGVudHJ5IChzdHJpbmcgc2hvcnRoYW5kIG9yIGNvbnRyYWN0IG9iamVjdCkuXG4gKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEFyZ3VtZW50cy5cbiAqIEBwYXJhbSB7dW5rbm93bn0gYXJncy5jb21tYW5kRW50cnkgLSBSYXcgY29tbWFuZCBlbnRyeS5cbiAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLm1vZGVsTmFtZSAtIERpYWdub3N0aWMgbW9kZWwgbmFtZS5cbiAqIEByZXR1cm5zIHt7bWV0aG9kTmFtZTogc3RyaW5nLCBhcmdzOiBBcnJheTx7bmFtZTogc3RyaW5nLCB0eXBlOiBzdHJpbmd9PiwgcmV0dXJuVHlwZTogc3RyaW5nIHwgbnVsbH19IC0gTWV0aG9kIG5hbWUgKyBtZXRhZGF0YS5cbiAqL1xuZnVuY3Rpb24gbm9ybWFsaXplRnJvbnRlbmRNb2RlbEN1c3RvbUNvbW1hbmRFbnRyeSh7Y29tbWFuZEVudHJ5LCBtb2RlbE5hbWV9KSB7XG4gIGlmICh0eXBlb2YgY29tbWFuZEVudHJ5ID09PSBcInN0cmluZ1wiKSB7XG4gICAgcmV0dXJuIHttZXRob2ROYW1lOiBjb21tYW5kRW50cnksIGFyZ3M6IFtdLCByZXR1cm5UeXBlOiBudWxsfVxuICB9XG5cbiAgaWYgKCFjb21tYW5kRW50cnkgfHwgdHlwZW9mIGNvbW1hbmRFbnRyeSAhPT0gXCJvYmplY3RcIiB8fCBBcnJheS5pc0FycmF5KGNvbW1hbmRFbnRyeSkpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYCR7bW9kZWxOYW1lfSBlbnRyaWVzIG11c3QgYmUgYSBjYW1lbENhc2UgbmFtZSBzdHJpbmcgb3IgYSB7bmFtZSwgYXJncz8sIHJldHVyblR5cGU/fSBvYmplY3RgKVxuICB9XG5cbiAgY29uc3Qge25hbWUsIGFyZ3MsIHJldHVyblR5cGUsIC4uLnJlc3R9ID0gLyoqIEB0eXBlIHt7bmFtZT86IHVua25vd24sIGFyZ3M/OiB1bmtub3duLCByZXR1cm5UeXBlPzogdW5rbm93bn19ICovIChjb21tYW5kRW50cnkpXG5cbiAgaWYgKE9iamVjdC5rZXlzKHJlc3QpLmxlbmd0aCA+IDApIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYFVuZXhwZWN0ZWQgJHttb2RlbE5hbWV9IGtleXM6ICR7T2JqZWN0LmtleXMocmVzdCkuam9pbihcIiwgXCIpfS4gQWxsb3dlZDogbmFtZSwgYXJncywgcmV0dXJuVHlwZWApXG4gIH1cblxuICBpZiAodHlwZW9mIG5hbWUgIT09IFwic3RyaW5nXCIgfHwgbmFtZS5sZW5ndGggPCAxKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGAke21vZGVsTmFtZX0gb2JqZWN0IGVudHJpZXMgcmVxdWlyZSBhIG5vbi1lbXB0eSAnbmFtZScgc3RyaW5nYClcbiAgfVxuXG4gIHJldHVybiB7XG4gICAgbWV0aG9kTmFtZTogbmFtZSxcbiAgICBhcmdzOiBub3JtYWxpemVGcm9udGVuZE1vZGVsQ29tbWFuZEFyZ3Moe2FyZ3MsIGNvbW1hbmROYW1lOiBuYW1lLCBtb2RlbE5hbWV9KSxcbiAgICByZXR1cm5UeXBlOiBub3JtYWxpemVGcm9udGVuZE1vZGVsQ29tbWFuZFJldHVyblR5cGUoe2NvbW1hbmROYW1lOiBuYW1lLCBtb2RlbE5hbWUsIHJldHVyblR5cGV9KVxuICB9XG59XG5cbi8qKlxuICogVmFsaWRhdGVzIGFuZCBub3JtYWxpemVzIGEgY3VzdG9tIGNvbW1hbmQncyB0eXBlZC1hcmd1bWVudCBsaXN0LlxuICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBBcmd1bWVudHMuXG4gKiBAcGFyYW0ge3Vua25vd259IGFyZ3MuYXJncyAtIFJhdyBjb21tYW5kIGFyZ3MuXG4gKiBAcGFyYW0ge3N0cmluZ30gYXJncy5jb21tYW5kTmFtZSAtIENvbW1hbmQgbmFtZSBmb3IgZGlhZ25vc3RpY3MuXG4gKiBAcGFyYW0ge3N0cmluZ30gYXJncy5tb2RlbE5hbWUgLSBEaWFnbm9zdGljIG1vZGVsIG5hbWUuXG4gKiBAcmV0dXJucyB7QXJyYXk8e25hbWU6IHN0cmluZywgdHlwZTogc3RyaW5nfT59IC0gTm9ybWFsaXplZCB0eXBlZCBjb21tYW5kIGFyZ3VtZW50cy5cbiAqL1xuZnVuY3Rpb24gbm9ybWFsaXplRnJvbnRlbmRNb2RlbENvbW1hbmRBcmdzKHthcmdzLCBjb21tYW5kTmFtZSwgbW9kZWxOYW1lfSkge1xuICBpZiAoYXJncyA9PT0gdW5kZWZpbmVkIHx8IGFyZ3MgPT09IG51bGwpIHtcbiAgICByZXR1cm4gW11cbiAgfVxuXG4gIGlmICghQXJyYXkuaXNBcnJheShhcmdzKSkge1xuICAgIHRocm93IG5ldyBFcnJvcihgJHttb2RlbE5hbWV9ICcke2NvbW1hbmROYW1lfScgYXJncyBtdXN0IGJlIGFuIGFycmF5IG9mIHtuYW1lLCB0eXBlfSBvYmplY3RzYClcbiAgfVxuXG4gIHJldHVybiBhcmdzLm1hcCgoYXJnKSA9PiB7XG4gICAgaWYgKCFhcmcgfHwgdHlwZW9mIGFyZyAhPT0gXCJvYmplY3RcIiB8fCB0eXBlb2YgYXJnLm5hbWUgIT09IFwic3RyaW5nXCIgfHwgYXJnLm5hbWUubGVuZ3RoIDwgMSB8fCB0eXBlb2YgYXJnLnR5cGUgIT09IFwic3RyaW5nXCIgfHwgYXJnLnR5cGUudHJpbSgpLmxlbmd0aCA8IDEpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgJHttb2RlbE5hbWV9ICcke2NvbW1hbmROYW1lfScgYXJncyBlbnRyaWVzIHJlcXVpcmUgbm9uLWVtcHR5ICduYW1lJyBhbmQgSlNEb2MtdHlwZSAndHlwZScgc3RyaW5nc2ApXG4gICAgfVxuXG4gICAgcmV0dXJuIHtuYW1lOiBhcmcubmFtZSwgdHlwZTogYXJnLnR5cGUudHJpbSgpfVxuICB9KVxufVxuXG4vKipcbiAqIFZhbGlkYXRlcyBhbmQgbm9ybWFsaXplcyBhIGN1c3RvbSBjb21tYW5kJ3MgZGVjbGFyZWQgSlNEb2MgcmV0dXJuIHR5cGUuXG4gKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEFyZ3VtZW50cy5cbiAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmNvbW1hbmROYW1lIC0gQ29tbWFuZCBuYW1lIGZvciBkaWFnbm9zdGljcy5cbiAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLm1vZGVsTmFtZSAtIERpYWdub3N0aWMgbW9kZWwgbmFtZS5cbiAqIEBwYXJhbSB7dW5rbm93bn0gYXJncy5yZXR1cm5UeXBlIC0gUmF3IHJldHVybiB0eXBlLlxuICogQHJldHVybnMge3N0cmluZyB8IG51bGx9IC0gTm9ybWFsaXplZCBKU0RvYyByZXR1cm4gdHlwZS5cbiAqL1xuZnVuY3Rpb24gbm9ybWFsaXplRnJvbnRlbmRNb2RlbENvbW1hbmRSZXR1cm5UeXBlKHtjb21tYW5kTmFtZSwgbW9kZWxOYW1lLCByZXR1cm5UeXBlfSkge1xuICBpZiAocmV0dXJuVHlwZSA9PT0gdW5kZWZpbmVkIHx8IHJldHVyblR5cGUgPT09IG51bGwpIHtcbiAgICByZXR1cm4gbnVsbFxuICB9XG5cbiAgaWYgKHR5cGVvZiByZXR1cm5UeXBlICE9PSBcInN0cmluZ1wiIHx8IHJldHVyblR5cGUudHJpbSgpLmxlbmd0aCA8IDEpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYCR7bW9kZWxOYW1lfSAnJHtjb21tYW5kTmFtZX0nIHJldHVyblR5cGUgbXVzdCBiZSBhIG5vbi1lbXB0eSBKU0RvYyB0eXBlIHN0cmluZ2ApXG4gIH1cblxuICByZXR1cm4gcmV0dXJuVHlwZS50cmltKClcbn1cblxuLyoqXG4gKiBSdW5zIHRoZSBmcm9udGVuZE1vZGVsUmVzb3VyY2VQYXRoIGhlbHBlci5cbiAqIEBwYXJhbSB7c3RyaW5nfSBtb2RlbE5hbWUgLSBNb2RlbCBjbGFzcyBuYW1lLlxuICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gcmVzb3VyY2VEZWZpbml0aW9uIC0gUmVzb3VyY2UgZGVmaW5pdGlvbi5cbiAqIEByZXR1cm5zIHtzdHJpbmd9IC0gTm9ybWFsaXplZCByZXNvdXJjZSBwYXRoLlxuICovXG5leHBvcnQgZnVuY3Rpb24gZnJvbnRlbmRNb2RlbFJlc291cmNlUGF0aChtb2RlbE5hbWUsIHJlc291cmNlRGVmaW5pdGlvbikge1xuICBjb25zdCByZXNvdXJjZUNvbmZpZ3VyYXRpb24gPSBmcm9udGVuZE1vZGVsUmVzb3VyY2VDb25maWd1cmF0aW9uRnJvbURlZmluaXRpb24ocmVzb3VyY2VEZWZpbml0aW9uKVxuXG4gIGlmICghcmVzb3VyY2VDb25maWd1cmF0aW9uKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGBJbnZhbGlkIGZyb250ZW5kIG1vZGVsIHJlc291cmNlIGRlZmluaXRpb24gZm9yICR7bW9kZWxOYW1lfWApXG4gIH1cblxuICByZXR1cm4gYC8ke2luZmxlY3Rpb24uZGFzaGVyaXplKGluZmxlY3Rpb24ucGx1cmFsaXplKGluZmxlY3Rpb24udW5kZXJzY29yZShtb2RlbE5hbWUpKSl9YFxufVxuXG4vKipcbiAqIFJ1bnMgdGhlIGZyb250ZW5kTW9kZWxBY3Rpb25Gb3JDb21tYW5kIGhlbHBlci5cbiAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gQXJndW1lbnRzLlxuICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MuY29tbWFuZE5hbWUgLSBDb21tYW5kIHBhdGggc2VnbWVudC5cbiAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLm1vZGVsTmFtZSAtIE1vZGVsIGNsYXNzIG5hbWUuXG4gKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBhcmdzLnJlc291cmNlRGVmaW5pdGlvbiAtIFJlc291cmNlIGRlZmluaXRpb24uXG4gKiBAcmV0dXJucyB7XCJkZXN0cm95XCIgfCBcImZpbmRcIiB8IFwiaW5kZXhcIiB8IFwiY3JlYXRlXCIgfCBcInVwZGF0ZVwiIHwgXCJhdHRhY2hcIiB8IFwiZG93bmxvYWRcIiB8IFwidXJsXCIgfCBudWxsfSAtIEZyb250ZW5kIGFjdGlvbi5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGZyb250ZW5kTW9kZWxBY3Rpb25Gb3JDb21tYW5kKHtjb21tYW5kTmFtZSwgbW9kZWxOYW1lLCByZXNvdXJjZURlZmluaXRpb259KSB7XG4gIGNvbnN0IHJlc291cmNlQ29uZmlndXJhdGlvbiA9IGZyb250ZW5kTW9kZWxSZXNvdXJjZUNvbmZpZ3VyYXRpb25Gcm9tRGVmaW5pdGlvbihyZXNvdXJjZURlZmluaXRpb24pXG5cbiAgaWYgKCFyZXNvdXJjZUNvbmZpZ3VyYXRpb24pIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYEludmFsaWQgZnJvbnRlbmQgbW9kZWwgcmVzb3VyY2UgZGVmaW5pdGlvbiBmb3IgJHttb2RlbE5hbWV9YClcbiAgfVxuXG4gIGZvciAoY29uc3QgW2FjdGlvbiwgY29uZmlndXJlZENvbW1hbmROYW1lXSBvZiBPYmplY3QuZW50cmllcyh7XG4gICAgLi4ucmVzb3VyY2VDb25maWd1cmF0aW9uLmJ1aWx0SW5Db2xsZWN0aW9uQ29tbWFuZHMsXG4gICAgLi4ucmVzb3VyY2VDb25maWd1cmF0aW9uLmJ1aWx0SW5NZW1iZXJDb21tYW5kc1xuICB9KSkge1xuICAgIGlmIChjb25maWd1cmVkQ29tbWFuZE5hbWUgPT09IHVuZGVmaW5lZCkgY29udGludWVcblxuICAgIGNvbnN0IHZhbGlkYXRlZENvbW1hbmROYW1lID0gdmFsaWRhdGVGcm9udGVuZE1vZGVsUmVzb3VyY2VDb21tYW5kTmFtZSh7XG4gICAgICBjb21tYW5kTmFtZTogY29uZmlndXJlZENvbW1hbmROYW1lLFxuICAgICAgY29tbWFuZFR5cGU6IC8qKiBAdHlwZSB7XCJhdHRhY2hcIiB8IFwiY3JlYXRlXCIgfCBcImRlc3Ryb3lcIiB8IFwiZG93bmxvYWRcIiB8IFwiZmluZFwiIHwgXCJpbmRleFwiIHwgXCJ1cGRhdGVcIiB8IFwidXJsXCJ9ICovIChhY3Rpb24pLFxuICAgICAgbW9kZWxOYW1lXG4gICAgfSlcblxuICAgIGlmIChjb21tYW5kTmFtZSA9PT0gdmFsaWRhdGVkQ29tbWFuZE5hbWUpIHtcbiAgICAgIHJldHVybiAvKiogQHR5cGUge1wiYXR0YWNoXCIgfCBcImNyZWF0ZVwiIHwgXCJkZXN0cm95XCIgfCBcImRvd25sb2FkXCIgfCBcImZpbmRcIiB8IFwiaW5kZXhcIiB8IFwidXBkYXRlXCIgfCBcInVybFwifSAqLyAoYWN0aW9uKVxuICAgIH1cbiAgfVxuXG4gIHJldHVybiBudWxsXG59XG5cbi8qKlxuICogUnVucyB0aGUgZnJvbnRlbmRNb2RlbEN1c3RvbUNvbW1hbmRGb3JQYXRoIGhlbHBlci5cbiAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gQXJndW1lbnRzLlxuICogQHBhcmFtIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkJhY2tlbmRQcm9qZWN0Q29uZmlndXJhdGlvbltdfSBhcmdzLmJhY2tlbmRQcm9qZWN0cyAtIEJhY2tlbmQgcHJvamVjdHMgdG8gc2Nhbi5cbiAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmN1cnJlbnRQYXRoIC0gUmVxdWVzdCBwYXRoIHdpdGhvdXQgcXVlcnkuXG4gKiBAcmV0dXJucyB7e2NvbW1hbmROYW1lOiBzdHJpbmcsIG1lbWJlcklkPzogc3RyaW5nLCBtZXRob2ROYW1lOiBzdHJpbmcsIG1vZGVsTmFtZTogc3RyaW5nLCByZXNvdXJjZVBhdGg6IHN0cmluZywgc2NvcGU6IFwiY29sbGVjdGlvblwiIHwgXCJtZW1iZXJcIn0gfCBudWxsfSAtIE1hdGNoZWQgY3VzdG9tIGNvbW1hbmQgbWV0YWRhdGEuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBmcm9udGVuZE1vZGVsQ3VzdG9tQ29tbWFuZEZvclBhdGgoe2JhY2tlbmRQcm9qZWN0cywgY3VycmVudFBhdGh9KSB7XG4gIGNvbnN0IG5vcm1hbGl6ZWRDdXJyZW50UGF0aCA9IG5vcm1hbGl6ZUZyb250ZW5kTW9kZWxSZXNvdXJjZVBhdGhGb3JNYXRjaChjdXJyZW50UGF0aClcblxuICBmb3IgKGNvbnN0IGJhY2tlbmRQcm9qZWN0IG9mIGJhY2tlbmRQcm9qZWN0cykge1xuICAgIGNvbnN0IHJlc291cmNlcyA9IGZyb250ZW5kTW9kZWxSZXNvdXJjZXNGb3JCYWNrZW5kUHJvamVjdChiYWNrZW5kUHJvamVjdClcblxuICAgIGZvciAoY29uc3QgbW9kZWxOYW1lIGluIHJlc291cmNlcykge1xuICAgICAgY29uc3QgcmVzb3VyY2VEZWZpbml0aW9uID0gcmVzb3VyY2VzW21vZGVsTmFtZV1cbiAgICAgIGNvbnN0IHJlc291cmNlQ29uZmlndXJhdGlvbiA9IGZyb250ZW5kTW9kZWxSZXNvdXJjZUNvbmZpZ3VyYXRpb25Gcm9tRGVmaW5pdGlvbihyZXNvdXJjZURlZmluaXRpb24pXG5cbiAgICAgIGlmICghcmVzb3VyY2VDb25maWd1cmF0aW9uKSB7XG4gICAgICAgIGNvbnRpbnVlXG4gICAgICB9XG5cbiAgICAgIGNvbnN0IHJlc291cmNlUGF0aCA9IG5vcm1hbGl6ZUZyb250ZW5kTW9kZWxSZXNvdXJjZVBhdGhGb3JNYXRjaChmcm9udGVuZE1vZGVsUmVzb3VyY2VQYXRoKG1vZGVsTmFtZSwgcmVzb3VyY2VEZWZpbml0aW9uKSlcbiAgICAgIGNvbnN0IGV4cGVjdGVkUHJlZml4ID0gYCR7cmVzb3VyY2VQYXRofS9gXG5cbiAgICAgIGlmICghbm9ybWFsaXplZEN1cnJlbnRQYXRoLnN0YXJ0c1dpdGgoZXhwZWN0ZWRQcmVmaXgpKSB7XG4gICAgICAgIGNvbnRpbnVlXG4gICAgICB9XG5cbiAgICAgIGNvbnN0IHBhdGhTZWdtZW50cyA9IG5vcm1hbGl6ZWRDdXJyZW50UGF0aFxuICAgICAgICAuc2xpY2UoZXhwZWN0ZWRQcmVmaXgubGVuZ3RoKVxuICAgICAgICAuc3BsaXQoXCIvXCIpXG4gICAgICAgIC5maWx0ZXIoQm9vbGVhbilcblxuICAgICAgaWYgKHBhdGhTZWdtZW50cy5sZW5ndGggPT09IDEpIHtcbiAgICAgICAgY29uc3QgbWF0Y2hlZENvbGxlY3Rpb25Db21tYW5kID0gT2JqZWN0LmVudHJpZXMocmVzb3VyY2VDb25maWd1cmF0aW9uLmNvbGxlY3Rpb25Db21tYW5kcylcbiAgICAgICAgICAuZmluZCgoWywgY29tbWFuZE5hbWVdKSA9PiBjb21tYW5kTmFtZSA9PT0gcGF0aFNlZ21lbnRzWzBdKVxuXG4gICAgICAgIGlmIChtYXRjaGVkQ29sbGVjdGlvbkNvbW1hbmQpIHtcbiAgICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgY29tbWFuZE5hbWU6IG1hdGNoZWRDb2xsZWN0aW9uQ29tbWFuZFsxXSxcbiAgICAgICAgICAgIG1ldGhvZE5hbWU6IG1hdGNoZWRDb2xsZWN0aW9uQ29tbWFuZFswXSxcbiAgICAgICAgICAgIG1vZGVsTmFtZSxcbiAgICAgICAgICAgIHJlc291cmNlUGF0aCxcbiAgICAgICAgICAgIHNjb3BlOiBcImNvbGxlY3Rpb25cIlxuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICBpZiAocGF0aFNlZ21lbnRzLmxlbmd0aCA9PT0gMikge1xuICAgICAgICBjb25zdCBtYXRjaGVkTWVtYmVyQ29tbWFuZCA9IE9iamVjdC5lbnRyaWVzKHJlc291cmNlQ29uZmlndXJhdGlvbi5tZW1iZXJDb21tYW5kcylcbiAgICAgICAgICAuZmluZCgoWywgY29tbWFuZE5hbWVdKSA9PiBjb21tYW5kTmFtZSA9PT0gcGF0aFNlZ21lbnRzWzFdKVxuXG4gICAgICAgIGlmIChtYXRjaGVkTWVtYmVyQ29tbWFuZCkge1xuICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICBjb21tYW5kTmFtZTogbWF0Y2hlZE1lbWJlckNvbW1hbmRbMV0sXG4gICAgICAgICAgICBtZW1iZXJJZDogZGVjb2RlVVJJQ29tcG9uZW50KHBhdGhTZWdtZW50c1swXSksXG4gICAgICAgICAgICBtZXRob2ROYW1lOiBtYXRjaGVkTWVtYmVyQ29tbWFuZFswXSxcbiAgICAgICAgICAgIG1vZGVsTmFtZSxcbiAgICAgICAgICAgIHJlc291cmNlUGF0aCxcbiAgICAgICAgICAgIHNjb3BlOiBcIm1lbWJlclwiXG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIG51bGxcbn1cblxuLyoqXG4gKiBSdW5zIG5vcm1hbGl6ZSBmcm9udGVuZCBtb2RlbCByZXNvdXJjZSBwYXRoIGZvciBtYXRjaC5cbiAqIEBwYXJhbSB7c3RyaW5nfSBwYXRoIC0gUGF0aCB2YWx1ZS5cbiAqIEByZXR1cm5zIHtzdHJpbmd9IC0gTm9ybWFsaXplZCBwYXRoIHdpdGggbGVhZGluZyBzbGFzaCBhbmQgbm8gdHJhaWxpbmcgc2xhc2guXG4gKi9cbmZ1bmN0aW9uIG5vcm1hbGl6ZUZyb250ZW5kTW9kZWxSZXNvdXJjZVBhdGhGb3JNYXRjaChwYXRoKSB7XG4gIGNvbnN0IHdpdGhMZWFkaW5nU2xhc2ggPSBwYXRoLnN0YXJ0c1dpdGgoXCIvXCIpID8gcGF0aCA6IGAvJHtwYXRofWBcblxuICBpZiAod2l0aExlYWRpbmdTbGFzaC5sZW5ndGggPiAxKSB7XG4gICAgcmV0dXJuIHdpdGhMZWFkaW5nU2xhc2gucmVwbGFjZSgvXFwvKyQvLCBcIlwiKVxuICB9XG5cbiAgcmV0dXJuIHdpdGhMZWFkaW5nU2xhc2hcbn1cblxuLyoqXG4gKiBSZXNvbHZlcyB0aGUgcmVnaXN0ZXJlZCBmcm9udGVuZC1tb2RlbCByZXNvdXJjZSBjbGFzcyBmb3IgYSByZXNvdXJjZSB0eXBlXG4gKiBhY3Jvc3MgYWxsIGJhY2tlbmQgcHJvamVjdHMuIEEgcmVzb3VyY2UncyBlZmZlY3RpdmUgbmFtZSBpcyBpdHNcbiAqIGBtb2RlbE5hbWVgIG92ZXJyaWRlIHdoZW4gZGVjbGFyZWQsIG90aGVyd2lzZSBpdHMgcmVnaXN0cnkga2V5IOKAlCBtYXRjaGluZ1xuICoge0BsaW5rIGZyb250ZW5kTW9kZWxTeW5jTWFuaWZlc3RGb3JCYWNrZW5kUHJvamVjdHN9LiBBIHJlZ2lzdHJ5IGtleSBzaGFkb3dlZFxuICogYnkgYSBgbW9kZWxOYW1lYCBvdmVycmlkZSBkb2VzIG5vdCByZXNvbHZlLlxuICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICogQHBhcmFtIHt7Z2V0QmFja2VuZFByb2plY3RzOiAoKSA9PiBpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkJhY2tlbmRQcm9qZWN0Q29uZmlndXJhdGlvbltdfX0gYXJncy5jb25maWd1cmF0aW9uIC0gQ29uZmlndXJhdGlvbiBleHBvc2luZyB0aGUgYmFja2VuZCBwcm9qZWN0cy5cbiAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLnJlc291cmNlVHlwZSAtIEZyb250ZW5kIG1vZGVsIG5hbWUgdG8gcmVzb2x2ZS5cbiAqIEByZXR1cm5zIHtGcm9udGVuZE1vZGVsUmVzb2x2ZWRSZXNvdXJjZVJlZ2lzdHJhdGlvbiB8IG51bGx9IFJlc29sdmVkIHJlZ2lzdHJhdGlvbiBvciBudWxsIHdoZW4gdGhlIHJlc291cmNlIHR5cGUgaXMgbm90IHJlZ2lzdGVyZWQuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiByZXNvbHZlRnJvbnRlbmRNb2RlbFJlc291cmNlQ2xhc3Moe2NvbmZpZ3VyYXRpb24sIHJlc291cmNlVHlwZX0pIHtcbiAgZm9yIChjb25zdCBiYWNrZW5kUHJvamVjdCBvZiBjb25maWd1cmF0aW9uLmdldEJhY2tlbmRQcm9qZWN0cygpKSB7XG4gICAgY29uc3QgcmVzb3VyY2VzID0gZnJvbnRlbmRNb2RlbFJlc291cmNlc0ZvckJhY2tlbmRQcm9qZWN0KGJhY2tlbmRQcm9qZWN0KVxuXG4gICAgZm9yIChjb25zdCBjb25maWd1cmVkTW9kZWxOYW1lIG9mIE9iamVjdC5rZXlzKHJlc291cmNlcykpIHtcbiAgICAgIGNvbnN0IHJlc291cmNlRGVmaW5pdGlvbiA9IHJlc291cmNlc1tjb25maWd1cmVkTW9kZWxOYW1lXVxuICAgICAgY29uc3QgcmVzb3VyY2VDbGFzcyA9IGZyb250ZW5kTW9kZWxSZXNvdXJjZUNsYXNzRnJvbURlZmluaXRpb24ocmVzb3VyY2VEZWZpbml0aW9uKVxuXG4gICAgICBpZiAoIXJlc291cmNlQ2xhc3MpIGNvbnRpbnVlXG5cbiAgICAgIC8vIENoZWFwIGRpcmVjdC1rZXkgbWlzbWF0Y2ggc2tpcDogb25seSBub3JtYWxpemUgY29uZmlndXJhdGlvbnMgZm9yIHRoZVxuICAgICAgLy8gbWF0Y2hpbmcga2V5IG9yIHdoZW4gYSBtb2RlbE5hbWUgb3ZlcnJpZGUgY291bGQgcmVuYW1lIHRoZSByZXNvdXJjZS5cbiAgICAgIGlmIChjb25maWd1cmVkTW9kZWxOYW1lICE9PSByZXNvdXJjZVR5cGUgJiYgIXJlc291cmNlQ2xhc3Muc2hhcmVkUmVzb3VyY2VTdGF0aWNWYWx1ZShcIm1vZGVsTmFtZVwiKSkgY29udGludWVcblxuICAgICAgY29uc3QgcmVzb3VyY2VDb25maWd1cmF0aW9uID0gZnJvbnRlbmRNb2RlbFJlc291cmNlQ29uZmlndXJhdGlvbkZyb21EZWZpbml0aW9uKHJlc291cmNlRGVmaW5pdGlvbilcblxuICAgICAgaWYgKCFyZXNvdXJjZUNvbmZpZ3VyYXRpb24pIGNvbnRpbnVlXG4gICAgICBpZiAoKHJlc291cmNlQ29uZmlndXJhdGlvbi5tb2RlbE5hbWUgfHwgY29uZmlndXJlZE1vZGVsTmFtZSkgIT09IHJlc291cmNlVHlwZSkgY29udGludWVcblxuICAgICAgcmV0dXJuIHttb2RlbE5hbWU6IHJlc291cmNlVHlwZSwgcmVzb3VyY2VDbGFzcywgcmVzb3VyY2VDb25maWd1cmF0aW9ufVxuICAgIH1cbiAgfVxuXG4gIHJldHVybiBudWxsXG59XG4iXX0=