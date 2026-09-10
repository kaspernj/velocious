// @ts-check
import { ensureError } from "typanic";
import BacktraceCleaner from "../../utils/backtrace-cleaner-node.js";
import EventEmitter from "../../utils/event-emitter.js";
import { HttpResponseBodyTooLargeError } from "./errors.js";
import Logger from "../../logger.js";
import RequestTiming from "./request-timing.js";
import Response from "./response.js";
import RoutesResolver from "../../routes/resolver.js";
import { REQUEST_TIME_ZONE_HEADER } from "../../time-zone.js";
/**
 * Runs stack frame line.
 * @param {string | undefined} line - Potential header line.
 * @returns {boolean} - Whether the line is a stack frame.
 */
function stackFrameLine(line) {
    if (!line)
        return false;
    return /^at\s+/u.test(line.trim());
}
/**
 * Runs request error summary.
 * @param {Error} error - Error to format for logging.
 * @param {string | undefined} cleanedStackWithHeader - Cleaned stack with header line.
 * @returns {string} - Error summary line with type information.
 */
function requestErrorSummary(error, cleanedStackWithHeader) {
    const stackHeader = cleanedStackWithHeader?.split("\n")[0]?.trim();
    if (stackHeader && !stackFrameLine(stackHeader))
        return stackHeader;
    const errorCode = typeof /** @type {ReturnType<typeof JSON.parse>} */ (error).code === "string"
        ? /** @type {ReturnType<typeof JSON.parse>} */ (error).code
        : undefined;
    const errorMessage = error.message || String(error);
    if (errorCode)
        return `${error.name} [${errorCode}]: ${errorMessage}`;
    return `${error.name}: ${errorMessage}`;
}
/**
 * Runs request error log details.
 * @param {Error} error - Error to format for logging.
 * @returns {{
 *   errorSummary: string,
 *   cleanedBacktrace: string | undefined,
 * }} - Log details.
 */
function requestErrorLogDetails(error) {
    const cleanedStackWithHeader = BacktraceCleaner.getCleanedStack(error);
    const errorSummary = requestErrorSummary(error, cleanedStackWithHeader);
    const cleanedBacktrace = BacktraceCleaner.getCleanedStack(error, { includeErrorHeader: false }) || cleanedStackWithHeader;
    return { errorSummary, cleanedBacktrace };
}
/**
 * Runs request error log message.
 * @param {{
 *   errorSummary: string,
 *   cleanedBacktrace: string | undefined,
 * }} logDetails - Log details.
 * @returns {string} - Single request error log message.
 */
function requestErrorLogMessage(logDetails) {
    if (!logDetails.cleanedBacktrace) {
        return `Error while running request: ${logDetails.errorSummary}`;
    }
    return `Error while running request: ${logDetails.errorSummary}\nCleaned backtrace:\n${logDetails.cleanedBacktrace}`;
}
/**
 * Runs response body type for log.
 * @param {Response} response - Response object.
 * @returns {string} - Response body type for logging.
 */
function responseBodyTypeForLog(response) {
    if (response.getFilePath())
        return "file";
    try {
        return typeof response.getBody();
    }
    catch {
        return "unset";
    }
}
/**
 * Runs format bucket ms.
 * @param {number} value - Milliseconds.
 * @returns {string} - Formatted milliseconds with one decimal place.
 */
function formatBucketMs(value) {
    return `${value.toFixed(1)}ms`;
}
/**
 * Runs query count label.
 * @param {number} count - Query count.
 * @returns {string} - Query count label.
 */
function queryCountLabel(count) {
    return `${count} ${count === 1 ? "query" : "queries"}`;
}
export default class VelociousHttpServerClientRequestRunner {
    events = new EventEmitter();
    /**
     * Runs constructor.
     * @param {object} args - Options object.
     * @param {import("../../configuration.js").default} args.configuration - Configuration instance.
     * @param {import("./request.js").default | import("./websocket-request.js").default} args.request - Request object.
     */
    constructor({ configuration, request }) {
        if (!configuration)
            throw new Error("No configuration given");
        if (!request)
            throw new Error("No request given");
        this.logger = new Logger(this);
        this.configuration = configuration;
        this.request = request;
        this.response = new Response({ configuration });
        this.completedRequestLogged = false;
        this.requestTiming = new RequestTiming();
        this.state = "running";
    }
    getRequest() { return this.request; }
    getState() { return this.state; }
    async run() {
        this.requestTiming.startedAtMs = Date.now();
        return await this.configuration.runWithRequestTiming(this.requestTiming, async () => {
            const redactor = this.configuration.getLogRedactor();
            const sensitiveValues = redactor.requestSensitiveValues(this.request, this.requestTiming.getLogSensitiveValues());
            this.requestTiming.registerLogSensitiveValues(sensitiveValues);
            // Run the whole request inside any per-test shared connection context so an
            // in-process handler executes on the test's connection (and open transaction).
            // No shared connection is set outside tests / in worker threads, so this is a
            // no-op there.
            await this.configuration.runWithTestSharedConnectionContexts(async () => {
                await this._run();
            });
        });
    }
    async _run() {
        const { configuration, request, response } = this;
        if (!request)
            throw new Error("No request?");
        const redactor = configuration.getLogRedactor();
        const sensitiveValues = this.requestTiming.getLogSensitiveValues();
        const loggedPath = redactor.redactPath(request.path(), sensitiveValues);
        try {
            await this.logger.debug(() => ["Run request lifecycle", {
                    httpMethod: request.httpMethod(),
                    httpVersion: request.httpVersion(),
                    origin: request.origin(),
                    path: loggedPath,
                    remoteAddress: request.remoteAddress()
                }]);
            // Before we checked if the sec-fetch-mode was "cors", but it seems the sec-fetch-mode isn't always present
            await this.logger.debug(() => ["Run CORS", { httpMethod: request.httpMethod(), secFetchMode: request.header("sec-fetch-mode") }]);
            const cors = configuration.getCors();
            if (cors) {
                await cors({ request, response });
                await this.logger.debug(() => ["CORS handler done", {
                        httpMethod: request.httpMethod(),
                        path: loggedPath,
                        responseStatusCode: response.getStatusCode()
                    }]);
            }
            if (request.httpMethod() == "OPTIONS" && request.header("sec-fetch-mode") == "cors") {
                response.setStatus(200);
                response.setBody("");
                await this.logger.debug(() => ["Handled preflight OPTIONS request", {
                        path: loggedPath,
                        responseStatusCode: response.getStatusCode()
                    }]);
            }
            else {
                await this.logger.debug("Run request");
                const routesResolver = new RoutesResolver({ configuration, request, response });
                const startTimeMs = Date.now();
                /**
                 * Defines timeoutId.
                 * @type {ReturnType<typeof setTimeout> | undefined} */
                let timeoutId;
                /**
                 * Defines timeoutReject.
                 * @type {((error: Error) => void) | undefined} */
                let timeoutReject;
                let timedOut = false;
                const setRequestTimeoutSeconds = (/** @type {number | undefined} */ timeoutSeconds) => {
                    if (timeoutId) {
                        clearTimeout(timeoutId);
                        timeoutId = undefined;
                    }
                    if (typeof timeoutSeconds !== "number" || !Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0) {
                        return;
                    }
                    const timeoutMs = timeoutSeconds * 1000;
                    const elapsedMs = Date.now() - startTimeMs;
                    const remainingMs = timeoutMs - elapsedMs;
                    if (remainingMs <= 0) {
                        timeoutReject?.(new Error(`Request timed out after ${timeoutSeconds}s`));
                        return;
                    }
                    timeoutId = setTimeout(() => {
                        timeoutReject?.(new Error(`Request timed out after ${timeoutSeconds}s`));
                    }, remainingMs);
                };
                const timeoutPromise = new Promise((_, reject) => {
                    timeoutReject = (error) => {
                        timedOut = true;
                        reject(error);
                    };
                });
                response.setRequestTimeoutMsChangeHandler((timeoutSeconds) => {
                    setRequestTimeoutSeconds(timeoutSeconds);
                });
                setRequestTimeoutSeconds(configuration.getRequestTimeoutMs?.());
                /** @type {Promise<void> | undefined} */
                let resolvePromise;
                const runResolvedRequest = async () => {
                    resolvePromise = routesResolver.resolve();
                    // Keep Promise.race here to allow dynamic timeout updates.
                    await Promise.race([resolvePromise, timeoutPromise]);
                    await this.logger.debug(() => ["Routes resolver done", {
                            httpMethod: request.httpMethod(),
                            path: loggedPath,
                            responseStatusCode: response.getStatusCode(),
                            hasFilePath: Boolean(response.getFilePath()),
                            bodyType: responseBodyTypeForLog(response)
                        }]);
                };
                try {
                    const requestTimeZone = request.header(REQUEST_TIME_ZONE_HEADER);
                    if (requestTimeZone !== undefined && requestTimeZone !== null) {
                        await configuration.runWithTimezone(requestTimeZone, runResolvedRequest);
                    }
                    else {
                        await runResolvedRequest();
                    }
                }
                catch (error) {
                    if (timedOut && resolvePromise) {
                        void resolvePromise.catch((resolveError) => {
                            const safeResolveError = redactor.redactError(ensureError(resolveError), sensitiveValues);
                            this.logger.warn(() => ["Request finished after timeout", safeResolveError]);
                        });
                    }
                    throw error;
                }
                finally {
                    if (timeoutId)
                        clearTimeout(timeoutId);
                }
            }
        }
        catch (e) {
            const error = ensureError(e);
            const errorWithContext = /** @type {{velociousContext?: object}} */ (error);
            const errorContext = errorWithContext.velociousContext || { stage: "request-runner" };
            const logDetails = requestErrorLogDetails(error);
            const redactedLogDetails = {
                cleanedBacktrace: logDetails.cleanedBacktrace
                    ? redactor.redactString(logDetails.cleanedBacktrace, sensitiveValues)
                    : undefined,
                errorSummary: redactor.redactString(logDetails.errorSummary, sensitiveValues)
            };
            await this.logger.error(() => requestErrorLogMessage(redactedLogDetails));
            const errorPayload = {
                context: redactor.redactStructured(errorContext, sensitiveValues),
                error: redactor.redactError(error, sensitiveValues),
                request,
                response
            };
            configuration.getErrorEvents().emit("framework-error", errorPayload);
            configuration.getErrorEvents().emit("all-error", {
                ...errorPayload,
                errorType: "framework-error"
            });
            response.setStatus(500);
            try {
                response.setErrorBody(error);
            }
            catch (responseError) {
                if (!(responseError instanceof HttpResponseBodyTooLargeError))
                    throw responseError;
                response.setBody("");
            }
        }
        await this.logger.debug(() => ["Request runner done", {
                httpMethod: request.httpMethod(),
                path: loggedPath,
                responseStatusCode: response.getStatusCode()
            }]);
        this.state = "done";
        this.events.emit("done", this);
    }
    /**
     * Runs log completed request.
     * @returns {Promise<void>} - Logs the completed request line after the response has been served.
     */
    async logCompletedRequest() {
        if (this.completedRequestLogged)
            return;
        this.completedRequestLogged = true;
        const requestTiming = this.requestTiming;
        requestTiming.markResponseServed();
        if (!requestTiming.completedLogSubject || !requestTiming.completedLogMethod)
            return;
        const logger = new Logger(requestTiming.completedLogSubject, { configuration: this.configuration });
        const summary = requestTiming.summary();
        const response = this.response;
        const completedMessage = [
            `Completed ${response.getStatusCode()} ${response.getStatusMessage()} in ${Math.round(summary.totalMs)}ms (`,
            `Controller: ${formatBucketMs(summary.controllerMs)}`,
            ` | Views: ${formatBucketMs(summary.viewsMs)}`,
            ` | DB: ${formatBucketMs(summary.dbMs)} (${queryCountLabel(summary.dbQueryCount)})`,
            ` | Velocious: ${formatBucketMs(summary.velociousMs)}`,
            `)`
        ].join("");
        await logger[requestTiming.completedLogMethod](completedMessage);
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicmVxdWVzdC1ydW5uZXIuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvaHR0cC1zZXJ2ZXIvY2xpZW50L3JlcXVlc3QtcnVubmVyLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLEVBQUMsV0FBVyxFQUFDLE1BQU0sU0FBUyxDQUFBO0FBQ25DLE9BQU8sZ0JBQWdCLE1BQU0sdUNBQXVDLENBQUE7QUFDcEUsT0FBTyxZQUFZLE1BQU0sOEJBQThCLENBQUE7QUFDdkQsT0FBTyxFQUFDLDZCQUE2QixFQUFDLE1BQU0sYUFBYSxDQUFBO0FBQ3pELE9BQU8sTUFBTSxNQUFNLGlCQUFpQixDQUFBO0FBQ3BDLE9BQU8sYUFBYSxNQUFNLHFCQUFxQixDQUFBO0FBQy9DLE9BQU8sUUFBUSxNQUFNLGVBQWUsQ0FBQTtBQUNwQyxPQUFPLGNBQWMsTUFBTSwwQkFBMEIsQ0FBQTtBQUNyRCxPQUFPLEVBQUMsd0JBQXdCLEVBQUMsTUFBTSxvQkFBb0IsQ0FBQTtBQUUzRDs7OztHQUlHO0FBQ0gsU0FBUyxjQUFjLENBQUMsSUFBSTtJQUMxQixJQUFJLENBQUMsSUFBSTtRQUFFLE9BQU8sS0FBSyxDQUFBO0lBRXZCLE9BQU8sU0FBUyxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsSUFBSSxFQUFFLENBQUMsQ0FBQTtBQUNwQyxDQUFDO0FBRUQ7Ozs7O0dBS0c7QUFDSCxTQUFTLG1CQUFtQixDQUFDLEtBQUssRUFBRSxzQkFBc0I7SUFDeEQsTUFBTSxXQUFXLEdBQUcsc0JBQXNCLEVBQUUsS0FBSyxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsQ0FBQyxFQUFFLElBQUksRUFBRSxDQUFBO0lBRWxFLElBQUksV0FBVyxJQUFJLENBQUMsY0FBYyxDQUFDLFdBQVcsQ0FBQztRQUFFLE9BQU8sV0FBVyxDQUFBO0lBRW5FLE1BQU0sU0FBUyxHQUFHLE9BQU8sNENBQTRDLENBQUMsQ0FBQyxLQUFLLENBQUMsQ0FBQyxJ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bXBvcnQge2Vuc3VyZUVycm9yfSBmcm9tIFwidHlwYW5pY1wiXG5pbXBvcnQgQmFja3RyYWNlQ2xlYW5lciBmcm9tIFwiLi4vLi4vdXRpbHMvYmFja3RyYWNlLWNsZWFuZXItbm9kZS5qc1wiXG5pbXBvcnQgRXZlbnRFbWl0dGVyIGZyb20gXCIuLi8uLi91dGlscy9ldmVudC1lbWl0dGVyLmpzXCJcbmltcG9ydCB7SHR0cFJlc3BvbnNlQm9keVRvb0xhcmdlRXJyb3J9IGZyb20gXCIuL2Vycm9ycy5qc1wiXG5pbXBvcnQgTG9nZ2VyIGZyb20gXCIuLi8uLi9sb2dnZXIuanNcIlxuaW1wb3J0IFJlcXVlc3RUaW1pbmcgZnJvbSBcIi4vcmVxdWVzdC10aW1pbmcuanNcIlxuaW1wb3J0IFJlc3BvbnNlIGZyb20gXCIuL3Jlc3BvbnNlLmpzXCJcbmltcG9ydCBSb3V0ZXNSZXNvbHZlciBmcm9tIFwiLi4vLi4vcm91dGVzL3Jlc29sdmVyLmpzXCJcbmltcG9ydCB7UkVRVUVTVF9USU1FX1pPTkVfSEVBREVSfSBmcm9tIFwiLi4vLi4vdGltZS16b25lLmpzXCJcblxuLyoqXG4gKiBSdW5zIHN0YWNrIGZyYW1lIGxpbmUuXG4gKiBAcGFyYW0ge3N0cmluZyB8IHVuZGVmaW5lZH0gbGluZSAtIFBvdGVudGlhbCBoZWFkZXIgbGluZS5cbiAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgdGhlIGxpbmUgaXMgYSBzdGFjayBmcmFtZS5cbiAqL1xuZnVuY3Rpb24gc3RhY2tGcmFtZUxpbmUobGluZSkge1xuICBpZiAoIWxpbmUpIHJldHVybiBmYWxzZVxuXG4gIHJldHVybiAvXmF0XFxzKy91LnRlc3QobGluZS50cmltKCkpXG59XG5cbi8qKlxuICogUnVucyByZXF1ZXN0IGVycm9yIHN1bW1hcnkuXG4gKiBAcGFyYW0ge0Vycm9yfSBlcnJvciAtIEVycm9yIHRvIGZvcm1hdCBmb3IgbG9nZ2luZy5cbiAqIEBwYXJhbSB7c3RyaW5nIHwgdW5kZWZpbmVkfSBjbGVhbmVkU3RhY2tXaXRoSGVhZGVyIC0gQ2xlYW5lZCBzdGFjayB3aXRoIGhlYWRlciBsaW5lLlxuICogQHJldHVybnMge3N0cmluZ30gLSBFcnJvciBzdW1tYXJ5IGxpbmUgd2l0aCB0eXBlIGluZm9ybWF0aW9uLlxuICovXG5mdW5jdGlvbiByZXF1ZXN0RXJyb3JTdW1tYXJ5KGVycm9yLCBjbGVhbmVkU3RhY2tXaXRoSGVhZGVyKSB7XG4gIGNvbnN0IHN0YWNrSGVhZGVyID0gY2xlYW5lZFN0YWNrV2l0aEhlYWRlcj8uc3BsaXQoXCJcXG5cIilbMF0/LnRyaW0oKVxuXG4gIGlmIChzdGFja0hlYWRlciAmJiAhc3RhY2tGcmFtZUxpbmUoc3RhY2tIZWFkZXIpKSByZXR1cm4gc3RhY2tIZWFkZXJcblxuICBjb25zdCBlcnJvckNvZGUgPSB0eXBlb2YgLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi8gKGVycm9yKS5jb2RlID09PSBcInN0cmluZ1wiXG4gICAgPyAvKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqLyAoZXJyb3IpLmNvZGVcbiAgICA6IHVuZGVmaW5lZFxuICBjb25zdCBlcnJvck1lc3NhZ2UgPSBlcnJvci5tZXNzYWdlIHx8IFN0cmluZyhlcnJvcilcblxuICBpZiAoZXJyb3JDb2RlKSByZXR1cm4gYCR7ZXJyb3IubmFtZX0gWyR7ZXJyb3JDb2RlfV06ICR7ZXJyb3JNZXNzYWdlfWBcblxuICByZXR1cm4gYCR7ZXJyb3IubmFtZX06ICR7ZXJyb3JNZXNzYWdlfWBcbn1cblxuLyoqXG4gKiBSdW5zIHJlcXVlc3QgZXJyb3IgbG9nIGRldGFpbHMuXG4gKiBAcGFyYW0ge0Vycm9yfSBlcnJvciAtIEVycm9yIHRvIGZvcm1hdCBmb3IgbG9nZ2luZy5cbiAqIEByZXR1cm5zIHt7XG4gKiAgIGVycm9yU3VtbWFyeTogc3RyaW5nLFxuICogICBjbGVhbmVkQmFja3RyYWNlOiBzdHJpbmcgfCB1bmRlZmluZWQsXG4gKiB9fSAtIExvZyBkZXRhaWxzLlxuICovXG5mdW5jdGlvbiByZXF1ZXN0RXJyb3JMb2dEZXRhaWxzKGVycm9yKSB7XG4gIGNvbnN0IGNsZWFuZWRTdGFja1dpdGhIZWFkZXIgPSBCYWNrdHJhY2VDbGVhbmVyLmdldENsZWFuZWRTdGFjayhlcnJvcilcbiAgY29uc3QgZXJyb3JTdW1tYXJ5ID0gcmVxdWVzdEVycm9yU3VtbWFyeShlcnJvciwgY2xlYW5lZFN0YWNrV2l0aEhlYWRlcilcbiAgY29uc3QgY2xlYW5lZEJhY2t0cmFjZSA9IEJhY2t0cmFjZUNsZWFuZXIuZ2V0Q2xlYW5lZFN0YWNrKGVycm9yLCB7aW5jbHVkZUVycm9ySGVhZGVyOiBmYWxzZX0pIHx8IGNsZWFuZWRTdGFja1dpdGhIZWFkZXJcblxuICByZXR1cm4ge2Vycm9yU3VtbWFyeSwgY2xlYW5lZEJhY2t0cmFjZX1cbn1cblxuLyoqXG4gKiBSdW5zIHJlcXVlc3QgZXJyb3IgbG9nIG1lc3NhZ2UuXG4gKiBAcGFyYW0ge3tcbiAqICAgZXJyb3JTdW1tYXJ5OiBzdHJpbmcsXG4gKiAgIGNsZWFuZWRCYWNrdHJhY2U6IHN0cmluZyB8IHVuZGVmaW5lZCxcbiAqIH19IGxvZ0RldGFpbHMgLSBMb2cgZGV0YWlscy5cbiAqIEByZXR1cm5zIHtzdHJpbmd9IC0gU2luZ2xlIHJlcXVlc3QgZXJyb3IgbG9nIG1lc3NhZ2UuXG4gKi9cbmZ1bmN0aW9uIHJlcXVlc3RFcnJvckxvZ01lc3NhZ2UobG9nRGV0YWlscykge1xuICBpZiAoIWxvZ0RldGFpbHMuY2xlYW5lZEJhY2t0cmFjZSkge1xuICAgIHJldHVybiBgRXJyb3Igd2hpbGUgcnVubmluZyByZXF1ZXN0OiAke2xvZ0RldGFpbHMuZXJyb3JTdW1tYXJ5fWBcbiAgfVxuXG4gIHJldHVybiBgRXJyb3Igd2hpbGUgcnVubmluZyByZXF1ZXN0OiAke2xvZ0RldGFpbHMuZXJyb3JTdW1tYXJ5fVxcbkNsZWFuZWQgYmFja3RyYWNlOlxcbiR7bG9nRGV0YWlscy5jbGVhbmVkQmFja3RyYWNlfWBcbn1cblxuLyoqXG4gKiBSdW5zIHJlc3BvbnNlIGJvZHkgdHlwZSBmb3IgbG9nLlxuICogQHBhcmFtIHtSZXNwb25zZX0gcmVzcG9uc2UgLSBSZXNwb25zZSBvYmplY3QuXG4gKiBAcmV0dXJucyB7c3RyaW5nfSAtIFJlc3BvbnNlIGJvZHkgdHlwZSBmb3IgbG9nZ2luZy5cbiAqL1xuZnVuY3Rpb24gcmVzcG9uc2VCb2R5VHlwZUZvckxvZyhyZXNwb25zZSkge1xuICBpZiAocmVzcG9uc2UuZ2V0RmlsZVBhdGgoKSkgcmV0dXJuIFwiZmlsZVwiXG5cbiAgdHJ5IHtcbiAgICByZXR1cm4gdHlwZW9mIHJlc3BvbnNlLmdldEJvZHkoKVxuICB9IGNhdGNoIHtcbiAgICByZXR1cm4gXCJ1bnNldFwiXG4gIH1cbn1cblxuLyoqXG4gKiBSdW5zIGZvcm1hdCBidWNrZXQgbXMuXG4gKiBAcGFyYW0ge251bWJlcn0gdmFsdWUgLSBNaWxsaXNlY29uZHMuXG4gKiBAcmV0dXJucyB7c3RyaW5nfSAtIEZvcm1hdHRlZCBtaWxsaXNlY29uZHMgd2l0aCBvbmUgZGVjaW1hbCBwbGFjZS5cbiAqL1xuZnVuY3Rpb24gZm9ybWF0QnVja2V0TXModmFsdWUpIHtcbiAgcmV0dXJuIGAke3ZhbHVlLnRvRml4ZWQoMSl9bXNgXG59XG5cbi8qKlxuICogUnVucyBxdWVyeSBjb3VudCBsYWJlbC5cbiAqIEBwYXJhbSB7bnVtYmVyfSBjb3VudCAtIFF1ZXJ5IGNvdW50LlxuICogQHJldHVybnMge3N0cmluZ30gLSBRdWVyeSBjb3VudCBsYWJlbC5cbiAqL1xuZnVuY3Rpb24gcXVlcnlDb3VudExhYmVsKGNvdW50KSB7XG4gIHJldHVybiBgJHtjb3VudH0gJHtjb3VudCA9PT0gMSA/IFwicXVlcnlcIiA6IFwicXVlcmllc1wifWBcbn1cblxuZXhwb3J0IGRlZmF1bHQgY2xhc3MgVmVsb2Npb3VzSHR0cFNlcnZlckNsaWVudFJlcXVlc3RSdW5uZXIge1xuICBldmVudHMgPSBuZXcgRXZlbnRFbWl0dGVyKClcblxuICAvKipcbiAgICogUnVucyBjb25zdHJ1Y3Rvci5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi8uLi9jb25maWd1cmF0aW9uLmpzXCIpLmRlZmF1bHR9IGFyZ3MuY29uZmlndXJhdGlvbiAtIENvbmZpZ3VyYXRpb24gaW5zdGFuY2UuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9yZXF1ZXN0LmpzXCIpLmRlZmF1bHQgfCBpbXBvcnQoXCIuL3dlYnNvY2tldC1yZXF1ZXN0LmpzXCIpLmRlZmF1bHR9IGFyZ3MucmVxdWVzdCAtIFJlcXVlc3Qgb2JqZWN0LlxuICAgKi9cbiAgY29uc3RydWN0b3Ioe2NvbmZpZ3VyYXRpb24sIHJlcXVlc3R9KSB7XG4gICAgaWYgKCFjb25maWd1cmF0aW9uKSB0aHJvdyBuZXcgRXJyb3IoXCJObyBjb25maWd1cmF0aW9uIGdpdmVuXCIpXG4gICAgaWYgKCFyZXF1ZXN0KSB0aHJvdyBuZXcgRXJyb3IoXCJObyByZXF1ZXN0IGdpdmVuXCIpXG5cbiAgICB0aGlzLmxvZ2dlciA9IG5ldyBMb2dnZXIodGhpcylcbiAgICB0aGlzLmNvbmZpZ3VyYXRpb24gPSBjb25maWd1cmF0aW9uXG4gICAgdGhpcy5yZXF1ZXN0ID0gcmVxdWVzdFxuICAgIHRoaXMucmVzcG9uc2UgPSBuZXcgUmVzcG9uc2Uoe2NvbmZpZ3VyYXRpb259KVxuICAgIHRoaXMuY29tcGxldGVkUmVxdWVzdExvZ2dlZCA9IGZhbHNlXG4gICAgdGhpcy5yZXF1ZXN0VGltaW5nID0gbmV3IFJlcXVlc3RUaW1pbmcoKVxuICAgIHRoaXMuc3RhdGUgPSBcInJ1bm5pbmdcIlxuICB9XG5cbiAgZ2V0UmVxdWVzdCgpIHsgcmV0dXJuIHRoaXMucmVxdWVzdCB9XG4gIGdldFN0YXRlKCkgeyByZXR1cm4gdGhpcy5zdGF0ZSB9XG5cbiAgYXN5bmMgcnVuKCkge1xuICAgIHRoaXMucmVxdWVzdFRpbWluZy5zdGFydGVkQXRNcyA9IERhdGUubm93KClcblxuICAgIHJldHVybiBhd2FpdCB0aGlzLmNvbmZpZ3VyYXRpb24ucnVuV2l0aFJlcXVlc3RUaW1pbmcodGhpcy5yZXF1ZXN0VGltaW5nLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCByZWRhY3RvciA9IHRoaXMuY29uZmlndXJhdGlvbi5nZXRMb2dSZWRhY3RvcigpXG4gICAgICBjb25zdCBzZW5zaXRpdmVWYWx1ZXMgPSByZWRhY3Rvci5yZXF1ZXN0U2Vuc2l0aXZlVmFsdWVzKHRoaXMucmVxdWVzdCwgdGhpcy5yZXF1ZXN0VGltaW5nLmdldExvZ1NlbnNpdGl2ZVZhbHVlcygpKVxuXG4gICAgICB0aGlzLnJlcXVlc3RUaW1pbmcucmVnaXN0ZXJMb2dTZW5zaXRpdmVWYWx1ZXMoc2Vuc2l0aXZlVmFsdWVzKVxuXG4gICAgICAvLyBSdW4gdGhlIHdob2xlIHJlcXVlc3QgaW5zaWRlIGFueSBwZXItdGVzdCBzaGFyZWQgY29ubmVjdGlvbiBjb250ZXh0IHNvIGFuXG4gICAgICAvLyBpbi1wcm9jZXNzIGhhbmRsZXIgZXhlY3V0ZXMgb24gdGhlIHRlc3QncyBjb25uZWN0aW9uIChhbmQgb3BlbiB0cmFuc2FjdGlvbikuXG4gICAgICAvLyBObyBzaGFyZWQgY29ubmVjdGlvbiBpcyBzZXQgb3V0c2lkZSB0ZXN0cyAvIGluIHdvcmtlciB0aHJlYWRzLCBzbyB0aGlzIGlzIGFcbiAgICAgIC8vIG5vLW9wIHRoZXJlLlxuICAgICAgYXdhaXQgdGhpcy5jb25maWd1cmF0aW9uLnJ1bldpdGhUZXN0U2hhcmVkQ29ubmVjdGlvbkNvbnRleHRzKGFzeW5jICgpID0+IHtcbiAgICAgICAgYXdhaXQgdGhpcy5fcnVuKClcbiAgICAgIH0pXG4gICAgfSlcbiAgfVxuXG4gIGFzeW5jIF9ydW4oKSB7XG4gICAgY29uc3Qge2NvbmZpZ3VyYXRpb24sIHJlcXVlc3QsIHJlc3BvbnNlfSA9IHRoaXNcblxuICAgIGlmICghcmVxdWVzdCkgdGhyb3cgbmV3IEVycm9yKFwiTm8gcmVxdWVzdD9cIilcblxuICAgIGNvbnN0IHJlZGFjdG9yID0gY29uZmlndXJhdGlvbi5nZXRMb2dSZWRhY3RvcigpXG4gICAgY29uc3Qgc2Vuc2l0aXZlVmFsdWVzID0gdGhpcy5yZXF1ZXN0VGltaW5nLmdldExvZ1NlbnNpdGl2ZVZhbHVlcygpXG4gICAgY29uc3QgbG9nZ2VkUGF0aCA9IHJlZGFjdG9yLnJlZGFjdFBhdGgocmVxdWVzdC5wYXRoKCksIHNlbnNpdGl2ZVZhbHVlcylcblxuICAgIHRyeSB7XG4gICAgICBhd2FpdCB0aGlzLmxvZ2dlci5kZWJ1ZygoKSA9PiBbXCJSdW4gcmVxdWVzdCBsaWZlY3ljbGVcIiwge1xuICAgICAgICBodHRwTWV0aG9kOiByZXF1ZXN0Lmh0dHBNZXRob2QoKSxcbiAgICAgICAgaHR0cFZlcnNpb246IHJlcXVlc3QuaHR0cFZlcnNpb24oKSxcbiAgICAgICAgb3JpZ2luOiByZXF1ZXN0Lm9yaWdpbigpLFxuICAgICAgICBwYXRoOiBsb2dnZWRQYXRoLFxuICAgICAgICByZW1vdGVBZGRyZXNzOiByZXF1ZXN0LnJlbW90ZUFkZHJlc3MoKVxuICAgICAgfV0pXG4gICAgICAvLyBCZWZvcmUgd2UgY2hlY2tlZCBpZiB0aGUgc2VjLWZldGNoLW1vZGUgd2FzIFwiY29yc1wiLCBidXQgaXQgc2VlbXMgdGhlIHNlYy1mZXRjaC1tb2RlIGlzbid0IGFsd2F5cyBwcmVzZW50XG4gICAgICBhd2FpdCB0aGlzLmxvZ2dlci5kZWJ1ZygoKSA9PiBbXCJSdW4gQ09SU1wiLCB7aHR0cE1ldGhvZDogcmVxdWVzdC5odHRwTWV0aG9kKCksIHNlY0ZldGNoTW9kZTogcmVxdWVzdC5oZWFkZXIoXCJzZWMtZmV0Y2gtbW9kZVwiKX1dKVxuXG4gICAgICBjb25zdCBjb3JzID0gY29uZmlndXJhdGlvbi5nZXRDb3JzKClcblxuICAgICAgaWYgKGNvcnMpIHtcbiAgICAgICAgYXdhaXQgY29ycyh7cmVxdWVzdCwgcmVzcG9uc2V9KVxuICAgICAgICBhd2FpdCB0aGlzLmxvZ2dlci5kZWJ1ZygoKSA9PiBbXCJDT1JTIGhhbmRsZXIgZG9uZVwiLCB7XG4gICAgICAgICAgaHR0cE1ldGhvZDogcmVxdWVzdC5odHRwTWV0aG9kKCksXG4gICAgICAgICAgcGF0aDogbG9nZ2VkUGF0aCxcbiAgICAgICAgICByZXNwb25zZVN0YXR1c0NvZGU6IHJlc3BvbnNlLmdldFN0YXR1c0NvZGUoKVxuICAgICAgICB9XSlcbiAgICAgIH1cblxuICAgICAgaWYgKHJlcXVlc3QuaHR0cE1ldGhvZCgpID09IFwiT1BUSU9OU1wiICYmIHJlcXVlc3QuaGVhZGVyKFwic2VjLWZldGNoLW1vZGVcIikgPT0gXCJjb3JzXCIpIHtcbiAgICAgICAgcmVzcG9uc2Uuc2V0U3RhdHVzKDIwMClcbiAgICAgICAgcmVzcG9uc2Uuc2V0Qm9keShcIlwiKVxuICAgICAgICBhd2FpdCB0aGlzLmxvZ2dlci5kZWJ1ZygoKSA9PiBbXCJIYW5kbGVkIHByZWZsaWdodCBPUFRJT05TIHJlcXVlc3RcIiwge1xuICAgICAgICAgIHBhdGg6IGxvZ2dlZFBhdGgsXG4gICAgICAgICAgcmVzcG9uc2VTdGF0dXNDb2RlOiByZXNwb25zZS5nZXRTdGF0dXNDb2RlKClcbiAgICAgICAgfV0pXG4gICAgICB9IGVsc2Uge1xuICAgICAgICBhd2FpdCB0aGlzLmxvZ2dlci5kZWJ1ZyhcIlJ1biByZXF1ZXN0XCIpXG4gICAgICAgIGNvbnN0IHJvdXRlc1Jlc29sdmVyID0gbmV3IFJvdXRlc1Jlc29sdmVyKHtjb25maWd1cmF0aW9uLCByZXF1ZXN0LCByZXNwb25zZX0pXG4gICAgICAgIGNvbnN0IHN0YXJ0VGltZU1zID0gRGF0ZS5ub3coKVxuICAgICAgICAvKipcbiAgICAgICAgICogRGVmaW5lcyB0aW1lb3V0SWQuXG4gICAgICAgICAqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBzZXRUaW1lb3V0PiB8IHVuZGVmaW5lZH0gKi9cbiAgICAgICAgbGV0IHRpbWVvdXRJZFxuICAgICAgICAvKipcbiAgICAgICAgICogRGVmaW5lcyB0aW1lb3V0UmVqZWN0LlxuICAgICAgICAgKiBAdHlwZSB7KChlcnJvcjogRXJyb3IpID0+IHZvaWQpIHwgdW5kZWZpbmVkfSAqL1xuICAgICAgICBsZXQgdGltZW91dFJlamVjdFxuICAgICAgICBsZXQgdGltZWRPdXQgPSBmYWxzZVxuXG4gICAgICAgIGNvbnN0IHNldFJlcXVlc3RUaW1lb3V0U2Vjb25kcyA9ICgvKiogQHR5cGUge251bWJlciB8IHVuZGVmaW5lZH0gKi8gdGltZW91dFNlY29uZHMpID0+IHtcbiAgICAgICAgICBpZiAodGltZW91dElkKSB7XG4gICAgICAgICAgICBjbGVhclRpbWVvdXQodGltZW91dElkKVxuICAgICAgICAgICAgdGltZW91dElkID0gdW5kZWZpbmVkXG4gICAgICAgICAgfVxuXG4gICAgICAgICAgaWYgKHR5cGVvZiB0aW1lb3V0U2Vjb25kcyAhPT0gXCJudW1iZXJcIiB8fCAhTnVtYmVyLmlzRmluaXRlKHRpbWVvdXRTZWNvbmRzKSB8fCB0aW1lb3V0U2Vjb25kcyA8PSAwKSB7XG4gICAgICAgICAgICByZXR1cm5cbiAgICAgICAgICB9XG5cbiAgICAgICAgICBjb25zdCB0aW1lb3V0TXMgPSB0aW1lb3V0U2Vjb25kcyAqIDEwMDBcbiAgICAgICAgICBjb25zdCBlbGFwc2VkTXMgPSBEYXRlLm5vdygpIC0gc3RhcnRUaW1lTXNcbiAgICAgICAgICBjb25zdCByZW1haW5pbmdNcyA9IHRpbWVvdXRNcyAtIGVsYXBzZWRNc1xuXG4gICAgICAgICAgaWYgKHJlbWFpbmluZ01zIDw9IDApIHtcbiAgICAgICAgICAgIHRpbWVvdXRSZWplY3Q/LihuZXcgRXJyb3IoYFJlcXVlc3QgdGltZWQgb3V0IGFmdGVyICR7dGltZW91dFNlY29uZHN9c2ApKVxuICAgICAgICAgICAgcmV0dXJuXG4gICAgICAgICAgfVxuXG4gICAgICAgICAgdGltZW91dElkID0gc2V0VGltZW91dCgoKSA9PiB7XG4gICAgICAgICAgICB0aW1lb3V0UmVqZWN0Py4obmV3IEVycm9yKGBSZXF1ZXN0IHRpbWVkIG91dCBhZnRlciAke3RpbWVvdXRTZWNvbmRzfXNgKSlcbiAgICAgICAgICB9LCByZW1haW5pbmdNcylcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IHRpbWVvdXRQcm9taXNlID0gbmV3IFByb21pc2UoKF8sIHJlamVjdCkgPT4ge1xuICAgICAgICAgIHRpbWVvdXRSZWplY3QgPSAoZXJyb3IpID0+IHtcbiAgICAgICAgICAgIHRpbWVkT3V0ID0gdHJ1ZVxuICAgICAgICAgICAgcmVqZWN0KGVycm9yKVxuICAgICAgICAgIH1cbiAgICAgICAgfSlcblxuICAgICAgICByZXNwb25zZS5zZXRSZXF1ZXN0VGltZW91dE1zQ2hhbmdlSGFuZGxlcigodGltZW91dFNlY29uZHMpID0+IHtcbiAgICAgICAgICBzZXRSZXF1ZXN0VGltZW91dFNlY29uZHModGltZW91dFNlY29uZHMpXG4gICAgICAgIH0pXG5cbiAgICAgICAgc2V0UmVxdWVzdFRpbWVvdXRTZWNvbmRzKGNvbmZpZ3VyYXRpb24uZ2V0UmVxdWVzdFRpbWVvdXRNcz8uKCkpXG5cbiAgICAgICAgLyoqIEB0eXBlIHtQcm9taXNlPHZvaWQ+IHwgdW5kZWZpbmVkfSAqL1xuICAgICAgICBsZXQgcmVzb2x2ZVByb21pc2VcblxuICAgICAgICBjb25zdCBydW5SZXNvbHZlZFJlcXVlc3QgPSBhc3luYyAoKSA9PiB7XG4gICAgICAgICAgcmVzb2x2ZVByb21pc2UgPSByb3V0ZXNSZXNvbHZlci5yZXNvbHZlKClcbiAgICAgICAgICAvLyBLZWVwIFByb21pc2UucmFjZSBoZXJlIHRvIGFsbG93IGR5bmFtaWMgdGltZW91dCB1cGRhdGVzLlxuICAgICAgICAgIGF3YWl0IFByb21pc2UucmFjZShbcmVzb2x2ZVByb21pc2UsIHRpbWVvdXRQcm9taXNlXSlcbiAgICAgICAgICBhd2FpdCB0aGlzLmxvZ2dlci5kZWJ1ZygoKSA9PiBbXCJSb3V0ZXMgcmVzb2x2ZXIgZG9uZVwiLCB7XG4gICAgICAgICAgICBodHRwTWV0aG9kOiByZXF1ZXN0Lmh0dHBNZXRob2QoKSxcbiAgICAgICAgICAgIHBhdGg6IGxvZ2dlZFBhdGgsXG4gICAgICAgICAgICByZXNwb25zZVN0YXR1c0NvZGU6IHJlc3BvbnNlLmdldFN0YXR1c0NvZGUoKSxcbiAgICAgICAgICAgIGhhc0ZpbGVQYXRoOiBCb29sZWFuKHJlc3BvbnNlLmdldEZpbGVQYXRoKCkpLFxuICAgICAgICAgICAgYm9keVR5cGU6IHJlc3BvbnNlQm9keVR5cGVGb3JMb2cocmVzcG9uc2UpXG4gICAgICAgICAgfV0pXG4gICAgICAgIH1cblxuICAgICAgICB0cnkge1xuICAgICAgICAgIGNvbnN0IHJlcXVlc3RUaW1lWm9uZSA9IHJlcXVlc3QuaGVhZGVyKFJFUVVFU1RfVElNRV9aT05FX0hFQURFUilcblxuICAgICAgICAgIGlmIChyZXF1ZXN0VGltZVpvbmUgIT09IHVuZGVmaW5lZCAmJiByZXF1ZXN0VGltZVpvbmUgIT09IG51bGwpIHtcbiAgICAgICAgICAgIGF3YWl0IGNvbmZpZ3VyYXRpb24ucnVuV2l0aFRpbWV6b25lKHJlcXVlc3RUaW1lWm9uZSwgcnVuUmVzb2x2ZWRSZXF1ZXN0KVxuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBhd2FpdCBydW5SZXNvbHZlZFJlcXVlc3QoKVxuICAgICAgICAgIH1cbiAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICBpZiAodGltZWRPdXQgJiYgcmVzb2x2ZVByb21pc2UpIHtcbiAgICAgICAgICAgIHZvaWQgcmVzb2x2ZVByb21pc2UuY2F0Y2goKHJlc29sdmVFcnJvcikgPT4ge1xuICAgICAgICAgICAgICBjb25zdCBzYWZlUmVzb2x2ZUVycm9yID0gcmVkYWN0b3IucmVkYWN0RXJyb3IoZW5zdXJlRXJyb3IocmVzb2x2ZUVycm9yKSwgc2Vuc2l0aXZlVmFsdWVzKVxuXG4gICAgICAgICAgICAgIHRoaXMubG9nZ2VyLndhcm4oKCkgPT4gW1wiUmVxdWVzdCBmaW5pc2hlZCBhZnRlciB0aW1lb3V0XCIsIHNhZmVSZXNvbHZlRXJyb3JdKVxuICAgICAgICAgICAgfSlcbiAgICAgICAgICB9XG4gICAgICAgICAgdGhyb3cgZXJyb3JcbiAgICAgICAgfSBmaW5hbGx5IHtcbiAgICAgICAgICBpZiAodGltZW91dElkKSBjbGVhclRpbWVvdXQodGltZW91dElkKVxuICAgICAgICB9XG4gICAgICB9XG4gICAgfSBjYXRjaCAoZSkge1xuICAgICAgY29uc3QgZXJyb3IgPSBlbnN1cmVFcnJvcihlKVxuICAgICAgY29uc3QgZXJyb3JXaXRoQ29udGV4dCA9IC8qKiBAdHlwZSB7e3ZlbG9jaW91c0NvbnRleHQ/OiBvYmplY3R9fSAqLyAoZXJyb3IpXG4gICAgICBjb25zdCBlcnJvckNvbnRleHQgPSBlcnJvcldpdGhDb250ZXh0LnZlbG9jaW91c0NvbnRleHQgfHwge3N0YWdlOiBcInJlcXVlc3QtcnVubmVyXCJ9XG4gICAgICBjb25zdCBsb2dEZXRhaWxzID0gcmVxdWVzdEVycm9yTG9nRGV0YWlscyhlcnJvcilcbiAgICAgIGNvbnN0IHJlZGFjdGVkTG9nRGV0YWlscyA9IHtcbiAgICAgICAgY2xlYW5lZEJhY2t0cmFjZTogbG9nRGV0YWlscy5jbGVhbmVkQmFja3RyYWNlXG4gICAgICAgICAgPyByZWRhY3Rvci5yZWRhY3RTdHJpbmcobG9nRGV0YWlscy5jbGVhbmVkQmFja3RyYWNlLCBzZW5zaXRpdmVWYWx1ZXMpXG4gICAgICAgICAgOiB1bmRlZmluZWQsXG4gICAgICAgIGVycm9yU3VtbWFyeTogcmVkYWN0b3IucmVkYWN0U3RyaW5nKGxvZ0RldGFpbHMuZXJyb3JTdW1tYXJ5LCBzZW5zaXRpdmVWYWx1ZXMpXG4gICAgICB9XG5cbiAgICAgIGF3YWl0IHRoaXMubG9nZ2VyLmVycm9yKCgpID0+IHJlcXVlc3RFcnJvckxvZ01lc3NhZ2UocmVkYWN0ZWRMb2dEZXRhaWxzKSlcblxuICAgICAgY29uc3QgZXJyb3JQYXlsb2FkID0ge1xuICAgICAgICBjb250ZXh0OiByZWRhY3Rvci5yZWRhY3RTdHJ1Y3R1cmVkKGVycm9yQ29udGV4dCwgc2Vuc2l0aXZlVmFsdWVzKSxcbiAgICAgICAgZXJyb3I6IHJlZGFjdG9yLnJlZGFjdEVycm9yKGVycm9yLCBzZW5zaXRpdmVWYWx1ZXMpLFxuICAgICAgICByZXF1ZXN0LFxuICAgICAgICByZXNwb25zZVxuICAgICAgfVxuXG4gICAgICBjb25maWd1cmF0aW9uLmdldEVycm9yRXZlbnRzKCkuZW1pdChcImZyYW1ld29yay1lcnJvclwiLCBlcnJvclBheWxvYWQpXG4gICAgICBjb25maWd1cmF0aW9uLmdldEVycm9yRXZlbnRzKCkuZW1pdChcImFsbC1lcnJvclwiLCB7XG4gICAgICAgIC4uLmVycm9yUGF5bG9hZCxcbiAgICAgICAgZXJyb3JUeXBlOiBcImZyYW1ld29yay1lcnJvclwiXG4gICAgICB9KVxuXG4gICAgICByZXNwb25zZS5zZXRTdGF0dXMoNTAwKVxuICAgICAgdHJ5IHtcbiAgICAgICAgcmVzcG9uc2Uuc2V0RXJyb3JCb2R5KGVycm9yKVxuICAgICAgfSBjYXRjaCAocmVzcG9uc2VFcnJvcikge1xuICAgICAgICBpZiAoIShyZXNwb25zZUVycm9yIGluc3RhbmNlb2YgSHR0cFJlc3BvbnNlQm9keVRvb0xhcmdlRXJyb3IpKSB0aHJvdyByZXNwb25zZUVycm9yXG5cbiAgICAgICAgcmVzcG9uc2Uuc2V0Qm9keShcIlwiKVxuICAgICAgfVxuICAgIH1cblxuICAgIGF3YWl0IHRoaXMubG9nZ2VyLmRlYnVnKCgpID0+IFtcIlJlcXVlc3QgcnVubmVyIGRvbmVcIiwge1xuICAgICAgaHR0cE1ldGhvZDogcmVxdWVzdC5odHRwTWV0aG9kKCksXG4gICAgICBwYXRoOiBsb2dnZWRQYXRoLFxuICAgICAgcmVzcG9uc2VTdGF0dXNDb2RlOiByZXNwb25zZS5nZXRTdGF0dXNDb2RlKClcbiAgICB9XSlcbiAgICB0aGlzLnN0YXRlID0gXCJkb25lXCJcbiAgICB0aGlzLmV2ZW50cy5lbWl0KFwiZG9uZVwiLCB0aGlzKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbG9nIGNvbXBsZXRlZCByZXF1ZXN0LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBMb2dzIHRoZSBjb21wbGV0ZWQgcmVxdWVzdCBsaW5lIGFmdGVyIHRoZSByZXNwb25zZSBoYXMgYmVlbiBzZXJ2ZWQuXG4gICAqL1xuICBhc3luYyBsb2dDb21wbGV0ZWRSZXF1ZXN0KCkge1xuICAgIGlmICh0aGlzLmNvbXBsZXRlZFJlcXVlc3RMb2dnZWQpIHJldHVyblxuXG4gICAgdGhpcy5jb21wbGV0ZWRSZXF1ZXN0TG9nZ2VkID0gdHJ1ZVxuXG4gICAgY29uc3QgcmVxdWVzdFRpbWluZyA9IHRoaXMucmVxdWVzdFRpbWluZ1xuXG4gICAgcmVxdWVzdFRpbWluZy5tYXJrUmVzcG9uc2VTZXJ2ZWQoKVxuXG4gICAgaWYgKCFyZXF1ZXN0VGltaW5nLmNvbXBsZXRlZExvZ1N1YmplY3QgfHwgIXJlcXVlc3RUaW1pbmcuY29tcGxldGVkTG9nTWV0aG9kKSByZXR1cm5cblxuICAgIGNvbnN0IGxvZ2dlciA9IG5ldyBMb2dnZXIocmVxdWVzdFRpbWluZy5jb21wbGV0ZWRMb2dTdWJqZWN0LCB7Y29uZmlndXJhdGlvbjogdGhpcy5jb25maWd1cmF0aW9ufSlcbiAgICBjb25zdCBzdW1tYXJ5ID0gcmVxdWVzdFRpbWluZy5zdW1tYXJ5KClcbiAgICBjb25zdCByZXNwb25zZSA9IHRoaXMucmVzcG9uc2VcbiAgICBjb25zdCBjb21wbGV0ZWRNZXNzYWdlID0gW1xuICAgICAgYENvbXBsZXRlZCAke3Jlc3BvbnNlLmdldFN0YXR1c0NvZGUoKX0gJHtyZXNwb25zZS5nZXRTdGF0dXNNZXNzYWdlKCl9IGluICR7TWF0aC5yb3VuZChzdW1tYXJ5LnRvdGFsTXMpfW1zIChgLFxuICAgICAgYENvbnRyb2xsZXI6ICR7Zm9ybWF0QnVja2V0TXMoc3VtbWFyeS5jb250cm9sbGVyTXMpfWAsXG4gICAgICBgIHwgVmlld3M6ICR7Zm9ybWF0QnVja2V0TXMoc3VtbWFyeS52aWV3c01zKX1gLFxuICAgICAgYCB8IERCOiAke2Zvcm1hdEJ1Y2tldE1zKHN1bW1hcnkuZGJNcyl9ICgke3F1ZXJ5Q291bnRMYWJlbChzdW1tYXJ5LmRiUXVlcnlDb3VudCl9KWAsXG4gICAgICBgIHwgVmVsb2Npb3VzOiAke2Zvcm1hdEJ1Y2tldE1zKHN1bW1hcnkudmVsb2Npb3VzTXMpfWAsXG4gICAgICBgKWBcbiAgICBdLmpvaW4oXCJcIilcblxuICAgIGF3YWl0IGxvZ2dlcltyZXF1ZXN0VGltaW5nLmNvbXBsZXRlZExvZ01ldGhvZF0oY29tcGxldGVkTWVzc2FnZSlcbiAgfVxufVxuIl19