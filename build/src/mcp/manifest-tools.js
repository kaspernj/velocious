// @ts-check
/**
 * @typedef {object} ManifestCommandEntry
 * @property {Array<{name: string, type: string}>} [args] - Declared typed command arguments.
 * @property {string} methodName - Command method name.
 * @property {string} [path] - Manifest command path (member paths carry `<id>`).
 * @property {string | null} [returnType] - Declared JSDoc return type.
 * @property {"collection" | "member"} scope - Command scope.
 */
/**
 * @typedef {object} ManifestResourceEntry
 * @property {Record<string, ManifestCommandEntry[]>} [commands] - Scope-keyed custom command entries.
 * @property {Record<string, Record<string, string>>} [builtInCommands] - Scope-keyed built-in command maps (methodName → slug).
 * @property {string} modelName - Backend model name.
 * @property {string | string[]} [primaryKey] - Primary key attribute name(s).
 */
/**
 * @typedef {Record<string, unknown> & {formatVersion?: number, resources?: Record<string, unknown>}} ApiManifest
 */
import inflection from "inflection";
const MCP_TOOL_NAME_PATTERN = /^[a-z0-9_]+$/;
/** @type {Record<string, string>} */
const BUILT_IN_COMMAND_DESCRIPTIONS = {
    attach: "Attach a file attachment to one record.",
    attachmentList: "List the attachments of one record.",
    create: "Create one record with `attributes` (and optional `nestedAttributes`).",
    destroy: "Destroy one record by primary key `id`.",
    download: "Download one attachment of one record.",
    find: "Find one record by primary key `id`.",
    index: "List records with optional `where`, `searches`, `sort`, `limit`, `offset`, `page`, `perPage`, `preload`, `select`, `count`, `pluck`, `distinct`, `group`, `joins`, and `queryData`.",
    update: "Update one record by primary key `id` with `attributes` (and optional `nestedAttributes`).",
    url: "Resolve the download URL of one attachment of one record."
};
const META_TOOL_NAME = "frontend_model_api_manifest";
const META_TOOL_DESCRIPTION = "Return the full frontend-model API manifest (all resources, attributes, abilities, and commands) so callers can discover the available model commands.";
/**
 * Maps one JSDoc type string from command metadata to a JSON Schema fragment.
 * @param {string} type - JSDoc type string (for example `string`, `number`, `{id: number}`).
 * @returns {{items?: {type: string}, type: string}} - JSON Schema type fragment.
 */
function jsonSchemaTypeForJSDocType(type) {
    const normalizedType = type.trim();
    if (normalizedType === "number" || normalizedType === "integer")
        return { type: "number" };
    if (normalizedType === "boolean")
        return { type: "boolean" };
    if (normalizedType.startsWith("Array<") || normalizedType.endsWith("[]"))
        return { items: { type: "string" }, type: "array" };
    return { type: "string" };
}
/**
 * Builds the MCP tool name for one model command.
 * @param {object} args - Arguments.
 * @param {string} args.modelKey - Manifest resource key (configured model name).
 * @param {string} args.commandName - Command method name.
 * @param {"collection" | "member"} args.scope - Command scope.
 * @returns {string} - MCP tool name.
 */
function mcpToolName({ commandName, modelKey, scope }) {
    const modelPart = inflection.underscore(modelKey).toLowerCase();
    const commandPart = inflection.underscore(commandName).toLowerCase();
    const scopePart = scope === "member" ? "_by_id" : "";
    return `${modelPart}_${commandPart}${scopePart}`;
}
/**
 * Builds the primary key input properties for one manifest resource.
 * @param {string | string[] | undefined} primaryKey - Resource primary key attribute name(s).
 * @returns {Record<string, {description: string, type: string}>} - Primary key JSON Schema properties.
 */
function primaryKeyProperties(primaryKey) {
    const keyAttributes = Array.isArray(primaryKey) ? primaryKey : [primaryKey || "id"];
    /** @type {Record<string, {description: string, type: string}>} */
    const properties = {};
    for (const keyAttribute of keyAttributes) {
        properties[keyAttribute] = { description: `Primary key attribute \`${keyAttribute}\` of the record.`, type: "string" };
    }
    return properties;
}
/**
 * Builds the fixed input schema for one built-in command.
 * @param {object} args - Arguments.
 * @param {string} args.commandName - Built-in command name.
 * @param {string | string[] | undefined} args.primaryKey - Resource primary key attribute name(s).
 * @returns {Record<string, unknown>} - JSON Schema object for the tool input.
 */
function builtInCommandInputSchema({ commandName, primaryKey }) {
    if (commandName === "index") {
        return {
            additionalProperties: false,
            properties: {
                count: { description: "Return only the count of matching records.", type: "boolean" },
                distinct: { description: "Apply DISTINCT to the index query.", type: "boolean" },
                group: { description: "Group the index query by attribute names or relationship-path descriptors.", type: "object" },
                joins: { description: "Relationship-path join descriptors.", type: "object" },
                limit: { description: "Maximum number of records to return.", type: "number" },
                offset: { description: "Number of records to skip.", type: "number" },
                page: { description: "1-based page number (combine with `perPage`).", type: "number" },
                perPage: { description: "Records per page.", type: "number" },
                pluck: { description: "Attribute names or relationship-path descriptors to pluck instead of full records.", type: "array" },
                preload: { description: "Relationship preload descriptors.", type: "object" },
                queryData: { description: "Structured query-data descriptor.", type: "object" },
                searches: { description: "Search descriptors (path/column/operator/value).", type: "array" },
                select: { description: "Selected attribute names per model.", type: "object" },
                selectsExtra: { description: "Extra selected attributes.", type: "object" },
                sort: { description: "Sort definitions (column or relationship-path descriptors).", type: "array" },
                where: { description: "Attribute filter hash.", type: "object" },
                withCount: { description: "Include the total count alongside records.", type: "boolean" }
            },
            type: "object"
        };
    }
    if (commandName === "create") {
        return {
            additionalProperties: false,
            properties: {
                attributes: { description: "Writable attribute values for the new record.", type: "object" },
                nestedAttributes: { description: "Nested relationship attribute payloads.", type: "object" }
            },
            required: ["attributes"],
            type: "object"
        };
    }
    if (commandName === "update") {
        const idProperties = primaryKeyProperties(primaryKey);
        return {
            additionalProperties: false,
            properties: {
                attributes: { description: "Writable attribute values to apply.", type: "object" },
                ...idProperties,
                nestedAttributes: { description: "Nested relationship attribute payloads.", type: "object" }
            },
            required: [...Object.keys(idProperties), "attributes"],
            type: "object"
        };
    }
    // find / destroy / attach / download / url / attachmentList are id-addressed
    const idProperties = primaryKeyProperties(primaryKey);
    return {
        additionalProperties: false,
        properties: { ...idProperties },
        required: [...Object.keys(idProperties)],
        type: "object"
    };
}
/**
 * Builds the input schema for one custom command from its manifest argument metadata.
 * @param {object} args - Arguments.
 * @param {ManifestCommandEntry} args.entry - Manifest command entry.
 * @param {string | string[] | undefined} args.primaryKey - Resource primary key attribute name(s).
 * @returns {Record<string, unknown>} - JSON Schema object for the tool input.
 */
function customCommandInputSchema({ entry, primaryKey }) {
    const commandArgs = entry.args || [];
    /** @type {Record<string, {description?: string, items?: {items?: {type: string}, type: string}, type: string}>} */
    const properties = {};
    for (const commandArg of commandArgs) {
        properties[commandArg.name] = jsonSchemaTypeForJSDocType(commandArg.type);
    }
    if (entry.scope === "member") {
        for (const [keyAttribute, keySchema] of Object.entries(primaryKeyProperties(primaryKey))) {
            if (!properties[keyAttribute])
                properties[keyAttribute] = keySchema;
        }
    }
    return {
        additionalProperties: true,
        properties,
        type: "object"
    };
}
/**
 * Generates MCP tool definitions from a frontend-model API manifest.
 * Every built-in and custom command of every manifest resource becomes one tool;
 * one meta tool exposes the raw manifest for discovery.
 * @param {ApiManifest} manifest - Manifest from `configuration.getApiManifest()`.
 * @returns {Record<string, unknown>[]} - MCP `tools/list` tool definitions.
 */
export function generateMcpTools(manifest) {
    const resources = manifest.resources;
    const tools = [];
    if (!resources)
        return [buildMetaTool()];
    for (const modelKey of Object.keys(resources).sort()) {
        const resource = /** @type {ManifestResourceEntry} */ (resources[modelKey]);
        const commands = resource.commands || {};
        const builtInCommands = resource.builtInCommands || {};
        for (const scope of /** @type {Array<"collection" | "member">} */ (["collection", "member"])) {
            for (const entry of scopeCommandEntries({ builtInCommands, commands, scope })) {
                const commandName = entry.methodName;
                const isBuiltIn = entry.isBuiltIn;
                const name = mcpToolName({ commandName, modelKey, scope });
                if (!MCP_TOOL_NAME_PATTERN.test(name))
                    continue;
                tools.push({
                    description: isBuiltIn
                        ? `${BUILT_IN_COMMAND_DESCRIPTIONS[commandName] || `Run the built-in \`${commandName}\` command on \`${resource.modelName}\`.`} Model: \`${resource.modelName}\`.`
                        : `Custom command \`${commandName}\` on model \`${resource.modelName}\`${entry.returnType ? ` (returns ${entry.returnType})` : ""}.`,
                    inputSchema: isBuiltIn
                        ? builtInCommandInputSchema({ commandName, primaryKey: resource.primaryKey })
                        : customCommandInputSchema({ entry, primaryKey: resource.primaryKey }),
                    name
                });
            }
        }
    }
    tools.push(buildMetaTool());
    return tools;
}
/**
 * Merges the manifest's built-in command names and custom command entries for
 * one scope into a single deterministic command-entry list.
 * @param {object} args - Arguments.
 * @param {Record<string, Record<string, string>>} args.builtInCommands - Scope-keyed built-in command maps.
 * @param {Record<string, ManifestCommandEntry[]>} args.commands - Scope-keyed custom command entries.
 * @param {"collection" | "member"} args.scope - Command scope.
 * @returns {Array<ManifestCommandEntry & {isBuiltIn: boolean}>} - Combined command entries.
 */
function scopeCommandEntries({ builtInCommands, commands, scope }) {
    /** @type {Array<ManifestCommandEntry & {isBuiltIn: boolean}>} */
    const entries = [];
    for (const commandName of Object.keys(builtInCommands[scope] || {})) {
        entries.push({ isBuiltIn: true, methodName: commandName, scope });
    }
    for (const entry of commands[scope] || []) {
        entries.push({ ...entry, isBuiltIn: false });
    }
    return entries.sort((a, b) => a.methodName.localeCompare(b.methodName));
}
/**
 * Builds the manifest discovery meta tool.
 * @returns {Record<string, unknown>} - MCP tool definition.
 */
function buildMetaTool() {
    return {
        description: META_TOOL_DESCRIPTION,
        inputSchema: { additionalProperties: false, properties: {}, type: "object" },
        name: META_TOOL_NAME
    };
}
/**
 * Parses one MCP tool name back into its manifest model key and command method name.
 * @param {object} args - Arguments.
 * @param {string} args.toolName - MCP tool name.
 * @param {ApiManifest} args.manifest - Manifest from `configuration.getApiManifest()`.
 * @returns {{commandName: string, modelKey: string, scope: "collection" | "member"} | null} - Command identity, or null when unknown.
 */
export function parseMcpToolName({ manifest, toolName }) {
    if (toolName === META_TOOL_NAME)
        return null;
    const resources = manifest.resources;
    if (!resources)
        return null;
    for (const modelKey of Object.keys(resources)) {
        const resource = /** @type {ManifestResourceEntry} */ (resources[modelKey]);
        const commands = resource.commands || {};
        const builtInCommands = resource.builtInCommands || {};
        for (const scope of /** @type {Array<"collection" | "member">} */ (["collection", "member"])) {
            const commandNames = [...Object.keys(builtInCommands[scope] || {}), ...(commands[scope] || []).map((entry) => entry.methodName)];
            for (const commandName of commandNames) {
                if (mcpToolName({ commandName, modelKey, scope }) === toolName) {
                    return { commandName, modelKey, scope };
                }
            }
        }
    }
    return null;
}
/**
 * Runs the metaToolName helper.
 * @returns {string} - The meta tool name.
 */
export function metaToolName() { return META_TOOL_NAME; }
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibWFuaWZlc3QtdG9vbHMuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvbWNwL21hbmlmZXN0LXRvb2xzLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWjs7Ozs7OztHQU9HO0FBRUg7Ozs7OztHQU1HO0FBRUg7O0dBRUc7QUFFSCxPQUFPLFVBQVUsTUFBTSxZQUFZLENBQUE7QUFFbkMsTUFBTSxxQkFBcUIsR0FBRyxjQUFjLENBQUE7QUFFNUMscUNBQXFDO0FBQ3JDLE1BQU0sNkJBQTZCLEdBQUc7SUFDcEMsTUFBTSxFQUFFLHlDQUF5QztJQUNqRCxjQUFjLEVBQUUscUNBQXFDO0lBQ3JELE1BQU0sRUFBRSx3RUFBd0U7SUFDaEYsT0FBTyxFQUFFLHlDQUF5QztJQUNsRCxRQUFRLEVBQUUsd0NBQXdDO0lBQ2xELElBQUksRUFBRSxzQ0FBc0M7SUFDNUMsS0FBSyxFQUFFLHFMQUFxTDtJQUM1TCxNQUFNLEVBQUUsNEZBQTRGO0lBQ3BHLEdBQUcsRUFBRSwyREFBMkQ7Q0FDakUsQ0FBQTtBQUVELE1BQU0sY0FBYyxHQUFHLDZCQUE2QixDQUFBO0FBQ3BELE1BQU0scUJBQXFCLEdBQUcsd0pBQXdKLENBQUE7QUFFdEw7Ozs7R0FJRztBQUNILFNBQVMsMEJBQTBCLENBQUMsSUFBSTtJQUN0QyxNQUFNLGNBQWMsR0FBRyxJQUFJLENBQUMsSUFBSSxFQUFFLENBQUE7SUFFbEMsSUFBSSxjQUFjLEtBQUssUUFBUSxJQUFJLGNBQWMsS0FBSyxTQUFTO1FBQUUsT0FBTyxFQUFDLElBQUksRUFBRSxRQUFRLEVBQUMsQ0FBQTtJQUN4RixJQUFJLGNBQWMsS0FBSyxTQUFTO1FBQUUsT0FBTyxFQUFDLElBQUksRUFBRSxTQUFTLEVBQUMsQ0FBQTtJQUMxRCxJQUFJLGNBQWMsQ0FBQyxVQUFVLENBQUMsUUFBUSxDQUFDLElBQUksY0FBYyxDQUFDLFFBQVEsQ0FBQyxJQUFJLENBQUM7UUFBRSxPQUFPLEVBQUMsS0FBSyxF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UUFFdEQsS0FBSyxNQUFNLEtBQUssSUFBSSw2Q0FBNkMsQ0FBQyxDQUFDLENBQUMsWUFBWSxFQUFFLFFBQVEsQ0FBQyxDQUFDLEVBQUUsQ0FBQztZQUM3RixNQUFNLFlBQVksR0FBRyxDQUFDLEdBQUcsTUFBTSxDQUFDLElBQUksQ0FBQyxlQUFlLENBQUMsS0FBSyxDQUFDLElBQUksRUFBRSxDQUFDLEVBQUUsR0FBRyxDQUFDLFFBQVEsQ0FBQyxLQUFLLENBQUMsSUFBSSxFQUFFLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQyxLQUFLLEVBQUUsRUFBRSxDQUFDLEtBQUssQ0FBQyxVQUFVLENBQUMsQ0FBQyxDQUFBO1lBRWhJLEtBQUssTUFBTSxXQUFXLElBQUksWUFBWSxFQUFFLENBQUM7Z0JBQ3ZDLElBQUksV0FBVyxDQUFDLEVBQUMsV0FBVyxFQUFFLFFBQVEsRUFBRSxLQUFLLEVBQUMsQ0FBQyxLQUFLLFFBQVEsRUFBRSxDQUFDO29CQUM3RCxPQUFPLEVBQUMsV0FBVyxFQUFFLFFBQVEsRUFBRSxLQUFLLEVBQUMsQ0FBQTtnQkFDdkMsQ0FBQztZQUNILENBQUM7UUFDSCxDQUFDO0lBQ0gsQ0FBQztJQUVELE9BQU8sSUFBSSxDQUFBO0FBQ2IsQ0FBQztBQUVEOzs7R0FHRztBQUNILE1BQU0sVUFBVSxZQUFZLEtBQUssT0FBTyxjQUFjLENBQUEsQ0FBQyxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbi8qKlxuICogQHR5cGVkZWYge29iamVjdH0gTWFuaWZlc3RDb21tYW5kRW50cnlcbiAqIEBwcm9wZXJ0eSB7QXJyYXk8e25hbWU6IHN0cmluZywgdHlwZTogc3RyaW5nfT59IFthcmdzXSAtIERlY2xhcmVkIHR5cGVkIGNvbW1hbmQgYXJndW1lbnRzLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IG1ldGhvZE5hbWUgLSBDb21tYW5kIG1ldGhvZCBuYW1lLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IFtwYXRoXSAtIE1hbmlmZXN0IGNvbW1hbmQgcGF0aCAobWVtYmVyIHBhdGhzIGNhcnJ5IGA8aWQ+YCkuXG4gKiBAcHJvcGVydHkge3N0cmluZyB8IG51bGx9IFtyZXR1cm5UeXBlXSAtIERlY2xhcmVkIEpTRG9jIHJldHVybiB0eXBlLlxuICogQHByb3BlcnR5IHtcImNvbGxlY3Rpb25cIiB8IFwibWVtYmVyXCJ9IHNjb3BlIC0gQ29tbWFuZCBzY29wZS5cbiAqL1xuXG4vKipcbiAqIEB0eXBlZGVmIHtvYmplY3R9IE1hbmlmZXN0UmVzb3VyY2VFbnRyeVxuICogQHByb3BlcnR5IHtSZWNvcmQ8c3RyaW5nLCBNYW5pZmVzdENvbW1hbmRFbnRyeVtdPn0gW2NvbW1hbmRzXSAtIFNjb3BlLWtleWVkIGN1c3RvbSBjb21tYW5kIGVudHJpZXMuXG4gKiBAcHJvcGVydHkge1JlY29yZDxzdHJpbmcsIFJlY29yZDxzdHJpbmcsIHN0cmluZz4+fSBbYnVpbHRJbkNvbW1hbmRzXSAtIFNjb3BlLWtleWVkIGJ1aWx0LWluIGNvbW1hbmQgbWFwcyAobWV0aG9kTmFtZSDihpIgc2x1ZykuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gbW9kZWxOYW1lIC0gQmFja2VuZCBtb2RlbCBuYW1lLlxuICogQHByb3BlcnR5IHtzdHJpbmcgfCBzdHJpbmdbXX0gW3ByaW1hcnlLZXldIC0gUHJpbWFyeSBrZXkgYXR0cmlidXRlIG5hbWUocykuXG4gKi9cblxuLyoqXG4gKiBAdHlwZWRlZiB7UmVjb3JkPHN0cmluZywgdW5rbm93bj4gJiB7Zm9ybWF0VmVyc2lvbj86IG51bWJlciwgcmVzb3VyY2VzPzogUmVjb3JkPHN0cmluZywgdW5rbm93bj59fSBBcGlNYW5pZmVzdFxuICovXG5cbmltcG9ydCBpbmZsZWN0aW9uIGZyb20gXCJpbmZsZWN0aW9uXCJcblxuY29uc3QgTUNQX1RPT0xfTkFNRV9QQVRURVJOID0gL15bYS16MC05X10rJC9cblxuLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+fSAqL1xuY29uc3QgQlVJTFRfSU5fQ09NTUFORF9ERVNDUklQVElPTlMgPSB7XG4gIGF0dGFjaDogXCJBdHRhY2ggYSBmaWxlIGF0dGFjaG1lbnQgdG8gb25lIHJlY29yZC5cIixcbiAgYXR0YWNobWVudExpc3Q6IFwiTGlzdCB0aGUgYXR0YWNobWVudHMgb2Ygb25lIHJlY29yZC5cIixcbiAgY3JlYXRlOiBcIkNyZWF0ZSBvbmUgcmVjb3JkIHdpdGggYGF0dHJpYnV0ZXNgIChhbmQgb3B0aW9uYWwgYG5lc3RlZEF0dHJpYnV0ZXNgKS5cIixcbiAgZGVzdHJveTogXCJEZXN0cm95IG9uZSByZWNvcmQgYnkgcHJpbWFyeSBrZXkgYGlkYC5cIixcbiAgZG93bmxvYWQ6IFwiRG93bmxvYWQgb25lIGF0dGFjaG1lbnQgb2Ygb25lIHJlY29yZC5cIixcbiAgZmluZDogXCJGaW5kIG9uZSByZWNvcmQgYnkgcHJpbWFyeSBrZXkgYGlkYC5cIixcbiAgaW5kZXg6IFwiTGlzdCByZWNvcmRzIHdpdGggb3B0aW9uYWwgYHdoZXJlYCwgYHNlYXJjaGVzYCwgYHNvcnRgLCBgbGltaXRgLCBgb2Zmc2V0YCwgYHBhZ2VgLCBgcGVyUGFnZWAsIGBwcmVsb2FkYCwgYHNlbGVjdGAsIGBjb3VudGAsIGBwbHVja2AsIGBkaXN0aW5jdGAsIGBncm91cGAsIGBqb2luc2AsIGFuZCBgcXVlcnlEYXRhYC5cIixcbiAgdXBkYXRlOiBcIlVwZGF0ZSBvbmUgcmVjb3JkIGJ5IHByaW1hcnkga2V5IGBpZGAgd2l0aCBgYXR0cmlidXRlc2AgKGFuZCBvcHRpb25hbCBgbmVzdGVkQXR0cmlidXRlc2ApLlwiLFxuICB1cmw6IFwiUmVzb2x2ZSB0aGUgZG93bmxvYWQgVVJMIG9mIG9uZSBhdHRhY2htZW50IG9mIG9uZSByZWNvcmQuXCJcbn1cblxuY29uc3QgTUVUQV9UT09MX05BTUUgPSBcImZyb250ZW5kX21vZGVsX2FwaV9tYW5pZmVzdFwiXG5jb25zdCBNRVRBX1RPT0xfREVTQ1JJUFRJT04gPSBcIlJldHVybiB0aGUgZnVsbCBmcm9udGVuZC1tb2RlbCBBUEkgbWFuaWZlc3QgKGFsbCByZXNvdXJjZXMsIGF0dHJpYnV0ZXMsIGFiaWxpdGllcywgYW5kIGNvbW1hbmRzKSBzbyBjYWxsZXJzIGNhbiBkaXNjb3ZlciB0aGUgYXZhaWxhYmxlIG1vZGVsIGNvbW1hbmRzLlwiXG5cbi8qKlxuICogTWFwcyBvbmUgSlNEb2MgdHlwZSBzdHJpbmcgZnJvbSBjb21tYW5kIG1ldGFkYXRhIHRvIGEgSlNPTiBTY2hlbWEgZnJhZ21lbnQuXG4gKiBAcGFyYW0ge3N0cmluZ30gdHlwZSAtIEpTRG9jIHR5cGUgc3RyaW5nIChmb3IgZXhhbXBsZSBgc3RyaW5nYCwgYG51bWJlcmAsIGB7aWQ6IG51bWJlcn1gKS5cbiAqIEByZXR1cm5zIHt7aXRlbXM/OiB7dHlwZTogc3RyaW5nfSwgdHlwZTogc3RyaW5nfX0gLSBKU09OIFNjaGVtYSB0eXBlIGZyYWdtZW50LlxuICovXG5mdW5jdGlvbiBqc29uU2NoZW1hVHlwZUZvckpTRG9jVHlwZSh0eXBlKSB7XG4gIGNvbnN0IG5vcm1hbGl6ZWRUeXBlID0gdHlwZS50cmltKClcblxuICBpZiAobm9ybWFsaXplZFR5cGUgPT09IFwibnVtYmVyXCIgfHwgbm9ybWFsaXplZFR5cGUgPT09IFwiaW50ZWdlclwiKSByZXR1cm4ge3R5cGU6IFwibnVtYmVyXCJ9XG4gIGlmIChub3JtYWxpemVkVHlwZSA9PT0gXCJib29sZWFuXCIpIHJldHVybiB7dHlwZTogXCJib29sZWFuXCJ9XG4gIGlmIChub3JtYWxpemVkVHlwZS5zdGFydHNXaXRoKFwiQXJyYXk8XCIpIHx8IG5vcm1hbGl6ZWRUeXBlLmVuZHNXaXRoKFwiW11cIikpIHJldHVybiB7aXRlbXM6IHt0eXBlOiBcInN0cmluZ1wifSwgdHlwZTogXCJhcnJheVwifVxuXG4gIHJldHVybiB7dHlwZTogXCJzdHJpbmdcIn1cbn1cblxuLyoqXG4gKiBCdWlsZHMgdGhlIE1DUCB0b29sIG5hbWUgZm9yIG9uZSBtb2RlbCBjb21tYW5kLlxuICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBBcmd1bWVudHMuXG4gKiBAcGFyYW0ge3N0cmluZ30gYXJncy5tb2RlbEtleSAtIE1hbmlmZXN0IHJlc291cmNlIGtleSAoY29uZmlndXJlZCBtb2RlbCBuYW1lKS5cbiAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmNvbW1hbmROYW1lIC0gQ29tbWFuZCBtZXRob2QgbmFtZS5cbiAqIEBwYXJhbSB7XCJjb2xsZWN0aW9uXCIgfCBcIm1lbWJlclwifSBhcmdzLnNjb3BlIC0gQ29tbWFuZCBzY29wZS5cbiAqIEByZXR1cm5zIHtzdHJpbmd9IC0gTUNQIHRvb2wgbmFtZS5cbiAqL1xuZnVuY3Rpb24gbWNwVG9vbE5hbWUoe2NvbW1hbmROYW1lLCBtb2RlbEtleSwgc2NvcGV9KSB7XG4gIGNvbnN0IG1vZGVsUGFydCA9IGluZmxlY3Rpb24udW5kZXJzY29yZShtb2RlbEtleSkudG9Mb3dlckNhc2UoKVxuICBjb25zdCBjb21tYW5kUGFydCA9IGluZmxlY3Rpb24udW5kZXJzY29yZShjb21tYW5kTmFtZSkudG9Mb3dlckNhc2UoKVxuICBjb25zdCBzY29wZVBhcnQgPSBzY29wZSA9PT0gXCJtZW1iZXJcIiA/IFwiX2J5X2lkXCIgOiBcIlwiXG5cbiAgcmV0dXJuIGAke21vZGVsUGFydH1fJHtjb21tYW5kUGFydH0ke3Njb3BlUGFydH1gXG59XG5cbi8qKlxuICogQnVpbGRzIHRoZSBwcmltYXJ5IGtleSBpbnB1dCBwcm9wZXJ0aWVzIGZvciBvbmUgbWFuaWZlc3QgcmVzb3VyY2UuXG4gKiBAcGFyYW0ge3N0cmluZyB8IHN0cmluZ1tdIHwgdW5kZWZpbmVkfSBwcmltYXJ5S2V5IC0gUmVzb3VyY2UgcHJpbWFyeSBrZXkgYXR0cmlidXRlIG5hbWUocykuXG4gKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywge2Rlc2NyaXB0aW9uOiBzdHJpbmcsIHR5cGU6IHN0cmluZ30+fSAtIFByaW1hcnkga2V5IEpTT04gU2NoZW1hIHByb3BlcnRpZXMuXG4gKi9cbmZ1bmN0aW9uIHByaW1hcnlLZXlQcm9wZXJ0aWVzKHByaW1hcnlLZXkpIHtcbiAgY29uc3Qga2V5QXR0cmlidXRlcyA9IEFycmF5LmlzQXJyYXkocHJpbWFyeUtleSkgPyBwcmltYXJ5S2V5IDogW3ByaW1hcnlLZXkgfHwgXCJpZFwiXVxuICAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIHtkZXNjcmlwdGlvbjogc3RyaW5nLCB0eXBlOiBzdHJpbmd9Pn0gKi9cbiAgY29uc3QgcHJvcGVydGllcyA9IHt9XG5cbiAgZm9yIChjb25zdCBrZXlBdHRyaWJ1dGUgb2Yga2V5QXR0cmlidXRlcykge1xuICAgIHByb3BlcnRpZXNba2V5QXR0cmlidXRlXSA9IHtkZXNjcmlwdGlvbjogYFByaW1hcnkga2V5IGF0dHJpYnV0ZSBcXGAke2tleUF0dHJpYnV0ZX1cXGAgb2YgdGhlIHJlY29yZC5gLCB0eXBlOiBcInN0cmluZ1wifVxuICB9XG5cbiAgcmV0dXJuIHByb3BlcnRpZXNcbn1cblxuLyoqXG4gKiBCdWlsZHMgdGhlIGZpeGVkIGlucHV0IHNjaGVtYSBmb3Igb25lIGJ1aWx0LWluIGNvbW1hbmQuXG4gKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEFyZ3VtZW50cy5cbiAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmNvbW1hbmROYW1lIC0gQnVpbHQtaW4gY29tbWFuZCBuYW1lLlxuICogQHBhcmFtIHtzdHJpbmcgfCBzdHJpbmdbXSB8IHVuZGVmaW5lZH0gYXJncy5wcmltYXJ5S2V5IC0gUmVzb3VyY2UgcHJpbWFyeSBrZXkgYXR0cmlidXRlIG5hbWUocykuXG4gKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgdW5rbm93bj59IC0gSlNPTiBTY2hlbWEgb2JqZWN0IGZvciB0aGUgdG9vbCBpbnB1dC5cbiAqL1xuZnVuY3Rpb24gYnVpbHRJbkNvbW1hbmRJbnB1dFNjaGVtYSh7Y29tbWFuZE5hbWUsIHByaW1hcnlLZXl9KSB7XG4gIGlmIChjb21tYW5kTmFtZSA9PT0gXCJpbmRleFwiKSB7XG4gICAgcmV0dXJuIHtcbiAgICAgIGFkZGl0aW9uYWxQcm9wZXJ0aWVzOiBmYWxzZSxcbiAgICAgIHByb3BlcnRpZXM6IHtcbiAgICAgICAgY291bnQ6IHtkZXNjcmlwdGlvbjogXCJSZXR1cm4gb25seSB0aGUgY291bnQgb2YgbWF0Y2hpbmcgcmVjb3Jkcy5cIiwgdHlwZTogXCJib29sZWFuXCJ9LFxuICAgICAgICBkaXN0aW5jdDoge2Rlc2NyaXB0aW9uOiBcIkFwcGx5IERJU1RJTkNUIHRvIHRoZSBpbmRleCBxdWVyeS5cIiwgdHlwZTogXCJib29sZWFuXCJ9LFxuICAgICAgICBncm91cDoge2Rlc2NyaXB0aW9uOiBcIkdyb3VwIHRoZSBpbmRleCBxdWVyeSBieSBhdHRyaWJ1dGUgbmFtZXMgb3IgcmVsYXRpb25zaGlwLXBhdGggZGVzY3JpcHRvcnMuXCIsIHR5cGU6IFwib2JqZWN0XCJ9LFxuICAgICAgICBqb2luczoge2Rlc2NyaXB0aW9uOiBcIlJlbGF0aW9uc2hpcC1wYXRoIGpvaW4gZGVzY3JpcHRvcnMuXCIsIHR5cGU6IFwib2JqZWN0XCJ9LFxuICAgICAgICBsaW1pdDoge2Rlc2NyaXB0aW9uOiBcIk1heGltdW0gbnVtYmVyIG9mIHJlY29yZHMgdG8gcmV0dXJuLlwiLCB0eXBlOiBcIm51bWJlclwifSxcbiAgICAgICAgb2Zmc2V0OiB7ZGVzY3JpcHRpb246IFwiTnVtYmVyIG9mIHJlY29yZHMgdG8gc2tpcC5cIiwgdHlwZTogXCJudW1iZXJcIn0sXG4gICAgICAgIHBhZ2U6IHtkZXNjcmlwdGlvbjogXCIxLWJhc2VkIHBhZ2UgbnVtYmVyIChjb21iaW5lIHdpdGggYHBlclBhZ2VgKS5cIiwgdHlwZTogXCJudW1iZXJcIn0sXG4gICAgICAgIHBlclBhZ2U6IHtkZXNjcmlwdGlvbjogXCJSZWNvcmRzIHBlciBwYWdlLlwiLCB0eXBlOiBcIm51bWJlclwifSxcbiAgICAgICAgcGx1Y2s6IHtkZXNjcmlwdGlvbjogXCJBdHRyaWJ1dGUgbmFtZXMgb3IgcmVsYXRpb25zaGlwLXBhdGggZGVzY3JpcHRvcnMgdG8gcGx1Y2sgaW5zdGVhZCBvZiBmdWxsIHJlY29yZHMuXCIsIHR5cGU6IFwiYXJyYXlcIn0sXG4gICAgICAgIHByZWxvYWQ6IHtkZXNjcmlwdGlvbjogXCJSZWxhdGlvbnNoaXAgcHJlbG9hZCBkZXNjcmlwdG9ycy5cIiwgdHlwZTogXCJvYmplY3RcIn0sXG4gICAgICAgIHF1ZXJ5RGF0YToge2Rlc2NyaXB0aW9uOiBcIlN0cnVjdHVyZWQgcXVlcnktZGF0YSBkZXNjcmlwdG9yLlwiLCB0eXBlOiBcIm9iamVjdFwifSxcbiAgICAgICAgc2VhcmNoZXM6IHtkZXNjcmlwdGlvbjogXCJTZWFyY2ggZGVzY3JpcHRvcnMgKHBhdGgvY29sdW1uL29wZXJhdG9yL3ZhbHVlKS5cIiwgdHlwZTogXCJhcnJheVwifSxcbiAgICAgICAgc2VsZWN0OiB7ZGVzY3JpcHRpb246IFwiU2VsZWN0ZWQgYXR0cmlidXRlIG5hbWVzIHBlciBtb2RlbC5cIiwgdHlwZTogXCJvYmplY3RcIn0sXG4gICAgICAgIHNlbGVjdHNFeHRyYToge2Rlc2NyaXB0aW9uOiBcIkV4dHJhIHNlbGVjdGVkIGF0dHJpYnV0ZXMuXCIsIHR5cGU6IFwib2JqZWN0XCJ9LFxuICAgICAgICBzb3J0OiB7ZGVzY3JpcHRpb246IFwiU29ydCBkZWZpbml0aW9ucyAoY29sdW1uIG9yIHJlbGF0aW9uc2hpcC1wYXRoIGRlc2NyaXB0b3JzKS5cIiwgdHlwZTogXCJhcnJheVwifSxcbiAgICAgICAgd2hlcmU6IHtkZXNjcmlwdGlvbjogXCJBdHRyaWJ1dGUgZmlsdGVyIGhhc2guXCIsIHR5cGU6IFwib2JqZWN0XCJ9LFxuICAgICAgICB3aXRoQ291bnQ6IHtkZXNjcmlwdGlvbjogXCJJbmNsdWRlIHRoZSB0b3RhbCBjb3VudCBhbG9uZ3NpZGUgcmVjb3Jkcy5cIiwgdHlwZTogXCJib29sZWFuXCJ9XG4gICAgICB9LFxuICAgICAgdHlwZTogXCJvYmplY3RcIlxuICAgIH1cbiAgfVxuXG4gIGlmIChjb21tYW5kTmFtZSA9PT0gXCJjcmVhdGVcIikge1xuICAgIHJldHVybiB7XG4gICAgICBhZGRpdGlvbmFsUHJvcGVydGllczogZmFsc2UsXG4gICAgICBwcm9wZXJ0aWVzOiB7XG4gICAgICAgIGF0dHJpYnV0ZXM6IHtkZXNjcmlwdGlvbjogXCJXcml0YWJsZSBhdHRyaWJ1dGUgdmFsdWVzIGZvciB0aGUgbmV3IHJlY29yZC5cIiwgdHlwZTogXCJvYmplY3RcIn0sXG4gICAgICAgIG5lc3RlZEF0dHJpYnV0ZXM6IHtkZXNjcmlwdGlvbjogXCJOZXN0ZWQgcmVsYXRpb25zaGlwIGF0dHJpYnV0ZSBwYXlsb2Fkcy5cIiwgdHlwZTogXCJvYmplY3RcIn1cbiAgICAgIH0sXG4gICAgICByZXF1aXJlZDogW1wiYXR0cmlidXRlc1wiXSxcbiAgICAgIHR5cGU6IFwib2JqZWN0XCJcbiAgICB9XG4gIH1cblxuICBpZiAoY29tbWFuZE5hbWUgPT09IFwidXBkYXRlXCIpIHtcbiAgICBjb25zdCBpZFByb3BlcnRpZXMgPSBwcmltYXJ5S2V5UHJvcGVydGllcyhwcmltYXJ5S2V5KVxuXG4gICAgcmV0dXJuIHtcbiAgICAgIGFkZGl0aW9uYWxQcm9wZXJ0aWVzOiBmYWxzZSxcbiAgICAgIHByb3BlcnRpZXM6IHtcbiAgICAgICAgYXR0cmlidXRlczoge2Rlc2NyaXB0aW9uOiBcIldyaXRhYmxlIGF0dHJpYnV0ZSB2YWx1ZXMgdG8gYXBwbHkuXCIsIHR5cGU6IFwib2JqZWN0XCJ9LFxuICAgICAgICAuLi5pZFByb3BlcnRpZXMsXG4gICAgICAgIG5lc3RlZEF0dHJpYnV0ZXM6IHtkZXNjcmlwdGlvbjogXCJOZXN0ZWQgcmVsYXRpb25zaGlwIGF0dHJpYnV0ZSBwYXlsb2Fkcy5cIiwgdHlwZTogXCJvYmplY3RcIn1cbiAgICAgIH0sXG4gICAgICByZXF1aXJlZDogWy4uLk9iamVjdC5rZXlzKGlkUHJvcGVydGllcyksIFwiYXR0cmlidXRlc1wiXSxcbiAgICAgIHR5cGU6IFwib2JqZWN0XCJcbiAgICB9XG4gIH1cblxuICAvLyBmaW5kIC8gZGVzdHJveSAvIGF0dGFjaCAvIGRvd25sb2FkIC8gdXJsIC8gYXR0YWNobWVudExpc3QgYXJlIGlkLWFkZHJlc3NlZFxuICBjb25zdCBpZFByb3BlcnRpZXMgPSBwcmltYXJ5S2V5UHJvcGVydGllcyhwcmltYXJ5S2V5KVxuXG4gIHJldHVybiB7XG4gICAgYWRkaXRpb25hbFByb3BlcnRpZXM6IGZhbHNlLFxuICAgIHByb3BlcnRpZXM6IHsuLi5pZFByb3BlcnRpZXN9LFxuICAgIHJlcXVpcmVkOiBbLi4uT2JqZWN0LmtleXMoaWRQcm9wZXJ0aWVzKV0sXG4gICAgdHlwZTogXCJvYmplY3RcIlxuICB9XG59XG5cbi8qKlxuICogQnVpbGRzIHRoZSBpbnB1dCBzY2hlbWEgZm9yIG9uZSBjdXN0b20gY29tbWFuZCBmcm9tIGl0cyBtYW5pZmVzdCBhcmd1bWVudCBtZXRhZGF0YS5cbiAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gQXJndW1lbnRzLlxuICogQHBhcmFtIHtNYW5pZmVzdENvbW1hbmRFbnRyeX0gYXJncy5lbnRyeSAtIE1hbmlmZXN0IGNvbW1hbmQgZW50cnkuXG4gKiBAcGFyYW0ge3N0cmluZyB8IHN0cmluZ1tdIHwgdW5kZWZpbmVkfSBhcmdzLnByaW1hcnlLZXkgLSBSZXNvdXJjZSBwcmltYXJ5IGtleSBhdHRyaWJ1dGUgbmFtZShzKS5cbiAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCB1bmtub3duPn0gLSBKU09OIFNjaGVtYSBvYmplY3QgZm9yIHRoZSB0b29sIGlucHV0LlxuICovXG5mdW5jdGlvbiBjdXN0b21Db21tYW5kSW5wdXRTY2hlbWEoe2VudHJ5LCBwcmltYXJ5S2V5fSkge1xuICBjb25zdCBjb21tYW5kQXJncyA9IGVudHJ5LmFyZ3MgfHwgW11cbiAgLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCB7ZGVzY3JpcHRpb24/OiBzdHJpbmcsIGl0ZW1zPzoge2l0ZW1zPzoge3R5cGU6IHN0cmluZ30sIHR5cGU6IHN0cmluZ30sIHR5cGU6IHN0cmluZ30+fSAqL1xuICBjb25zdCBwcm9wZXJ0aWVzID0ge31cblxuICBmb3IgKGNvbnN0IGNvbW1hbmRBcmcgb2YgY29tbWFuZEFyZ3MpIHtcbiAgICBwcm9wZXJ0aWVzW2NvbW1hbmRBcmcubmFtZV0gPSBqc29uU2NoZW1hVHlwZUZvckpTRG9jVHlwZShjb21tYW5kQXJnLnR5cGUpXG4gIH1cblxuICBpZiAoZW50cnkuc2NvcGUgPT09IFwibWVtYmVyXCIpIHtcbiAgICBmb3IgKGNvbnN0IFtrZXlBdHRyaWJ1dGUsIGtleVNjaGVtYV0gb2YgT2JqZWN0LmVudHJpZXMocHJpbWFyeUtleVByb3BlcnRpZXMocHJpbWFyeUtleSkpKSB7XG4gICAgICBpZiAoIXByb3BlcnRpZXNba2V5QXR0cmlidXRlXSkgcHJvcGVydGllc1trZXlBdHRyaWJ1dGVdID0ga2V5U2NoZW1hXG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIHtcbiAgICBhZGRpdGlvbmFsUHJvcGVydGllczogdHJ1ZSxcbiAgICBwcm9wZXJ0aWVzLFxuICAgIHR5cGU6IFwib2JqZWN0XCJcbiAgfVxufVxuXG4vKipcbiAqIEdlbmVyYXRlcyBNQ1AgdG9vbCBkZWZpbml0aW9ucyBmcm9tIGEgZnJvbnRlbmQtbW9kZWwgQVBJIG1hbmlmZXN0LlxuICogRXZlcnkgYnVpbHQtaW4gYW5kIGN1c3RvbSBjb21tYW5kIG9mIGV2ZXJ5IG1hbmlmZXN0IHJlc291cmNlIGJlY29tZXMgb25lIHRvb2w7XG4gKiBvbmUgbWV0YSB0b29sIGV4cG9zZXMgdGhlIHJhdyBtYW5pZmVzdCBmb3IgZGlzY292ZXJ5LlxuICogQHBhcmFtIHtBcGlNYW5pZmVzdH0gbWFuaWZlc3QgLSBNYW5pZmVzdCBmcm9tIGBjb25maWd1cmF0aW9uLmdldEFwaU1hbmlmZXN0KClgLlxuICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIHVua25vd24+W119IC0gTUNQIGB0b29scy9saXN0YCB0b29sIGRlZmluaXRpb25zLlxuICovXG5leHBvcnQgZnVuY3Rpb24gZ2VuZXJhdGVNY3BUb29scyhtYW5pZmVzdCkge1xuICBjb25zdCByZXNvdXJjZXMgPSBtYW5pZmVzdC5yZXNvdXJjZXNcbiAgY29uc3QgdG9vbHMgPSBbXVxuXG4gIGlmICghcmVzb3VyY2VzKSByZXR1cm4gW2J1aWxkTWV0YVRvb2woKV1cblxuICBmb3IgKGNvbnN0IG1vZGVsS2V5IG9mIE9iamVjdC5rZXlzKHJlc291cmNlcykuc29ydCgpKSB7XG4gICAgY29uc3QgcmVzb3VyY2UgPSAvKiogQHR5cGUge01hbmlmZXN0UmVzb3VyY2VFbnRyeX0gKi8gKHJlc291cmNlc1ttb2RlbEtleV0pXG4gICAgY29uc3QgY29tbWFuZHMgPSByZXNvdXJjZS5jb21tYW5kcyB8fCB7fVxuICAgIGNvbnN0IGJ1aWx0SW5Db21tYW5kcyA9IHJlc291cmNlLmJ1aWx0SW5Db21tYW5kcyB8fCB7fVxuXG4gICAgZm9yIChjb25zdCBzY29wZSBvZiAvKiogQHR5cGUge0FycmF5PFwiY29sbGVjdGlvblwiIHwgXCJtZW1iZXJcIj59ICovIChbXCJjb2xsZWN0aW9uXCIsIFwibWVtYmVyXCJdKSkge1xuICAgICAgZm9yIChjb25zdCBlbnRyeSBvZiBzY29wZUNvbW1hbmRFbnRyaWVzKHtidWlsdEluQ29tbWFuZHMsIGNvbW1hbmRzLCBzY29wZX0pKSB7XG4gICAgICAgIGNvbnN0IGNvbW1hbmROYW1lID0gZW50cnkubWV0aG9kTmFtZVxuICAgICAgICBjb25zdCBpc0J1aWx0SW4gPSBlbnRyeS5pc0J1aWx0SW5cbiAgICAgICAgY29uc3QgbmFtZSA9IG1jcFRvb2xOYW1lKHtjb21tYW5kTmFtZSwgbW9kZWxLZXksIHNjb3BlfSlcblxuICAgICAgICBpZiAoIU1DUF9UT09MX05BTUVfUEFUVEVSTi50ZXN0KG5hbWUpKSBjb250aW51ZVxuXG4gICAgICAgIHRvb2xzLnB1c2goe1xuICAgICAgICAgIGRlc2NyaXB0aW9uOiBpc0J1aWx0SW5cbiAgICAgICAgICAgID8gYCR7QlVJTFRfSU5fQ09NTUFORF9ERVNDUklQVElPTlNbY29tbWFuZE5hbWVdIHx8IGBSdW4gdGhlIGJ1aWx0LWluIFxcYCR7Y29tbWFuZE5hbWV9XFxgIGNvbW1hbmQgb24gXFxgJHtyZXNvdXJjZS5tb2RlbE5hbWV9XFxgLmB9IE1vZGVsOiBcXGAke3Jlc291cmNlLm1vZGVsTmFtZX1cXGAuYFxuICAgICAgICAgICAgOiBgQ3VzdG9tIGNvbW1hbmQgXFxgJHtjb21tYW5kTmFtZX1cXGAgb24gbW9kZWwgXFxgJHtyZXNvdXJjZS5tb2RlbE5hbWV9XFxgJHtlbnRyeS5yZXR1cm5UeXBlID8gYCAocmV0dXJucyAke2VudHJ5LnJldHVyblR5cGV9KWAgOiBcIlwifS5gLFxuICAgICAgICAgIGlucHV0U2NoZW1hOiBpc0J1aWx0SW5cbiAgICAgICAgICAgID8gYnVpbHRJbkNvbW1hbmRJbnB1dFNjaGVtYSh7Y29tbWFuZE5hbWUsIHByaW1hcnlLZXk6IHJlc291cmNlLnByaW1hcnlLZXl9KVxuICAgICAgICAgICAgOiBjdXN0b21Db21tYW5kSW5wdXRTY2hlbWEoe2VudHJ5LCBwcmltYXJ5S2V5OiByZXNvdXJjZS5wcmltYXJ5S2V5fSksXG4gICAgICAgICAgbmFtZVxuICAgICAgICB9KVxuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIHRvb2xzLnB1c2goYnVpbGRNZXRhVG9vbCgpKVxuXG4gIHJldHVybiB0b29sc1xufVxuXG4vKipcbiAqIE1lcmdlcyB0aGUgbWFuaWZlc3QncyBidWlsdC1pbiBjb21tYW5kIG5hbWVzIGFuZCBjdXN0b20gY29tbWFuZCBlbnRyaWVzIGZvclxuICogb25lIHNjb3BlIGludG8gYSBzaW5nbGUgZGV0ZXJtaW5pc3RpYyBjb21tYW5kLWVudHJ5IGxpc3QuXG4gKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEFyZ3VtZW50cy5cbiAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmVjb3JkPHN0cmluZywgc3RyaW5nPj59IGFyZ3MuYnVpbHRJbkNvbW1hbmRzIC0gU2NvcGUta2V5ZWQgYnVpbHQtaW4gY29tbWFuZCBtYXBzLlxuICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBNYW5pZmVzdENvbW1hbmRFbnRyeVtdPn0gYXJncy5jb21tYW5kcyAtIFNjb3BlLWtleWVkIGN1c3RvbSBjb21tYW5kIGVudHJpZXMuXG4gKiBAcGFyYW0ge1wiY29sbGVjdGlvblwiIHwgXCJtZW1iZXJcIn0gYXJncy5zY29wZSAtIENvbW1hbmQgc2NvcGUuXG4gKiBAcmV0dXJucyB7QXJyYXk8TWFuaWZlc3RDb21tYW5kRW50cnkgJiB7aXNCdWlsdEluOiBib29sZWFufT59IC0gQ29tYmluZWQgY29tbWFuZCBlbnRyaWVzLlxuICovXG5mdW5jdGlvbiBzY29wZUNvbW1hbmRFbnRyaWVzKHtidWlsdEluQ29tbWFuZHMsIGNvbW1hbmRzLCBzY29wZX0pIHtcbiAgLyoqIEB0eXBlIHtBcnJheTxNYW5pZmVzdENvbW1hbmRFbnRyeSAmIHtpc0J1aWx0SW46IGJvb2xlYW59Pn0gKi9cbiAgY29uc3QgZW50cmllcyA9IFtdXG5cbiAgZm9yIChjb25zdCBjb21tYW5kTmFtZSBvZiBPYmplY3Qua2V5cyhidWlsdEluQ29tbWFuZHNbc2NvcGVdIHx8IHt9KSkge1xuICAgIGVudHJpZXMucHVzaCh7aXNCdWlsdEluOiB0cnVlLCBtZXRob2ROYW1lOiBjb21tYW5kTmFtZSwgc2NvcGV9KVxuICB9XG5cbiAgZm9yIChjb25zdCBlbnRyeSBvZiBjb21tYW5kc1tzY29wZV0gfHwgW10pIHtcbiAgICBlbnRyaWVzLnB1c2goey4uLmVudHJ5LCBpc0J1aWx0SW46IGZhbHNlfSlcbiAgfVxuXG4gIHJldHVybiBlbnRyaWVzLnNvcnQoKGEsIGIpID0+IGEubWV0aG9kTmFtZS5sb2NhbGVDb21wYXJlKGIubWV0aG9kTmFtZSkpXG59XG5cbi8qKlxuICogQnVpbGRzIHRoZSBtYW5pZmVzdCBkaXNjb3ZlcnkgbWV0YSB0b29sLlxuICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIHVua25vd24+fSAtIE1DUCB0b29sIGRlZmluaXRpb24uXG4gKi9cbmZ1bmN0aW9uIGJ1aWxkTWV0YVRvb2woKSB7XG4gIHJldHVybiB7XG4gICAgZGVzY3JpcHRpb246IE1FVEFfVE9PTF9ERVNDUklQVElPTixcbiAgICBpbnB1dFNjaGVtYToge2FkZGl0aW9uYWxQcm9wZXJ0aWVzOiBmYWxzZSwgcHJvcGVydGllczoge30sIHR5cGU6IFwib2JqZWN0XCJ9LFxuICAgIG5hbWU6IE1FVEFfVE9PTF9OQU1FXG4gIH1cbn1cblxuLyoqXG4gKiBQYXJzZXMgb25lIE1DUCB0b29sIG5hbWUgYmFjayBpbnRvIGl0cyBtYW5pZmVzdCBtb2RlbCBrZXkgYW5kIGNvbW1hbmQgbWV0aG9kIG5hbWUuXG4gKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEFyZ3VtZW50cy5cbiAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLnRvb2xOYW1lIC0gTUNQIHRvb2wgbmFtZS5cbiAqIEBwYXJhbSB7QXBpTWFuaWZlc3R9IGFyZ3MubWFuaWZlc3QgLSBNYW5pZmVzdCBmcm9tIGBjb25maWd1cmF0aW9uLmdldEFwaU1hbmlmZXN0KClgLlxuICogQHJldHVybnMge3tjb21tYW5kTmFtZTogc3RyaW5nLCBtb2RlbEtleTogc3RyaW5nLCBzY29wZTogXCJjb2xsZWN0aW9uXCIgfCBcIm1lbWJlclwifSB8IG51bGx9IC0gQ29tbWFuZCBpZGVudGl0eSwgb3IgbnVsbCB3aGVuIHVua25vd24uXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBwYXJzZU1jcFRvb2xOYW1lKHttYW5pZmVzdCwgdG9vbE5hbWV9KSB7XG4gIGlmICh0b29sTmFtZSA9PT0gTUVUQV9UT09MX05BTUUpIHJldHVybiBudWxsXG5cbiAgY29uc3QgcmVzb3VyY2VzID0gbWFuaWZlc3QucmVzb3VyY2VzXG5cbiAgaWYgKCFyZXNvdXJjZXMpIHJldHVybiBudWxsXG5cbiAgZm9yIChjb25zdCBtb2RlbEtleSBvZiBPYmplY3Qua2V5cyhyZXNvdXJjZXMpKSB7XG4gICAgY29uc3QgcmVzb3VyY2UgPSAvKiogQHR5cGUge01hbmlmZXN0UmVzb3VyY2VFbnRyeX0gKi8gKHJlc291cmNlc1ttb2RlbEtleV0pXG4gICAgY29uc3QgY29tbWFuZHMgPSByZXNvdXJjZS5jb21tYW5kcyB8fCB7fVxuICAgIGNvbnN0IGJ1aWx0SW5Db21tYW5kcyA9IHJlc291cmNlLmJ1aWx0SW5Db21tYW5kcyB8fCB7fVxuXG4gICAgZm9yIChjb25zdCBzY29wZSBvZiAvKiogQHR5cGUge0FycmF5PFwiY29sbGVjdGlvblwiIHwgXCJtZW1iZXJcIj59ICovIChbXCJjb2xsZWN0aW9uXCIsIFwibWVtYmVyXCJdKSkge1xuICAgICAgY29uc3QgY29tbWFuZE5hbWVzID0gWy4uLk9iamVjdC5rZXlzKGJ1aWx0SW5Db21tYW5kc1tzY29wZV0gfHwge30pLCAuLi4oY29tbWFuZHNbc2NvcGVdIHx8IFtdKS5tYXAoKGVudHJ5KSA9PiBlbnRyeS5tZXRob2ROYW1lKV1cblxuICAgICAgZm9yIChjb25zdCBjb21tYW5kTmFtZSBvZiBjb21tYW5kTmFtZXMpIHtcbiAgICAgICAgaWYgKG1jcFRvb2xOYW1lKHtjb21tYW5kTmFtZSwgbW9kZWxLZXksIHNjb3BlfSkgPT09IHRvb2xOYW1lKSB7XG4gICAgICAgICAgcmV0dXJuIHtjb21tYW5kTmFtZSwgbW9kZWxLZXksIHNjb3BlfVxuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIG51bGxcbn1cblxuLyoqXG4gKiBSdW5zIHRoZSBtZXRhVG9vbE5hbWUgaGVscGVyLlxuICogQHJldHVybnMge3N0cmluZ30gLSBUaGUgbWV0YSB0b29sIG5hbWUuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBtZXRhVG9vbE5hbWUoKSB7IHJldHVybiBNRVRBX1RPT0xfTkFNRSB9XG4iXX0=