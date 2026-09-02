// @ts-check
import { ensureError } from "typanic";
import BacktraceCleaner from "../../utils/backtrace-cleaner-node.js";
import EventEmitter from "../../utils/event-emitter.js";
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
            response.setErrorBody(error);
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicmVxdWVzdC1ydW5uZXIuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvaHR0cC1zZXJ2ZXIvY2xpZW50L3JlcXVlc3QtcnVubmVyLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLEVBQUMsV0FBVyxFQUFDLE1BQU0sU0FBUyxDQUFBO0FBQ25DLE9BQU8sZ0JBQWdCLE1BQU0sdUNBQXVDLENBQUE7QUFDcEUsT0FBTyxZQUFZLE1BQU0sOEJBQThCLENBQUE7QUFDdkQsT0FBTyxNQUFNLE1BQU0saUJBQWlCLENBQUE7QUFDcEMsT0FBTyxhQUFhLE1BQU0scUJBQXFCLENBQUE7QUFDL0MsT0FBTyxRQUFRLE1BQU0sZUFBZSxDQUFBO0FBQ3BDLE9BQU8sY0FBYyxNQUFNLDBCQUEwQixDQUFBO0FBQ3JELE9BQU8sRUFBQyx3QkFBd0IsRUFBQyxNQUFNLG9CQUFvQixDQUFBO0FBRTNEOzs7O0dBSUc7QUFDSCxTQUFTLGNBQWMsQ0FBQyxJQUFJO0lBQzFCLElBQUksQ0FBQyxJQUFJO1FBQUUsT0FBTyxLQUFLLENBQUE7SUFFdkIsT0FBTyxTQUFTLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxJQUFJLEVBQUUsQ0FBQyxDQUFBO0FBQ3BDLENBQUM7QUFFRDs7Ozs7R0FLRztBQUNILFNBQVMsbUJBQW1CLENBQUMsS0FBSyxFQUFFLHNCQUFzQjtJQUN4RCxNQUFNLFdBQVcsR0FBRyxzQkFBc0IsRUFBRSxLQUFLLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxDQUFDLEVBQUUsSUFBSSxFQUFFLENBQUE7SUFFbEUsSUFBSSxXQUFXLElBQUksQ0FBQyxjQUFjLENBQUMsV0FBVyxDQUFDO1FBQUUsT0FBTyxXQUFXLENBQUE7SUFFbkUsTUFBTSxTQUFTLEdBQUcsT0FBTyw0Q0FBNEMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxDQUFDLElBQUksS0FBSyxRQUFRO1FBQzdGLENBQUMsQ0FBQyw0Q0FBNEMsQ0FBQyxD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QUFHLElBQUksTUFBTSxDQUFDLGFBQWEsQ0FBQyxtQkFBbUIsRUFBRSxFQUFDLGFBQWEsRUFBRSxJQUFJLENBQUMsYUFBYSxFQUFDLENBQUMsQ0FBQTtRQUNqRyxNQUFNLE9BQU8sR0FBRyxhQUFhLENBQUMsT0FBTyxFQUFFLENBQUE7UUFDdkMsTUFBTSxRQUFRLEdBQUcsSUFBSSxDQUFDLFFBQVEsQ0FBQTtRQUM5QixNQUFNLGdCQUFnQixHQUFHO1lBQ3ZCLGFBQWEsUUFBUSxDQUFDLGFBQWEsRUFBRSxJQUFJLFFBQVEsQ0FBQyxnQkFBZ0IsRUFBRSxPQUFPLElBQUksQ0FBQyxLQUFLLENBQUMsT0FBTyxDQUFDLE9BQU8sQ0FBQyxNQUFNO1lBQzVHLGVBQWUsY0FBYyxDQUFDLE9BQU8sQ0FBQyxZQUFZLENBQUMsRUFBRTtZQUNyRCxhQUFhLGNBQWMsQ0FBQyxPQUFPLENBQUMsT0FBTyxDQUFDLEVBQUU7WUFDOUMsVUFBVSxjQUFjLENBQUMsT0FBTyxDQUFDLElBQUksQ0FBQyxLQUFLLGVBQWUsQ0FBQyxPQUFPLENBQUMsWUFBWSxDQUFDLEdBQUc7WUFDbkYsaUJBQWlCLGNBQWMsQ0FBQyxPQUFPLENBQUMsV0FBVyxDQUFDLEVBQUU7WUFDdEQsR0FBRztTQUNKLENBQUMsSUFBSSxDQUFDLEVBQUUsQ0FBQyxDQUFBO1FBRVYsTUFBTSxNQUFNLENBQUMsYUFBYSxDQUFDLGtCQUFrQixDQUFDLENBQUMsZ0JBQWdCLENBQUMsQ0FBQTtJQUNsRSxDQUFDO0NBQ0YiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuaW1wb3J0IHtlbnN1cmVFcnJvcn0gZnJvbSBcInR5cGFuaWNcIlxuaW1wb3J0IEJhY2t0cmFjZUNsZWFuZXIgZnJvbSBcIi4uLy4uL3V0aWxzL2JhY2t0cmFjZS1jbGVhbmVyLW5vZGUuanNcIlxuaW1wb3J0IEV2ZW50RW1pdHRlciBmcm9tIFwiLi4vLi4vdXRpbHMvZXZlbnQtZW1pdHRlci5qc1wiXG5pbXBvcnQgTG9nZ2VyIGZyb20gXCIuLi8uLi9sb2dnZXIuanNcIlxuaW1wb3J0IFJlcXVlc3RUaW1pbmcgZnJvbSBcIi4vcmVxdWVzdC10aW1pbmcuanNcIlxuaW1wb3J0IFJlc3BvbnNlIGZyb20gXCIuL3Jlc3BvbnNlLmpzXCJcbmltcG9ydCBSb3V0ZXNSZXNvbHZlciBmcm9tIFwiLi4vLi4vcm91dGVzL3Jlc29sdmVyLmpzXCJcbmltcG9ydCB7UkVRVUVTVF9USU1FX1pPTkVfSEVBREVSfSBmcm9tIFwiLi4vLi4vdGltZS16b25lLmpzXCJcblxuLyoqXG4gKiBSdW5zIHN0YWNrIGZyYW1lIGxpbmUuXG4gKiBAcGFyYW0ge3N0cmluZyB8IHVuZGVmaW5lZH0gbGluZSAtIFBvdGVudGlhbCBoZWFkZXIgbGluZS5cbiAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgdGhlIGxpbmUgaXMgYSBzdGFjayBmcmFtZS5cbiAqL1xuZnVuY3Rpb24gc3RhY2tGcmFtZUxpbmUobGluZSkge1xuICBpZiAoIWxpbmUpIHJldHVybiBmYWxzZVxuXG4gIHJldHVybiAvXmF0XFxzKy91LnRlc3QobGluZS50cmltKCkpXG59XG5cbi8qKlxuICogUnVucyByZXF1ZXN0IGVycm9yIHN1bW1hcnkuXG4gKiBAcGFyYW0ge0Vycm9yfSBlcnJvciAtIEVycm9yIHRvIGZvcm1hdCBmb3IgbG9nZ2luZy5cbiAqIEBwYXJhbSB7c3RyaW5nIHwgdW5kZWZpbmVkfSBjbGVhbmVkU3RhY2tXaXRoSGVhZGVyIC0gQ2xlYW5lZCBzdGFjayB3aXRoIGhlYWRlciBsaW5lLlxuICogQHJldHVybnMge3N0cmluZ30gLSBFcnJvciBzdW1tYXJ5IGxpbmUgd2l0aCB0eXBlIGluZm9ybWF0aW9uLlxuICovXG5mdW5jdGlvbiByZXF1ZXN0RXJyb3JTdW1tYXJ5KGVycm9yLCBjbGVhbmVkU3RhY2tXaXRoSGVhZGVyKSB7XG4gIGNvbnN0IHN0YWNrSGVhZGVyID0gY2xlYW5lZFN0YWNrV2l0aEhlYWRlcj8uc3BsaXQoXCJcXG5cIilbMF0/LnRyaW0oKVxuXG4gIGlmIChzdGFja0hlYWRlciAmJiAhc3RhY2tGcmFtZUxpbmUoc3RhY2tIZWFkZXIpKSByZXR1cm4gc3RhY2tIZWFkZXJcblxuICBjb25zdCBlcnJvckNvZGUgPSB0eXBlb2YgLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi8gKGVycm9yKS5jb2RlID09PSBcInN0cmluZ1wiXG4gICAgPyAvKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqLyAoZXJyb3IpLmNvZGVcbiAgICA6IHVuZGVmaW5lZFxuICBjb25zdCBlcnJvck1lc3NhZ2UgPSBlcnJvci5tZXNzYWdlIHx8IFN0cmluZyhlcnJvcilcblxuICBpZiAoZXJyb3JDb2RlKSByZXR1cm4gYCR7ZXJyb3IubmFtZX0gWyR7ZXJyb3JDb2RlfV06ICR7ZXJyb3JNZXNzYWdlfWBcblxuICByZXR1cm4gYCR7ZXJyb3IubmFtZX06ICR7ZXJyb3JNZXNzYWdlfWBcbn1cblxuLyoqXG4gKiBSdW5zIHJlcXVlc3QgZXJyb3IgbG9nIGRldGFpbHMuXG4gKiBAcGFyYW0ge0Vycm9yfSBlcnJvciAtIEVycm9yIHRvIGZvcm1hdCBmb3IgbG9nZ2luZy5cbiAqIEByZXR1cm5zIHt7XG4gKiAgIGVycm9yU3VtbWFyeTogc3RyaW5nLFxuICogICBjbGVhbmVkQmFja3RyYWNlOiBzdHJpbmcgfCB1bmRlZmluZWQsXG4gKiB9fSAtIExvZyBkZXRhaWxzLlxuICovXG5mdW5jdGlvbiByZXF1ZXN0RXJyb3JMb2dEZXRhaWxzKGVycm9yKSB7XG4gIGNvbnN0IGNsZWFuZWRTdGFja1dpdGhIZWFkZXIgPSBCYWNrdHJhY2VDbGVhbmVyLmdldENsZWFuZWRTdGFjayhlcnJvcilcbiAgY29uc3QgZXJyb3JTdW1tYXJ5ID0gcmVxdWVzdEVycm9yU3VtbWFyeShlcnJvciwgY2xlYW5lZFN0YWNrV2l0aEhlYWRlcilcbiAgY29uc3QgY2xlYW5lZEJhY2t0cmFjZSA9IEJhY2t0cmFjZUNsZWFuZXIuZ2V0Q2xlYW5lZFN0YWNrKGVycm9yLCB7aW5jbHVkZUVycm9ySGVhZGVyOiBmYWxzZX0pIHx8IGNsZWFuZWRTdGFja1dpdGhIZWFkZXJcblxuICByZXR1cm4ge2Vycm9yU3VtbWFyeSwgY2xlYW5lZEJhY2t0cmFjZX1cbn1cblxuLyoqXG4gKiBSdW5zIHJlcXVlc3QgZXJyb3IgbG9nIG1lc3NhZ2UuXG4gKiBAcGFyYW0ge3tcbiAqICAgZXJyb3JTdW1tYXJ5OiBzdHJpbmcsXG4gKiAgIGNsZWFuZWRCYWNrdHJhY2U6IHN0cmluZyB8IHVuZGVmaW5lZCxcbiAqIH19IGxvZ0RldGFpbHMgLSBMb2cgZGV0YWlscy5cbiAqIEByZXR1cm5zIHtzdHJpbmd9IC0gU2luZ2xlIHJlcXVlc3QgZXJyb3IgbG9nIG1lc3NhZ2UuXG4gKi9cbmZ1bmN0aW9uIHJlcXVlc3RFcnJvckxvZ01lc3NhZ2UobG9nRGV0YWlscykge1xuICBpZiAoIWxvZ0RldGFpbHMuY2xlYW5lZEJhY2t0cmFjZSkge1xuICAgIHJldHVybiBgRXJyb3Igd2hpbGUgcnVubmluZyByZXF1ZXN0OiAke2xvZ0RldGFpbHMuZXJyb3JTdW1tYXJ5fWBcbiAgfVxuXG4gIHJldHVybiBgRXJyb3Igd2hpbGUgcnVubmluZyByZXF1ZXN0OiAke2xvZ0RldGFpbHMuZXJyb3JTdW1tYXJ5fVxcbkNsZWFuZWQgYmFja3RyYWNlOlxcbiR7bG9nRGV0YWlscy5jbGVhbmVkQmFja3RyYWNlfWBcbn1cblxuLyoqXG4gKiBSdW5zIHJlc3BvbnNlIGJvZHkgdHlwZSBmb3IgbG9nLlxuICogQHBhcmFtIHtSZXNwb25zZX0gcmVzcG9uc2UgLSBSZXNwb25zZSBvYmplY3QuXG4gKiBAcmV0dXJucyB7c3RyaW5nfSAtIFJlc3BvbnNlIGJvZHkgdHlwZSBmb3IgbG9nZ2luZy5cbiAqL1xuZnVuY3Rpb24gcmVzcG9uc2VCb2R5VHlwZUZvckxvZyhyZXNwb25zZSkge1xuICBpZiAocmVzcG9uc2UuZ2V0RmlsZVBhdGgoKSkgcmV0dXJuIFwiZmlsZVwiXG5cbiAgdHJ5IHtcbiAgICByZXR1cm4gdHlwZW9mIHJlc3BvbnNlLmdldEJvZHkoKVxuICB9IGNhdGNoIHtcbiAgICByZXR1cm4gXCJ1bnNldFwiXG4gIH1cbn1cblxuLyoqXG4gKiBSdW5zIGZvcm1hdCBidWNrZXQgbXMuXG4gKiBAcGFyYW0ge251bWJlcn0gdmFsdWUgLSBNaWxsaXNlY29uZHMuXG4gKiBAcmV0dXJucyB7c3RyaW5nfSAtIEZvcm1hdHRlZCBtaWxsaXNlY29uZHMgd2l0aCBvbmUgZGVjaW1hbCBwbGFjZS5cbiAqL1xuZnVuY3Rpb24gZm9ybWF0QnVja2V0TXModmFsdWUpIHtcbiAgcmV0dXJuIGAke3ZhbHVlLnRvRml4ZWQoMSl9bXNgXG59XG5cbi8qKlxuICogUnVucyBxdWVyeSBjb3VudCBsYWJlbC5cbiAqIEBwYXJhbSB7bnVtYmVyfSBjb3VudCAtIFF1ZXJ5IGNvdW50LlxuICogQHJldHVybnMge3N0cmluZ30gLSBRdWVyeSBjb3VudCBsYWJlbC5cbiAqL1xuZnVuY3Rpb24gcXVlcnlDb3VudExhYmVsKGNvdW50KSB7XG4gIHJldHVybiBgJHtjb3VudH0gJHtjb3VudCA9PT0gMSA/IFwicXVlcnlcIiA6IFwicXVlcmllc1wifWBcbn1cblxuZXhwb3J0IGRlZmF1bHQgY2xhc3MgVmVsb2Npb3VzSHR0cFNlcnZlckNsaWVudFJlcXVlc3RSdW5uZXIge1xuICBldmVudHMgPSBuZXcgRXZlbnRFbWl0dGVyKClcblxuICAvKipcbiAgICogUnVucyBjb25zdHJ1Y3Rvci5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi8uLi9jb25maWd1cmF0aW9uLmpzXCIpLmRlZmF1bHR9IGFyZ3MuY29uZmlndXJhdGlvbiAtIENvbmZpZ3VyYXRpb24gaW5zdGFuY2UuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9yZXF1ZXN0LmpzXCIpLmRlZmF1bHQgfCBpbXBvcnQoXCIuL3dlYnNvY2tldC1yZXF1ZXN0LmpzXCIpLmRlZmF1bHR9IGFyZ3MucmVxdWVzdCAtIFJlcXVlc3Qgb2JqZWN0LlxuICAgKi9cbiAgY29uc3RydWN0b3Ioe2NvbmZpZ3VyYXRpb24sIHJlcXVlc3R9KSB7XG4gICAgaWYgKCFjb25maWd1cmF0aW9uKSB0aHJvdyBuZXcgRXJyb3IoXCJObyBjb25maWd1cmF0aW9uIGdpdmVuXCIpXG4gICAgaWYgKCFyZXF1ZXN0KSB0aHJvdyBuZXcgRXJyb3IoXCJObyByZXF1ZXN0IGdpdmVuXCIpXG5cbiAgICB0aGlzLmxvZ2dlciA9IG5ldyBMb2dnZXIodGhpcylcbiAgICB0aGlzLmNvbmZpZ3VyYXRpb24gPSBjb25maWd1cmF0aW9uXG4gICAgdGhpcy5yZXF1ZXN0ID0gcmVxdWVzdFxuICAgIHRoaXMucmVzcG9uc2UgPSBuZXcgUmVzcG9uc2Uoe2NvbmZpZ3VyYXRpb259KVxuICAgIHRoaXMuY29tcGxldGVkUmVxdWVzdExvZ2dlZCA9IGZhbHNlXG4gICAgdGhpcy5yZXF1ZXN0VGltaW5nID0gbmV3IFJlcXVlc3RUaW1pbmcoKVxuICAgIHRoaXMuc3RhdGUgPSBcInJ1bm5pbmdcIlxuICB9XG5cbiAgZ2V0UmVxdWVzdCgpIHsgcmV0dXJuIHRoaXMucmVxdWVzdCB9XG4gIGdldFN0YXRlKCkgeyByZXR1cm4gdGhpcy5zdGF0ZSB9XG5cbiAgYXN5bmMgcnVuKCkge1xuICAgIHRoaXMucmVxdWVzdFRpbWluZy5zdGFydGVkQXRNcyA9IERhdGUubm93KClcblxuICAgIHJldHVybiBhd2FpdCB0aGlzLmNvbmZpZ3VyYXRpb24ucnVuV2l0aFJlcXVlc3RUaW1pbmcodGhpcy5yZXF1ZXN0VGltaW5nLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCByZWRhY3RvciA9IHRoaXMuY29uZmlndXJhdGlvbi5nZXRMb2dSZWRhY3RvcigpXG4gICAgICBjb25zdCBzZW5zaXRpdmVWYWx1ZXMgPSByZWRhY3Rvci5yZXF1ZXN0U2Vuc2l0aXZlVmFsdWVzKHRoaXMucmVxdWVzdCwgdGhpcy5yZXF1ZXN0VGltaW5nLmdldExvZ1NlbnNpdGl2ZVZhbHVlcygpKVxuXG4gICAgICB0aGlzLnJlcXVlc3RUaW1pbmcucmVnaXN0ZXJMb2dTZW5zaXRpdmVWYWx1ZXMoc2Vuc2l0aXZlVmFsdWVzKVxuXG4gICAgICAvLyBSdW4gdGhlIHdob2xlIHJlcXVlc3QgaW5zaWRlIGFueSBwZXItdGVzdCBzaGFyZWQgY29ubmVjdGlvbiBjb250ZXh0IHNvIGFuXG4gICAgICAvLyBpbi1wcm9jZXNzIGhhbmRsZXIgZXhlY3V0ZXMgb24gdGhlIHRlc3QncyBjb25uZWN0aW9uIChhbmQgb3BlbiB0cmFuc2FjdGlvbikuXG4gICAgICAvLyBObyBzaGFyZWQgY29ubmVjdGlvbiBpcyBzZXQgb3V0c2lkZSB0ZXN0cyAvIGluIHdvcmtlciB0aHJlYWRzLCBzbyB0aGlzIGlzIGFcbiAgICAgIC8vIG5vLW9wIHRoZXJlLlxuICAgICAgYXdhaXQgdGhpcy5jb25maWd1cmF0aW9uLnJ1bldpdGhUZXN0U2hhcmVkQ29ubmVjdGlvbkNvbnRleHRzKGFzeW5jICgpID0+IHtcbiAgICAgICAgYXdhaXQgdGhpcy5fcnVuKClcbiAgICAgIH0pXG4gICAgfSlcbiAgfVxuXG4gIGFzeW5jIF9ydW4oKSB7XG4gICAgY29uc3Qge2NvbmZpZ3VyYXRpb24sIHJlcXVlc3QsIHJlc3BvbnNlfSA9IHRoaXNcblxuICAgIGlmICghcmVxdWVzdCkgdGhyb3cgbmV3IEVycm9yKFwiTm8gcmVxdWVzdD9cIilcblxuICAgIGNvbnN0IHJlZGFjdG9yID0gY29uZmlndXJhdGlvbi5nZXRMb2dSZWRhY3RvcigpXG4gICAgY29uc3Qgc2Vuc2l0aXZlVmFsdWVzID0gdGhpcy5yZXF1ZXN0VGltaW5nLmdldExvZ1NlbnNpdGl2ZVZhbHVlcygpXG4gICAgY29uc3QgbG9nZ2VkUGF0aCA9IHJlZGFjdG9yLnJlZGFjdFBhdGgocmVxdWVzdC5wYXRoKCksIHNlbnNpdGl2ZVZhbHVlcylcblxuICAgIHRyeSB7XG4gICAgICBhd2FpdCB0aGlzLmxvZ2dlci5kZWJ1ZygoKSA9PiBbXCJSdW4gcmVxdWVzdCBsaWZlY3ljbGVcIiwge1xuICAgICAgICBodHRwTWV0aG9kOiByZXF1ZXN0Lmh0dHBNZXRob2QoKSxcbiAgICAgICAgaHR0cFZlcnNpb246IHJlcXVlc3QuaHR0cFZlcnNpb24oKSxcbiAgICAgICAgb3JpZ2luOiByZXF1ZXN0Lm9yaWdpbigpLFxuICAgICAgICBwYXRoOiBsb2dnZWRQYXRoLFxuICAgICAgICByZW1vdGVBZGRyZXNzOiByZXF1ZXN0LnJlbW90ZUFkZHJlc3MoKVxuICAgICAgfV0pXG4gICAgICAvLyBCZWZvcmUgd2UgY2hlY2tlZCBpZiB0aGUgc2VjLWZldGNoLW1vZGUgd2FzIFwiY29yc1wiLCBidXQgaXQgc2VlbXMgdGhlIHNlYy1mZXRjaC1tb2RlIGlzbid0IGFsd2F5cyBwcmVzZW50XG4gICAgICBhd2FpdCB0aGlzLmxvZ2dlci5kZWJ1ZygoKSA9PiBbXCJSdW4gQ09SU1wiLCB7aHR0cE1ldGhvZDogcmVxdWVzdC5odHRwTWV0aG9kKCksIHNlY0ZldGNoTW9kZTogcmVxdWVzdC5oZWFkZXIoXCJzZWMtZmV0Y2gtbW9kZVwiKX1dKVxuXG4gICAgICBjb25zdCBjb3JzID0gY29uZmlndXJhdGlvbi5nZXRDb3JzKClcblxuICAgICAgaWYgKGNvcnMpIHtcbiAgICAgICAgYXdhaXQgY29ycyh7cmVxdWVzdCwgcmVzcG9uc2V9KVxuICAgICAgICBhd2FpdCB0aGlzLmxvZ2dlci5kZWJ1ZygoKSA9PiBbXCJDT1JTIGhhbmRsZXIgZG9uZVwiLCB7XG4gICAgICAgICAgaHR0cE1ldGhvZDogcmVxdWVzdC5odHRwTWV0aG9kKCksXG4gICAgICAgICAgcGF0aDogbG9nZ2VkUGF0aCxcbiAgICAgICAgICByZXNwb25zZVN0YXR1c0NvZGU6IHJlc3BvbnNlLmdldFN0YXR1c0NvZGUoKVxuICAgICAgICB9XSlcbiAgICAgIH1cblxuICAgICAgaWYgKHJlcXVlc3QuaHR0cE1ldGhvZCgpID09IFwiT1BUSU9OU1wiICYmIHJlcXVlc3QuaGVhZGVyKFwic2VjLWZldGNoLW1vZGVcIikgPT0gXCJjb3JzXCIpIHtcbiAgICAgICAgcmVzcG9uc2Uuc2V0U3RhdHVzKDIwMClcbiAgICAgICAgcmVzcG9uc2Uuc2V0Qm9keShcIlwiKVxuICAgICAgICBhd2FpdCB0aGlzLmxvZ2dlci5kZWJ1ZygoKSA9PiBbXCJIYW5kbGVkIHByZWZsaWdodCBPUFRJT05TIHJlcXVlc3RcIiwge1xuICAgICAgICAgIHBhdGg6IGxvZ2dlZFBhdGgsXG4gICAgICAgICAgcmVzcG9uc2VTdGF0dXNDb2RlOiByZXNwb25zZS5nZXRTdGF0dXNDb2RlKClcbiAgICAgICAgfV0pXG4gICAgICB9IGVsc2Uge1xuICAgICAgICBhd2FpdCB0aGlzLmxvZ2dlci5kZWJ1ZyhcIlJ1biByZXF1ZXN0XCIpXG4gICAgICAgIGNvbnN0IHJvdXRlc1Jlc29sdmVyID0gbmV3IFJvdXRlc1Jlc29sdmVyKHtjb25maWd1cmF0aW9uLCByZXF1ZXN0LCByZXNwb25zZX0pXG4gICAgICAgIGNvbnN0IHN0YXJ0VGltZU1zID0gRGF0ZS5ub3coKVxuICAgICAgICAvKipcbiAgICAgICAgICogRGVmaW5lcyB0aW1lb3V0SWQuXG4gICAgICAgICAqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBzZXRUaW1lb3V0PiB8IHVuZGVmaW5lZH0gKi9cbiAgICAgICAgbGV0IHRpbWVvdXRJZFxuICAgICAgICAvKipcbiAgICAgICAgICogRGVmaW5lcyB0aW1lb3V0UmVqZWN0LlxuICAgICAgICAgKiBAdHlwZSB7KChlcnJvcjogRXJyb3IpID0+IHZvaWQpIHwgdW5kZWZpbmVkfSAqL1xuICAgICAgICBsZXQgdGltZW91dFJlamVjdFxuICAgICAgICBsZXQgdGltZWRPdXQgPSBmYWxzZVxuXG4gICAgICAgIGNvbnN0IHNldFJlcXVlc3RUaW1lb3V0U2Vjb25kcyA9ICgvKiogQHR5cGUge251bWJlciB8IHVuZGVmaW5lZH0gKi8gdGltZW91dFNlY29uZHMpID0+IHtcbiAgICAgICAgICBpZiAodGltZW91dElkKSB7XG4gICAgICAgICAgICBjbGVhclRpbWVvdXQodGltZW91dElkKVxuICAgICAgICAgICAgdGltZW91dElkID0gdW5kZWZpbmVkXG4gICAgICAgICAgfVxuXG4gICAgICAgICAgaWYgKHR5cGVvZiB0aW1lb3V0U2Vjb25kcyAhPT0gXCJudW1iZXJcIiB8fCAhTnVtYmVyLmlzRmluaXRlKHRpbWVvdXRTZWNvbmRzKSB8fCB0aW1lb3V0U2Vjb25kcyA8PSAwKSB7XG4gICAgICAgICAgICByZXR1cm5cbiAgICAgICAgICB9XG5cbiAgICAgICAgICBjb25zdCB0aW1lb3V0TXMgPSB0aW1lb3V0U2Vjb25kcyAqIDEwMDBcbiAgICAgICAgICBjb25zdCBlbGFwc2VkTXMgPSBEYXRlLm5vdygpIC0gc3RhcnRUaW1lTXNcbiAgICAgICAgICBjb25zdCByZW1haW5pbmdNcyA9IHRpbWVvdXRNcyAtIGVsYXBzZWRNc1xuXG4gICAgICAgICAgaWYgKHJlbWFpbmluZ01zIDw9IDApIHtcbiAgICAgICAgICAgIHRpbWVvdXRSZWplY3Q/LihuZXcgRXJyb3IoYFJlcXVlc3QgdGltZWQgb3V0IGFmdGVyICR7dGltZW91dFNlY29uZHN9c2ApKVxuICAgICAgICAgICAgcmV0dXJuXG4gICAgICAgICAgfVxuXG4gICAgICAgICAgdGltZW91dElkID0gc2V0VGltZW91dCgoKSA9PiB7XG4gICAgICAgICAgICB0aW1lb3V0UmVqZWN0Py4obmV3IEVycm9yKGBSZXF1ZXN0IHRpbWVkIG91dCBhZnRlciAke3RpbWVvdXRTZWNvbmRzfXNgKSlcbiAgICAgICAgICB9LCByZW1haW5pbmdNcylcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IHRpbWVvdXRQcm9taXNlID0gbmV3IFByb21pc2UoKF8sIHJlamVjdCkgPT4ge1xuICAgICAgICAgIHRpbWVvdXRSZWplY3QgPSAoZXJyb3IpID0+IHtcbiAgICAgICAgICAgIHRpbWVkT3V0ID0gdHJ1ZVxuICAgICAgICAgICAgcmVqZWN0KGVycm9yKVxuICAgICAgICAgIH1cbiAgICAgICAgfSlcblxuICAgICAgICByZXNwb25zZS5zZXRSZXF1ZXN0VGltZW91dE1zQ2hhbmdlSGFuZGxlcigodGltZW91dFNlY29uZHMpID0+IHtcbiAgICAgICAgICBzZXRSZXF1ZXN0VGltZW91dFNlY29uZHModGltZW91dFNlY29uZHMpXG4gICAgICAgIH0pXG5cbiAgICAgICAgc2V0UmVxdWVzdFRpbWVvdXRTZWNvbmRzKGNvbmZpZ3VyYXRpb24uZ2V0UmVxdWVzdFRpbWVvdXRNcz8uKCkpXG5cbiAgICAgICAgLyoqIEB0eXBlIHtQcm9taXNlPHZvaWQ+IHwgdW5kZWZpbmVkfSAqL1xuICAgICAgICBsZXQgcmVzb2x2ZVByb21pc2VcblxuICAgICAgICBjb25zdCBydW5SZXNvbHZlZFJlcXVlc3QgPSBhc3luYyAoKSA9PiB7XG4gICAgICAgICAgcmVzb2x2ZVByb21pc2UgPSByb3V0ZXNSZXNvbHZlci5yZXNvbHZlKClcbiAgICAgICAgICAvLyBLZWVwIFByb21pc2UucmFjZSBoZXJlIHRvIGFsbG93IGR5bmFtaWMgdGltZW91dCB1cGRhdGVzLlxuICAgICAgICAgIGF3YWl0IFByb21pc2UucmFjZShbcmVzb2x2ZVByb21pc2UsIHRpbWVvdXRQcm9taXNlXSlcbiAgICAgICAgICBhd2FpdCB0aGlzLmxvZ2dlci5kZWJ1ZygoKSA9PiBbXCJSb3V0ZXMgcmVzb2x2ZXIgZG9uZVwiLCB7XG4gICAgICAgICAgICBodHRwTWV0aG9kOiByZXF1ZXN0Lmh0dHBNZXRob2QoKSxcbiAgICAgICAgICAgIHBhdGg6IGxvZ2dlZFBhdGgsXG4gICAgICAgICAgICByZXNwb25zZVN0YXR1c0NvZGU6IHJlc3BvbnNlLmdldFN0YXR1c0NvZGUoKSxcbiAgICAgICAgICAgIGhhc0ZpbGVQYXRoOiBCb29sZWFuKHJlc3BvbnNlLmdldEZpbGVQYXRoKCkpLFxuICAgICAgICAgICAgYm9keVR5cGU6IHJlc3BvbnNlQm9keVR5cGVGb3JMb2cocmVzcG9uc2UpXG4gICAgICAgICAgfV0pXG4gICAgICAgIH1cblxuICAgICAgICB0cnkge1xuICAgICAgICAgIGNvbnN0IHJlcXVlc3RUaW1lWm9uZSA9IHJlcXVlc3QuaGVhZGVyKFJFUVVFU1RfVElNRV9aT05FX0hFQURFUilcblxuICAgICAgICAgIGlmIChyZXF1ZXN0VGltZVpvbmUgIT09IHVuZGVmaW5lZCAmJiByZXF1ZXN0VGltZVpvbmUgIT09IG51bGwpIHtcbiAgICAgICAgICAgIGF3YWl0IGNvbmZpZ3VyYXRpb24ucnVuV2l0aFRpbWV6b25lKHJlcXVlc3RUaW1lWm9uZSwgcnVuUmVzb2x2ZWRSZXF1ZXN0KVxuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBhd2FpdCBydW5SZXNvbHZlZFJlcXVlc3QoKVxuICAgICAgICAgIH1cbiAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICBpZiAodGltZWRPdXQgJiYgcmVzb2x2ZVByb21pc2UpIHtcbiAgICAgICAgICAgIHZvaWQgcmVzb2x2ZVByb21pc2UuY2F0Y2goKHJlc29sdmVFcnJvcikgPT4ge1xuICAgICAgICAgICAgICBjb25zdCBzYWZlUmVzb2x2ZUVycm9yID0gcmVkYWN0b3IucmVkYWN0RXJyb3IoZW5zdXJlRXJyb3IocmVzb2x2ZUVycm9yKSwgc2Vuc2l0aXZlVmFsdWVzKVxuXG4gICAgICAgICAgICAgIHRoaXMubG9nZ2VyLndhcm4oKCkgPT4gW1wiUmVxdWVzdCBmaW5pc2hlZCBhZnRlciB0aW1lb3V0XCIsIHNhZmVSZXNvbHZlRXJyb3JdKVxuICAgICAgICAgICAgfSlcbiAgICAgICAgICB9XG4gICAgICAgICAgdGhyb3cgZXJyb3JcbiAgICAgICAgfSBmaW5hbGx5IHtcbiAgICAgICAgICBpZiAodGltZW91dElkKSBjbGVhclRpbWVvdXQodGltZW91dElkKVxuICAgICAgICB9XG4gICAgICB9XG4gICAgfSBjYXRjaCAoZSkge1xuICAgICAgY29uc3QgZXJyb3IgPSBlbnN1cmVFcnJvcihlKVxuICAgICAgY29uc3QgZXJyb3JXaXRoQ29udGV4dCA9IC8qKiBAdHlwZSB7e3ZlbG9jaW91c0NvbnRleHQ/OiBvYmplY3R9fSAqLyAoZXJyb3IpXG4gICAgICBjb25zdCBlcnJvckNvbnRleHQgPSBlcnJvcldpdGhDb250ZXh0LnZlbG9jaW91c0NvbnRleHQgfHwge3N0YWdlOiBcInJlcXVlc3QtcnVubmVyXCJ9XG4gICAgICBjb25zdCBsb2dEZXRhaWxzID0gcmVxdWVzdEVycm9yTG9nRGV0YWlscyhlcnJvcilcbiAgICAgIGNvbnN0IHJlZGFjdGVkTG9nRGV0YWlscyA9IHtcbiAgICAgICAgY2xlYW5lZEJhY2t0cmFjZTogbG9nRGV0YWlscy5jbGVhbmVkQmFja3RyYWNlXG4gICAgICAgICAgPyByZWRhY3Rvci5yZWRhY3RTdHJpbmcobG9nRGV0YWlscy5jbGVhbmVkQmFja3RyYWNlLCBzZW5zaXRpdmVWYWx1ZXMpXG4gICAgICAgICAgOiB1bmRlZmluZWQsXG4gICAgICAgIGVycm9yU3VtbWFyeTogcmVkYWN0b3IucmVkYWN0U3RyaW5nKGxvZ0RldGFpbHMuZXJyb3JTdW1tYXJ5LCBzZW5zaXRpdmVWYWx1ZXMpXG4gICAgICB9XG5cbiAgICAgIGF3YWl0IHRoaXMubG9nZ2VyLmVycm9yKCgpID0+IHJlcXVlc3RFcnJvckxvZ01lc3NhZ2UocmVkYWN0ZWRMb2dEZXRhaWxzKSlcblxuICAgICAgY29uc3QgZXJyb3JQYXlsb2FkID0ge1xuICAgICAgICBjb250ZXh0OiByZWRhY3Rvci5yZWRhY3RTdHJ1Y3R1cmVkKGVycm9yQ29udGV4dCwgc2Vuc2l0aXZlVmFsdWVzKSxcbiAgICAgICAgZXJyb3I6IHJlZGFjdG9yLnJlZGFjdEVycm9yKGVycm9yLCBzZW5zaXRpdmVWYWx1ZXMpLFxuICAgICAgICByZXF1ZXN0LFxuICAgICAgICByZXNwb25zZVxuICAgICAgfVxuXG4gICAgICBjb25maWd1cmF0aW9uLmdldEVycm9yRXZlbnRzKCkuZW1pdChcImZyYW1ld29yay1lcnJvclwiLCBlcnJvclBheWxvYWQpXG4gICAgICBjb25maWd1cmF0aW9uLmdldEVycm9yRXZlbnRzKCkuZW1pdChcImFsbC1lcnJvclwiLCB7XG4gICAgICAgIC4uLmVycm9yUGF5bG9hZCxcbiAgICAgICAgZXJyb3JUeXBlOiBcImZyYW1ld29yay1lcnJvclwiXG4gICAgICB9KVxuXG4gICAgICByZXNwb25zZS5zZXRTdGF0dXMoNTAwKVxuICAgICAgcmVzcG9uc2Uuc2V0RXJyb3JCb2R5KGVycm9yKVxuICAgIH1cblxuICAgIGF3YWl0IHRoaXMubG9nZ2VyLmRlYnVnKCgpID0+IFtcIlJlcXVlc3QgcnVubmVyIGRvbmVcIiwge1xuICAgICAgaHR0cE1ldGhvZDogcmVxdWVzdC5odHRwTWV0aG9kKCksXG4gICAgICBwYXRoOiBsb2dnZWRQYXRoLFxuICAgICAgcmVzcG9uc2VTdGF0dXNDb2RlOiByZXNwb25zZS5nZXRTdGF0dXNDb2RlKClcbiAgICB9XSlcbiAgICB0aGlzLnN0YXRlID0gXCJkb25lXCJcbiAgICB0aGlzLmV2ZW50cy5lbWl0KFwiZG9uZVwiLCB0aGlzKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbG9nIGNvbXBsZXRlZCByZXF1ZXN0LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBMb2dzIHRoZSBjb21wbGV0ZWQgcmVxdWVzdCBsaW5lIGFmdGVyIHRoZSByZXNwb25zZSBoYXMgYmVlbiBzZXJ2ZWQuXG4gICAqL1xuICBhc3luYyBsb2dDb21wbGV0ZWRSZXF1ZXN0KCkge1xuICAgIGlmICh0aGlzLmNvbXBsZXRlZFJlcXVlc3RMb2dnZWQpIHJldHVyblxuXG4gICAgdGhpcy5jb21wbGV0ZWRSZXF1ZXN0TG9nZ2VkID0gdHJ1ZVxuXG4gICAgY29uc3QgcmVxdWVzdFRpbWluZyA9IHRoaXMucmVxdWVzdFRpbWluZ1xuXG4gICAgcmVxdWVzdFRpbWluZy5tYXJrUmVzcG9uc2VTZXJ2ZWQoKVxuXG4gICAgaWYgKCFyZXF1ZXN0VGltaW5nLmNvbXBsZXRlZExvZ1N1YmplY3QgfHwgIXJlcXVlc3RUaW1pbmcuY29tcGxldGVkTG9nTWV0aG9kKSByZXR1cm5cblxuICAgIGNvbnN0IGxvZ2dlciA9IG5ldyBMb2dnZXIocmVxdWVzdFRpbWluZy5jb21wbGV0ZWRMb2dTdWJqZWN0LCB7Y29uZmlndXJhdGlvbjogdGhpcy5jb25maWd1cmF0aW9ufSlcbiAgICBjb25zdCBzdW1tYXJ5ID0gcmVxdWVzdFRpbWluZy5zdW1tYXJ5KClcbiAgICBjb25zdCByZXNwb25zZSA9IHRoaXMucmVzcG9uc2VcbiAgICBjb25zdCBjb21wbGV0ZWRNZXNzYWdlID0gW1xuICAgICAgYENvbXBsZXRlZCAke3Jlc3BvbnNlLmdldFN0YXR1c0NvZGUoKX0gJHtyZXNwb25zZS5nZXRTdGF0dXNNZXNzYWdlKCl9IGluICR7TWF0aC5yb3VuZChzdW1tYXJ5LnRvdGFsTXMpfW1zIChgLFxuICAgICAgYENvbnRyb2xsZXI6ICR7Zm9ybWF0QnVja2V0TXMoc3VtbWFyeS5jb250cm9sbGVyTXMpfWAsXG4gICAgICBgIHwgVmlld3M6ICR7Zm9ybWF0QnVja2V0TXMoc3VtbWFyeS52aWV3c01zKX1gLFxuICAgICAgYCB8IERCOiAke2Zvcm1hdEJ1Y2tldE1zKHN1bW1hcnkuZGJNcyl9ICgke3F1ZXJ5Q291bnRMYWJlbChzdW1tYXJ5LmRiUXVlcnlDb3VudCl9KWAsXG4gICAgICBgIHwgVmVsb2Npb3VzOiAke2Zvcm1hdEJ1Y2tldE1zKHN1bW1hcnkudmVsb2Npb3VzTXMpfWAsXG4gICAgICBgKWBcbiAgICBdLmpvaW4oXCJcIilcblxuICAgIGF3YWl0IGxvZ2dlcltyZXF1ZXN0VGltaW5nLmNvbXBsZXRlZExvZ01ldGhvZF0oY29tcGxldGVkTWVzc2FnZSlcbiAgfVxufVxuIl19