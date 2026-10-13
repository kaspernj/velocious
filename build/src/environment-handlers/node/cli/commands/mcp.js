// @ts-check
import Application from "../../../../application.js";
import BaseCommand from "../../../../cli/base-command.js";
import { startMcpStdioServer } from "../../../../mcp/json-rpc-server.js";
/**
 * Parses `--request-context key=value` occurrences from raw process args and the
 * `MCP_REQUEST_CONTEXT` environment variable (JSON object) into one context hash.
 * @param {object} args - Arguments.
 * @param {string[]} [args.processArgs] - Raw CLI process args.
 * @returns {Record<string, string | number | boolean> | undefined} - Parsed request context, or undefined when none configured.
 */
export function parseMcpRequestContext({ processArgs = [] }) {
    /** @type {Record<string, string | number | boolean>} */
    const context = {};
    const envValue = process.env.MCP_REQUEST_CONTEXT;
    if (envValue) {
        const parsedEnv = /** @type {Record<string, unknown>} */ (JSON.parse(envValue));
        for (const [key, value] of Object.entries(parsedEnv)) {
            assignContextValue(context, key, value);
        }
    }
    for (let i = 0; i < processArgs.length; i++) {
        if (processArgs[i] !== "--request-context")
            continue;
        const pair = processArgs[i + 1];
        if (typeof pair !== "string")
            throw new Error("--request-context requires a key=value pair");
        const separatorIndex = pair.indexOf("=");
        if (separatorIndex < 1)
            throw new Error(`--request-context pair '${pair}' must be key=value`);
        assignContextValue(context, pair.slice(0, separatorIndex), pair.slice(separatorIndex + 1));
        i++;
    }
    return Object.keys(context).length > 0 ? context : undefined;
}
/**
 * Assigns one scalar context value, converting numeric strings to numbers.
 * @param {Record<string, string | number | boolean>} context - Target context hash.
 * @param {string} key - Context key.
 * @param {unknown} value - Raw value.
 * @returns {void} - No return value.
 */
function assignContextValue(context, key, value) {
    if (typeof value === "number" || typeof value === "boolean") {
        context[key] = value;
        return;
    }
    if (typeof value !== "string")
        throw new Error(`Request context value for '${key}' must be a scalar`);
    const asNumber = Number(value);
    context[key] = value.length > 0 && Number.isFinite(asNumber) ? asNumber : value;
}
export default class VelociousCliCommandsMcp extends BaseCommand {
    /**
     * Runs execute.
     * @returns {Promise<void>} - Starts the MCP stdio server and waits until stdin closes.
     */
    async execute() {
        // Identify this process in `ps`/`top` instead of a generic "node" entry.
        process.title = "velocious mcp";
        const configuration = this.getConfiguration();
        const requestContext = parseMcpRequestContext({ processArgs: this.processArgs });
        const application = new Application({ configuration, type: "mcp" });
        await application.initialize();
        const server = startMcpStdioServer({ configuration, requestContext });
        await server.done;
        await application.stop();
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibWNwLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vLi4vLi4vc3JjL2Vudmlyb25tZW50LWhhbmRsZXJzL25vZGUvY2xpL2NvbW1hbmRzL21jcC5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxZQUFZO0FBRVosT0FBTyxXQUFXLE1BQU0sNEJBQTRCLENBQUE7QUFDcEQsT0FBTyxXQUFXLE1BQU0saUNBQWlDLENBQUE7QUFDekQsT0FBTyxFQUFDLG1CQUFtQixFQUFDLE1BQU0sb0NBQW9DLENBQUE7QUFFdEU7Ozs7OztHQU1HO0FBQ0gsTUFBTSxVQUFVLHNCQUFzQixDQUFDLEVBQUMsV0FBVyxHQUFHLEVBQUUsRUFBQztJQUN2RCx3REFBd0Q7SUFDeEQsTUFBTSxPQUFPLEdBQUcsRUFBRSxDQUFBO0lBRWxCLE1BQU0sUUFBUSxHQUFHLE9BQU8sQ0FBQyxHQUFHLENBQUMsbUJBQW1CLENBQUE7SUFFaEQsSUFBSSxRQUFRLEVBQUUsQ0FBQztRQUNiLE1BQU0sU0FBUyxHQUFHLHNDQUFzQyxDQUFDLENBQUMsSUFBSSxDQUFDLEtBQUssQ0FBQyxRQUFRLENBQUMsQ0FBQyxDQUFBO1FBRS9FLEtBQUssTUFBTSxDQUFDLEdBQUcsRUFBRSxLQUFLLENBQUMsSUFBSSxNQUFNLENBQUMsT0FBTyxDQUFDLFNBQVMsQ0FBQyxFQUFFLENBQUM7WUFDckQsa0JBQWtCLENBQUMsT0FBTyxFQUFFLEdBQUcsRUFBRSxLQUFLLENBQUMsQ0FBQTtRQUN6QyxDQUFDO0lBQ0gsQ0FBQztJQUVELEtBQUssSUFBSSxDQUFDLEdBQUcsQ0FBQyxFQUFFLENBQUMsR0FBRyxXQUFXLENBQUMsTUFBTSxFQUFFLENBQUMsRUFBRSxFQUFFLENBQUM7UUFDNUMsSUFBSSxXQUFXLENBQUMsQ0FBQyxDQUFDLEtBQUssbUJBQW1CO1lBQUUsU0FBUTtRQUVwRCxNQUFNLElBQUksR0FBRyxXQUFXLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFBO1FBRS9CLElBQUksT0FBTyxJQUFJLEtBQUssUUFBUTtZQUFFLE1BQU0sSUFBSSxLQUFLLENBQUMsNkNBQTZDLENBQUMsQ0FBQTtRQUU1RixNQUFNLGNBQWMsR0FBRyxJQUFJLENBQUMsT0FBTyxDQUFDLEdBQUcsQ0FBQyxDQUFBO1FBRXhDLElBQUksY0FBYyxHQUFHLENBQUM7WUFBRSxNQUFNLElBQUksS0FBSyxDQUFDLDJCQUEyQixJQUFJLHFCQUFxQixDQUFDLENBQUE7UUFFN0Ysa0JBQWtCLENBQUMsT0FBTyxFQUFFLElBQUksQ0FBQyxLQUFLLENBQUMsQ0FBQyxFQUFFLGNBQWMsQ0FBQyxFQUFFLElBQUksQ0FBQyxLQUFLLENBQUMsY0FBYyxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUE7UUFDMUYsQ0FBQyxFQUFFLENBQUE7SUFDTCxDQUFDO0lBRUQsT0FBTyxNQUFNLENBQUMsSUFBSSxDQUFDLE9BQU8sQ0FBQyxDQUFDLE1BQU0sR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUMsU0FBUyxDQUFBO0FBQzlELENBQUM7QUFFRDs7Ozs7O0dBTUc7QUFDSCxTQUFTLGtCQUFrQixDQUFDLE9BQU8sRUFBRSxHQUFHLEVBQUUsS0FBSztJQUM3QyxJQUFJLE9BQU8sS0FBSyxLQUFLLFFBQVEsSUFBSSxPQUFPLEtBQUssS0FBSyxTQUFTLEVBQUUsQ0FBQztRQUM1RCxPQUFPLENBQUMsR0FBRyxDQUFDLEdBQUcsS0FBSyxDQUFBO1FBRXBCLE9BQU07SUFDUixDQUFDO0lBRUQsSUFBSSxPQUFPLEtBQUssS0FBSyxRQUFRO1FBQUUsTUFBTSxJQUFJLEtBQUssQ0FBQyw4QkFBOEIsR0FBRyxvQkFBb0IsQ0FBQyxDQUFBO0lBRXJHLE1BQU0sUUFBUSxHQUFHLE1BQU0sQ0FBQyxLQUFLLENBQUMsQ0FBQTtJQUU5QixPQUFPLENBQUMsR0FBRyxDQUFDLEdBQUcsS0FBSyxDQUFDLE1BQU0sR0FBRyxDQUFDLElBQUksTUFBTSxDQUFDLFFBQVEsQ0FBQyxRQUFRLENBQUMsQ0FBQyxDQUFDLENBQUMsUUFBUSxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUE7QUFDakYsQ0FBQztBQUVELE1BQU0sQ0FBQyxPQUFPLE9BQU8sdUJBQXdCLFNBQVEsV0FBVztJQUM5RDs7O09BR0c7SUFDSCxLQUFLLENBQUMsT0FBTztRQUNYLHlFQUF5RTtRQUN6RSxPQUFPLENBQUMsS0FBSyxHQUFHLGVBQWUsQ0FBQTtRQUUvQixNQUFNLGFBQWEsR0FBRyxJQUFJLENBQUMsZ0JBQWdCLEVBQUUsQ0FBQTtRQUM3QyxNQUFNLGNBQWMsR0FBRyxzQkFBc0IsQ0FBQyxFQUFDLFdBQVcsRUFBRSxJQUFJLENBQUMsV0FBVyxFQUFDLENBQUMsQ0FBQTtRQUM5RSxNQUFNLFdBQVcsR0FBRyxJQUFJLFdBQVcsQ0FBQyxFQUFDLGFBQWEsRUFBRSxJQUFJLEVBQUUsS0FBSyxFQUFDLENBQUMsQ0FBQTtRQUVqRSxNQUFNLFdBQVcsQ0FBQyxVQUFVLEVBQUUsQ0FBQTtRQUU5QixNQUFNLE1BQU0sR0FBRyxtQkFBbUIsQ0FBQyxFQUFDLGFBQWEsRUFBRSxjQUFjLEVBQUMsQ0FBQyxDQUFBO1FBRW5FLE1BQU0sTUFBTSxDQUFDLElBQUksQ0FBQTtRQUNqQixNQUFNLFdBQVcsQ0FBQyxJQUFJLEVBQUUsQ0FBQTtJQUMxQixDQUFDO0NBQ0YiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuaW1wb3J0IEFwcGxpY2F0aW9uIGZyb20gXCIuLi8uLi8uLi8uLi9hcHBsaWNhdGlvbi5qc1wiXG5pbXBvcnQgQmFzZUNvbW1hbmQgZnJvbSBcIi4uLy4uLy4uLy4uL2NsaS9iYXNlLWNvbW1hbmQuanNcIlxuaW1wb3J0IHtzdGFydE1jcFN0ZGlvU2VydmVyfSBmcm9tIFwiLi4vLi4vLi4vLi4vbWNwL2pzb24tcnBjLXNlcnZlci5qc1wiXG5cbi8qKlxuICogUGFyc2VzIGAtLXJlcXVlc3QtY29udGV4dCBrZXk9dmFsdWVgIG9jY3VycmVuY2VzIGZyb20gcmF3IHByb2Nlc3MgYXJncyBhbmQgdGhlXG4gKiBgTUNQX1JFUVVFU1RfQ09OVEVYVGAgZW52aXJvbm1lbnQgdmFyaWFibGUgKEpTT04gb2JqZWN0KSBpbnRvIG9uZSBjb250ZXh0IGhhc2guXG4gKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEFyZ3VtZW50cy5cbiAqIEBwYXJhbSB7c3RyaW5nW119IFthcmdzLnByb2Nlc3NBcmdzXSAtIFJhdyBDTEkgcHJvY2VzcyBhcmdzLlxuICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIHN0cmluZyB8IG51bWJlciB8IGJvb2xlYW4+IHwgdW5kZWZpbmVkfSAtIFBhcnNlZCByZXF1ZXN0IGNvbnRleHQsIG9yIHVuZGVmaW5lZCB3aGVuIG5vbmUgY29uZmlndXJlZC5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHBhcnNlTWNwUmVxdWVzdENvbnRleHQoe3Byb2Nlc3NBcmdzID0gW119KSB7XG4gIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgc3RyaW5nIHwgbnVtYmVyIHwgYm9vbGVhbj59ICovXG4gIGNvbnN0IGNvbnRleHQgPSB7fVxuXG4gIGNvbnN0IGVudlZhbHVlID0gcHJvY2Vzcy5lbnYuTUNQX1JFUVVFU1RfQ09OVEVYVFxuXG4gIGlmIChlbnZWYWx1ZSkge1xuICAgIGNvbnN0IHBhcnNlZEVudiA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgdW5rbm93bj59ICovIChKU09OLnBhcnNlKGVudlZhbHVlKSlcblxuICAgIGZvciAoY29uc3QgW2tleSwgdmFsdWVdIG9mIE9iamVjdC5lbnRyaWVzKHBhcnNlZEVudikpIHtcbiAgICAgIGFzc2lnbkNvbnRleHRWYWx1ZShjb250ZXh0LCBrZXksIHZhbHVlKVxuICAgIH1cbiAgfVxuXG4gIGZvciAobGV0IGkgPSAwOyBpIDwgcHJvY2Vzc0FyZ3MubGVuZ3RoOyBpKyspIHtcbiAgICBpZiAocHJvY2Vzc0FyZ3NbaV0gIT09IFwiLS1yZXF1ZXN0LWNvbnRleHRcIikgY29udGludWVcblxuICAgIGNvbnN0IHBhaXIgPSBwcm9jZXNzQXJnc1tpICsgMV1cblxuICAgIGlmICh0eXBlb2YgcGFpciAhPT0gXCJzdHJpbmdcIikgdGhyb3cgbmV3IEVycm9yKFwiLS1yZXF1ZXN0LWNvbnRleHQgcmVxdWlyZXMgYSBrZXk9dmFsdWUgcGFpclwiKVxuXG4gICAgY29uc3Qgc2VwYXJhdG9ySW5kZXggPSBwYWlyLmluZGV4T2YoXCI9XCIpXG5cbiAgICBpZiAoc2VwYXJhdG9ySW5kZXggPCAxKSB0aHJvdyBuZXcgRXJyb3IoYC0tcmVxdWVzdC1jb250ZXh0IHBhaXIgJyR7cGFpcn0nIG11c3QgYmUga2V5PXZhbHVlYClcblxuICAgIGFzc2lnbkNvbnRleHRWYWx1ZShjb250ZXh0LCBwYWlyLnNsaWNlKDAsIHNlcGFyYXRvckluZGV4KSwgcGFpci5zbGljZShzZXBhcmF0b3JJbmRleCArIDEpKVxuICAgIGkrK1xuICB9XG5cbiAgcmV0dXJuIE9iamVjdC5rZXlzKGNvbnRleHQpLmxlbmd0aCA+IDAgPyBjb250ZXh0IDogdW5kZWZpbmVkXG59XG5cbi8qKlxuICogQXNzaWducyBvbmUgc2NhbGFyIGNvbnRleHQgdmFsdWUsIGNvbnZlcnRpbmcgbnVtZXJpYyBzdHJpbmdzIHRvIG51bWJlcnMuXG4gKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIHN0cmluZyB8IG51bWJlciB8IGJvb2xlYW4+fSBjb250ZXh0IC0gVGFyZ2V0IGNvbnRleHQgaGFzaC5cbiAqIEBwYXJhbSB7c3RyaW5nfSBrZXkgLSBDb250ZXh0IGtleS5cbiAqIEBwYXJhbSB7dW5rbm93bn0gdmFsdWUgLSBSYXcgdmFsdWUuXG4gKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gKi9cbmZ1bmN0aW9uIGFzc2lnbkNvbnRleHRWYWx1ZShjb250ZXh0LCBrZXksIHZhbHVlKSB7XG4gIGlmICh0eXBlb2YgdmFsdWUgPT09IFwibnVtYmVyXCIgfHwgdHlwZW9mIHZhbHVlID09PSBcImJvb2xlYW5cIikge1xuICAgIGNvbnRleHRba2V5XSA9IHZhbHVlXG5cbiAgICByZXR1cm5cbiAgfVxuXG4gIGlmICh0eXBlb2YgdmFsdWUgIT09IFwic3RyaW5nXCIpIHRocm93IG5ldyBFcnJvcihgUmVxdWVzdCBjb250ZXh0IHZhbHVlIGZvciAnJHtrZXl9JyBtdXN0IGJlIGEgc2NhbGFyYClcblxuICBjb25zdCBhc051bWJlciA9IE51bWJlcih2YWx1ZSlcblxuICBjb250ZXh0W2tleV0gPSB2YWx1ZS5sZW5ndGggPiAwICYmIE51bWJlci5pc0Zpbml0ZShhc051bWJlcikgPyBhc051bWJlciA6IHZhbHVlXG59XG5cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIFZlbG9jaW91c0NsaUNvbW1hbmRzTWNwIGV4dGVuZHMgQmFzZUNvbW1hbmR7XG4gIC8qKlxuICAgKiBSdW5zIGV4ZWN1dGUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFN0YXJ0cyB0aGUgTUNQIHN0ZGlvIHNlcnZlciBhbmQgd2FpdHMgdW50aWwgc3RkaW4gY2xvc2VzLlxuICAgKi9cbiAgYXN5bmMgZXhlY3V0ZSgpIHtcbiAgICAvLyBJZGVudGlmeSB0aGlzIHByb2Nlc3MgaW4gYHBzYC9gdG9wYCBpbnN0ZWFkIG9mIGEgZ2VuZXJpYyBcIm5vZGVcIiBlbnRyeS5cbiAgICBwcm9jZXNzLnRpdGxlID0gXCJ2ZWxvY2lvdXMgbWNwXCJcblxuICAgIGNvbnN0IGNvbmZpZ3VyYXRpb24gPSB0aGlzLmdldENvbmZpZ3VyYXRpb24oKVxuICAgIGNvbnN0IHJlcXVlc3RDb250ZXh0ID0gcGFyc2VNY3BSZXF1ZXN0Q29udGV4dCh7cHJvY2Vzc0FyZ3M6IHRoaXMucHJvY2Vzc0FyZ3N9KVxuICAgIGNvbnN0IGFwcGxpY2F0aW9uID0gbmV3IEFwcGxpY2F0aW9uKHtjb25maWd1cmF0aW9uLCB0eXBlOiBcIm1jcFwifSlcblxuICAgIGF3YWl0IGFwcGxpY2F0aW9uLmluaXRpYWxpemUoKVxuXG4gICAgY29uc3Qgc2VydmVyID0gc3RhcnRNY3BTdGRpb1NlcnZlcih7Y29uZmlndXJhdGlvbiwgcmVxdWVzdENvbnRleHR9KVxuXG4gICAgYXdhaXQgc2VydmVyLmRvbmVcbiAgICBhd2FpdCBhcHBsaWNhdGlvbi5zdG9wKClcbiAgfVxufVxuIl19