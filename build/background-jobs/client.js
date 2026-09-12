// @ts-check

import timeout, { TimeoutError } from "awaitery/build/timeout.js"
import configurationResolver from "../configuration-resolver.js"
import isPlainObject from "../utils/plain-object.js"
import BackgroundJobEnqueueAcknowledgementTimeoutError from "./enqueue-acknowledgement-timeout-error.js"
import BackgroundJobsSocketRequest from "./socket-request.js"
import { DEFAULT_GENERATION_HANDSHAKE_TIMEOUT_MS, validateGenerationHandshakeTimeoutMs } from "./generation-handshake-timeout-error.js"
import { BACKGROUND_JOB_ACTIVE_STATUSES, BACKGROUND_JOB_EXECUTION_MODES, BACKGROUND_JOB_STATUSES, BACKGROUND_JOB_TERMINAL_STATUSES } from "./job-semantics.js"

const DEFAULT_ENQUEUE_TIMEOUT_MS = 5000
const BACKGROUND_JOB_WAKE_OUTCOMES = ["woken", "already_due", "handed_off", "not_found"]
const BACKGROUND_JOB_NULLABLE_NUMBER_FIELDS = [
  "attempts",
  "childPid",
  "childReceivedAtMs",
  "childStartedAtMs",
  "completedAtMs",
  "createdAtMs",
  "failedAtMs",
  "handedOffAtMs",
  "maxConcurrency",
  "maxRetries",
  "orphanedAtMs",
  "scheduleOrder",
  "scheduledAtMs",
  "timeoutMs"
]
const BACKGROUND_JOB_NULLABLE_STRING_FIELDS = ["childInstanceId", "concurrencyKey", "handoffId", "lastError", "scheduleKey", "workerId"]

/**
 * Checks a required nullable number from a normalized wire row.
 * @param {ReturnType<typeof JSON.parse>} value - Field value.
 * @returns {boolean} - Whether the field is null or a finite number.
 */
function isNullableBackgroundJobNumber(value) {
  return value === null || (typeof value === "number" && Number.isFinite(value))
}

/**
 * Checks a required nullable string from a normalized wire row.
 * @param {ReturnType<typeof JSON.parse>} value - Field value.
 * @returns {boolean} - Whether the field is null or a string.
 */
function isNullableBackgroundJobString(value) {
  return value === null || typeof value === "string"
}

/**
 * Checks that a transport job uses the normalized public camel-case shape.
 * @param {ReturnType<typeof JSON.parse>} value - Transport value.
 * @returns {value is import("./types.js").BackgroundJobRow} - Whether normalized.
 */
function isNormalizedBackgroundJob(value) {
  if (!isPlainObject(value)) return false

  const job = value

  return typeof job.id === "string"
    && typeof job.jobName === "string"
    && Array.isArray(job.args)
    && BACKGROUND_JOB_EXECUTION_MODES.some((executionMode) => executionMode === job.executionMode)
    && typeof job.queue === "string"
    && BACKGROUND_JOB_STATUSES.some((status) => status === job.status)
    && BACKGROUND_JOB_NULLABLE_NUMBER_FIELDS.every((field) => isNullableBackgroundJobNumber(job[field]))
    && BACKGROUND_JOB_NULLABLE_STRING_FIELDS.every((field) => isNullableBackgroundJobString(job[field]))
}

/**
 * Describes an unexpected protocol response without echoing its payload.
 * @param {string} operation - Public operation name.
 * @param {import("./types.js").BackgroundJobSocketMessage} message - Response.
 * @returns {Error} - Protocol error.
 */
function unexpectedResponseError(operation, message) {
  const responseType = message && typeof message.type === "string" ? message.type : "missing type"

  return new Error(`Unexpected ${operation} response: ${responseType}`)
}

export default class BackgroundJobsClient {
  /**
   * Runs constructor.
   * @param {object} [args] - Options.
   * @param {import("../configuration.js").default} [args.configuration] - Configuration.
   * @param {number} [args.enqueueTimeoutMs] - Maximum time to wait for an enqueue acknowledgement in milliseconds (default: 5000).
   * @param {number} [args.generationHandshakeTimeoutMs] - Maximum time to wait for generation acknowledgement (default: 4000).
   * @param {string} [args.generationId] - Explicit release generation identity.
   */
  constructor({configuration, enqueueTimeoutMs = DEFAULT_ENQUEUE_TIMEOUT_MS, generationHandshakeTimeoutMs = DEFAULT_GENERATION_HANDSHAKE_TIMEOUT_MS, generationId} = {}) {
    this.configurationPromise = configuration ? Promise.resolve(configuration) : configurationResolver()
    this.enqueueTimeoutMs = enqueueTimeoutMs
    this.generationHandshakeTimeoutMs = validateGenerationHandshakeTimeoutMs(generationHandshakeTimeoutMs)
    this.explicitGenerationId = generationId
  }

  /**
   * Builds a one-shot client socket request from the resolved configuration.
   * @returns {Promise<BackgroundJobsSocketRequest>} - Socket request.
   */
  async _request() {
    const configuration = await this.configurationPromise
    const {host, port} = configuration.getBackgroundJobsConfig()
    const {generationId} = configuration.resolveBackgroundJobsGenerationConfig({
      generationId: this.explicitGenerationId,
      sourceName: "BackgroundJobsClient"
    })

    return new BackgroundJobsSocketRequest({host, port, role: "client", generationHandshakeTimeoutMs: this.generationHandshakeTimeoutMs, generationId})
  }

  /**
   * Runs enqueue.
   * @param {object} args - Options.
   * @param {string} args.jobName - Job name.
   * @param {Array<ReturnType<typeof JSON.parse>>} args.args - Job args.
   * @param {import("./types.js").BackgroundJobOptions} [args.options] - Job options.
   * @param {string} [args.producerInvocationId] - Stable identity for one owned enqueue invocation.
   * @param {import("./types.js").BackgroundJobProducerProof} [args.producerProof] - Exact internal producer handoff.
   * @returns {Promise<string>} - Job id.
   */
  async enqueue({jobName, args, options, producerInvocationId, producerProof}) {
    const message = {
      type: /** @type {const} */ ("enqueue"),
      jobName,
      args,
      options,
      ...(producerInvocationId ? {producerInvocationId} : {}),
      ...(producerProof ? {producerProof} : {})
    }
    /**
     * Creates safe observations for one attempt without retaining request data.
     * @param {object} args - Attempt identity.
     * @param {"initial" | "owned_replay"} args.attemptKind - Initial attempt or owned replay.
     * @param {number} args.attemptNumber - One-based attempt number.
     * @returns {import("./enqueue-acknowledgement-timeout-error.js").BackgroundJobEnqueueAttempt} - Mutable attempt observations.
     */
    const newAttemptObservation = ({attemptKind, attemptNumber}) => ({
      acknowledgementWaitElapsedMs: 0,
      attemptElapsedMs: 0,
      attemptKind,
      attemptNumber,
      explicitlyRejected: false,
      generationFenced: false,
      requestSent: false
    })
    /**
     * Sends one enqueue attempt. An owned caller may replay this exact message
     * once when transport acknowledgement remains ambiguous after send.
     * @param {import("./enqueue-acknowledgement-timeout-error.js").BackgroundJobEnqueueAttempt} attemptObservation - Mutable attempt observations.
     * @param {Readonly<Array<import("./enqueue-acknowledgement-timeout-error.js").BackgroundJobEnqueueAttempt>>} previousAttempts - Earlier timed-out attempts.
     * @returns {Promise<string>} - Job id.
     */
    const enqueueAttempt = async (attemptObservation, previousAttempts) => {
      const attemptStartedAtMs = Date.now()
      const request = await this._request()
      const requestAbortController = new AbortController()
      const timeoutErrorMessage = `Background job enqueue acknowledgement timed out after ${this.enqueueTimeoutMs}ms`
      /** @type {number | undefined} */
      let requestSentAtMs
      /**
       * Resolves the pre-send phase when the mutation has entered the socket.
       * @type {() => void}
       */
      let markRequestSent = () => {}
      const requestSent = new Promise((resolve) => {
        markRequestSent = () => resolve(undefined)
      })
      /**
       * Applies the configured deadline independently to one request phase.
       * @template T
       * @param {() => Promise<T>} callback - Phase work.
       * @returns {Promise<T>} - Phase result.
       */
      const withEnqueueTimeout = async (callback) => await timeout({
        errorMessage: timeoutErrorMessage,
        timeout: this.enqueueTimeoutMs
      }, async ({control}) => {
        const abortRequest = () => requestAbortController.abort(control.signal.reason)

        control.signal.addEventListener("abort", abortRequest)
        try {
          return await callback()
        } finally {
          control.signal.removeEventListener("abort", abortRequest)
        }
      })
      const requestPromise = request.run({
        signal: requestAbortController.signal,
        onConnect: (jsonSocket) => {
          jsonSocket.send(message)
          attemptObservation.generationFenced = Boolean(request.generationId)
          attemptObservation.requestSent = true
          requestSentAtMs = Date.now()
          markRequestSent()
        },
        onMessage: ({message, resolve, reject}) => {
          if (message?.type === "enqueued") {
            resolve(message.jobId)
            return
          }

          if (message?.type === "enqueue-error") {
            attemptObservation.explicitlyRejected = true
            reject(new Error(message.error || "Failed to enqueue job"))
          }
        }
      })

      await withEnqueueTimeout(async () => await Promise.race([requestSent, requestPromise]))

      try {
        return await withEnqueueTimeout(async () => await requestPromise)
      } catch (error) {
        if (!(error instanceof TimeoutError)) throw error
        if (requestSentAtMs === undefined) throw new Error("Background job enqueue acknowledgement wait started before the request was sent", {cause: error})

        const timedOutAtMs = Date.now()
        // The fired timer proves its logical deadline even when the adjustable wall clock reports a shorter interval.
        const acknowledgementWaitElapsedMs = Math.max(this.enqueueTimeoutMs, timedOutAtMs - requestSentAtMs)

        attemptObservation.acknowledgementWaitElapsedMs = acknowledgementWaitElapsedMs
        attemptObservation.attemptElapsedMs = Math.max(acknowledgementWaitElapsedMs, timedOutAtMs - attemptStartedAtMs)

        throw new BackgroundJobEnqueueAcknowledgementTimeoutError({
          acknowledgementTimeoutMs: this.enqueueTimeoutMs,
          attemptHistory: [...previousAttempts, attemptObservation],
          cause: error,
          generationId: request.generationId,
          jobName,
          producerInvocationId,
          producerProofPresent: Boolean(producerProof)
        })
      }
    }

    const initialAttempt = newAttemptObservation({attemptKind: "initial", attemptNumber: 1})

    try {
      return await enqueueAttempt(initialAttempt, [])
    } catch (error) {
      if (!producerInvocationId || !producerProof || !initialAttempt.generationFenced || !initialAttempt.requestSent || initialAttempt.explicitlyRejected) throw error

      const previousAttempts = error instanceof BackgroundJobEnqueueAcknowledgementTimeoutError ? error.attemptHistory : []
      const replayAttempt = newAttemptObservation({attemptKind: "owned_replay", attemptNumber: 2})

      return await enqueueAttempt(replayAttempt, previousAttempts)
    }
  }

  /**
   * Atomically replaces the queued owner of a stable schedule key.
   * @param {object} args - Options.
   * @param {string} args.scheduleKey - Stable logical schedule key.
   * @param {string} args.jobName - Job name.
   * @param {Array<ReturnType<typeof JSON.parse>>} args.args - Job args.
   * @param {import("./types.js").BackgroundJobOptions} [args.options] - Job options.
   * @returns {Promise<import("./types.js").BackgroundJobReplacementResult>} - Replacement result.
   */
  async replaceScheduled({scheduleKey, jobName, args, options}) {
    const request = await this._request()

    return await request.run({
      onConnect: (jsonSocket) => {
        jsonSocket.send({type: "replace-scheduled", scheduleKey, jobName, args, options})
      },
      onMessage: ({message, resolve, reject}) => {
        if (message?.type === "schedule-replaced") {
          resolve({
            jobId: message.jobId,
            previousJobId: message.previousJobId,
            previousStatus: message.previousStatus
          })
          return
        }

        if (message?.type === "replace-scheduled-error") {
          reject(new Error(message.error || "Failed to replace scheduled job"))
        }
      }
    })
  }

  /**
   * Cancels or detaches the current owner of a stable schedule key.
   * @param {object} args - Options.
   * @param {string} args.scheduleKey - Stable logical schedule key.
   * @returns {Promise<import("./types.js").BackgroundJobCancellationResult>} - Cancellation result.
   */
  async cancelScheduled({scheduleKey}) {
    const request = await this._request()

    return await request.run({
      onConnect: (jsonSocket) => {
        jsonSocket.send({type: "cancel-scheduled", scheduleKey})
      },
      onMessage: ({message, resolve, reject}) => {
        if (message?.type === "schedule-cancelled") {
          resolve({jobId: message.jobId, outcome: message.outcome})
          return
        }

        if (message?.type === "cancel-scheduled-error") {
          reject(new Error(message.error || "Failed to cancel scheduled job"))
        }
      }
    })
  }

  /**
   * Reads current stable ownership and optional terminal history.
   * @param {{scheduleKey: string, includeLatestTerminal?: boolean}} args - Lookup request.
   * @returns {Promise<import("./types.js").BackgroundJobScheduledLookupResult>} - Normalized stable schedule jobs.
   */
  async getScheduledJob({scheduleKey, includeLatestTerminal}) {
    const request = await this._request()

    return await request.run({
      onConnect: (jsonSocket) => {
        jsonSocket.send({type: "get-scheduled-job", scheduleKey, includeLatestTerminal})
      },
      onMessage: ({message, resolve, reject}) => {
        if (message?.type === "scheduled-job") {
          const {currentJob, latestTerminalJob} = message
          const currentJobValid = currentJob === null
            || (isNormalizedBackgroundJob(currentJob) && BACKGROUND_JOB_ACTIVE_STATUSES.some((status) => status === currentJob.status))
          const latestTerminalJobValid = latestTerminalJob === null
            || (isNormalizedBackgroundJob(latestTerminalJob) && BACKGROUND_JOB_TERMINAL_STATUSES.some((status) => status === latestTerminalJob.status))

          if (!currentJobValid || !latestTerminalJobValid) {
            reject(new Error("Invalid getScheduledJob response: expected normalized public job values"))
            return
          }

          resolve({currentJob, latestTerminalJob})
          return
        }

        if (message?.type === "get-scheduled-job-error") {
          reject(new Error(message.error || "Failed to read scheduled job"))
          return
        }

        reject(unexpectedResponseError("getScheduledJob", message))
      }
    })
  }

  /**
   * Expedites a future queued stable owner without changing job identity.
   * @param {{scheduleKey: string}} args - Wake request.
   * @returns {Promise<import("./types.js").BackgroundJobWakeResult>} - Wake result.
   */
  async wakeScheduled({scheduleKey}) {
    const request = await this._request()

    return await request.run({
      onConnect: (jsonSocket) => {
        jsonSocket.send({type: "wake-scheduled", scheduleKey})
      },
      onMessage: ({message, resolve, reject}) => {
        if (message?.type === "schedule-woken") {
          const outcome = message.outcome
          const knownOutcome = BACKGROUND_JOB_WAKE_OUTCOMES.includes(outcome)
          const validJobId = outcome === "not_found" ? message.jobId === null : typeof message.jobId === "string" && message.jobId.length > 0

          if (!knownOutcome || !validJobId) {
            reject(new Error("Invalid wakeScheduled response"))
            return
          }

          resolve({jobId: message.jobId, outcome})
          return
        }

        if (message?.type === "wake-scheduled-error") {
          reject(new Error(message.error || "Failed to wake scheduled job"))
          return
        }

        reject(unexpectedResponseError("wakeScheduled", message))
      }
    })
  }
}
