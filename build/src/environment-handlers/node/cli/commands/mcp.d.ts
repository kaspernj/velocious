import BaseCommand from "../../../../cli/base-command.js";
/**
 * Parses `--request-context key=value` occurrences from raw process args and the
 * `MCP_REQUEST_CONTEXT` environment variable (JSON object) into one context hash.
 * @param {object} args - Arguments.
 * @param {string[]} [args.processArgs] - Raw CLI process args.
 * @returns {Record<string, string | number | boolean> | undefined} - Parsed request context, or undefined when none configured.
 */
export declare function parseMcpRequestContext({ processArgs }: {
    processArgs?: string[];
}): Record<string, string | number | boolean> | undefined;
export default class VelociousCliCommandsMcp extends BaseCommand {
    /**
     * Runs execute.
     * @returns {Promise<void>} - Starts the MCP stdio server and waits until stdin closes.
     */
    execute(): Promise<void>;
}
//# sourceMappingURL=mcp.d.ts.map