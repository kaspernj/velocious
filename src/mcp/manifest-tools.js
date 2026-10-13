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

import inflection from "inflection"

const MCP_TOOL_NAME_PATTERN = /^[a-z0-9_]+$/

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
}

const META_TOOL_NAME = "frontend_model_api_manifest"
const META_TOOL_DESCRIPTION = "Return the full frontend-model API manifest (all resources, attributes, abilities, and commands) so callers can discover the available model commands."

/**
 * Maps one JSDoc type string from command metadata to a JSON Schema fragment.
 * @param {string} type - JSDoc type string (for example `string`, `number`, `{id: number}`).
 * @returns {{items?: {type: string}, type: string}} - JSON Schema type fragment.
 */
function jsonSchemaTypeForJSDocType(type) {
  const normalizedType = type.trim()

  if (normalizedType === "number" || normalizedType === "integer") return {type: "number"}
  if (normalizedType === "boolean") return {type: "boolean"}
  if (normalizedType.startsWith("Array<") || normalizedType.endsWith("[]")) return {items: {type: "string"}, type: "array"}

  return {type: "string"}
}

/**
 * Builds the MCP tool name for one model command.
 * @param {object} args - Arguments.
 * @param {string} args.modelKey - Manifest resource key (configured model name).
 * @param {string} args.commandName - Command method name.
 * @param {"collection" | "member"} args.scope - Command scope.
 * @returns {string} - MCP tool name.
 */
function mcpToolName({commandName, modelKey, scope}) {
  const modelPart = inflection.underscore(modelKey).toLowerCase()
  const commandPart = inflection.underscore(commandName).toLowerCase()
  const scopePart = scope === "member" ? "_by_id" : ""

  return `${modelPart}_${commandPart}${scopePart}`
}

/**
 * Builds the primary key input properties for one manifest resource.
 * @param {string | string[] | undefined} primaryKey - Resource primary key attribute name(s).
 * @returns {Record<string, {description: string, type: string}>} - Primary key JSON Schema properties.
 */
function primaryKeyProperties(primaryKey) {
  const keyAttributes = Array.isArray(primaryKey) ? primaryKey : [primaryKey || "id"]
  /** @type {Record<string, {description: string, type: string}>} */
  const properties = {}

  for (const keyAttribute of keyAttributes) {
    properties[keyAttribute] = {description: `Primary key attribute \`${keyAttribute}\` of the record.`, type: "string"}
  }

  return properties
}

/**
 * Builds the fixed input schema for one built-in command.
 * @param {object} args - Arguments.
 * @param {string} args.commandName - Built-in command name.
 * @param {string | string[] | undefined} args.primaryKey - Resource primary key attribute name(s).
 * @returns {Record<string, unknown>} - JSON Schema object for the tool input.
 */
function builtInCommandInputSchema({commandName, primaryKey}) {
  if (commandName === "index") {
    return {
      additionalProperties: false,
      properties: {
        count: {description: "Return only the count of matching records.", type: "boolean"},
        distinct: {description: "Apply DISTINCT to the index query.", type: "boolean"},
        group: {description: "Group the index query by attribute names or relationship-path descriptors.", type: "object"},
        joins: {description: "Relationship-path join descriptors.", type: "object"},
        limit: {description: "Maximum number of records to return.", type: "number"},
        offset: {description: "Number of records to skip.", type: "number"},
        page: {description: "1-based page number (combine with `perPage`).", type: "number"},
        perPage: {description: "Records per page.", type: "number"},
        pluck: {description: "Attribute names or relationship-path descriptors to pluck instead of full records.", type: "array"},
        preload: {description: "Relationship preload descriptors.", type: "object"},
        queryData: {description: "Structured query-data descriptor.", type: "object"},
        searches: {description: "Search descriptors (path/column/operator/value).", type: "array"},
        select: {description: "Selected attribute names per model.", type: "object"},
        selectsExtra: {description: "Extra selected attributes.", type: "object"},
        sort: {description: "Sort definitions (column or relationship-path descriptors).", type: "array"},
        where: {description: "Attribute filter hash.", type: "object"},
        withCount: {description: "Include the total count alongside records.", type: "boolean"}
      },
      type: "object"
    }
  }

  if (commandName === "create") {
    return {
      additionalProperties: false,
      properties: {
        attributes: {description: "Writable attribute values for the new record.", type: "object"},
        nestedAttributes: {description: "Nested relationship attribute payloads.", type: "object"}
      },
      required: ["attributes"],
      type: "object"
    }
  }

  if (commandName === "update") {
    const idProperties = primaryKeyProperties(primaryKey)

    return {
      additionalProperties: false,
      properties: {
        attributes: {description: "Writable attribute values to apply.", type: "object"},
        ...idProperties,
        nestedAttributes: {description: "Nested relationship attribute payloads.", type: "object"}
      },
      required: [...Object.keys(idProperties), "attributes"],
      type: "object"
    }
  }

  // find / destroy / attach / download / url / attachmentList are id-addressed
  const idProperties = primaryKeyProperties(primaryKey)

  return {
    additionalProperties: false,
    properties: {...idProperties},
    required: [...Object.keys(idProperties)],
    type: "object"
  }
}

/**
 * Builds the input schema for one custom command from its manifest argument metadata.
 * @param {object} args - Arguments.
 * @param {ManifestCommandEntry} args.entry - Manifest command entry.
 * @param {string | string[] | undefined} args.primaryKey - Resource primary key attribute name(s).
 * @returns {Record<string, unknown>} - JSON Schema object for the tool input.
 */
function customCommandInputSchema({entry, primaryKey}) {
  const commandArgs = entry.args || []
  /** @type {Record<string, {description?: string, items?: {items?: {type: string}, type: string}, type: string}>} */
  const properties = {}

  for (const commandArg of commandArgs) {
    properties[commandArg.name] = jsonSchemaTypeForJSDocType(commandArg.type)
  }

  if (entry.scope === "member") {
    for (const [keyAttribute, keySchema] of Object.entries(primaryKeyProperties(primaryKey))) {
      if (!properties[keyAttribute]) properties[keyAttribute] = keySchema
    }
  }

  return {
    additionalProperties: true,
    properties,
    type: "object"
  }
}

/**
 * Generates MCP tool definitions from a frontend-model API manifest.
 * Every built-in and custom command of every manifest resource becomes one tool;
 * one meta tool exposes the raw manifest for discovery.
 * @param {ApiManifest} manifest - Manifest from `configuration.getApiManifest()`.
 * @returns {Record<string, unknown>[]} - MCP `tools/list` tool definitions.
 */
export function generateMcpTools(manifest) {
  const resources = manifest.resources
  const tools = []

  if (!resources) return [buildMetaTool()]

  for (const modelKey of Object.keys(resources).sort()) {
    const resource = /** @type {ManifestResourceEntry} */ (resources[modelKey])
    const commands = resource.commands || {}
    const builtInCommands = resource.builtInCommands || {}

    for (const scope of /** @type {Array<"collection" | "member">} */ (["collection", "member"])) {
      for (const entry of scopeCommandEntries({builtInCommands, commands, scope})) {
        const commandName = entry.methodName
        const isBuiltIn = entry.isBuiltIn
        const name = mcpToolName({commandName, modelKey, scope})

        if (!MCP_TOOL_NAME_PATTERN.test(name)) continue

        tools.push({
          description: isBuiltIn
            ? `${BUILT_IN_COMMAND_DESCRIPTIONS[commandName] || `Run the built-in \`${commandName}\` command on \`${resource.modelName}\`.`} Model: \`${resource.modelName}\`.`
            : `Custom command \`${commandName}\` on model \`${resource.modelName}\`${entry.returnType ? ` (returns ${entry.returnType})` : ""}.`,
          inputSchema: isBuiltIn
            ? builtInCommandInputSchema({commandName, primaryKey: resource.primaryKey})
            : customCommandInputSchema({entry, primaryKey: resource.primaryKey}),
          name
        })
      }
    }
  }

  tools.push(buildMetaTool())

  return tools
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
function scopeCommandEntries({builtInCommands, commands, scope}) {
  /** @type {Array<ManifestCommandEntry & {isBuiltIn: boolean}>} */
  const entries = []

  for (const commandName of Object.keys(builtInCommands[scope] || {})) {
    entries.push({isBuiltIn: true, methodName: commandName, scope})
  }

  for (const entry of commands[scope] || []) {
    entries.push({...entry, isBuiltIn: false})
  }

  return entries.sort((a, b) => a.methodName.localeCompare(b.methodName))
}

/**
 * Builds the manifest discovery meta tool.
 * @returns {Record<string, unknown>} - MCP tool definition.
 */
function buildMetaTool() {
  return {
    description: META_TOOL_DESCRIPTION,
    inputSchema: {additionalProperties: false, properties: {}, type: "object"},
    name: META_TOOL_NAME
  }
}

/**
 * Parses one MCP tool name back into its manifest model key and command method name.
 * @param {object} args - Arguments.
 * @param {string} args.toolName - MCP tool name.
 * @param {ApiManifest} args.manifest - Manifest from `configuration.getApiManifest()`.
 * @returns {{commandName: string, modelKey: string, scope: "collection" | "member"} | null} - Command identity, or null when unknown.
 */
export function parseMcpToolName({manifest, toolName}) {
  if (toolName === META_TOOL_NAME) return null

  const resources = manifest.resources

  if (!resources) return null

  for (const modelKey of Object.keys(resources)) {
    const resource = /** @type {ManifestResourceEntry} */ (resources[modelKey])
    const commands = resource.commands || {}
    const builtInCommands = resource.builtInCommands || {}

    for (const scope of /** @type {Array<"collection" | "member">} */ (["collection", "member"])) {
      const commandNames = [...Object.keys(builtInCommands[scope] || {}), ...(commands[scope] || []).map((entry) => entry.methodName)]

      for (const commandName of commandNames) {
        if (mcpToolName({commandName, modelKey, scope}) === toolName) {
          return {commandName, modelKey, scope}
        }
      }
    }
  }

  return null
}

/**
 * Runs the metaToolName helper.
 * @returns {string} - The meta tool name.
 */
export function metaToolName() { return META_TOOL_NAME }
