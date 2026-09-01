// @ts-check
import LoggerConsoleOutput from "./logger/outputs/console-output.js";
import LoggerFileOutput from "./logger/outputs/file-output.js";
import { currentConfiguration } from "./current-configuration.js";
import { formatValue } from "./utils/format-value.js";
import restArgsError from "./utils/rest-args-error.js";
/**
 * LogLevel type.
 * @typedef {"debug-low-level" | "debug" | "info" | "warn" | "error"} LogLevel */
const DEFAULT_LOGGING_CONFIGURATION = {
    console: true,
    file: false,
    /**
     * Types the following value.
     * @type {LogLevel[]} */
    levels: ["info", "warn", "error"]
};
/**
 * Level order.
 * @type {LogLevel[]} */
const LEVEL_ORDER = ["debug-low-level", "debug", "info", "warn", "error"];
/**
 * Runs function or messages.
 * @param {...ReturnType<typeof JSON.parse>|(() => Array<ReturnType<typeof JSON.parse>>)} messages - Messages.
 * @returns {Array<ReturnType<typeof JSON.parse>>} - Either the function result or the messages
 */
function functionOrMessages(...messages) {
    if (messages.length === 1 && typeof messages[0] == "function") {
        const result = messages[0]();
        messages = Array.isArray(result) ? result : [result];
    }
    return messages;
}
/**
 * Format a single value for inclusion in a log message.
 * @param {ReturnType<typeof JSON.parse>} value - Value to format.
 * @returns {string} - String representation.
 */
function formatPart(value) {
    if (value instanceof Error) {
        return `${value.message}\n${value.stack}`;
    }
    if (typeof value === "object") {
        return formatValue(value);
    }
    return String(value);
}
/**
 * Formats the user-supplied messages into a single string.
 *
 * If the first message is a string containing printf-style format
 * specifiers (`%s`, `%d`, `%j`, `%o`, `%O`, or `%%`), the remaining
 * messages are interpolated into it in order (like `console.log` /
 * `util.format`). Any leftover messages are appended with a space
 * separator. Otherwise, all parts are joined with spaces.
 * @param {Array<ReturnType<typeof JSON.parse>>} messages - User-supplied message parts.
 * @returns {string} - The formatted user message.
 */
function formatUserMessages(messages) {
    if (messages.length === 0)
        return "";
    const first = messages[0];
    if (typeof first === "string" && /%[sdjoO%]/.test(first)) {
        let argIndex = 1;
        const formatted = first.replace(/%[sdjoO%]/g, (match) => {
            if (match === "%%")
                return "%";
            if (argIndex >= messages.length)
                return match;
            const value = messages[argIndex];
            argIndex += 1;
            if (match === "%d") {
                // Match util.format: never throw for non-coercible values — yield "NaN" instead.
                // Number(Symbol()) throws, so catch and fall back.
                try {
                    return String(Number(value));
                }
                catch {
                    return "NaN";
                }
            }
            if (match === "%j" || match === "%o" || match === "%O")
                return formatValue(value);
            return formatPart(value);
        });
        let message = formatted;
        for (let index = argIndex; index < messages.length; index += 1) {
            message += ` ${formatPart(messages[index])}`;
        }
        return message;
    }
    let message = "";
    for (let index = 0; index < messages.length; index += 1) {
        if (index > 0)
            message += " ";
        message += formatPart(messages[index]);
    }
    return message;
}
/**
 * Converts a logger subject and message parts into a single log line.
 * @param {string} subject - Logger subject / category prefix.
 * @param {...ReturnType<typeof JSON.parse>} messages - User-supplied message parts (supports printf-style format specifiers on the first part).
 * @returns {string} - The formatted log line.
 */
function messagesToMessage(subject, ...messages) {
    const userMessage = formatUserMessages(messages);
    if (!subject)
        return userMessage;
    if (!userMessage)
        return String(subject);
    return `${subject} ${userMessage}`;
}
/**
 * Runs resolve logging configuration.
 * @param {import("./configuration.js").default | undefined} configuration - Configuration instance.
 * @returns {Required<Pick<import("./configuration-types.js").LoggingConfiguration, "console" | "file" | "levels">> & Partial<Pick<import("./configuration-types.js").LoggingConfiguration, "filePath" | "outputs">>} - The logging configuration.
 */
function resolveLoggingConfiguration(configuration) {
    const debugEnabled = configuration?.debug === true;
    if (configuration && typeof configuration.getLoggingConfiguration === "function") {
        const resolved = configuration.getLoggingConfiguration();
        if (debugEnabled) {
            return {
                ...resolved,
                console: true,
                levels: LEVEL_ORDER
            };
        }
        return resolved;
    }
    if (debugEnabled) {
        return {
            ...DEFAULT_LOGGING_CONFIGURATION,
            console: true,
            levels: LEVEL_ORDER
        };
    }
    return DEFAULT_LOGGING_CONFIGURATION;
}
/**
 * Runs is level allowed.
 * @param {object} args - Options object.
 * @param {LogLevel} args.level - Level.
 * @param {LogLevel[]} args.allowedLevels - Allowed levels.
 * @param {boolean} [args.debugFlag] - Whether debug flag.
 * @returns {boolean} - Whether level allowed.
 */
function isLevelAllowed({ level, allowedLevels, debugFlag }) {
    if (allowedLevels.includes(level))
        return true;
    if (debugFlag && LEVEL_ORDER.indexOf(level) >= LEVEL_ORDER.indexOf("debug"))
        return true;
    return false;
}
/**
 * Runs resolve logging outputs.
 * @param {object} args - Options object.
 * @param {import("./configuration-types.js").LoggingConfiguration} args.loggingConfiguration - Logging configuration.
 * @param {import("./configuration.js").default | undefined} args.configuration - Configuration instance.
 * @returns {import("./configuration-types.js").LoggingOutputConfig[]} - Logging outputs.
 */
function resolveLoggingOutputs({ loggingConfiguration, configuration }) {
    if (Array.isArray(loggingConfiguration.outputs))
        return loggingConfiguration.outputs;
    if (Array.isArray(loggingConfiguration.loggers)) {
        /**
         * Logger outputs.
         * @type {import("./configuration-types.js").LoggingOutputConfig[]} */
        const loggerOutputs = [];
        for (const logger of loggingConfiguration.loggers) {
            if (!logger)
                continue;
            const loggerConfig = /** @type {ReturnType<typeof JSON.parse>} */ (logger);
            if (typeof loggerConfig.toOutputConfig === "function") {
                loggerOutputs.push(loggerConfig.toOutputConfig({ configuration }));
                continue;
            }
            if (loggerConfig.output && typeof loggerConfig.output.write === "function") {
                loggerOutputs.push({
                    output: loggerConfig.output,
                    levels: loggerConfig.levels
                });
                continue;
            }
            if (typeof loggerConfig.write === "function") {
                loggerOutputs.push({
                    output: loggerConfig,
                    levels: loggerConfig.levels
                });
                continue;
            }
            const loggerName = loggerConfig?.constructor?.name || "UnknownLogger";
            throw new Error(`Logger must implement toOutputConfig or write: ${loggerName}`);
        }
        return loggerOutputs;
    }
    /**
     * Outputs.
     * @type {import("./configuration-types.js").LoggingOutputConfig[]} */
    const outputs = [];
    if (loggingConfiguration.console !== false) {
        outputs.push({
            output: new LoggerConsoleOutput(),
            levels: loggingConfiguration.levels
        });
    }
    if (loggingConfiguration.file !== false && loggingConfiguration.filePath) {
        outputs.push({
            output: new LoggerFileOutput({
                configuration,
                getConfiguration: () => configuration,
                filePath: loggingConfiguration.filePath
            }),
            levels: loggingConfiguration.levels
        });
    }
    return outputs;
}
/**
 * Runs is output level allowed.
 * @param {object} args - Options object.
 * @param {LogLevel} args.level - Level.
 * @param {import("./configuration-types.js").LoggingOutputConfig} args.outputConfig - Output configuration.
 * @param {import("./configuration-types.js").LoggingConfiguration} args.loggingConfiguration - Logging configuration.
 * @param {boolean} [args.debugFlag] - Whether debug flag.
 * @returns {boolean} - Whether output should log.
 */
function isOutputLevelAllowed({ level, outputConfig, loggingConfiguration, debugFlag }) {
    if (Array.isArray(outputConfig.levels)) {
        return isLevelAllowed({ level, allowedLevels: outputConfig.levels, debugFlag: false });
    }
    if (Array.isArray(outputConfig.output?.levels)) {
        return isLevelAllowed({ level, allowedLevels: outputConfig.output.levels, debugFlag: false });
    }
    const allowedLevels = loggingConfiguration.levels || DEFAULT_LOGGING_CONFIGURATION.levels;
    return isLevelAllowed({ level, allowedLevels, debugFlag });
}
/**
 * Runs enabled output configs.
 * @param {object} args - Options object.
 * @param {LogLevel} args.level - Level.
 * @param {import("./configuration-types.js").LoggingOutputConfig[]} args.outputs - Output configurations.
 * @param {import("./configuration-types.js").LoggingConfiguration} args.loggingConfiguration - Logging configuration.
 * @param {boolean} [args.debugFlag] - Whether debug flag.
 * @returns {import("./configuration-types.js").LoggingOutputConfig[]} - Outputs enabled for the level.
 */
function enabledOutputConfigs({ level, outputs, loggingConfiguration, debugFlag }) {
    return outputs.filter((outputConfig) => {
        if (!outputConfig || !outputConfig.output || typeof outputConfig.output.write !== "function")
            return false;
        return isOutputLevelAllowed({ level, outputConfig, loggingConfiguration, debugFlag });
    });
}
/**
 * Runs write log.
 * @param {object} args - Options object.
 * @param {string} args.subject - Log subject.
 * @param {LogLevel} args.level - Level.
 * @param {Parameters<typeof functionOrMessages>} args.messages - Messages.
 * @param {import("./configuration.js").default | undefined} args.configuration - Configuration instance.
 * @param {import("./configuration-types.js").LoggingConfiguration | undefined} args.loggingConfiguration - Logging configuration.
 * @param {boolean} [args.debugFlag] - Whether debug flag.
 * @returns {Promise<void>} - Resolves when complete.
 */
async function writeLog({ subject, level, messages, configuration, loggingConfiguration, debugFlag }) {
    const resolvedLoggingConfiguration = loggingConfiguration || resolveLoggingConfiguration(configuration);
    const outputs = resolveLoggingOutputs({ loggingConfiguration: resolvedLoggingConfiguration, configuration });
    const enabledOutputs = enabledOutputConfigs({
        level,
        outputs,
        loggingConfiguration: resolvedLoggingConfiguration,
        debugFlag
    });
    if (enabledOutputs.length === 0)
        return;
    const writes = [];
    /**
     * Types the following value.
     * @type {Array<ReturnType<typeof JSON.parse>> | undefined} */
    let resolvedMessages;
    /**
     * Types the following value.
     * @type {string | undefined} */
    let message;
    /**
     * Payload.
     * @type {import("./configuration-types.js").LoggingOutputPayload | null} */
    let payload = null;
    for (const outputConfig of enabledOutputs) {
        if (!payload) {
            resolvedMessages = functionOrMessages(...messages);
            message = messagesToMessage(subject, ...resolvedMessages);
            // subject is the first positional arg, then the user messages
            payload = {
                level,
                message,
                subject,
                timestamp: new Date()
            };
        }
        writes.push(outputConfig.output.write(payload));
    }
    if (writes.length === 1) {
        await writes[0];
    }
    else if (writes.length > 1) {
        await Promise.all(writes);
    }
}
export default class Logger {
    /**
     * Runs constructor.
     * @param {string | object} object - Object.
     * @param {object} args - Options object.
     * @param {import("./configuration.js").default} [args.configuration] - Configuration instance.
     * @param {boolean} [args.debug] - Whether debug.
     * @param {import("./configuration-types.js").LoggingConfiguration} [args.loggingConfiguration] - Logging configuration.
     */
    constructor(object, { configuration, debug = false, loggingConfiguration, ...restArgs } = {}) {
        restArgsError(restArgs);
        this._debug = debug;
        this._configuration = configuration;
        this._loggingConfiguration = loggingConfiguration;
        if (typeof object == "string") {
            this._subject = object || "EmptyString";
        }
        else {
            this._object = object;
            this._subject = object.constructor.name || "UnknownClass";
        }
    }
    /**
     * Runs get configuration.
     * @returns {import("./configuration.js").default} - The configuration.
     */
    getConfiguration() {
        if (!this._configuration) {
            const objectWithConfig = /** @type {{configuration?: import("./configuration.js").default}} */ (this._object);
            this._configuration = objectWithConfig?.configuration || currentConfiguration();
        }
        return this._configuration;
    }
    /**
     * Runs safe configuration.
     * @returns {import("./configuration.js").default | undefined} - The safe configuration.
     */
    _safeConfiguration() {
        try {
            return this.getConfiguration();
        }
        catch {
            return undefined;
        }
    }
    /**
     * Runs is level enabled.
     * @param {LogLevel} level - Level.
     * @returns {boolean} - Whether any configured output emits this level.
     */
    isLevelEnabled(level) {
        const configuration = this._safeConfiguration();
        const loggingConfiguration = this._loggingConfiguration || resolveLoggingConfiguration(configuration);
        const outputs = resolveLoggingOutputs({ loggingConfiguration, configuration });
        return enabledOutputConfigs({
            level,
            outputs,
            loggingConfiguration,
            debugFlag: this._debug
        }).length > 0;
    }
    /**
     * Runs debug.
     * @param {Array<ReturnType<typeof JSON.parse>>} messages - Messages.
     * @returns {Promise<void>} - Resolves when complete.
     */
    async debug(...messages) {
        await this._write({ level: "debug", messages });
    }
    /**
     * Runs info.
     * @param {Array<ReturnType<typeof JSON.parse>>} messages - Messages.
     * @returns {Promise<void>} - Resolves when complete.
     */
    async info(...messages) {
        await this._write({ level: "info", messages });
    }
    /**
     * Runs debug low level.
     * @param {Array<ReturnType<typeof JSON.parse>>} messages - Messages.
     * @returns {Promise<void>} - Resolves when complete.
     */
    async debugLowLevel(...messages) {
        await this._write({ level: "debug-low-level", messages });
    }
    /**
     * Runs log.
     * @param {Array<ReturnType<typeof JSON.parse>>} messages - Messages.
     * @returns {Promise<void>} - Resolves when complete.
     */
    async log(...messages) {
        await this._write({ level: "info", messages });
    }
    /**
     * Runs error.
     * @param {Array<ReturnType<typeof JSON.parse>>} messages - Messages.
     * @returns {Promise<void>} - Resolves when complete.
     */
    async error(...messages) {
        await this._write({ level: "error", messages });
    }
    /**
     * Runs set debug.
     * @param {boolean} newValue - New value.
     * @returns {void} - No return value.
     */
    setDebug(newValue) {
        this._debug = newValue;
    }
    /**
     * Runs warn.
     * @type {(...args: Parameters<typeof functionOrMessages>) => Promise<void>}
     */
    async warn(...messages) {
        await this._write({ level: "warn", messages });
    }
    /**
     * Runs write.
     * @param {object} args - Options object.
     * @param {LogLevel} args.level - Level.
     * @param {Parameters<typeof functionOrMessages>} args.messages - Messages.
     * @returns {Promise<void>} - Resolves when complete.
     */
    async _write({ level, messages }) {
        const configuration = this._safeConfiguration();
        const loggingConfiguration = this._loggingConfiguration || resolveLoggingConfiguration(configuration);
        await writeLog({
            subject: this._subject,
            level,
            messages,
            configuration,
            loggingConfiguration,
            debugFlag: this._debug
        });
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibG9nZ2VyLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vc3JjL2xvZ2dlci5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxZQUFZO0FBRVosT0FBTyxtQkFBbUIsTUFBTSxvQ0FBb0MsQ0FBQTtBQUNwRSxPQUFPLGdCQUFnQixNQUFNLGlDQUFpQyxDQUFBO0FBQzlELE9BQU8sRUFBQyxvQkFBb0IsRUFBQyxNQUFNLDRCQUE0QixDQUFBO0FBQy9ELE9BQU8sRUFBQyxXQUFXLEVBQUMsTUFBTSx5QkFBeUIsQ0FBQTtBQUNuRCxPQUFPLGFBQWEsTUFBTSw0QkFBNEIsQ0FBQTtBQUV0RDs7aUZBRWlGO0FBRWpGLE1BQU0sNkJBQTZCLEdBQUc7SUFDcEMsT0FBTyxFQUFFLElBQUk7SUFDYixJQUFJLEVBQUUsS0FBSztJQUNYOzs0QkFFd0I7SUFDeEIsTUFBTSxFQUFFLENBQUMsTUFBTSxFQUFFLE1BQU0sRUFBRSxPQUFPLENBQUM7Q0FDbEMsQ0FBQTtBQUVEOzt3QkFFd0I7QUFDeEIsTUFBTSxXQUFXLEdBQUcsQ0FBQyxpQkFBaUIsRUFBRSxPQUFPLEVBQUUsTUFBTSxFQUFFLE1BQU0sRUFBRSxPQUFPLENBQUMsQ0FBQTtBQUV6RTs7OztHQUlHO0FBQ0gsU0FBUyxrQkFBa0IsQ0FBQyxHQUFHLFFBQVE7SUFDckMsSUFBSSxRQUFRLENBQUMsTUFBTSxLQUFLLENBQUMsSUFBSSxPQUFPLFFBQVEsQ0FBQyxDQUFDLENBQUMsSUFBSSxVQUFVLEVBQUUsQ0FBQztRQUM5RCxNQUFNLE1BQU0sR0FBRyxRQUFRLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQTtRQUM1QixRQUFRLEdBQUcsS0FBSyxDQUFDLE9BQU8sQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxDQUFBO0lBQ3RELENBQUM7SUFFRCxPQUFPLFFBQVEsQ0FBQTtBQUNqQixDQUFDO0FBRUQ7Ozs7R0FJRztBQUNILFNB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QTtJQUM5QyxDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILEtBQUssQ0FBQyxLQUFLLENBQUMsR0FBRyxRQUFRO1FBQ3JCLE1BQU0sSUFBSSxDQUFDLE1BQU0sQ0FBQyxFQUFDLEtBQUssRUFBRSxPQUFPLEVBQUUsUUFBUSxFQUFDLENBQUMsQ0FBQTtJQUMvQyxDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILFFBQVEsQ0FBQyxRQUFRO1FBQ2YsSUFBSSxDQUFDLE1BQU0sR0FBRyxRQUFRLENBQUE7SUFDeEIsQ0FBQztJQUVEOzs7T0FHRztJQUNILEtBQUssQ0FBQyxJQUFJLENBQUMsR0FBRyxRQUFRO1FBQ3BCLE1BQU0sSUFBSSxDQUFDLE1BQU0sQ0FBQyxFQUFDLEtBQUssRUFBRSxNQUFNLEVBQUUsUUFBUSxFQUFDLENBQUMsQ0FBQTtJQUM5QyxDQUFDO0lBRUQ7Ozs7OztPQU1HO0lBQ0gsS0FBSyxDQUFDLE1BQU0sQ0FBQyxFQUFDLEtBQUssRUFBRSxRQUFRLEVBQUM7UUFDNUIsTUFBTSxhQUFhLEdBQUcsSUFBSSxDQUFDLGtCQUFrQixFQUFFLENBQUE7UUFDL0MsTUFBTSxvQkFBb0IsR0FBRyxJQUFJLENBQUMscUJBQXFCLElBQUksMkJBQTJCLENBQUMsYUFBYSxDQUFDLENBQUE7UUFFckcsTUFBTSxRQUFRLENBQUM7WUFDYixPQUFPLEVBQUUsSUFBSSxDQUFDLFFBQVE7WUFDdEIsS0FBSztZQUNMLFFBQVE7WUFDUixhQUFhO1lBQ2Isb0JBQW9CO1lBQ3BCLFNBQVMsRUFBRSxJQUFJLENBQUMsTUFBTTtTQUN2QixDQUFDLENBQUE7SUFDSixDQUFDO0NBQ0YiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuaW1wb3J0IExvZ2dlckNvbnNvbGVPdXRwdXQgZnJvbSBcIi4vbG9nZ2VyL291dHB1dHMvY29uc29sZS1vdXRwdXQuanNcIlxuaW1wb3J0IExvZ2dlckZpbGVPdXRwdXQgZnJvbSBcIi4vbG9nZ2VyL291dHB1dHMvZmlsZS1vdXRwdXQuanNcIlxuaW1wb3J0IHtjdXJyZW50Q29uZmlndXJhdGlvbn0gZnJvbSBcIi4vY3VycmVudC1jb25maWd1cmF0aW9uLmpzXCJcbmltcG9ydCB7Zm9ybWF0VmFsdWV9IGZyb20gXCIuL3V0aWxzL2Zvcm1hdC12YWx1ZS5qc1wiXG5pbXBvcnQgcmVzdEFyZ3NFcnJvciBmcm9tIFwiLi91dGlscy9yZXN0LWFyZ3MtZXJyb3IuanNcIlxuXG4vKipcbiAqIExvZ0xldmVsIHR5cGUuXG4gKiBAdHlwZWRlZiB7XCJkZWJ1Zy1sb3ctbGV2ZWxcIiB8IFwiZGVidWdcIiB8IFwiaW5mb1wiIHwgXCJ3YXJuXCIgfCBcImVycm9yXCJ9IExvZ0xldmVsICovXG5cbmNvbnN0IERFRkFVTFRfTE9HR0lOR19DT05GSUdVUkFUSU9OID0ge1xuICBjb25zb2xlOiB0cnVlLFxuICBmaWxlOiBmYWxzZSxcbiAgLyoqXG4gICAqIFR5cGVzIHRoZSBmb2xsb3dpbmcgdmFsdWUuXG4gICAqIEB0eXBlIHtMb2dMZXZlbFtdfSAqL1xuICBsZXZlbHM6IFtcImluZm9cIiwgXCJ3YXJuXCIsIFwiZXJyb3JcIl1cbn1cblxuLyoqXG4gKiBMZXZlbCBvcmRlci5cbiAqIEB0eXBlIHtMb2dMZXZlbFtdfSAqL1xuY29uc3QgTEVWRUxfT1JERVIgPSBbXCJkZWJ1Zy1sb3ctbGV2ZWxcIiwgXCJkZWJ1Z1wiLCBcImluZm9cIiwgXCJ3YXJuXCIsIFwiZXJyb3JcIl1cblxuLyoqXG4gKiBSdW5zIGZ1bmN0aW9uIG9yIG1lc3NhZ2VzLlxuICogQHBhcmFtIHsuLi5SZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPnwoKCkgPT4gQXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+KX0gbWVzc2FnZXMgLSBNZXNzYWdlcy5cbiAqIEByZXR1cm5zIHtBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gRWl0aGVyIHRoZSBmdW5jdGlvbiByZXN1bHQgb3IgdGhlIG1lc3NhZ2VzXG4gKi9cbmZ1bmN0aW9uIGZ1bmN0aW9uT3JNZXNzYWdlcyguLi5tZXNzYWdlcykge1xuICBpZiAobWVzc2FnZXMubGVuZ3RoID09PSAxICYmIHR5cGVvZiBtZXNzYWdlc1swXSA9PSBcImZ1bmN0aW9uXCIpIHtcbiAgICBjb25zdCByZXN1bHQgPSBtZXNzYWdlc1swXSgpXG4gICAgbWVzc2FnZXMgPSBBcnJheS5pc0FycmF5KHJlc3VsdCkgPyByZXN1bHQgOiBbcmVzdWx0XVxuICB9XG5cbiAgcmV0dXJuIG1lc3NhZ2VzXG59XG5cbi8qKlxuICogRm9ybWF0IGEgc2luZ2xlIHZhbHVlIGZvciBpbmNsdXNpb24gaW4gYSBsb2cgbWVzc2FnZS5cbiAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHZhbHVlIC0gVmFsdWUgdG8gZm9ybWF0LlxuICogQHJldHVybnMge3N0cmluZ30gLSBTdHJpbmcgcmVwcmVzZW50YXRpb24uXG4gKi9cbmZ1bmN0aW9uIGZvcm1hdFBhcnQodmFsdWUpIHtcbiAgaWYgKHZhbHVlIGluc3RhbmNlb2YgRXJyb3IpIHtcbiAgICByZXR1cm4gYCR7dmFsdWUubWVzc2FnZX1cXG4ke3ZhbHVlLnN0YWNrfWBcbiAgfVxuXG4gIGlmICh0eXBlb2YgdmFsdWUgPT09IFwib2JqZWN0XCIpIHtcbiAgICByZXR1cm4gZm9ybWF0VmFsdWUodmFsdWUpXG4gIH1cblxuICByZXR1cm4gU3RyaW5nKHZhbHVlKVxufVxuXG4vKipcbiAqIEZvcm1hdHMgdGhlIHVzZXItc3VwcGxpZWQgbWVzc2FnZXMgaW50byBhIHNpbmdsZSBzdHJpbmcuXG4gKlxuICogSWYgdGhlIGZpcnN0IG1lc3NhZ2UgaXMgYSBzdHJpbmcgY29udGFpbmluZyBwcmludGYtc3R5bGUgZm9ybWF0XG4gKiBzcGVjaWZpZXJzIChgJXNgLCBgJWRgLCBgJWpgLCBgJW9gLCBgJU9gLCBvciBgJSVgKSwgdGhlIHJlbWFpbmluZ1xuICogbWVzc2FnZXMgYXJlIGludGVycG9sYXRlZCBpbnRvIGl0IGluIG9yZGVyIChsaWtlIGBjb25zb2xlLmxvZ2AgL1xuICogYHV0aWwuZm9ybWF0YCkuIEFueSBsZWZ0b3ZlciBtZXNzYWdlcyBhcmUgYXBwZW5kZWQgd2l0aCBhIHNwYWNlXG4gKiBzZXBhcmF0b3IuIE90aGVyd2lzZSwgYWxsIHBhcnRzIGFyZSBqb2luZWQgd2l0aCBzcGFjZXMuXG4gKiBAcGFyYW0ge0FycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gbWVzc2FnZXMgLSBVc2VyLXN1cHBsaWVkIG1lc3NhZ2UgcGFydHMuXG4gKiBAcmV0dXJucyB7c3RyaW5nfSAtIFRoZSBmb3JtYXR0ZWQgdXNlciBtZXNzYWdlLlxuICovXG5mdW5jdGlvbiBmb3JtYXRVc2VyTWVzc2FnZXMobWVzc2FnZXMpIHtcbiAgaWYgKG1lc3NhZ2VzLmxlbmd0aCA9PT0gMCkgcmV0dXJuIFwiXCJcblxuICBjb25zdCBmaXJzdCA9IG1lc3NhZ2VzWzBdXG5cbiAgaWYgKHR5cGVvZiBmaXJzdCA9PT0gXCJzdHJpbmdcIiAmJiAvJVtzZGpvTyVdLy50ZXN0KGZpcnN0KSkge1xuICAgIGxldCBhcmdJbmRleCA9IDFcbiAgICBjb25zdCBmb3JtYXR0ZWQgPSBmaXJzdC5yZXBsYWNlKC8lW3Nkam9PJV0vZywgKG1hdGNoKSA9PiB7XG4gICAgICBpZiAobWF0Y2ggPT09IFwiJSVcIikgcmV0dXJuIFwiJVwiXG4gICAgICBpZiAoYXJnSW5kZXggPj0gbWVzc2FnZXMubGVuZ3RoKSByZXR1cm4gbWF0Y2hcblxuICAgICAgY29uc3QgdmFsdWUgPSBtZXNzYWdlc1thcmdJbmRleF1cblxuICAgICAgYXJnSW5kZXggKz0gMVxuXG4gICAgICBpZiAobWF0Y2ggPT09IFwiJWRcIikge1xuICAgICAgICAvLyBNYXRjaCB1dGlsLmZvcm1hdDogbmV2ZXIgdGhyb3cgZm9yIG5vbi1jb2VyY2libGUgdmFsdWVzIOKAlCB5aWVsZCBcIk5hTlwiIGluc3RlYWQuXG4gICAgICAgIC8vIE51bWJlcihTeW1ib2woKSkgdGhyb3dzLCBzbyBjYXRjaCBhbmQgZmFsbCBiYWNrLlxuICAgICAgICB0cnkge1xuICAgICAgICAgIHJldHVybiBTdHJpbmcoTnVtYmVyKHZhbHVlKSlcbiAgICAgICAgfSBjYXRjaCB7XG4gICAgICAgICAgcmV0dXJuIFwiTmFOXCJcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgaWYgKG1hdGNoID09PSBcIiVqXCIgfHwgbWF0Y2ggPT09IFwiJW9cIiB8fCBtYXRjaCA9PT0gXCIlT1wiKSByZXR1cm4gZm9ybWF0VmFsdWUodmFsdWUpXG5cbiAgICAgIHJldHVybiBmb3JtYXRQYXJ0KHZhbHVlKVxuICAgIH0pXG5cbiAgICBsZXQgbWVzc2FnZSA9IGZvcm1hdHRlZFxuXG4gICAgZm9yIChsZXQgaW5kZXggPSBhcmdJbmRleDsgaW5kZXggPCBtZXNzYWdlcy5sZW5ndGg7IGluZGV4ICs9IDEpIHtcbiAgICAgIG1lc3NhZ2UgKz0gYCAke2Zvcm1hdFBhcnQobWVzc2FnZXNbaW5kZXhdKX1gXG4gICAgfVxuXG4gICAgcmV0dXJuIG1lc3NhZ2VcbiAgfVxuXG4gIGxldCBtZXNzYWdlID0gXCJcIlxuXG4gIGZvciAobGV0IGluZGV4ID0gMDsgaW5kZXggPCBtZXNzYWdlcy5sZW5ndGg7IGluZGV4ICs9IDEpIHtcbiAgICBpZiAoaW5kZXggPiAwKSBtZXNzYWdlICs9IFwiIFwiXG4gICAgbWVzc2FnZSArPSBmb3JtYXRQYXJ0KG1lc3NhZ2VzW2luZGV4XSlcbiAgfVxuXG4gIHJldHVybiBtZXNzYWdlXG59XG5cbi8qKlxuICogQ29udmVydHMgYSBsb2dnZXIgc3ViamVjdCBhbmQgbWVzc2FnZSBwYXJ0cyBpbnRvIGEgc2luZ2xlIGxvZyBsaW5lLlxuICogQHBhcmFtIHtzdHJpbmd9IHN1YmplY3QgLSBMb2dnZXIgc3ViamVjdCAvIGNhdGVnb3J5IHByZWZpeC5cbiAqIEBwYXJhbSB7Li4uUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IG1lc3NhZ2VzIC0gVXNlci1zdXBwbGllZCBtZXNzYWdlIHBhcnRzIChzdXBwb3J0cyBwcmludGYtc3R5bGUgZm9ybWF0IHNwZWNpZmllcnMgb24gdGhlIGZpcnN0IHBhcnQpLlxuICogQHJldHVybnMge3N0cmluZ30gLSBUaGUgZm9ybWF0dGVkIGxvZyBsaW5lLlxuICovXG5mdW5jdGlvbiBtZXNzYWdlc1RvTWVzc2FnZShzdWJqZWN0LCAuLi5tZXNzYWdlcykge1xuICBjb25zdCB1c2VyTWVzc2FnZSA9IGZvcm1hdFVzZXJNZXNzYWdlcyhtZXNzYWdlcylcblxuICBpZiAoIXN1YmplY3QpIHJldHVybiB1c2VyTWVzc2FnZVxuICBpZiAoIXVzZXJNZXNzYWdlKSByZXR1cm4gU3RyaW5nKHN1YmplY3QpXG5cbiAgcmV0dXJuIGAke3N1YmplY3R9ICR7dXNlck1lc3NhZ2V9YFxufVxuXG4vKipcbiAqIFJ1bnMgcmVzb2x2ZSBsb2dnaW5nIGNvbmZpZ3VyYXRpb24uXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4vY29uZmlndXJhdGlvbi5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkfSBjb25maWd1cmF0aW9uIC0gQ29uZmlndXJhdGlvbiBpbnN0YW5jZS5cbiAqIEByZXR1cm5zIHtSZXF1aXJlZDxQaWNrPGltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Mb2dnaW5nQ29uZmlndXJhdGlvbiwgXCJjb25zb2xlXCIgfCBcImZpbGVcIiB8IFwibGV2ZWxzXCI+PiAmIFBhcnRpYWw8UGljazxpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuTG9nZ2luZ0NvbmZpZ3VyYXRpb24sIFwiZmlsZVBhdGhcIiB8IFwib3V0cHV0c1wiPj59IC0gVGhlIGxvZ2dpbmcgY29uZmlndXJhdGlvbi5cbiAqL1xuZnVuY3Rpb24gcmVzb2x2ZUxvZ2dpbmdDb25maWd1cmF0aW9uKGNvbmZpZ3VyYXRpb24pIHtcbiAgY29uc3QgZGVidWdFbmFibGVkID0gY29uZmlndXJhdGlvbj8uZGVidWcgPT09IHRydWVcbiAgaWYgKGNvbmZpZ3VyYXRpb24gJiYgdHlwZW9mIGNvbmZpZ3VyYXRpb24uZ2V0TG9nZ2luZ0NvbmZpZ3VyYXRpb24gPT09IFwiZnVuY3Rpb25cIikge1xuICAgIGNvbnN0IHJlc29sdmVkID0gY29uZmlndXJhdGlvbi5nZXRMb2dnaW5nQ29uZmlndXJhdGlvbigpXG5cbiAgICBpZiAoZGVidWdFbmFibGVkKSB7XG4gICAgICByZXR1cm4ge1xuICAgICAgICAuLi5yZXNvbHZlZCxcbiAgICAgICAgY29uc29sZTogdHJ1ZSxcbiAgICAgICAgbGV2ZWxzOiBMRVZFTF9PUkRFUlxuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiByZXNvbHZlZFxuICB9XG5cbiAgaWYgKGRlYnVnRW5hYmxlZCkge1xuICAgIHJldHVybiB7XG4gICAgICAuLi5ERUZBVUxUX0xPR0dJTkdfQ09ORklHVVJBVElPTixcbiAgICAgIGNvbnNvbGU6IHRydWUsXG4gICAgICBsZXZlbHM6IExFVkVMX09SREVSXG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIERFRkFVTFRfTE9HR0lOR19DT05GSUdVUkFUSU9OXG59XG5cbi8qKlxuICogUnVucyBpcyBsZXZlbCBhbGxvd2VkLlxuICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zIG9iamVjdC5cbiAqIEBwYXJhbSB7TG9nTGV2ZWx9IGFyZ3MubGV2ZWwgLSBMZXZlbC5cbiAqIEBwYXJhbSB7TG9nTGV2ZWxbXX0gYXJncy5hbGxvd2VkTGV2ZWxzIC0gQWxsb3dlZCBsZXZlbHMuXG4gKiBAcGFyYW0ge2Jvb2xlYW59IFthcmdzLmRlYnVnRmxhZ10gLSBXaGV0aGVyIGRlYnVnIGZsYWcuXG4gKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIGxldmVsIGFsbG93ZWQuXG4gKi9cbmZ1bmN0aW9uIGlzTGV2ZWxBbGxvd2VkKHtsZXZlbCwgYWxsb3dlZExldmVscywgZGVidWdGbGFnfSkge1xuICBpZiAoYWxsb3dlZExldmVscy5pbmNsdWRlcyhsZXZlbCkpIHJldHVybiB0cnVlXG5cbiAgaWYgKGRlYnVnRmxhZyAmJiBMRVZFTF9PUkRFUi5pbmRleE9mKGxldmVsKSA+PSBMRVZFTF9PUkRFUi5pbmRleE9mKFwiZGVidWdcIikpIHJldHVybiB0cnVlXG5cbiAgcmV0dXJuIGZhbHNlXG59XG5cbi8qKlxuICogUnVucyByZXNvbHZlIGxvZ2dpbmcgb3V0cHV0cy5cbiAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucyBvYmplY3QuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Mb2dnaW5nQ29uZmlndXJhdGlvbn0gYXJncy5sb2dnaW5nQ29uZmlndXJhdGlvbiAtIExvZ2dpbmcgY29uZmlndXJhdGlvbi5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLmpzXCIpLmRlZmF1bHQgfCB1bmRlZmluZWR9IGFyZ3MuY29uZmlndXJhdGlvbiAtIENvbmZpZ3VyYXRpb24gaW5zdGFuY2UuXG4gKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkxvZ2dpbmdPdXRwdXRDb25maWdbXX0gLSBMb2dnaW5nIG91dHB1dHMuXG4gKi9cbmZ1bmN0aW9uIHJlc29sdmVMb2dnaW5nT3V0cHV0cyh7bG9nZ2luZ0NvbmZpZ3VyYXRpb24sIGNvbmZpZ3VyYXRpb259KSB7XG4gIGlmIChBcnJheS5pc0FycmF5KGxvZ2dpbmdDb25maWd1cmF0aW9uLm91dHB1dHMpKSByZXR1cm4gbG9nZ2luZ0NvbmZpZ3VyYXRpb24ub3V0cHV0c1xuXG4gIGlmIChBcnJheS5pc0FycmF5KGxvZ2dpbmdDb25maWd1cmF0aW9uLmxvZ2dlcnMpKSB7XG4gICAgLyoqXG4gICAgICogTG9nZ2VyIG91dHB1dHMuXG4gICAgICogQHR5cGUge2ltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Mb2dnaW5nT3V0cHV0Q29uZmlnW119ICovXG4gICAgY29uc3QgbG9nZ2VyT3V0cHV0cyA9IFtdXG5cbiAgICBmb3IgKGNvbnN0IGxvZ2dlciBvZiBsb2dnaW5nQ29uZmlndXJhdGlvbi5sb2dnZXJzKSB7XG4gICAgICBpZiAoIWxvZ2dlcikgY29udGludWVcblxuICAgICAgY29uc3QgbG9nZ2VyQ29uZmlnID0gLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi8gKGxvZ2dlcilcblxuICAgICAgaWYgKHR5cGVvZiBsb2dnZXJDb25maWcudG9PdXRwdXRDb25maWcgPT09IFwiZnVuY3Rpb25cIikge1xuICAgICAgICBsb2dnZXJPdXRwdXRzLnB1c2gobG9nZ2VyQ29uZmlnLnRvT3V0cHV0Q29uZmlnKHtjb25maWd1cmF0aW9ufSkpXG4gICAgICAgIGNvbnRpbnVlXG4gICAgICB9XG5cbiAgICAgIGlmIChsb2dnZXJDb25maWcub3V0cHV0ICYmIHR5cGVvZiBsb2dnZXJDb25maWcub3V0cHV0LndyaXRlID09PSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgICAgbG9nZ2VyT3V0cHV0cy5wdXNoKHtcbiAgICAgICAgICBvdXRwdXQ6IGxvZ2dlckNvbmZpZy5vdXRwdXQsXG4gICAgICAgICAgbGV2ZWxzOiBsb2dnZXJDb25maWcubGV2ZWxzXG4gICAgICAgIH0pXG4gICAgICAgIGNvbnRpbnVlXG4gICAgICB9XG5cbiAgICAgIGlmICh0eXBlb2YgbG9nZ2VyQ29uZmlnLndyaXRlID09PSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgICAgbG9nZ2VyT3V0cHV0cy5wdXNoKHtcbiAgICAgICAgICBvdXRwdXQ6IGxvZ2dlckNvbmZpZyxcbiAgICAgICAgICBsZXZlbHM6IGxvZ2dlckNvbmZpZy5sZXZlbHNcbiAgICAgICAgfSlcbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgY29uc3QgbG9nZ2VyTmFtZSA9IGxvZ2dlckNvbmZpZz8uY29uc3RydWN0b3I/Lm5hbWUgfHwgXCJVbmtub3duTG9nZ2VyXCJcbiAgICAgIHRocm93IG5ldyBFcnJvcihgTG9nZ2VyIG11c3QgaW1wbGVtZW50IHRvT3V0cHV0Q29uZmlnIG9yIHdyaXRlOiAke2xvZ2dlck5hbWV9YClcbiAgICB9XG5cbiAgICByZXR1cm4gbG9nZ2VyT3V0cHV0c1xuICB9XG5cbiAgLyoqXG4gICAqIE91dHB1dHMuXG4gICAqIEB0eXBlIHtpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuTG9nZ2luZ091dHB1dENvbmZpZ1tdfSAqL1xuICBjb25zdCBvdXRwdXRzID0gW11cbiAgaWYgKGxvZ2dpbmdDb25maWd1cmF0aW9uLmNvbnNvbGUgIT09IGZhbHNlKSB7XG4gICAgb3V0cHV0cy5wdXNoKHtcbiAgICAgIG91dHB1dDogbmV3IExvZ2dlckNvbnNvbGVPdXRwdXQoKSxcbiAgICAgIGxldmVsczogbG9nZ2luZ0NvbmZpZ3VyYXRpb24ubGV2ZWxzXG4gICAgfSlcbiAgfVxuXG4gIGlmIChsb2dnaW5nQ29uZmlndXJhdGlvbi5maWxlICE9PSBmYWxzZSAmJiBsb2dnaW5nQ29uZmlndXJhdGlvbi5maWxlUGF0aCkge1xuICAgIG91dHB1dHMucHVzaCh7XG4gICAgICBvdXRwdXQ6IG5ldyBMb2dnZXJGaWxlT3V0cHV0KHtcbiAgICAgICAgY29uZmlndXJhdGlvbixcbiAgICAgICAgZ2V0Q29uZmlndXJhdGlvbjogKCkgPT4gY29uZmlndXJhdGlvbixcbiAgICAgICAgZmlsZVBhdGg6IGxvZ2dpbmdDb25maWd1cmF0aW9uLmZpbGVQYXRoXG4gICAgICB9KSxcbiAgICAgIGxldmVsczogbG9nZ2luZ0NvbmZpZ3VyYXRpb24ubGV2ZWxzXG4gICAgfSlcbiAgfVxuXG4gIHJldHVybiBvdXRwdXRzXG59XG5cbi8qKlxuICogUnVucyBpcyBvdXRwdXQgbGV2ZWwgYWxsb3dlZC5cbiAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucyBvYmplY3QuXG4gKiBAcGFyYW0ge0xvZ0xldmVsfSBhcmdzLmxldmVsIC0gTGV2ZWwuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Mb2dnaW5nT3V0cHV0Q29uZmlnfSBhcmdzLm91dHB1dENvbmZpZyAtIE91dHB1dCBjb25maWd1cmF0aW9uLlxuICogQHBhcmFtIHtpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuTG9nZ2luZ0NvbmZpZ3VyYXRpb259IGFyZ3MubG9nZ2luZ0NvbmZpZ3VyYXRpb24gLSBMb2dnaW5nIGNvbmZpZ3VyYXRpb24uXG4gKiBAcGFyYW0ge2Jvb2xlYW59IFthcmdzLmRlYnVnRmxhZ10gLSBXaGV0aGVyIGRlYnVnIGZsYWcuXG4gKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIG91dHB1dCBzaG91bGQgbG9nLlxuICovXG5mdW5jdGlvbiBpc091dHB1dExldmVsQWxsb3dlZCh7bGV2ZWwsIG91dHB1dENvbmZpZywgbG9nZ2luZ0NvbmZpZ3VyYXRpb24sIGRlYnVnRmxhZ30pIHtcbiAgaWYgKEFycmF5LmlzQXJyYXkob3V0cHV0Q29uZmlnLmxldmVscykpIHtcbiAgICByZXR1cm4gaXNMZXZlbEFsbG93ZWQoe2xldmVsLCBhbGxvd2VkTGV2ZWxzOiBvdXRwdXRDb25maWcubGV2ZWxzLCBkZWJ1Z0ZsYWc6IGZhbHNlfSlcbiAgfVxuXG4gIGlmIChBcnJheS5pc0FycmF5KG91dHB1dENvbmZpZy5vdXRwdXQ/LmxldmVscykpIHtcbiAgICByZXR1cm4gaXNMZXZlbEFsbG93ZWQoe2xldmVsLCBhbGxvd2VkTGV2ZWxzOiBvdXRwdXRDb25maWcub3V0cHV0LmxldmVscywgZGVidWdGbGFnOiBmYWxzZX0pXG4gIH1cblxuICBjb25zdCBhbGxvd2VkTGV2ZWxzID0gbG9nZ2luZ0NvbmZpZ3VyYXRpb24ubGV2ZWxzIHx8IERFRkFVTFRfTE9HR0lOR19DT05GSUdVUkFUSU9OLmxldmVsc1xuXG4gIHJldHVybiBpc0xldmVsQWxsb3dlZCh7bGV2ZWwsIGFsbG93ZWRMZXZlbHMsIGRlYnVnRmxhZ30pXG59XG5cbi8qKlxuICogUnVucyBlbmFibGVkIG91dHB1dCBjb25maWdzLlxuICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zIG9iamVjdC5cbiAqIEBwYXJhbSB7TG9nTGV2ZWx9IGFyZ3MubGV2ZWwgLSBMZXZlbC5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkxvZ2dpbmdPdXRwdXRDb25maWdbXX0gYXJncy5vdXRwdXRzIC0gT3V0cHV0IGNvbmZpZ3VyYXRpb25zLlxuICogQHBhcmFtIHtpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuTG9nZ2luZ0NvbmZpZ3VyYXRpb259IGFyZ3MubG9nZ2luZ0NvbmZpZ3VyYXRpb24gLSBMb2dnaW5nIGNvbmZpZ3VyYXRpb24uXG4gKiBAcGFyYW0ge2Jvb2xlYW59IFthcmdzLmRlYnVnRmxhZ10gLSBXaGV0aGVyIGRlYnVnIGZsYWcuXG4gKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkxvZ2dpbmdPdXRwdXRDb25maWdbXX0gLSBPdXRwdXRzIGVuYWJsZWQgZm9yIHRoZSBsZXZlbC5cbiAqL1xuZnVuY3Rpb24gZW5hYmxlZE91dHB1dENvbmZpZ3Moe2xldmVsLCBvdXRwdXRzLCBsb2dnaW5nQ29uZmlndXJhdGlvbiwgZGVidWdGbGFnfSkge1xuICByZXR1cm4gb3V0cHV0cy5maWx0ZXIoKG91dHB1dENvbmZpZykgPT4ge1xuICAgIGlmICghb3V0cHV0Q29uZmlnIHx8ICFvdXRwdXRDb25maWcub3V0cHV0IHx8IHR5cGVvZiBvdXRwdXRDb25maWcub3V0cHV0LndyaXRlICE9PSBcImZ1bmN0aW9uXCIpIHJldHVybiBmYWxzZVxuXG4gICAgcmV0dXJuIGlzT3V0cHV0TGV2ZWxBbGxvd2VkKHtsZXZlbCwgb3V0cHV0Q29uZmlnLCBsb2dnaW5nQ29uZmlndXJhdGlvbiwgZGVidWdGbGFnfSlcbiAgfSlcbn1cblxuLyoqXG4gKiBSdW5zIHdyaXRlIGxvZy5cbiAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucyBvYmplY3QuXG4gKiBAcGFyYW0ge3N0cmluZ30gYXJncy5zdWJqZWN0IC0gTG9nIHN1YmplY3QuXG4gKiBAcGFyYW0ge0xvZ0xldmVsfSBhcmdzLmxldmVsIC0gTGV2ZWwuXG4gKiBAcGFyYW0ge1BhcmFtZXRlcnM8dHlwZW9mIGZ1bmN0aW9uT3JNZXNzYWdlcz59IGFyZ3MubWVzc2FnZXMgLSBNZXNzYWdlcy5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLmpzXCIpLmRlZmF1bHQgfCB1bmRlZmluZWR9IGFyZ3MuY29uZmlndXJhdGlvbiAtIENvbmZpZ3VyYXRpb24gaW5zdGFuY2UuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Mb2dnaW5nQ29uZmlndXJhdGlvbiB8IHVuZGVmaW5lZH0gYXJncy5sb2dnaW5nQ29uZmlndXJhdGlvbiAtIExvZ2dpbmcgY29uZmlndXJhdGlvbi5cbiAqIEBwYXJhbSB7Ym9vbGVhbn0gW2FyZ3MuZGVidWdGbGFnXSAtIFdoZXRoZXIgZGVidWcgZmxhZy5cbiAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gKi9cbmFzeW5jIGZ1bmN0aW9uIHdyaXRlTG9nKHtzdWJqZWN0LCBsZXZlbCwgbWVzc2FnZXMsIGNvbmZpZ3VyYXRpb24sIGxvZ2dpbmdDb25maWd1cmF0aW9uLCBkZWJ1Z0ZsYWd9KSB7XG4gIGNvbnN0IHJlc29sdmVkTG9nZ2luZ0NvbmZpZ3VyYXRpb24gPSBsb2dnaW5nQ29uZmlndXJhdGlvbiB8fCByZXNvbHZlTG9nZ2luZ0NvbmZpZ3VyYXRpb24oY29uZmlndXJhdGlvbilcbiAgY29uc3Qgb3V0cHV0cyA9IHJlc29sdmVMb2dnaW5nT3V0cHV0cyh7bG9nZ2luZ0NvbmZpZ3VyYXRpb246IHJlc29sdmVkTG9nZ2luZ0NvbmZpZ3VyYXRpb24sIGNvbmZpZ3VyYXRpb259KVxuICBjb25zdCBlbmFibGVkT3V0cHV0cyA9IGVuYWJsZWRPdXRwdXRDb25maWdzKHtcbiAgICBsZXZlbCxcbiAgICBvdXRwdXRzLFxuICAgIGxvZ2dpbmdDb25maWd1cmF0aW9uOiByZXNvbHZlZExvZ2dpbmdDb25maWd1cmF0aW9uLFxuICAgIGRlYnVnRmxhZ1xuICB9KVxuXG4gIGlmIChlbmFibGVkT3V0cHV0cy5sZW5ndGggPT09IDApIHJldHVyblxuXG4gIGNvbnN0IHdyaXRlcyA9IFtdXG4gIC8qKlxuICAgKiBUeXBlcyB0aGUgZm9sbG93aW5nIHZhbHVlLlxuICAgKiBAdHlwZSB7QXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+IHwgdW5kZWZpbmVkfSAqL1xuICBsZXQgcmVzb2x2ZWRNZXNzYWdlc1xuICAvKipcbiAgICogVHlwZXMgdGhlIGZvbGxvd2luZyB2YWx1ZS5cbiAgICogQHR5cGUge3N0cmluZyB8IHVuZGVmaW5lZH0gKi9cbiAgbGV0IG1lc3NhZ2VcbiAgLyoqXG4gICAqIFBheWxvYWQuXG4gICAqIEB0eXBlIHtpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuTG9nZ2luZ091dHB1dFBheWxvYWQgfCBudWxsfSAqL1xuICBsZXQgcGF5bG9hZCA9IG51bGxcblxuICBmb3IgKGNvbnN0IG91dHB1dENvbmZpZyBvZiBlbmFibGVkT3V0cHV0cykge1xuICAgIGlmICghcGF5bG9hZCkge1xuICAgICAgcmVzb2x2ZWRNZXNzYWdlcyA9IGZ1bmN0aW9uT3JNZXNzYWdlcyguLi5tZXNzYWdlcylcbiAgICAgIG1lc3NhZ2UgPSBtZXNzYWdlc1RvTWVzc2FnZShzdWJqZWN0LCAuLi5yZXNvbHZlZE1lc3NhZ2VzKVxuICAgICAgLy8gc3ViamVjdCBpcyB0aGUgZmlyc3QgcG9zaXRpb25hbCBhcmcsIHRoZW4gdGhlIHVzZXIgbWVzc2FnZXNcbiAgICAgIHBheWxvYWQgPSB7XG4gICAgICAgIGxldmVsLFxuICAgICAgICBtZXNzYWdlLFxuICAgICAgICBzdWJqZWN0LFxuICAgICAgICB0aW1lc3RhbXA6IG5ldyBEYXRlKClcbiAgICAgIH1cbiAgICB9XG5cbiAgICB3cml0ZXMucHVzaChvdXRwdXRDb25maWcub3V0cHV0LndyaXRlKHBheWxvYWQpKVxuICB9XG5cbiAgaWYgKHdyaXRlcy5sZW5ndGggPT09IDEpIHtcbiAgICBhd2FpdCB3cml0ZXNbMF1cbiAgfSBlbHNlIGlmICh3cml0ZXMubGVuZ3RoID4gMSkge1xuICAgIGF3YWl0IFByb21pc2UuYWxsKHdyaXRlcylcbiAgfVxufVxuXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBMb2dnZXIge1xuICAvKipcbiAgICogUnVucyBjb25zdHJ1Y3Rvci5cbiAgICogQHBhcmFtIHtzdHJpbmcgfCBvYmplY3R9IG9iamVjdCAtIE9iamVjdC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24uanNcIikuZGVmYXVsdH0gW2FyZ3MuY29uZmlndXJhdGlvbl0gLSBDb25maWd1cmF0aW9uIGluc3RhbmNlLlxuICAgKiBAcGFyYW0ge2Jvb2xlYW59IFthcmdzLmRlYnVnXSAtIFdoZXRoZXIgZGVidWcuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkxvZ2dpbmdDb25maWd1cmF0aW9ufSBbYXJncy5sb2dnaW5nQ29uZmlndXJhdGlvbl0gLSBMb2dnaW5nIGNvbmZpZ3VyYXRpb24uXG4gICAqL1xuICBjb25zdHJ1Y3RvcihvYmplY3QsIHtjb25maWd1cmF0aW9uLCBkZWJ1ZyA9IGZhbHNlLCBsb2dnaW5nQ29uZmlndXJhdGlvbiwgLi4ucmVzdEFyZ3N9ID0ge30pIHtcbiAgICByZXN0QXJnc0Vycm9yKHJlc3RBcmdzKVxuXG4gICAgdGhpcy5fZGVidWcgPSBkZWJ1Z1xuICAgIHRoaXMuX2NvbmZpZ3VyYXRpb24gPSBjb25maWd1cmF0aW9uXG4gICAgdGhpcy5fbG9nZ2luZ0NvbmZpZ3VyYXRpb24gPSBsb2dnaW5nQ29uZmlndXJhdGlvblxuXG4gICAgaWYgKHR5cGVvZiBvYmplY3QgPT0gXCJzdHJpbmdcIikge1xuICAgICAgdGhpcy5fc3ViamVjdCA9IG9iamVjdCB8fCBcIkVtcHR5U3RyaW5nXCJcbiAgICB9IGVsc2Uge1xuICAgICAgdGhpcy5fb2JqZWN0ID0gb2JqZWN0XG4gICAgICB0aGlzLl9zdWJqZWN0ID0gb2JqZWN0LmNvbnN0cnVjdG9yLm5hbWUgfHwgXCJVbmtub3duQ2xhc3NcIlxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBjb25maWd1cmF0aW9uLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLmpzXCIpLmRlZmF1bHR9IC0gVGhlIGNvbmZpZ3VyYXRpb24uXG4gICAqL1xuICBnZXRDb25maWd1cmF0aW9uKCkge1xuICAgIGlmICghdGhpcy5fY29uZmlndXJhdGlvbikge1xuICAgICAgY29uc3Qgb2JqZWN0V2l0aENvbmZpZyA9IC8qKiBAdHlwZSB7e2NvbmZpZ3VyYXRpb24/OiBpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24uanNcIikuZGVmYXVsdH19ICovICh0aGlzLl9vYmplY3QpXG4gICAgICB0aGlzLl9jb25maWd1cmF0aW9uID0gb2JqZWN0V2l0aENvbmZpZz8uY29uZmlndXJhdGlvbiB8fCBjdXJyZW50Q29uZmlndXJhdGlvbigpXG4gICAgfVxuXG4gICAgcmV0dXJuIHRoaXMuX2NvbmZpZ3VyYXRpb25cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNhZmUgY29uZmlndXJhdGlvbi5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vY29uZmlndXJhdGlvbi5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkfSAtIFRoZSBzYWZlIGNvbmZpZ3VyYXRpb24uXG4gICAqL1xuICBfc2FmZUNvbmZpZ3VyYXRpb24oKSB7XG4gICAgdHJ5IHtcbiAgICAgIHJldHVybiB0aGlzLmdldENvbmZpZ3VyYXRpb24oKVxuICAgIH0gY2F0Y2gge1xuICAgICAgcmV0dXJuIHVuZGVmaW5lZFxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGlzIGxldmVsIGVuYWJsZWQuXG4gICAqIEBwYXJhbSB7TG9nTGV2ZWx9IGxldmVsIC0gTGV2ZWwuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgYW55IGNvbmZpZ3VyZWQgb3V0cHV0IGVtaXRzIHRoaXMgbGV2ZWwuXG4gICAqL1xuICBpc0xldmVsRW5hYmxlZChsZXZlbCkge1xuICAgIGNvbnN0IGNvbmZpZ3VyYXRpb24gPSB0aGlzLl9zYWZlQ29uZmlndXJhdGlvbigpXG4gICAgY29uc3QgbG9nZ2luZ0NvbmZpZ3VyYXRpb24gPSB0aGlzLl9sb2dnaW5nQ29uZmlndXJhdGlvbiB8fCByZXNvbHZlTG9nZ2luZ0NvbmZpZ3VyYXRpb24oY29uZmlndXJhdGlvbilcbiAgICBjb25zdCBvdXRwdXRzID0gcmVzb2x2ZUxvZ2dpbmdPdXRwdXRzKHtsb2dnaW5nQ29uZmlndXJhdGlvbiwgY29uZmlndXJhdGlvbn0pXG5cbiAgICByZXR1cm4gZW5hYmxlZE91dHB1dENvbmZpZ3Moe1xuICAgICAgbGV2ZWwsXG4gICAgICBvdXRwdXRzLFxuICAgICAgbG9nZ2luZ0NvbmZpZ3VyYXRpb24sXG4gICAgICBkZWJ1Z0ZsYWc6IHRoaXMuX2RlYnVnXG4gICAgfSkubGVuZ3RoID4gMFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZGVidWcuXG4gICAqIEBwYXJhbSB7QXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBtZXNzYWdlcyAtIE1lc3NhZ2VzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgZGVidWcoLi4ubWVzc2FnZXMpIHtcbiAgICBhd2FpdCB0aGlzLl93cml0ZSh7bGV2ZWw6IFwiZGVidWdcIiwgbWVzc2FnZXN9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaW5mby5cbiAgICogQHBhcmFtIHtBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IG1lc3NhZ2VzIC0gTWVzc2FnZXMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyBpbmZvKC4uLm1lc3NhZ2VzKSB7XG4gICAgYXdhaXQgdGhpcy5fd3JpdGUoe2xldmVsOiBcImluZm9cIiwgbWVzc2FnZXN9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZGVidWcgbG93IGxldmVsLlxuICAgKiBAcGFyYW0ge0FycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gbWVzc2FnZXMgLSBNZXNzYWdlcy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIGRlYnVnTG93TGV2ZWwoLi4ubWVzc2FnZXMpIHtcbiAgICBhd2FpdCB0aGlzLl93cml0ZSh7bGV2ZWw6IFwiZGVidWctbG93LWxldmVsXCIsIG1lc3NhZ2VzfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGxvZy5cbiAgICogQHBhcmFtIHtBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IG1lc3NhZ2VzIC0gTWVzc2FnZXMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyBsb2coLi4ubWVzc2FnZXMpIHtcbiAgICBhd2FpdCB0aGlzLl93cml0ZSh7bGV2ZWw6IFwiaW5mb1wiLCBtZXNzYWdlc30pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBlcnJvci5cbiAgICogQHBhcmFtIHtBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IG1lc3NhZ2VzIC0gTWVzc2FnZXMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyBlcnJvciguLi5tZXNzYWdlcykge1xuICAgIGF3YWl0IHRoaXMuX3dyaXRlKHtsZXZlbDogXCJlcnJvclwiLCBtZXNzYWdlc30pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzZXQgZGVidWcuXG4gICAqIEBwYXJhbSB7Ym9vbGVhbn0gbmV3VmFsdWUgLSBOZXcgdmFsdWUuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIHNldERlYnVnKG5ld1ZhbHVlKSB7XG4gICAgdGhpcy5fZGVidWcgPSBuZXdWYWx1ZVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgd2Fybi5cbiAgICogQHR5cGUgeyguLi5hcmdzOiBQYXJhbWV0ZXJzPHR5cGVvZiBmdW5jdGlvbk9yTWVzc2FnZXM+KSA9PiBQcm9taXNlPHZvaWQ+fVxuICAgKi9cbiAgYXN5bmMgd2FybiguLi5tZXNzYWdlcykge1xuICAgIGF3YWl0IHRoaXMuX3dyaXRlKHtsZXZlbDogXCJ3YXJuXCIsIG1lc3NhZ2VzfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHdyaXRlLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcGFyYW0ge0xvZ0xldmVsfSBhcmdzLmxldmVsIC0gTGV2ZWwuXG4gICAqIEBwYXJhbSB7UGFyYW1ldGVyczx0eXBlb2YgZnVuY3Rpb25Pck1lc3NhZ2VzPn0gYXJncy5tZXNzYWdlcyAtIE1lc3NhZ2VzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgX3dyaXRlKHtsZXZlbCwgbWVzc2FnZXN9KSB7XG4gICAgY29uc3QgY29uZmlndXJhdGlvbiA9IHRoaXMuX3NhZmVDb25maWd1cmF0aW9uKClcbiAgICBjb25zdCBsb2dnaW5nQ29uZmlndXJhdGlvbiA9IHRoaXMuX2xvZ2dpbmdDb25maWd1cmF0aW9uIHx8IHJlc29sdmVMb2dnaW5nQ29uZmlndXJhdGlvbihjb25maWd1cmF0aW9uKVxuXG4gICAgYXdhaXQgd3JpdGVMb2coe1xuICAgICAgc3ViamVjdDogdGhpcy5fc3ViamVjdCxcbiAgICAgIGxldmVsLFxuICAgICAgbWVzc2FnZXMsXG4gICAgICBjb25maWd1cmF0aW9uLFxuICAgICAgbG9nZ2luZ0NvbmZpZ3VyYXRpb24sXG4gICAgICBkZWJ1Z0ZsYWc6IHRoaXMuX2RlYnVnXG4gICAgfSlcbiAgfVxufVxuIl19