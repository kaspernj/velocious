export declare const LOG_REDACTION_MARKER = "[REDACTED]";
/** Owns structured logging redaction and request-local sensitive values. */
export default class LogRedactor {
    _extendedSensitiveNames: string[];
    /**
     * Builds a structured logging redactor.
     * @param {object} [args] - Redaction policy options.
     * @param {string[]} [args.sensitiveNames] - Application-defined sensitive names.
     */
    constructor({ sensitiveNames }?: {
        sensitiveNames?: string[];
    });
    /**
     * Checks a structured name against the default and application policy.
     * @param {string} name - Header or parameter name.
     * @returns {boolean} - Whether values under the name are sensitive.
     */
    isSensitiveName(name: string): boolean;
    /**
     * Collects values found below sensitive structured names.
     * @param {ReturnType<typeof JSON.parse>} value - Structured value.
     * @param {Set<string>} [initialValues] - Values already registered for this request.
     * @returns {Set<string>} - A new set containing all registered representations.
     */
    sensitiveValues(value: ReturnType<typeof JSON.parse>, initialValues?: Set<string>): Set<string>;
    /**
     * Collects sensitive values from every structured request surface.
     * @param {import("./http-server/client/request.js").default | import("./http-server/client/websocket-request.js").default} request - Incoming request.
     * @param {Set<string>} [initialValues] - Values already registered for this request.
     * @returns {Set<string>} - Request-local sensitive values.
     */
    requestSensitiveValues(request: import("./http-server/client/request.js").default | import("./http-server/client/websocket-request.js").default, initialValues?: Set<string>): Set<string>;
    /**
     * Redacts a structured value without mutating it.
     * @param {ReturnType<typeof JSON.parse>} value - Value to redact.
     * @param {Set<string>} [sensitiveValues] - Request-local sensitive values.
     * @returns {ReturnType<typeof JSON.parse>} - Redacted structural copy.
     */
    redactStructured(value: ReturnType<typeof JSON.parse>, sensitiveValues?: Set<string>): ReturnType<typeof JSON.parse>;
    /**
     * Replaces exact known sensitive values in diagnostic text.
     * @param {string} value - Diagnostic text.
     * @param {Set<string>} [sensitiveValues] - Request-local sensitive values.
     * @returns {string} - Redacted text.
     */
    redactString(value: string, sensitiveValues?: Set<string>): string;
    /**
     * Builds an Error-compatible diagnostic with redacted message and backtrace.
     * @param {Error} error - Original error.
     * @param {Set<string>} [sensitiveValues] - Request-local sensitive values.
     * @returns {Error} - Redacted error diagnostic.
     */
    redactError(error: Error, sensitiveValues?: Set<string>): Error;
    /**
     * Redacts named query values and registered path values without parsing SQL-like text.
     * @param {string} path - Request path, optionally including a query string.
     * @param {Set<string>} [sensitiveValues] - Request-local sensitive values.
     * @returns {string} - Redacted request path.
     */
    redactPath(path: string, sensitiveValues?: Set<string>): string;
    /**
     * Traverses structured values to find sensitive-name descendants.
     * @param {ReturnType<typeof JSON.parse>} value - Current structured value.
     * @param {string} key - Owning structured name.
     * @param {Set<string>} values - Collected sensitive values.
     * @param {WeakSet<object>} seen - Visited object references.
     * @returns {void} - No return value.
     */
    _collectSensitiveValues(value: ReturnType<typeof JSON.parse>, key: string, values: Set<string>, seen: WeakSet<object>): void;
    /**
     * Registers primitive leaves below a sensitive structured name.
     * @param {ReturnType<typeof JSON.parse>} value - Value below a sensitive name.
     * @param {string} key - Sensitive structured name.
     * @param {Set<string>} values - Collected sensitive values.
     * @param {WeakSet<object>} seen - Visited object references.
     * @returns {void} - No return value.
     */
    _collectLeafValues(value: ReturnType<typeof JSON.parse>, key: string, values: Set<string>, seen: WeakSet<object>): void;
    /**
     * Registers common encoded and credential-bearing representations.
     * @param {string} value - Sensitive string.
     * @param {string} key - Sensitive structured name.
     * @param {Set<string>} values - Collected sensitive values.
     * @returns {void} - No return value.
     */
    _addSensitiveString(value: string, key: string, values: Set<string>): void;
    /**
     * Produces a recursively redacted structural copy.
     * @param {ReturnType<typeof JSON.parse>} value - Current structured value.
     * @param {string} key - Owning structured name.
     * @param {Set<string>} sensitiveValues - Request-local sensitive values.
     * @param {WeakSet<object>} seen - Visited object references.
     * @returns {ReturnType<typeof JSON.parse>} - Redacted value.
     */
    _redactStructured(value: ReturnType<typeof JSON.parse>, key: string, sensitiveValues: Set<string>, seen: WeakSet<object>): ReturnType<typeof JSON.parse>;
}
//# sourceMappingURL=log-redactor.d.ts.map