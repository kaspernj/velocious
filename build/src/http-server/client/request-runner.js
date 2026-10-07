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
            if (response.isStreaming()) {
                // The headers already went to the client, so a plain error body is
                // impossible. The handler owns the stream lifecycle: it aborts the
                // stream (terminator + close callbacks) or, when it still controls
                // the connection, writes an error SSE frame.
                response.abortStream();
            }
            else {
                try {
                    response.setErrorBody(error);
                }
                catch (responseError) {
                    if (!(responseError instanceof HttpResponseBodyTooLargeError))
                        throw responseError;
                    response.setBody("");
                }
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicmVxdWVzdC1ydW5uZXIuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvaHR0cC1zZXJ2ZXIvY2xpZW50L3JlcXVlc3QtcnVubmVyLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLEVBQUMsV0FBVyxFQUFDLE1BQU0sU0FBUyxDQUFBO0FBQ25DLE9BQU8sZ0JBQWdCLE1BQU0sdUNBQXVDLENBQUE7QUFDcEUsT0FBTyxZQUFZLE1BQU0sOEJBQThCLENBQUE7QUFDdkQsT0FBTyxFQUFDLDZCQUE2QixFQUFDLE1BQU0sYUFBYSxDQUFBO0FBQ3pELE9BQU8sTUFBTSxNQUFNLGlCQUFpQixDQUFBO0FBQ3BDLE9BQU8sYUFBYSxNQUFNLHFCQUFxQixDQUFBO0FBQy9DLE9BQU8sUUFBUSxNQUFNLGVBQWUsQ0FBQTtBQUNwQyxPQUFPLGNBQWMsTUFBTSwwQkFBMEIsQ0FBQTtBQUNyRCxPQUFPLEVBQUMsd0JBQXdCLEVBQUMsTUFBTSxvQkFBb0IsQ0FBQTtBQUUzRDs7OztHQUlHO0FBQ0gsU0FBUyxjQUFjLENBQUMsSUFBSTtJQUMxQixJQUFJLENBQUMsSUFBSTtRQUFFLE9BQU8sS0FBSyxDQUFBO0lBRXZCLE9BQU8sU0FBUyxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsSUFBSSxFQUFFLENBQUMsQ0FBQTtBQUNwQyxDQUFDO0FBRUQ7Ozs7O0dBS0c7QUFDSCxTQUFTLG1CQUFtQixDQUFDLEtBQUssRUFBRSxzQkFBc0I7SUFDeEQsTUFBTSxXQUFXLEdBQUcsc0JBQXNCLEVBQUUsS0FBSyxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsQ0FBQyxFQUFFLElBQUksRUFBRSxDQUFBO0lBRWxFLElBQUksV0FBVyxJQUFJLENBQUMsY0FBYyxDQUFDLFdBQVcsQ0FBQztRQUFFLE9BQU8sV0FBVyxDQUFBO0lBRW5FLE1BQU0sU0FBUyxHQUFHLE9BQU8sNENBQTRDLENBQUMsQ0FBQyxLQUFLLENBQUMsQ0FBQyxJQUFJLEtBQUssUUFBUTtRQUM3RixDQUFDLENBQUMsNENBQTRDLENBQUMsQ0FBQyxLQUFLLENBQUMsQ0FBQyxJQUFJO1FBQzNELENBQUMsQ0FBQyxTQUFTLENBQUE7SUFDYixNQUFNLFlBQVksR0FBRyxLQUFLLENBQUMsT0FBTyxJQUFJLE1BQU0sQ0FBQyxLQUFLLENBQUMsQ0FBQTtJQUVuRCxJQUFJLFNBQVM7UUFBRSxPQUFPLEdBQUcsS0FBSyxDQUFDLElBQUksS0FBSyxTQUFTLE1BQU0sWUFBWSxFQUFFLENBQUE7SUFFckUsT0FBTyxHQUFHLEtBQUssQ0FBQyxJQUFJLEtBQUssWUFBWSxFQUFFLENBQUE7QUFDekMsQ0FBQztBQUVEOzs7Ozs7O0dBT0c7QUFDSCxTQUFTLHNCQUFzQixDQUFDLEtBQUs7SUFDbkMsTUFBTSxzQkFBc0IsR0FBRyxnQkFBZ0IsQ0FBQyxlQUFlLENBQUMsS0FBSyxDQUFDLENBQUE7SUFDdEUsTUFBTSxZQUFZLEdBQUcsbUJBQW1CLENBQUMsS0FBSyxFQUFFLHNCQUFzQixDQUFDLENBQUE7SUFDdkUsTUFBTSxnQkFBZ0IsR0FBRyxnQkFBZ0IsQ0FBQyxlQUFlLENBQUMsS0FBSyxFQUFFLEVBQUMsa0JBQWtCLEVBQUUsS0FBSyxFQUFDLENBQUMsSUFBSSxzQkFBc0IsQ0FBQTtJQUV2SCxPQUFPLEVBQUMsWUFBWSxFQUFFLGdCQUFnQixFQUFDLENBQUE7QUFDekMsQ0FBQztBQUVEOzs7Ozs7O0dBT0c7QUFDSCxTQUFTLHNCQUFzQixDQUFDLFVBQVU7SUFDeEMsSUFBSSxDQUFDLFVBQVUsQ0FBQyxnQkFBZ0IsRUFBRSxDQUFDO1FBQ2pDLE9BQU8sZ0NBQWdDLFVBQVUsQ0FBQyxZQUFZLEVBQUUsQ0FBQTtJQUNsRSxDQUFDO0lBRUQsT0FBTyxnQ0FBZ0MsVUFBVSxDQUFDLFlBQVkseUJBQXlCLFVBQVUsQ0FBQyxnQkFBZ0IsRUFBRSxDQUFBO0FBQ3RILENBQUM7QUFFRDs7OztHQUlHO0FBQ0gsU0FBUyxzQkFBc0IsQ0FBQyxRQUFRO0lBQ3RDLElBQUksUUFBUSxDQUFDLFdBQVcsRUFBRTtRQUFFLE9BQU8sTUFBTSxDQUFBO0lBRXpDLElBQUksQ0FBQztRQUNILE9BQU8sT0FBTyxRQUFRLENBQUMsT0FBTyxFQUFFLENBQUE7SUFDbEMsQ0FBQztJQUFDLE1BQU0sQ0FBQztRQUNQLE9BQU8sT0FBTyxDQUFBO0lBQ2hCLENBQUM7QUFDSCxDQUFDO0FBRUQ7Ozs7R0FJRztBQUNILFNBQVMsY0FBYyxDQUFDLEtBQUs7SUFDM0IsT0FBTyxHQUFHLEtBQUssQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQTtBQUNoQyxDQUFDO0FBRUQ7Ozs7R0FJRztBQUNILFNBQVMsZUFBZSxDQUFDLEtBQUs7SUFDNUIsT0FBTyxHQUFHLEtBQUssSUFBSSxLQUFLLEtBQUssQ0FBQyxDQUFDLENBQUMsQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDLFNBQVMsRUFBRSxDQUFBO0FBQ3hELENBQUM7QUFFRCxNQUFNLENBQUMsT0FBTyxPQUFPLHNDQUFzQztJQUN6RCxNQUFNLEdBQUcsSUFBSSxZQUFZLEVBQUUsQ0FBQTtJQUUzQjs7Ozs7T0FLRztJQUNILFlBQVksRUFBQyxhQUFhLEVBQUUsT0FBTyxFQUFDO1FBQ2xDLElBQUksQ0FBQyxhQUFhO1lBQUUsTUFBTSxJQUFJLEtBQUssQ0FBQyx3QkFBd0IsQ0FBQyxDQUFBO1FBQzdELElBQUksQ0FBQyxPQUFPO1lBQUUsTUFBTSxJQUFJLEtBQUssQ0FBQyxrQkFBa0IsQ0FBQyxDQUFBO1FBRWpELElBQUksQ0FBQyxNQUFNLEdBQUcsSUFBSSxNQUFNLENBQUMsSUFBSSxDQUFDLENBQUE7UUFDOUIsSUFBSSxDQUFDLGFBQWEsR0FBRyxhQUFhLENBQUE7UUFDbEMsSUFBSSxDQUFDLE9BQU8sR0FBRyxPQUFPLENBQUE7UUFDdEIsSUFBSSxDQUFDLFFBQVEsR0FBRyxJQUFJLFFBQVEsQ0FBQyxFQUFDLGFBQWEsRUFBQyxDQUFDLENBQUE7UUFDN0MsSUFBSSxDQUFDLHNCQUFzQixHQUFHLEtBQUssQ0FBQTtRQUNuQyxJQUFJLENBQUMsYUFBYSxHQUFHLElBQUksYUFBYSxFQUFFLENBQUE7UUFDeEMsSUFBSSxDQUFDLEtBQUssR0FBRyxTQUFTLENBQUE7SUFDeEIsQ0FBQztJQUVELFVBQVUsS0FBSyxPQUFPLElBQUksQ0FBQyxPQUFPLENBQUEsQ0FBQyxDQUFDO0lBQ3BDLFFBQVEsS0FBSyxPQUFPLElBQUksQ0FBQyxLQUFLLENBQUEsQ0FBQyxDQUFDO0lBRWhDLEtBQUssQ0FBQyxHQUFHO1FBQ1AsSUFBSSxDQUFDLGFBQWEsQ0FBQyxXQUFXLEdBQUcsSUFBSSxDQUFDLEdBQUcsRUFBRSxDQUFBO1FBRTNDLE9BQU8sTUFBTSxJQUFJLENBQUMsYUFBYSxDQUFDLG9CQUFvQixDQUFDLElBQUksQ0FBQyxhQUFhLEVBQUUsS0FBSyxJQUFJLEVBQUU7WUFDbEYsTUFBTSxRQUFRLEdBQUcsSUFBSSxDQUFDLGFBQWEsQ0FBQyxjQUFjLEVBQUUsQ0FBQTtZQUNwRCxNQUFNLGVBQWUsR0FBRyxRQUFRLENBQUMsc0JBQXNCLENBQUMsSUFBSSxDQUFDLE9BQU8sRUFBRSxJQUFJLENBQUMsYUFBYSxDQUFDLHFCQUFxQixFQUFFLENBQUMsQ0FBQTtZQUVqSCxJQUFJLENBQUMsYUFBYSxDQUFDLDBCQUEwQixDQUFDLGVBQWUsQ0FBQyxDQUFBO1lBRTlELDRFQUE0RTtZQUM1RSwrRUFBK0U7WUFDL0UsOEVBQThFO1lBQzlFLGVBQWU7WUFDZixNQUFNLElBQUksQ0FBQyxhQUFhLENBQUMsbUNBQW1DLENBQUMsS0FBSyxJQUFJLEVBQUU7Z0JBQ3RFLE1BQU0sSUFBSSxDQUFDLElBQUksRUFBRSxDQUFBO1lBQ25CLENBQUMsQ0FBQyxDQUFBO1FBQ0osQ0FBQyxDQUFDLENBQUE7SUFDSixDQUFDO0lBRUQsS0FBSyxDQUFDLElBQUk7UUFDUixNQUFNLEVBQUMsYUFBYSxFQUFFLE9BQU8sRUFBRSxRQUFRLEVBQUMsR0FBRyxJQUFJLENBQUE7UUFFL0MsSUFBSSxDQUFDLE9BQU87WUFBRSxNQUFNLElBQUksS0FBSyxDQUFDLGFBQWEsQ0FBQyxDQUFBO1FBRTVDLE1BQU0sUUFBUSxHQUFHLGFBQWEsQ0FBQyxjQUFjLEVBQUUsQ0FBQTtRQUMvQyxNQUFNLGVBQWUsR0FBRyxJQUFJLENBQUMsYUFBYSxDQUFDLHFCQUFxQixFQUFFLENBQUE7UUFDbEUsTUFBTSxVQUFVLEdBQUcsUUFBUSxDQUFDLFVBQVUsQ0FBQyxPQUFPLENBQUMsSUFBSSxFQUFFLEVBQUUsZUFBZSxDQUFDLENBQUE7UUFFdkUsSUFBSSxDQUFDO1lBQ0gsTUFBTSxJQUFJLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyxHQUFHLEVBQUUsQ0FBQyxDQUFDLHVCQUF1QixFQUFFO29CQUN0RCxVQUFVLEVBQUUsT0FBTyxDQUFDLFVBQVUsRUFBRTtvQkFDaEMsV0FBVyxFQUFFLE9BQU8sQ0FBQyxXQUFXLEVBQUU7b0JBQ2xDLE1BQU0sRUFBRSxPQUFPLENBQUMsTUFBTSxFQUFFO29CQUN4QixJQUFJLEVBQUUsVUFBVTtvQkFDaEIsYUFBYSxFQUFFLE9BQU8sQ0FBQyxhQUFhLEVBQUU7aUJBQ3ZDLENBQUMsQ0FBQyxDQUFBO1lBQ0gsMkdBQTJHO1lBQzNHLE1BQU0sSUFBSSxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMsR0FBRyxFQUFFLENBQUMsQ0FBQyxVQUFVLEVBQUUsRUFBQyxVQUFVLEVBQUUsT0FBTyxDQUFDLFVBQVUsRUFBRSxFQUFFLFlBQVksRUFBRSxPQUFPLENBQUMsTUFBTSxDQUFDLGdCQUFnQixDQUFDLEVBQUMsQ0FBQyxDQUFDLENBQUE7WUFFL0gsTUFBTSxJQUFJLEdBQUcsYUFBYSxDQUFDLE9BQU8sRUFBRSxDQUFBO1lBRXBDLElBQUksSUFBSSxFQUFFLENBQUM7Z0JBQ1QsTUFBTSxJQUFJLENBQUMsRUFBQyxPQUFPLEVBQUUsUUFBUSxFQUFDLENBQUMsQ0FBQTtnQkFDL0IsTUFBTSxJQUFJLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyxHQUFHLEVBQUUsQ0FBQyxDQUFDLG1CQUFtQixFQUFFO3dCQUNsRCxVQUFVLEVBQUUsT0FBTyxDQUFDLFVBQVUsRUFBRTt3QkFDaEMsSUFBSSxFQUFFLFVBQVU7d0JBQ2hCLGtCQUFrQixFQUFFLFFBQVEsQ0FBQyxhQUFhLEVBQUU7cUJBQzdDLENBQUMsQ0FBQyxDQUFBO1lBQ0wsQ0FBQztZQUVELElBQUksT0FBTyxDQUFDLFVBQVUsRUFBRSxJQUFJLFNBQVMsSUFBSSxPQUFPLENBQUMsTUFBTSxDQUFDLGdCQUFnQixDQUFDLElBQUksTUFBTSxFQUFFLENBQUM7Z0JBQ3BGLFFBQVEsQ0FBQyxTQUFTLENBQUMsR0FBRyxDQUFDLENBQUE7Z0JBQ3ZCLFFBQVEsQ0FBQyxPQUFPLENBQUMsRUFBRSxDQUFDLENBQUE7Z0JBQ3BCLE1BQU0sSUFBSSxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMsR0FBRyxFQUFFLENBQUMsQ0FBQyxtQ0FBbUMsRUFBRTt3QkFDbEUsSUFBSSxFQUFFLFVBQVU7d0JBQ2hCLGtCQUFrQixFQUFFLFFBQVEsQ0FBQyxhQUFhLEVBQUU7cUJBQzdDLENBQUMsQ0FBQyxDQUFBO1lBQ0wsQ0FBQztpQkFBTSxDQUFDO2dCQUNOLE1BQU0sSUFBSSxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMsYUFBYSxDQUFDLENBQUE7Z0JBQ3RDLE1BQU0sY0FBYyxHQUFHLElBQUksY0FBYyxDQUFDLEVBQUMsYUFBYSxFQUFFLE9BQU8sRUFBRSxRQUFRLEVBQUMsQ0FBQyxDQUFBO2dCQUM3RSxNQUFNLFdBQVcsR0FBRyxJQUFJLENBQUMsR0FBRyxFQUFFLENBQUE7Z0JBQzlCOzt1RUFFdUQ7Z0JBQ3ZELElBQUksU0FBUyxDQUFBO2dCQUNiOztrRUFFa0Q7Z0JBQ2xELElBQUksYUFBYSxDQUFBO2dCQUNqQixJQUFJLFFBQVEsR0FBRyxLQUFLLENBQUE7Z0JBRXBCLE1BQU0sd0JBQXdCLEdBQUcsQ0FBQyxpQ0FBaUMsQ0FBQyxjQUFjLEVBQUUsRUFBRTtvQkFDcEYsSUFBSSxTQUFTLEVBQUUsQ0FBQzt3QkFDZCxZQUFZLENBQUMsU0FBUyxDQUFDLENBQUE7d0JBQ3ZCLFNBQVMsR0FBRyxTQUFTLENBQUE7b0JBQ3ZCLENBQUM7b0JBRUQsSUFBSSxPQUFPLGNBQWMsS0FBSyxRQUFRLElBQUksQ0FBQyxNQUFNLENBQUMsUUFBUSxDQUFDLGNBQWMsQ0FBQyxJQUFJLGNBQWMsSUFBSSxDQUFDLEVBQUUsQ0FBQzt3QkFDbEcsT0FBTTtvQkFDUixDQUFDO29CQUVELE1BQU0sU0FBUyxHQUFHLGNBQWMsR0FBRyxJQUFJLENBQUE7b0JBQ3ZDLE1BQU0sU0FBUyxHQUFHLElBQUksQ0FBQyxHQUFHLEVBQUUsR0FBRyxXQUFXLENBQUE7b0JBQzFDLE1BQU0sV0FBVyxHQUFHLFNBQVMsR0FBRyxTQUFTLENBQUE7b0JBRXpDLElBQUksV0FBVyxJQUFJLENBQUMsRUFBRSxDQUFDO3dCQUNyQixhQUFhLEVBQUUsQ0FBQyxJQUFJLEtBQUssQ0FBQywyQkFBMkIsY0FBYyxHQUFHLENBQUMsQ0FBQyxDQUFBO3dCQUN4RSxPQUFNO29CQUNSLENBQUM7b0JBRUQsU0FBUyxHQUFHLFVBQVUsQ0FBQyxHQUFHLEVBQUU7d0JBQzFCLGFBQWEsRUFBRSxDQUFDLElBQUksS0FBSyxDQUFDLDJCQUEyQixjQUFjLEdBQUcsQ0FBQyxDQUFDLENBQUE7b0JBQzFFLENBQUMsRUFBRSxXQUFXLENBQUMsQ0FBQTtnQkFDakIsQ0FBQyxDQUFBO2dCQUVELE1BQU0sY0FBYyxHQUFHLElBQUksT0FBTyxDQUFDLENBQUMsQ0FBQyxFQUFFLE1BQU0sRUFBRSxFQUFFO29CQUMvQyxhQUFhLEdBQUcsQ0FBQyxLQUFLLEVBQUUsRUFBRTt3QkFDeEIsUUFBUSxHQUFHLElBQUksQ0FBQTt3QkFDZixNQUFNLENBQUMsS0FBSyxDQUFDLENBQUE7b0JBQ2YsQ0FBQyxDQUFBO2dCQUNILENBQUMsQ0FBQyxDQUFBO2dCQUVGLFFBQVEsQ0FBQyxnQ0FBZ0MsQ0FBQyxDQUFDLGNBQWMsRUFBRSxFQUFFO29CQUMzRCx3QkFBd0IsQ0FBQyxjQUFjLENBQUMsQ0FBQTtnQkFDMUMsQ0FBQyxDQUFDLENBQUE7Z0JBRUYsd0JBQXdCLENBQUMsYUFBYSxDQUFDLG1CQUFtQixFQUFFLEVBQUUsQ0FBQyxDQUFBO2dCQUUvRCx3Q0FBd0M7Z0JBQ3hDLElBQUksY0FBYyxDQUFBO2dCQUVsQixNQUFNLGtCQUFrQixHQUFHLEtBQUssSUFBSSxFQUFFO29CQUNwQyxjQUFjLEdBQUcsY0FBYyxDQUFDLE9BQU8sRUFBRSxDQUFBO29CQUN6QywyREFBMkQ7b0JBQzNELE1BQU0sT0FBTyxDQUFDLElBQUksQ0FBQyxDQUFDLGNBQWMsRUFBRSxjQUFjLENBQUMsQ0FBQyxDQUFBO29CQUNwRCxNQUFNLElBQUksQ0FBQyxNQUFNLENBQUMsS0FBSyxDQUFDLEdBQUcsRUFBRSxDQUFDLENBQUMsc0JBQXNCLEVBQUU7NEJBQ3JELFVBQVUsRUFBRSxPQUFPLENBQUMsVUFBVSxFQUFFOzRCQUNoQyxJQUFJLEVBQUUsVUFBVTs0QkFDaEIsa0JBQWtCLEVBQUUsUUFBUSxDQUFDLGFBQWEsRUFBRTs0QkFDNUMsV0FBVyxFQUFFLE9BQU8sQ0FBQyxRQUFRLENBQUMsV0FBVyxFQUFFLENBQUM7NEJBQzVDLFFBQVEsRUFBRSxzQkFBc0IsQ0FBQyxRQUFRLENBQUM7eUJBQzNDLENBQUMsQ0FBQyxDQUFBO2dCQUNMLENBQUMsQ0FBQTtnQkFFRCxJQUFJLENBQUM7b0JBQ0gsTUFBTSxlQUFlLEdBQUcsT0FBTyxDQUFDLE1BQU0sQ0FBQyx3QkFBd0IsQ0FBQyxDQUFBO29CQUVoRSxJQUFJLGVBQWUsS0FBSyxTQUFTLElBQUksZUFBZSxLQUFLLElBQUksRUFBRSxDQUFDO3dCQUM5RCxNQUFNLGFBQWEsQ0FBQyxlQUFlLENBQUMsZUFBZSxFQUFFLGtCQUFrQixDQUFDLENBQUE7b0JBQzFFLENBQUM7eUJBQU0sQ0FBQzt3QkFDTixNQUFNLGtCQUFrQixFQUFFLENBQUE7b0JBQzVCLENBQUM7Z0JBQ0gsQ0FBQztnQkFBQyxPQUFPLEtBQUssRUFBRSxDQUFDO29CQUNmLElBQUksUUFBUSxJQUFJLGNBQWMsRUFBRSxDQUFDO3dCQUMvQixLQUFLLGNBQWMsQ0FBQyxLQUFLLENBQUMsQ0FBQyxZQUFZLEVBQUUsRUFBRTs0QkFDekMsTUFBTSxnQkFBZ0IsR0FBRyxRQUFRLENBQUMsV0FBVyxDQUFDLFdBQVcsQ0FBQyxZQUFZLENBQUMsRUFBRSxlQUFlLENBQUMsQ0FBQTs0QkFFekYsSUFBSSxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsR0FBRyxFQUFFLENBQUMsQ0FBQyxnQ0FBZ0MsRUFBRSxnQkFBZ0IsQ0FBQyxDQUFDLENBQUE7d0JBQzlFLENBQUMsQ0FBQyxDQUFBO29CQUNKLENBQUM7b0JBQ0QsTUFBTSxLQUFLLENBQUE7Z0JBQ2IsQ0FBQzt3QkFBUyxDQUFDO29CQUNULElBQUksU0FBUzt3QkFBRSxZQUFZLENBQUMsU0FBUyxDQUFDLENBQUE7Z0JBQ3hDLENBQUM7WUFDSCxDQUFDO1FBQ0gsQ0FBQztRQUFDLE9BQU8sQ0FBQyxFQUFFLENBQUM7WUFDWCxNQUFNLEtBQUssR0FBRyxXQUFXLENBQUMsQ0FBQyxDQUFDLENBQUE7WUFDNUIsTUFBTSxnQkFBZ0IsR0FBRywwQ0FBMEMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxDQUFBO1lBQzNFLE1BQU0sWUFBWSxHQUFHLGdCQUFnQixDQUFDLGdCQUFnQixJQUFJLEVBQUMsS0FBSyxFQUFFLGdCQUFnQixFQUFDLENBQUE7WUFDbkYsTUFBTSxVQUFVLEdBQUcsc0JBQXNCLENBQUMsS0FBSyxDQUFDLENBQUE7WUFDaEQsTUFBTSxrQkFBa0IsR0FBRztnQkFDekIsZ0JBQWdCLEVBQUUsVUFBVSxDQUFDLGdCQUFnQjtvQkFDM0MsQ0FBQyxDQUFDLFFBQVEsQ0FBQyxZQUFZLENBQUMsVUFBVSxDQUFDLGdCQUFnQixFQUFFLGVBQWUsQ0FBQztvQkFDckUsQ0FBQyxDQUFDLFNBQVM7Z0JBQ2IsWUFBWSxFQUFFLFFBQVEsQ0FBQyxZQUFZLENBQUMsVUFBVSxDQUFDLFlBQVksRUFBRSxlQUFlLENBQUM7YUFDOUUsQ0FBQTtZQUVELE1BQU0sSUFBSSxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMsR0FBRyxFQUFFLENBQUMsc0JBQXNCLENBQUMsa0JBQWtCLENBQUMsQ0FBQyxDQUFBO1lBRXpFLE1BQU0sWUFBWSxHQUFHO2dCQUNuQixPQUFPLEVBQUUsUUFBUSxDQUFDLGdCQUFnQixDQUFDLFlBQVksRUFBRSxlQUFlLENBQUM7Z0JBQ2pFLEtBQUssRUFBRSxRQUFRLENBQUMsV0FBVyxDQUFDLEtBQUssRUFBRSxlQUFlLENBQUM7Z0JBQ25ELE9BQU87Z0JBQ1AsUUFBUTthQUNULENBQUE7WUFFRCxhQUFhLENBQUMsY0FBYyxFQUFFLENBQUMsSUFBSSxDQUFDLGlCQUFpQixFQUFFLFlBQVksQ0FBQyxDQUFBO1lBQ3BFLGFBQWEsQ0FBQyxjQUFjLEVBQUUsQ0FBQyxJQUFJLENBQUMsV0FBVyxFQUFFO2dCQUMvQyxHQUFHLFlBQVk7Z0JBQ2YsU0FBUyxFQUFFLGlCQUFpQjthQUM3QixDQUFDLENBQUE7WUFFRixRQUFRLENBQUMsU0FBUyxDQUFDLEdBQUcsQ0FBQyxDQUFBO1lBQ3ZCLElBQUksUUFBUSxDQUFDLFdBQVcsRUFBRSxFQUFFLENBQUM7Z0JBQzNCLG1FQUFtRTtnQkFDbkUsbUVBQW1FO2dCQUNuRSxtRUFBbUU7Z0JBQ25FLDZDQUE2QztnQkFDN0MsUUFBUSxDQUFDLFdBQVcsRUFBRSxDQUFBO1lBQ3hCLENBQUM7aUJBQU0sQ0FBQztnQkFDTixJQUFJLENBQUM7b0JBQ0gsUUFBUSxDQUFDLFlBQVksQ0FBQyxLQUFLLENBQUMsQ0FBQTtnQkFDOUIsQ0FBQztnQkFBQyxPQUFPLGFBQWEsRUFBRSxDQUFDO29CQUN2QixJQUFJLENBQUMsQ0FBQyxhQUFhLFlBQVksNkJBQTZCLENBQUM7d0JBQUUsTUFBTSxhQUFhLENBQUE7b0JBRWxGLFFBQVEsQ0FBQyxPQUFPLENBQUMsRUFBRSxDQUFDLENBQUE7Z0JBQ3RCLENBQUM7WUFDSCxDQUFDO1FBQ0gsQ0FBQztRQUVELE1BQU0sSUFBSSxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMsR0FBRyxFQUFFLENBQUMsQ0FBQyxxQkFBcUIsRUFBRTtnQkFDcEQsVUFBVSxFQUFFLE9BQU8sQ0FBQyxVQUFVLEVBQUU7Z0JBQ2hDLElBQUksRUFBRSxVQUFVO2dCQUNoQixrQkFBa0IsRUFBRSxRQUFRLENBQUMsYUFBYSxFQUFFO2FBQzdDLENBQUMsQ0FBQyxDQUFBO1FBQ0gsSUFBSSxDQUFDLEtBQUssR0FBRyxNQUFNLENBQUE7UUFDbkIsSUFBSSxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsTUFBTSxFQUFFLElBQUksQ0FBQyxDQUFBO0lBQ2hDLENBQUM7SUFFRDs7O09BR0c7SUFDSCxLQUFLLENBQUMsbUJBQW1CO1FBQ3ZCLElBQUksSUFBSSxDQUFDLHNCQUFzQjtZQUFFLE9BQU07UUFFdkMsSUFBSSxDQUFDLHNCQUFzQixHQUFHLElBQUksQ0FBQTtRQUVsQyxNQUFNLGFBQWEsR0FBRyxJQUFJLENBQUMsYUFBYSxDQUFBO1FBRXhDLGFBQWEsQ0FBQyxrQkFBa0IsRUFBRSxDQUFBO1FBRWxDLElBQUksQ0FBQyxhQUFhLENBQUMsbUJBQW1CLElBQUksQ0FBQyxhQUFhLENBQUMsa0JBQWtCO1lBQUUsT0FBTTtRQUVuRixNQUFNLE1BQU0sR0FBRyxJQUFJLE1BQU0sQ0FBQyxhQUFhLENBQUMsbUJBQW1CLEVBQUUsRUFBQyxhQUFhLEVBQUUsSUFBSSxDQUFDLGFBQWEsRUFBQyxDQUFDLENBQUE7UUFDakcsTUFBTSxPQUFPLEdBQUcsYUFBYSxDQUFDLE9BQU8sRUFBRSxDQUFBO1FBQ3ZDLE1BQU0sUUFBUSxHQUFHLElBQUksQ0FBQyxRQUFRLENBQUE7UUFDOUIsTUFBTSxnQkFBZ0IsR0FBRztZQUN2QixhQUFhLFFBQVEsQ0FBQyxhQUFhLEVBQUUsSUFBSSxRQUFRLENBQUMsZ0JBQWdCLEVBQUUsT0FBTyxJQUFJLENBQUMsS0FBSyxDQUFDLE9BQU8sQ0FBQyxPQUFPLENBQUMsTUFBTTtZQUM1RyxlQUFlLGNBQWMsQ0FBQyxPQUFPLENBQUMsWUFBWSxDQUFDLEVBQUU7WUFDckQsYUFBYSxjQUFjLENBQUMsT0FBTyxDQUFDLE9BQU8sQ0FBQyxFQUFFO1lBQzlDLFVBQVUsY0FBYyxDQUFDLE9BQU8sQ0FBQyxJQUFJLENBQUMsS0FBSyxlQUFlLENBQUMsT0FBTyxDQUFDLFlBQVksQ0FBQyxHQUFHO1lBQ25GLGlCQUFpQixjQUFjLENBQUMsT0FBTyxDQUFDLFdBQVcsQ0FBQyxFQUFFO1lBQ3RELEdBQUc7U0FDSixDQUFDLElBQUksQ0FBQyxFQUFFLENBQUMsQ0FBQTtRQUVWLE1BQU0sTUFBTSxDQUFDLGFBQWEsQ0FBQyxrQkFBa0IsQ0FBQyxDQUFDLGdCQUFnQixDQUFDLENBQUE7SUFDbEUsQ0FBQztDQUNGIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbmltcG9ydCB7ZW5zdXJlRXJyb3J9IGZyb20gXCJ0eXBhbmljXCJcbmltcG9ydCBCYWNrdHJhY2VDbGVhbmVyIGZyb20gXCIuLi8uLi91dGlscy9iYWNrdHJhY2UtY2xlYW5lci1ub2RlLmpzXCJcbmltcG9ydCBFdmVudEVtaXR0ZXIgZnJvbSBcIi4uLy4uL3V0aWxzL2V2ZW50LWVtaXR0ZXIuanNcIlxuaW1wb3J0IHtIdHRwUmVzcG9uc2VCb2R5VG9vTGFyZ2VFcnJvcn0gZnJvbSBcIi4vZXJyb3JzLmpzXCJcbmltcG9ydCBMb2dnZXIgZnJvbSBcIi4uLy4uL2xvZ2dlci5qc1wiXG5pbXBvcnQgUmVxdWVzdFRpbWluZyBmcm9tIFwiLi9yZXF1ZXN0LXRpbWluZy5qc1wiXG5pbXBvcnQgUmVzcG9uc2UgZnJvbSBcIi4vcmVzcG9uc2UuanNcIlxuaW1wb3J0IFJvdXRlc1Jlc29sdmVyIGZyb20gXCIuLi8uLi9yb3V0ZXMvcmVzb2x2ZXIuanNcIlxuaW1wb3J0IHtSRVFVRVNUX1RJTUVfWk9ORV9IRUFERVJ9IGZyb20gXCIuLi8uLi90aW1lLXpvbmUuanNcIlxuXG4vKipcbiAqIFJ1bnMgc3RhY2sgZnJhbWUgbGluZS5cbiAqIEBwYXJhbSB7c3RyaW5nIHwgdW5kZWZpbmVkfSBsaW5lIC0gUG90ZW50aWFsIGhlYWRlciBsaW5lLlxuICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciB0aGUgbGluZSBpcyBhIHN0YWNrIGZyYW1lLlxuICovXG5mdW5jdGlvbiBzdGFja0ZyYW1lTGluZShsaW5lKSB7XG4gIGlmICghbGluZSkgcmV0dXJuIGZhbHNlXG5cbiAgcmV0dXJuIC9eYXRcXHMrL3UudGVzdChsaW5lLnRyaW0oKSlcbn1cblxuLyoqXG4gKiBSdW5zIHJlcXVlc3QgZXJyb3Igc3VtbWFyeS5cbiAqIEBwYXJhbSB7RXJyb3J9IGVycm9yIC0gRXJyb3IgdG8gZm9ybWF0IGZvciBsb2dnaW5nLlxuICogQHBhcmFtIHtzdHJpbmcgfCB1bmRlZmluZWR9IGNsZWFuZWRTdGFja1dpdGhIZWFkZXIgLSBDbGVhbmVkIHN0YWNrIHdpdGggaGVhZGVyIGxpbmUuXG4gKiBAcmV0dXJucyB7c3RyaW5nfSAtIEVycm9yIHN1bW1hcnkgbGluZSB3aXRoIHR5cGUgaW5mb3JtYXRpb24uXG4gKi9cbmZ1bmN0aW9uIHJlcXVlc3RFcnJvclN1bW1hcnkoZXJyb3IsIGNsZWFuZWRTdGFja1dpdGhIZWFkZXIpIHtcbiAgY29uc3Qgc3RhY2tIZWFkZXIgPSBjbGVhbmVkU3RhY2tXaXRoSGVhZGVyPy5zcGxpdChcIlxcblwiKVswXT8udHJpbSgpXG5cbiAgaWYgKHN0YWNrSGVhZGVyICYmICFzdGFja0ZyYW1lTGluZShzdGFja0hlYWRlcikpIHJldHVybiBzdGFja0hlYWRlclxuXG4gIGNvbnN0IGVycm9yQ29kZSA9IHR5cGVvZiAvKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqLyAoZXJyb3IpLmNvZGUgPT09IFwic3RyaW5nXCJcbiAgICA/IC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovIChlcnJvcikuY29kZVxuICAgIDogdW5kZWZpbmVkXG4gIGNvbnN0IGVycm9yTWVzc2FnZSA9IGVycm9yLm1lc3NhZ2UgfHwgU3RyaW5nKGVycm9yKVxuXG4gIGlmIChlcnJvckNvZGUpIHJldHVybiBgJHtlcnJvci5uYW1lfSBbJHtlcnJvckNvZGV9XTogJHtlcnJvck1lc3NhZ2V9YFxuXG4gIHJldHVybiBgJHtlcnJvci5uYW1lfTogJHtlcnJvck1lc3NhZ2V9YFxufVxuXG4vKipcbiAqIFJ1bnMgcmVxdWVzdCBlcnJvciBsb2cgZGV0YWlscy5cbiAqIEBwYXJhbSB7RXJyb3J9IGVycm9yIC0gRXJyb3IgdG8gZm9ybWF0IGZvciBsb2dnaW5nLlxuICogQHJldHVybnMge3tcbiAqICAgZXJyb3JTdW1tYXJ5OiBzdHJpbmcsXG4gKiAgIGNsZWFuZWRCYWNrdHJhY2U6IHN0cmluZyB8IHVuZGVmaW5lZCxcbiAqIH19IC0gTG9nIGRldGFpbHMuXG4gKi9cbmZ1bmN0aW9uIHJlcXVlc3RFcnJvckxvZ0RldGFpbHMoZXJyb3IpIHtcbiAgY29uc3QgY2xlYW5lZFN0YWNrV2l0aEhlYWRlciA9IEJhY2t0cmFjZUNsZWFuZXIuZ2V0Q2xlYW5lZFN0YWNrKGVycm9yKVxuICBjb25zdCBlcnJvclN1bW1hcnkgPSByZXF1ZXN0RXJyb3JTdW1tYXJ5KGVycm9yLCBjbGVhbmVkU3RhY2tXaXRoSGVhZGVyKVxuICBjb25zdCBjbGVhbmVkQmFja3RyYWNlID0gQmFja3RyYWNlQ2xlYW5lci5nZXRDbGVhbmVkU3RhY2soZXJyb3IsIHtpbmNsdWRlRXJyb3JIZWFkZXI6IGZhbHNlfSkgfHwgY2xlYW5lZFN0YWNrV2l0aEhlYWRlclxuXG4gIHJldHVybiB7ZXJyb3JTdW1tYXJ5LCBjbGVhbmVkQmFja3RyYWNlfVxufVxuXG4vKipcbiAqIFJ1bnMgcmVxdWVzdCBlcnJvciBsb2cgbWVzc2FnZS5cbiAqIEBwYXJhbSB7e1xuICogICBlcnJvclN1bW1hcnk6IHN0cmluZyxcbiAqICAgY2xlYW5lZEJhY2t0cmFjZTogc3RyaW5nIHwgdW5kZWZpbmVkLFxuICogfX0gbG9nRGV0YWlscyAtIExvZyBkZXRhaWxzLlxuICogQHJldHVybnMge3N0cmluZ30gLSBTaW5nbGUgcmVxdWVzdCBlcnJvciBsb2cgbWVzc2FnZS5cbiAqL1xuZnVuY3Rpb24gcmVxdWVzdEVycm9yTG9nTWVzc2FnZShsb2dEZXRhaWxzKSB7XG4gIGlmICghbG9nRGV0YWlscy5jbGVhbmVkQmFja3RyYWNlKSB7XG4gICAgcmV0dXJuIGBFcnJvciB3aGlsZSBydW5uaW5nIHJlcXVlc3Q6ICR7bG9nRGV0YWlscy5lcnJvclN1bW1hcnl9YFxuICB9XG5cbiAgcmV0dXJuIGBFcnJvciB3aGlsZSBydW5uaW5nIHJlcXVlc3Q6ICR7bG9nRGV0YWlscy5lcnJvclN1bW1hcnl9XFxuQ2xlYW5lZCBiYWNrdHJhY2U6XFxuJHtsb2dEZXRhaWxzLmNsZWFuZWRCYWNrdHJhY2V9YFxufVxuXG4vKipcbiAqIFJ1bnMgcmVzcG9uc2UgYm9keSB0eXBlIGZvciBsb2cuXG4gKiBAcGFyYW0ge1Jlc3BvbnNlfSByZXNwb25zZSAtIFJlc3BvbnNlIG9iamVjdC5cbiAqIEByZXR1cm5zIHtzdHJpbmd9IC0gUmVzcG9uc2UgYm9keSB0eXBlIGZvciBsb2dnaW5nLlxuICovXG5mdW5jdGlvbiByZXNwb25zZUJvZHlUeXBlRm9yTG9nKHJlc3BvbnNlKSB7XG4gIGlmIChyZXNwb25zZS5nZXRGaWxlUGF0aCgpKSByZXR1cm4gXCJmaWxlXCJcblxuICB0cnkge1xuICAgIHJldHVybiB0eXBlb2YgcmVzcG9uc2UuZ2V0Qm9keSgpXG4gIH0gY2F0Y2gge1xuICAgIHJldHVybiBcInVuc2V0XCJcbiAgfVxufVxuXG4vKipcbiAqIFJ1bnMgZm9ybWF0IGJ1Y2tldCBtcy5cbiAqIEBwYXJhbSB7bnVtYmVyfSB2YWx1ZSAtIE1pbGxpc2Vjb25kcy5cbiAqIEByZXR1cm5zIHtzdHJpbmd9IC0gRm9ybWF0dGVkIG1pbGxpc2Vjb25kcyB3aXRoIG9uZSBkZWNpbWFsIHBsYWNlLlxuICovXG5mdW5jdGlvbiBmb3JtYXRCdWNrZXRNcyh2YWx1ZSkge1xuICByZXR1cm4gYCR7dmFsdWUudG9GaXhlZCgxKX1tc2Bcbn1cblxuLyoqXG4gKiBSdW5zIHF1ZXJ5IGNvdW50IGxhYmVsLlxuICogQHBhcmFtIHtudW1iZXJ9IGNvdW50IC0gUXVlcnkgY291bnQuXG4gKiBAcmV0dXJucyB7c3RyaW5nfSAtIFF1ZXJ5IGNvdW50IGxhYmVsLlxuICovXG5mdW5jdGlvbiBxdWVyeUNvdW50TGFiZWwoY291bnQpIHtcbiAgcmV0dXJuIGAke2NvdW50fSAke2NvdW50ID09PSAxID8gXCJxdWVyeVwiIDogXCJxdWVyaWVzXCJ9YFxufVxuXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBWZWxvY2lvdXNIdHRwU2VydmVyQ2xpZW50UmVxdWVzdFJ1bm5lciB7XG4gIGV2ZW50cyA9IG5ldyBFdmVudEVtaXR0ZXIoKVxuXG4gIC8qKlxuICAgKiBSdW5zIGNvbnN0cnVjdG9yLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uLy4uL2NvbmZpZ3VyYXRpb24uanNcIikuZGVmYXVsdH0gYXJncy5jb25maWd1cmF0aW9uIC0gQ29uZmlndXJhdGlvbiBpbnN0YW5jZS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3JlcXVlc3QuanNcIikuZGVmYXVsdCB8IGltcG9ydChcIi4vd2Vic29ja2V0LXJlcXVlc3QuanNcIikuZGVmYXVsdH0gYXJncy5yZXF1ZXN0IC0gUmVxdWVzdCBvYmplY3QuXG4gICAqL1xuICBjb25zdHJ1Y3Rvcih7Y29uZmlndXJhdGlvbiwgcmVxdWVzdH0pIHtcbiAgICBpZiAoIWNvbmZpZ3VyYXRpb24pIHRocm93IG5ldyBFcnJvcihcIk5vIGNvbmZpZ3VyYXRpb24gZ2l2ZW5cIilcbiAgICBpZiAoIXJlcXVlc3QpIHRocm93IG5ldyBFcnJvcihcIk5vIHJlcXVlc3QgZ2l2ZW5cIilcblxuICAgIHRoaXMubG9nZ2VyID0gbmV3IExvZ2dlcih0aGlzKVxuICAgIHRoaXMuY29uZmlndXJhdGlvbiA9IGNvbmZpZ3VyYXRpb25cbiAgICB0aGlzLnJlcXVlc3QgPSByZXF1ZXN0XG4gICAgdGhpcy5yZXNwb25zZSA9IG5ldyBSZXNwb25zZSh7Y29uZmlndXJhdGlvbn0pXG4gICAgdGhpcy5jb21wbGV0ZWRSZXF1ZXN0TG9nZ2VkID0gZmFsc2VcbiAgICB0aGlzLnJlcXVlc3RUaW1pbmcgPSBuZXcgUmVxdWVzdFRpbWluZygpXG4gICAgdGhpcy5zdGF0ZSA9IFwicnVubmluZ1wiXG4gIH1cblxuICBnZXRSZXF1ZXN0KCkgeyByZXR1cm4gdGhpcy5yZXF1ZXN0IH1cbiAgZ2V0U3RhdGUoKSB7IHJldHVybiB0aGlzLnN0YXRlIH1cblxuICBhc3luYyBydW4oKSB7XG4gICAgdGhpcy5yZXF1ZXN0VGltaW5nLnN0YXJ0ZWRBdE1zID0gRGF0ZS5ub3coKVxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuY29uZmlndXJhdGlvbi5ydW5XaXRoUmVxdWVzdFRpbWluZyh0aGlzLnJlcXVlc3RUaW1pbmcsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IHJlZGFjdG9yID0gdGhpcy5jb25maWd1cmF0aW9uLmdldExvZ1JlZGFjdG9yKClcbiAgICAgIGNvbnN0IHNlbnNpdGl2ZVZhbHVlcyA9IHJlZGFjdG9yLnJlcXVlc3RTZW5zaXRpdmVWYWx1ZXModGhpcy5yZXF1ZXN0LCB0aGlzLnJlcXVlc3RUaW1pbmcuZ2V0TG9nU2Vuc2l0aXZlVmFsdWVzKCkpXG5cbiAgICAgIHRoaXMucmVxdWVzdFRpbWluZy5yZWdpc3RlckxvZ1NlbnNpdGl2ZVZhbHVlcyhzZW5zaXRpdmVWYWx1ZXMpXG5cbiAgICAgIC8vIFJ1biB0aGUgd2hvbGUgcmVxdWVzdCBpbnNpZGUgYW55IHBlci10ZXN0IHNoYXJlZCBjb25uZWN0aW9uIGNvbnRleHQgc28gYW5cbiAgICAgIC8vIGluLXByb2Nlc3MgaGFuZGxlciBleGVjdXRlcyBvbiB0aGUgdGVzdCdzIGNvbm5lY3Rpb24gKGFuZCBvcGVuIHRyYW5zYWN0aW9uKS5cbiAgICAgIC8vIE5vIHNoYXJlZCBjb25uZWN0aW9uIGlzIHNldCBvdXRzaWRlIHRlc3RzIC8gaW4gd29ya2VyIHRocmVhZHMsIHNvIHRoaXMgaXMgYVxuICAgICAgLy8gbm8tb3AgdGhlcmUuXG4gICAgICBhd2FpdCB0aGlzLmNvbmZpZ3VyYXRpb24ucnVuV2l0aFRlc3RTaGFyZWRDb25uZWN0aW9uQ29udGV4dHMoYXN5bmMgKCkgPT4ge1xuICAgICAgICBhd2FpdCB0aGlzLl9ydW4oKVxuICAgICAgfSlcbiAgICB9KVxuICB9XG5cbiAgYXN5bmMgX3J1bigpIHtcbiAgICBjb25zdCB7Y29uZmlndXJhdGlvbiwgcmVxdWVzdCwgcmVzcG9uc2V9ID0gdGhpc1xuXG4gICAgaWYgKCFyZXF1ZXN0KSB0aHJvdyBuZXcgRXJyb3IoXCJObyByZXF1ZXN0P1wiKVxuXG4gICAgY29uc3QgcmVkYWN0b3IgPSBjb25maWd1cmF0aW9uLmdldExvZ1JlZGFjdG9yKClcbiAgICBjb25zdCBzZW5zaXRpdmVWYWx1ZXMgPSB0aGlzLnJlcXVlc3RUaW1pbmcuZ2V0TG9nU2Vuc2l0aXZlVmFsdWVzKClcbiAgICBjb25zdCBsb2dnZWRQYXRoID0gcmVkYWN0b3IucmVkYWN0UGF0aChyZXF1ZXN0LnBhdGgoKSwgc2Vuc2l0aXZlVmFsdWVzKVxuXG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IHRoaXMubG9nZ2VyLmRlYnVnKCgpID0+IFtcIlJ1biByZXF1ZXN0IGxpZmVjeWNsZVwiLCB7XG4gICAgICAgIGh0dHBNZXRob2Q6IHJlcXVlc3QuaHR0cE1ldGhvZCgpLFxuICAgICAgICBodHRwVmVyc2lvbjogcmVxdWVzdC5odHRwVmVyc2lvbigpLFxuICAgICAgICBvcmlnaW46IHJlcXVlc3Qub3JpZ2luKCksXG4gICAgICAgIHBhdGg6IGxvZ2dlZFBhdGgsXG4gICAgICAgIHJlbW90ZUFkZHJlc3M6IHJlcXVlc3QucmVtb3RlQWRkcmVzcygpXG4gICAgICB9XSlcbiAgICAgIC8vIEJlZm9yZSB3ZSBjaGVja2VkIGlmIHRoZSBzZWMtZmV0Y2gtbW9kZSB3YXMgXCJjb3JzXCIsIGJ1dCBpdCBzZWVtcyB0aGUgc2VjLWZldGNoLW1vZGUgaXNuJ3QgYWx3YXlzIHByZXNlbnRcbiAgICAgIGF3YWl0IHRoaXMubG9nZ2VyLmRlYnVnKCgpID0+IFtcIlJ1biBDT1JTXCIsIHtodHRwTWV0aG9kOiByZXF1ZXN0Lmh0dHBNZXRob2QoKSwgc2VjRmV0Y2hNb2RlOiByZXF1ZXN0LmhlYWRlcihcInNlYy1mZXRjaC1tb2RlXCIpfV0pXG5cbiAgICAgIGNvbnN0IGNvcnMgPSBjb25maWd1cmF0aW9uLmdldENvcnMoKVxuXG4gICAgICBpZiAoY29ycykge1xuICAgICAgICBhd2FpdCBjb3JzKHtyZXF1ZXN0LCByZXNwb25zZX0pXG4gICAgICAgIGF3YWl0IHRoaXMubG9nZ2VyLmRlYnVnKCgpID0+IFtcIkNPUlMgaGFuZGxlciBkb25lXCIsIHtcbiAgICAgICAgICBodHRwTWV0aG9kOiByZXF1ZXN0Lmh0dHBNZXRob2QoKSxcbiAgICAgICAgICBwYXRoOiBsb2dnZWRQYXRoLFxuICAgICAgICAgIHJlc3BvbnNlU3RhdHVzQ29kZTogcmVzcG9uc2UuZ2V0U3RhdHVzQ29kZSgpXG4gICAgICAgIH1dKVxuICAgICAgfVxuXG4gICAgICBpZiAocmVxdWVzdC5odHRwTWV0aG9kKCkgPT0gXCJPUFRJT05TXCIgJiYgcmVxdWVzdC5oZWFkZXIoXCJzZWMtZmV0Y2gtbW9kZVwiKSA9PSBcImNvcnNcIikge1xuICAgICAgICByZXNwb25zZS5zZXRTdGF0dXMoMjAwKVxuICAgICAgICByZXNwb25zZS5zZXRCb2R5KFwiXCIpXG4gICAgICAgIGF3YWl0IHRoaXMubG9nZ2VyLmRlYnVnKCgpID0+IFtcIkhhbmRsZWQgcHJlZmxpZ2h0IE9QVElPTlMgcmVxdWVzdFwiLCB7XG4gICAgICAgICAgcGF0aDogbG9nZ2VkUGF0aCxcbiAgICAgICAgICByZXNwb25zZVN0YXR1c0NvZGU6IHJlc3BvbnNlLmdldFN0YXR1c0NvZGUoKVxuICAgICAgICB9XSlcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGF3YWl0IHRoaXMubG9nZ2VyLmRlYnVnKFwiUnVuIHJlcXVlc3RcIilcbiAgICAgICAgY29uc3Qgcm91dGVzUmVzb2x2ZXIgPSBuZXcgUm91dGVzUmVzb2x2ZXIoe2NvbmZpZ3VyYXRpb24sIHJlcXVlc3QsIHJlc3BvbnNlfSlcbiAgICAgICAgY29uc3Qgc3RhcnRUaW1lTXMgPSBEYXRlLm5vdygpXG4gICAgICAgIC8qKlxuICAgICAgICAgKiBEZWZpbmVzIHRpbWVvdXRJZC5cbiAgICAgICAgICogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIHNldFRpbWVvdXQ+IHwgdW5kZWZpbmVkfSAqL1xuICAgICAgICBsZXQgdGltZW91dElkXG4gICAgICAgIC8qKlxuICAgICAgICAgKiBEZWZpbmVzIHRpbWVvdXRSZWplY3QuXG4gICAgICAgICAqIEB0eXBlIHsoKGVycm9yOiBFcnJvcikgPT4gdm9pZCkgfCB1bmRlZmluZWR9ICovXG4gICAgICAgIGxldCB0aW1lb3V0UmVqZWN0XG4gICAgICAgIGxldCB0aW1lZE91dCA9IGZhbHNlXG5cbiAgICAgICAgY29uc3Qgc2V0UmVxdWVzdFRpbWVvdXRTZWNvbmRzID0gKC8qKiBAdHlwZSB7bnVtYmVyIHwgdW5kZWZpbmVkfSAqLyB0aW1lb3V0U2Vjb25kcykgPT4ge1xuICAgICAgICAgIGlmICh0aW1lb3V0SWQpIHtcbiAgICAgICAgICAgIGNsZWFyVGltZW91dCh0aW1lb3V0SWQpXG4gICAgICAgICAgICB0aW1lb3V0SWQgPSB1bmRlZmluZWRcbiAgICAgICAgICB9XG5cbiAgICAgICAgICBpZiAodHlwZW9mIHRpbWVvdXRTZWNvbmRzICE9PSBcIm51bWJlclwiIHx8ICFOdW1iZXIuaXNGaW5pdGUodGltZW91dFNlY29uZHMpIHx8IHRpbWVvdXRTZWNvbmRzIDw9IDApIHtcbiAgICAgICAgICAgIHJldHVyblxuICAgICAgICAgIH1cblxuICAgICAgICAgIGNvbnN0IHRpbWVvdXRNcyA9IHRpbWVvdXRTZWNvbmRzICogMTAwMFxuICAgICAgICAgIGNvbnN0IGVsYXBzZWRNcyA9IERhdGUubm93KCkgLSBzdGFydFRpbWVNc1xuICAgICAgICAgIGNvbnN0IHJlbWFpbmluZ01zID0gdGltZW91dE1zIC0gZWxhcHNlZE1zXG5cbiAgICAgICAgICBpZiAocmVtYWluaW5nTXMgPD0gMCkge1xuICAgICAgICAgICAgdGltZW91dFJlamVjdD8uKG5ldyBFcnJvcihgUmVxdWVzdCB0aW1lZCBvdXQgYWZ0ZXIgJHt0aW1lb3V0U2Vjb25kc31zYCkpXG4gICAgICAgICAgICByZXR1cm5cbiAgICAgICAgICB9XG5cbiAgICAgICAgICB0aW1lb3V0SWQgPSBzZXRUaW1lb3V0KCgpID0+IHtcbiAgICAgICAgICAgIHRpbWVvdXRSZWplY3Q/LihuZXcgRXJyb3IoYFJlcXVlc3QgdGltZWQgb3V0IGFmdGVyICR7dGltZW91dFNlY29uZHN9c2ApKVxuICAgICAgICAgIH0sIHJlbWFpbmluZ01zKVxuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgdGltZW91dFByb21pc2UgPSBuZXcgUHJvbWlzZSgoXywgcmVqZWN0KSA9PiB7XG4gICAgICAgICAgdGltZW91dFJlamVjdCA9IChlcnJvcikgPT4ge1xuICAgICAgICAgICAgdGltZWRPdXQgPSB0cnVlXG4gICAgICAgICAgICByZWplY3QoZXJyb3IpXG4gICAgICAgICAgfVxuICAgICAgICB9KVxuXG4gICAgICAgIHJlc3BvbnNlLnNldFJlcXVlc3RUaW1lb3V0TXNDaGFuZ2VIYW5kbGVyKCh0aW1lb3V0U2Vjb25kcykgPT4ge1xuICAgICAgICAgIHNldFJlcXVlc3RUaW1lb3V0U2Vjb25kcyh0aW1lb3V0U2Vjb25kcylcbiAgICAgICAgfSlcblxuICAgICAgICBzZXRSZXF1ZXN0VGltZW91dFNlY29uZHMoY29uZmlndXJhdGlvbi5nZXRSZXF1ZXN0VGltZW91dE1zPy4oKSlcblxuICAgICAgICAvKiogQHR5cGUge1Byb21pc2U8dm9pZD4gfCB1bmRlZmluZWR9ICovXG4gICAgICAgIGxldCByZXNvbHZlUHJvbWlzZVxuXG4gICAgICAgIGNvbnN0IHJ1blJlc29sdmVkUmVxdWVzdCA9IGFzeW5jICgpID0+IHtcbiAgICAgICAgICByZXNvbHZlUHJvbWlzZSA9IHJvdXRlc1Jlc29sdmVyLnJlc29sdmUoKVxuICAgICAgICAgIC8vIEtlZXAgUHJvbWlzZS5yYWNlIGhlcmUgdG8gYWxsb3cgZHluYW1pYyB0aW1lb3V0IHVwZGF0ZXMuXG4gICAgICAgICAgYXdhaXQgUHJvbWlzZS5yYWNlKFtyZXNvbHZlUHJvbWlzZSwgdGltZW91dFByb21pc2VdKVxuICAgICAgICAgIGF3YWl0IHRoaXMubG9nZ2VyLmRlYnVnKCgpID0+IFtcIlJvdXRlcyByZXNvbHZlciBkb25lXCIsIHtcbiAgICAgICAgICAgIGh0dHBNZXRob2Q6IHJlcXVlc3QuaHR0cE1ldGhvZCgpLFxuICAgICAgICAgICAgcGF0aDogbG9nZ2VkUGF0aCxcbiAgICAgICAgICAgIHJlc3BvbnNlU3RhdHVzQ29kZTogcmVzcG9uc2UuZ2V0U3RhdHVzQ29kZSgpLFxuICAgICAgICAgICAgaGFzRmlsZVBhdGg6IEJvb2xlYW4ocmVzcG9uc2UuZ2V0RmlsZVBhdGgoKSksXG4gICAgICAgICAgICBib2R5VHlwZTogcmVzcG9uc2VCb2R5VHlwZUZvckxvZyhyZXNwb25zZSlcbiAgICAgICAgICB9XSlcbiAgICAgICAgfVxuXG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgY29uc3QgcmVxdWVzdFRpbWVab25lID0gcmVxdWVzdC5oZWFkZXIoUkVRVUVTVF9USU1FX1pPTkVfSEVBREVSKVxuXG4gICAgICAgICAgaWYgKHJlcXVlc3RUaW1lWm9uZSAhPT0gdW5kZWZpbmVkICYmIHJlcXVlc3RUaW1lWm9uZSAhPT0gbnVsbCkge1xuICAgICAgICAgICAgYXdhaXQgY29uZmlndXJhdGlvbi5ydW5XaXRoVGltZXpvbmUocmVxdWVzdFRpbWVab25lLCBydW5SZXNvbHZlZFJlcXVlc3QpXG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGF3YWl0IHJ1blJlc29sdmVkUmVxdWVzdCgpXG4gICAgICAgICAgfVxuICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgIGlmICh0aW1lZE91dCAmJiByZXNvbHZlUHJvbWlzZSkge1xuICAgICAgICAgICAgdm9pZCByZXNvbHZlUHJvbWlzZS5jYXRjaCgocmVzb2x2ZUVycm9yKSA9PiB7XG4gICAgICAgICAgICAgIGNvbnN0IHNhZmVSZXNvbHZlRXJyb3IgPSByZWRhY3Rvci5yZWRhY3RFcnJvcihlbnN1cmVFcnJvcihyZXNvbHZlRXJyb3IpLCBzZW5zaXRpdmVWYWx1ZXMpXG5cbiAgICAgICAgICAgICAgdGhpcy5sb2dnZXIud2FybigoKSA9PiBbXCJSZXF1ZXN0IGZpbmlzaGVkIGFmdGVyIHRpbWVvdXRcIiwgc2FmZVJlc29sdmVFcnJvcl0pXG4gICAgICAgICAgICB9KVxuICAgICAgICAgIH1cbiAgICAgICAgICB0aHJvdyBlcnJvclxuICAgICAgICB9IGZpbmFsbHkge1xuICAgICAgICAgIGlmICh0aW1lb3V0SWQpIGNsZWFyVGltZW91dCh0aW1lb3V0SWQpXG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9IGNhdGNoIChlKSB7XG4gICAgICBjb25zdCBlcnJvciA9IGVuc3VyZUVycm9yKGUpXG4gICAgICBjb25zdCBlcnJvcldpdGhDb250ZXh0ID0gLyoqIEB0eXBlIHt7dmVsb2Npb3VzQ29udGV4dD86IG9iamVjdH19ICovIChlcnJvcilcbiAgICAgIGNvbnN0IGVycm9yQ29udGV4dCA9IGVycm9yV2l0aENvbnRleHQudmVsb2Npb3VzQ29udGV4dCB8fCB7c3RhZ2U6IFwicmVxdWVzdC1ydW5uZXJcIn1cbiAgICAgIGNvbnN0IGxvZ0RldGFpbHMgPSByZXF1ZXN0RXJyb3JMb2dEZXRhaWxzKGVycm9yKVxuICAgICAgY29uc3QgcmVkYWN0ZWRMb2dEZXRhaWxzID0ge1xuICAgICAgICBjbGVhbmVkQmFja3RyYWNlOiBsb2dEZXRhaWxzLmNsZWFuZWRCYWNrdHJhY2VcbiAgICAgICAgICA/IHJlZGFjdG9yLnJlZGFjdFN0cmluZyhsb2dEZXRhaWxzLmNsZWFuZWRCYWNrdHJhY2UsIHNlbnNpdGl2ZVZhbHVlcylcbiAgICAgICAgICA6IHVuZGVmaW5lZCxcbiAgICAgICAgZXJyb3JTdW1tYXJ5OiByZWRhY3Rvci5yZWRhY3RTdHJpbmcobG9nRGV0YWlscy5lcnJvclN1bW1hcnksIHNlbnNpdGl2ZVZhbHVlcylcbiAgICAgIH1cblxuICAgICAgYXdhaXQgdGhpcy5sb2dnZXIuZXJyb3IoKCkgPT4gcmVxdWVzdEVycm9yTG9nTWVzc2FnZShyZWRhY3RlZExvZ0RldGFpbHMpKVxuXG4gICAgICBjb25zdCBlcnJvclBheWxvYWQgPSB7XG4gICAgICAgIGNvbnRleHQ6IHJlZGFjdG9yLnJlZGFjdFN0cnVjdHVyZWQoZXJyb3JDb250ZXh0LCBzZW5zaXRpdmVWYWx1ZXMpLFxuICAgICAgICBlcnJvcjogcmVkYWN0b3IucmVkYWN0RXJyb3IoZXJyb3IsIHNlbnNpdGl2ZVZhbHVlcyksXG4gICAgICAgIHJlcXVlc3QsXG4gICAgICAgIHJlc3BvbnNlXG4gICAgICB9XG5cbiAgICAgIGNvbmZpZ3VyYXRpb24uZ2V0RXJyb3JFdmVudHMoKS5lbWl0KFwiZnJhbWV3b3JrLWVycm9yXCIsIGVycm9yUGF5bG9hZClcbiAgICAgIGNvbmZpZ3VyYXRpb24uZ2V0RXJyb3JFdmVudHMoKS5lbWl0KFwiYWxsLWVycm9yXCIsIHtcbiAgICAgICAgLi4uZXJyb3JQYXlsb2FkLFxuICAgICAgICBlcnJvclR5cGU6IFwiZnJhbWV3b3JrLWVycm9yXCJcbiAgICAgIH0pXG5cbiAgICAgIHJlc3BvbnNlLnNldFN0YXR1cyg1MDApXG4gICAgICBpZiAocmVzcG9uc2UuaXNTdHJlYW1pbmcoKSkge1xuICAgICAgICAvLyBUaGUgaGVhZGVycyBhbHJlYWR5IHdlbnQgdG8gdGhlIGNsaWVudCwgc28gYSBwbGFpbiBlcnJvciBib2R5IGlzXG4gICAgICAgIC8vIGltcG9zc2libGUuIFRoZSBoYW5kbGVyIG93bnMgdGhlIHN0cmVhbSBsaWZlY3ljbGU6IGl0IGFib3J0cyB0aGVcbiAgICAgICAgLy8gc3RyZWFtICh0ZXJtaW5hdG9yICsgY2xvc2UgY2FsbGJhY2tzKSBvciwgd2hlbiBpdCBzdGlsbCBjb250cm9sc1xuICAgICAgICAvLyB0aGUgY29ubmVjdGlvbiwgd3JpdGVzIGFuIGVycm9yIFNTRSBmcmFtZS5cbiAgICAgICAgcmVzcG9uc2UuYWJvcnRTdHJlYW0oKVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICByZXNwb25zZS5zZXRFcnJvckJvZHkoZXJyb3IpXG4gICAgICAgIH0gY2F0Y2ggKHJlc3BvbnNlRXJyb3IpIHtcbiAgICAgICAgICBpZiAoIShyZXNwb25zZUVycm9yIGluc3RhbmNlb2YgSHR0cFJlc3BvbnNlQm9keVRvb0xhcmdlRXJyb3IpKSB0aHJvdyByZXNwb25zZUVycm9yXG5cbiAgICAgICAgICByZXNwb25zZS5zZXRCb2R5KFwiXCIpXG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG5cbiAgICBhd2FpdCB0aGlzLmxvZ2dlci5kZWJ1ZygoKSA9PiBbXCJSZXF1ZXN0IHJ1bm5lciBkb25lXCIsIHtcbiAgICAgIGh0dHBNZXRob2Q6IHJlcXVlc3QuaHR0cE1ldGhvZCgpLFxuICAgICAgcGF0aDogbG9nZ2VkUGF0aCxcbiAgICAgIHJlc3BvbnNlU3RhdHVzQ29kZTogcmVzcG9uc2UuZ2V0U3RhdHVzQ29kZSgpXG4gICAgfV0pXG4gICAgdGhpcy5zdGF0ZSA9IFwiZG9uZVwiXG4gICAgdGhpcy5ldmVudHMuZW1pdChcImRvbmVcIiwgdGhpcylcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGxvZyBjb21wbGV0ZWQgcmVxdWVzdC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gTG9ncyB0aGUgY29tcGxldGVkIHJlcXVlc3QgbGluZSBhZnRlciB0aGUgcmVzcG9uc2UgaGFzIGJlZW4gc2VydmVkLlxuICAgKi9cbiAgYXN5bmMgbG9nQ29tcGxldGVkUmVxdWVzdCgpIHtcbiAgICBpZiAodGhpcy5jb21wbGV0ZWRSZXF1ZXN0TG9nZ2VkKSByZXR1cm5cblxuICAgIHRoaXMuY29tcGxldGVkUmVxdWVzdExvZ2dlZCA9IHRydWVcblxuICAgIGNvbnN0IHJlcXVlc3RUaW1pbmcgPSB0aGlzLnJlcXVlc3RUaW1pbmdcblxuICAgIHJlcXVlc3RUaW1pbmcubWFya1Jlc3BvbnNlU2VydmVkKClcblxuICAgIGlmICghcmVxdWVzdFRpbWluZy5jb21wbGV0ZWRMb2dTdWJqZWN0IHx8ICFyZXF1ZXN0VGltaW5nLmNvbXBsZXRlZExvZ01ldGhvZCkgcmV0dXJuXG5cbiAgICBjb25zdCBsb2dnZXIgPSBuZXcgTG9nZ2VyKHJlcXVlc3RUaW1pbmcuY29tcGxldGVkTG9nU3ViamVjdCwge2NvbmZpZ3VyYXRpb246IHRoaXMuY29uZmlndXJhdGlvbn0pXG4gICAgY29uc3Qgc3VtbWFyeSA9IHJlcXVlc3RUaW1pbmcuc3VtbWFyeSgpXG4gICAgY29uc3QgcmVzcG9uc2UgPSB0aGlzLnJlc3BvbnNlXG4gICAgY29uc3QgY29tcGxldGVkTWVzc2FnZSA9IFtcbiAgICAgIGBDb21wbGV0ZWQgJHtyZXNwb25zZS5nZXRTdGF0dXNDb2RlKCl9ICR7cmVzcG9uc2UuZ2V0U3RhdHVzTWVzc2FnZSgpfSBpbiAke01hdGgucm91bmQoc3VtbWFyeS50b3RhbE1zKX1tcyAoYCxcbiAgICAgIGBDb250cm9sbGVyOiAke2Zvcm1hdEJ1Y2tldE1zKHN1bW1hcnkuY29udHJvbGxlck1zKX1gLFxuICAgICAgYCB8IFZpZXdzOiAke2Zvcm1hdEJ1Y2tldE1zKHN1bW1hcnkudmlld3NNcyl9YCxcbiAgICAgIGAgfCBEQjogJHtmb3JtYXRCdWNrZXRNcyhzdW1tYXJ5LmRiTXMpfSAoJHtxdWVyeUNvdW50TGFiZWwoc3VtbWFyeS5kYlF1ZXJ5Q291bnQpfSlgLFxuICAgICAgYCB8IFZlbG9jaW91czogJHtmb3JtYXRCdWNrZXRNcyhzdW1tYXJ5LnZlbG9jaW91c01zKX1gLFxuICAgICAgYClgXG4gICAgXS5qb2luKFwiXCIpXG5cbiAgICBhd2FpdCBsb2dnZXJbcmVxdWVzdFRpbWluZy5jb21wbGV0ZWRMb2dNZXRob2RdKGNvbXBsZXRlZE1lc3NhZ2UpXG4gIH1cbn1cbiJdfQ==