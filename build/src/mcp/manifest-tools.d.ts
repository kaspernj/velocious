export type ManifestCommandEntry = {
    /**
     * - Declared typed command arguments.
     */
    args?: Array<{
        name: string;
        type: string;
    }>;
    /**
     * - Command method name.
     */
    methodName: string;
    /**
     * - Manifest command path (member paths carry `<id>`).
     */
    path?: string;
    /**
     * - Declared JSDoc return type.
     */
    returnType?: string | null;
    /**
     * - Command scope.
     */
    scope: "collection" | "member";
};
export type ManifestResourceEntry = {
    /**
     * - Scope-keyed custom command entries.
     */
    commands?: Record<string, ManifestCommandEntry[]>;
    /**
     * - Scope-keyed built-in command maps (methodName → slug).
     */
    builtInCommands?: Record<string, Record<string, string>>;
    /**
     * - Backend model name.
     */
    modelName: string;
    /**
     * - Primary key attribute name(s).
     */
    primaryKey?: string | string[];
};
export type ApiManifest = Record<string, unknown> & {
    formatVersion?: number;
    resources?: Record<string, unknown>;
};
/**
 * Generates MCP tool definitions from a frontend-model API manifest.
 * Every built-in and custom command of every manifest resource becomes one tool;
 * one meta tool exposes the raw manifest for discovery.
 * @param {ApiManifest} manifest - Manifest from `configuration.getApiManifest()`.
 * @returns {Record<string, unknown>[]} - MCP `tools/list` tool definitions.
 */
export declare function generateMcpTools(manifest: ApiManifest): Record<string, unknown>[];
/**
 * Parses one MCP tool name back into its manifest model key and command method name.
 * @param {object} args - Arguments.
 * @param {string} args.toolName - MCP tool name.
 * @param {ApiManifest} args.manifest - Manifest from `configuration.getApiManifest()`.
 * @returns {{commandName: string, modelKey: string, scope: "collection" | "member"} | null} - Command identity, or null when unknown.
 */
export declare function parseMcpToolName({ manifest, toolName }: {
    toolName: string;
    manifest: ApiManifest;
}): {
    commandName: string;
    modelKey: string;
    scope: "collection" | "member";
} | null;
/**
 * Runs the metaToolName helper.
 * @returns {string} - The meta tool name.
 */
export declare function metaToolName(): string;
//# sourceMappingURL=manifest-tools.d.ts.map