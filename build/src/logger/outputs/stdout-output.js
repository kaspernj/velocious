// @ts-check
import useEnvSense from "env-sense/build/use-env-sense.js";
/**
 * LoggingOutputPayload type.
 * @typedef {import("../../configuration-types.js").LoggingOutputPayload} LoggingOutputPayload */
const { isBrowser } = useEnvSense();
const isNodeRuntime = typeof process !== "undefined" && Boolean(process.versions?.node);
/**
 * Runs write to stream.
 * @param {import("node:stream").Writable | undefined} stream - Stream to write to.
 * @param {string} message - Message to write.
 * @returns {Promise<void>} - Resolves when complete.
 */
function writeToStream(stream, message) {
    return new Promise((resolve) => {
        if (!stream || typeof stream.write !== "function") {
            resolve();
            return;
        }
        stream.write(`${message}\n`, "utf8", () => resolve());
    });
}
/** Logger stdout/stderr output. */
export default class LoggerStdoutOutput {
    /**
     * Runs write.
     * @param {LoggingOutputPayload} payload - Log payload.
     */
    async write({ level, message }) {
        if (!isBrowser && isNodeRuntime) {
            if (level === "warn" || level === "error") {
                await writeToStream(process.stderr, message);
            }
            else {
                await writeToStream(process.stdout, message);
            }
            return;
        }
        if (level === "error") {
            console.error(message);
            return;
        }
        if (level === "warn") {
            console.warn(message);
            return;
        }
        if (level === "debug" || level === "debug-low-level") {
            const debugLogger = typeof console.debug === "function" ? console.debug : console.log;
            debugLogger(message);
            return;
        }
        console.log(message);
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic3Rkb3V0LW91dHB1dC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy9sb2dnZXIvb3V0cHV0cy9zdGRvdXQtb3V0cHV0LmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLFdBQVcsTUFBTSxrQ0FBa0MsQ0FBQTtBQUUxRDs7aUdBRWlHO0FBRWpHLE1BQU0sRUFBQyxTQUFTLEVBQUMsR0FBRyxXQUFXLEVBQUUsQ0FBQTtBQUNqQyxNQUFNLGFBQWEsR0FBRyxPQUFPLE9BQU8sS0FBSyxXQUFXLElBQUksT0FBTyxDQUFDLE9BQU8sQ0FBQyxRQUFRLEVBQUUsSUFBSSxDQUFDLENBQUE7QUFFdkY7Ozs7O0dBS0c7QUFDSCxTQUFTLGFBQWEsQ0FBQyxNQUFNLEVBQUUsT0FBTztJQUNwQyxPQUFPLElBQUksT0FBTyxDQUFDLENBQUMsT0FBTyxFQUFFLEVBQUU7UUFDN0IsSUFBSSxDQUFDLE1BQU0sSUFBSSxPQUFPLE1BQU0sQ0FBQyxLQUFLLEtBQUssVUFBVSxFQUFFLENBQUM7WUFDbEQsT0FBTyxFQUFFLENBQUE7WUFDVCxPQUFNO1FBQ1IsQ0FBQztRQUVELE1BQU0sQ0FBQyxLQUFLLENBQUMsR0FBRyxPQUFPLElBQUksRUFBRSxNQUFNLEVBQUUsR0FBRyxFQUFFLENBQUMsT0FBTyxFQUFFLENBQUMsQ0FBQTtJQUN2RCxDQUFDLENBQUMsQ0FBQTtBQUNKLENBQUM7QUFFRCxtQ0FBbUM7QUFDbkMsTUFBTSxDQUFDLE9BQU8sT0FBTyxrQkFBa0I7SUFDckM7OztPQUdHO0lBQ0gsS0FBSyxDQUFDLEtBQUssQ0FBQyxFQUFDLEtBQUssRUFBRSxPQUFPLEVBQUM7UUFDMUIsSUFBSSxDQUFDLFNBQVMsSUFBSSxhQUFhLEVBQUUsQ0FBQztZQUNoQyxJQUFJLEtBQUssS0FBSyxNQUFNLElBQUksS0FBSyxLQUFLLE9BQU8sRUFBRSxDQUFDO2dCQUMxQyxNQUFNLGFBQWEsQ0FBQyxPQUFPLENBQUMsTUFBTSxFQUFFLE9BQU8sQ0FBQyxDQUFBO1lBQzlDLENBQUM7aUJBQU0sQ0FBQztnQkFDTixNQUFNLGFBQWEsQ0FBQyxPQUFPLENBQUMsTUFBTSxFQUFFLE9BQU8sQ0FBQyxDQUFBO1lBQzlDLENBQUM7WUFFRCxPQUFNO1FBQ1IsQ0FBQztRQUVELElBQUksS0FBSyxLQUFLLE9BQU8sRUFBRSxDQUFDO1lBQ3RCLE9BQU8sQ0FBQyxLQUFLLENBQUMsT0FBTyxDQUFDLENBQUE7WUFDdEIsT0FBTTtRQUNSLENBQUM7UUFFRCxJQUFJLEtBQUssS0FBSyxNQUFNLEVBQUUsQ0FBQztZQUNyQixPQUFPLENBQUMsSUFBSSxDQUFDLE9BQU8sQ0FBQyxDQUFBO1lBQ3JCLE9BQU07UUFDUixDQUFDO1FBRUQsSUFBSSxLQUFLLEtBQUssT0FBTyxJQUFJLEtBQUssS0FBSyxpQkFBaUIsRUFBRSxDQUFDO1lBQ3JELE1BQU0sV0FBVyxHQUFHLE9BQU8sT0FBTyxDQUFDLEtBQUssS0FBSyxVQUFVLENBQUMsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxHQUFHLENBQUE7WUFDckYsV0FBVyxDQUFDLE9BQU8sQ0FBQyxDQUFBO1lBQ3BCLE9BQU07UUFDUixDQUFDO1FBRUQsT0FBTyxDQUFDLEdBQUcsQ0FBQyxPQUFPLENBQUMsQ0FBQTtJQUN0QixDQUFDO0NBQ0YiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuaW1wb3J0IHVzZUVudlNlbnNlIGZyb20gXCJlbnYtc2Vuc2UvYnVpbGQvdXNlLWVudi1zZW5zZS5qc1wiXG5cbi8qKlxuICogTG9nZ2luZ091dHB1dFBheWxvYWQgdHlwZS5cbiAqIEB0eXBlZGVmIHtpbXBvcnQoXCIuLi8uLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkxvZ2dpbmdPdXRwdXRQYXlsb2FkfSBMb2dnaW5nT3V0cHV0UGF5bG9hZCAqL1xuXG5jb25zdCB7aXNCcm93c2VyfSA9IHVzZUVudlNlbnNlKClcbmNvbnN0IGlzTm9kZVJ1bnRpbWUgPSB0eXBlb2YgcHJvY2VzcyAhPT0gXCJ1bmRlZmluZWRcIiAmJiBCb29sZWFuKHByb2Nlc3MudmVyc2lvbnM/Lm5vZGUpXG5cbi8qKlxuICogUnVucyB3cml0ZSB0byBzdHJlYW0uXG4gKiBAcGFyYW0ge2ltcG9ydChcIm5vZGU6c3RyZWFtXCIpLldyaXRhYmxlIHwgdW5kZWZpbmVkfSBzdHJlYW0gLSBTdHJlYW0gdG8gd3JpdGUgdG8uXG4gKiBAcGFyYW0ge3N0cmluZ30gbWVzc2FnZSAtIE1lc3NhZ2UgdG8gd3JpdGUuXG4gKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICovXG5mdW5jdGlvbiB3cml0ZVRvU3RyZWFtKHN0cmVhbSwgbWVzc2FnZSkge1xuICByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUpID0+IHtcbiAgICBpZiAoIXN0cmVhbSB8fCB0eXBlb2Ygc3RyZWFtLndyaXRlICE9PSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgIHJlc29sdmUoKVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgc3RyZWFtLndyaXRlKGAke21lc3NhZ2V9XFxuYCwgXCJ1dGY4XCIsICgpID0+IHJlc29sdmUoKSlcbiAgfSlcbn1cblxuLyoqIExvZ2dlciBzdGRvdXQvc3RkZXJyIG91dHB1dC4gKi9cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIExvZ2dlclN0ZG91dE91dHB1dCB7XG4gIC8qKlxuICAgKiBSdW5zIHdyaXRlLlxuICAgKiBAcGFyYW0ge0xvZ2dpbmdPdXRwdXRQYXlsb2FkfSBwYXlsb2FkIC0gTG9nIHBheWxvYWQuXG4gICAqL1xuICBhc3luYyB3cml0ZSh7bGV2ZWwsIG1lc3NhZ2V9KSB7XG4gICAgaWYgKCFpc0Jyb3dzZXIgJiYgaXNOb2RlUnVudGltZSkge1xuICAgICAgaWYgKGxldmVsID09PSBcIndhcm5cIiB8fCBsZXZlbCA9PT0gXCJlcnJvclwiKSB7XG4gICAgICAgIGF3YWl0IHdyaXRlVG9TdHJlYW0ocHJvY2Vzcy5zdGRlcnIsIG1lc3NhZ2UpXG4gICAgICB9IGVsc2Uge1xuICAgICAgICBhd2FpdCB3cml0ZVRvU3RyZWFtKHByb2Nlc3Muc3Rkb3V0LCBtZXNzYWdlKVxuICAgICAgfVxuXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBpZiAobGV2ZWwgPT09IFwiZXJyb3JcIikge1xuICAgICAgY29uc29sZS5lcnJvcihtZXNzYWdlKVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgaWYgKGxldmVsID09PSBcIndhcm5cIikge1xuICAgICAgY29uc29sZS53YXJuKG1lc3NhZ2UpXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBpZiAobGV2ZWwgPT09IFwiZGVidWdcIiB8fCBsZXZlbCA9PT0gXCJkZWJ1Zy1sb3ctbGV2ZWxcIikge1xuICAgICAgY29uc3QgZGVidWdMb2dnZXIgPSB0eXBlb2YgY29uc29sZS5kZWJ1ZyA9PT0gXCJmdW5jdGlvblwiID8gY29uc29sZS5kZWJ1ZyA6IGNvbnNvbGUubG9nXG4gICAgICBkZWJ1Z0xvZ2dlcihtZXNzYWdlKVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgY29uc29sZS5sb2cobWVzc2FnZSlcbiAgfVxufVxuIl19