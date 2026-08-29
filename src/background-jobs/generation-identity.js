// @ts-check

import { utf8ByteLength } from "../utils/utf8-byte-length.js"

/**
 * @typedef {object} GenerationValueSource
 * @property {string} name - Human-readable source name.
 * @property {boolean} present - Whether the source was explicitly supplied.
 * @property {ReturnType<typeof JSON.parse> | undefined} value - Supplied value.
 */

const GENERATION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
const WORKER_INSTANCE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const INITIAL_GENERATION_STATES = new Set(["candidate", "active", "retired"])

/**
 * Validates one release generation identifier.
 * @param {ReturnType<typeof JSON.parse> | undefined} value - Candidate value.
 * @param {string} [sourceName] - Source label for failures.
 * @returns {string} - Valid generation id.
 */
export function validateGenerationId(value, sourceName = "background jobs generationId") {
  if (typeof value !== "string" || !GENERATION_ID_PATTERN.test(value)) {
    throw new TypeError(`${sourceName} must match ${GENERATION_ID_PATTERN}`)
  }

  return value
}

/**
 * Resolves explicitly present generation identity sources without precedence.
 * @param {GenerationValueSource[]} sources - Identity sources.
 * @returns {string | undefined} - Identical resolved identity or legacy unset.
 */
export function resolveGenerationId(sources) {
  const presentSources = sources.filter((source) => source.present)

  if (presentSources.length === 0) return undefined

  const values = presentSources.map((source) => validateGenerationId(source.value, source.name))
  const generationId = values[0]

  if (values.some((value) => value !== generationId)) {
    const names = presentSources.map((source) => source.name).join(", ")

    throw new Error(`Conflicting background jobs generation identities from: ${names}`)
  }

  return generationId
}

/**
 * Resolves the boot lifecycle state.
 * @param {GenerationValueSource[]} sources - State sources.
 * @param {string | undefined} generationId - Resolved generation identity.
 * @returns {import("./types.js").BackgroundJobsGenerationInitialState | "active"} - Boot state.
 */
export function resolveInitialGenerationState(sources, generationId) {
  const presentSources = sources.filter((source) => source.present)

  if (presentSources.length === 0) return generationId ? "candidate" : "active"
  if (!generationId) throw new Error("backgroundJobs.initialGenerationState requires backgroundJobs.generationId")

  const values = presentSources.map((source) => {
    if (typeof source.value !== "string" || !INITIAL_GENERATION_STATES.has(source.value)) {
      throw new TypeError(`${source.name} must be "candidate", "active", or "retired"`)
    }

    return /** @type {import("./types.js").BackgroundJobsGenerationInitialState} */ (source.value)
  })
  const state = values[0]

  if (values.some((value) => value !== state)) {
    const names = presentSources.map((source) => source.name).join(", ")

    throw new Error(`Conflicting background jobs initialGenerationState values from: ${names}`)
  }

  return state
}

/**
 * Resolves the optional release-local lifecycle socket path.
 * @param {GenerationValueSource[]} sources - Path sources.
 * @param {string | undefined} generationId - Resolved generation identity.
 * @returns {string | undefined} - Absolute Unix socket path.
 */
export function resolveLifecycleSocketPath(sources, generationId) {
  const presentSources = sources.filter((source) => source.present)

  if (presentSources.length === 0) return undefined
  if (!generationId) throw new Error("backgroundJobs.lifecycleSocketPath requires backgroundJobs.generationId")

  const values = presentSources.map((source) => {
    if (typeof source.value !== "string" || !source.value.startsWith("/") || source.value.includes("\0")) {
      throw new TypeError(`${source.name} must be an absolute Unix socket path`)
    }

    if (utf8ByteLength(source.value) > 103) {
      throw new TypeError(`${source.name} must be at most 103 UTF-8 bytes for portable Unix socket support`)
    }

    return source.value
  })
  const socketPath = values[0]

  if (values.some((value) => value !== socketPath)) {
    const names = presentSources.map((source) => source.name).join(", ")

    throw new Error(`Conflicting background jobs lifecycle socket paths from: ${names}`)
  }

  return socketPath
}

/**
 * Creates the exact durable worker owner token.
 * @param {object} args - Owner parts.
 * @param {string} args.generationId - Release generation.
 * @param {string} args.workerInstanceId - Worker process UUID.
 * @returns {string} - Generation-qualified durable worker id.
 */
export function createGenerationWorkerId({generationId, workerInstanceId}) {
  validateGenerationId(generationId)
  if (!WORKER_INSTANCE_ID_PATTERN.test(workerInstanceId)) throw new TypeError("workerInstanceId must be a UUID")

  return `${generationId}:${workerInstanceId}`
}

/**
 * Parses a generation-qualified durable worker id.
 * @param {ReturnType<typeof JSON.parse>} workerId - Durable worker id.
 * @returns {{generationId: string, workerInstanceId: string} | null} - Parsed owner or null.
 */
export function parseGenerationWorkerId(workerId) {
  if (typeof workerId !== "string") return null

  const separatorIndex = workerId.indexOf(":")
  if (separatorIndex < 1 || separatorIndex !== workerId.lastIndexOf(":")) return null

  const generationId = workerId.slice(0, separatorIndex)
  const workerInstanceId = workerId.slice(separatorIndex + 1)

  if (!GENERATION_ID_PATTERN.test(generationId) || !WORKER_INSTANCE_ID_PATTERN.test(workerInstanceId)) return null

  return {generationId, workerInstanceId}
}

/**
 * Checks exact parsed generation ownership.
 * @param {object} args - Ownership query.
 * @param {string} args.generationId - Expected generation.
 * @param {ReturnType<typeof JSON.parse>} args.workerId - Durable worker id.
 * @returns {boolean} - Whether the parsed owner belongs to the generation.
 */
export function workerIdBelongsToGeneration({generationId, workerId}) {
  const parsed = parseGenerationWorkerId(workerId)

  return parsed?.generationId === generationId
}
