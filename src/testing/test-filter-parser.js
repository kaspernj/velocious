// @ts-check

const INCLUDE_TAG_FLAGS = new Set(["--tag", "--include-tag", "-t"])
const EXCLUDE_TAG_FLAGS = new Set(["--exclude-tag", "--skip-tag", "-x"])
const EXAMPLE_FLAGS = new Set(["--example", "--name", "-e"])
const GROUPS_FLAGS = new Set(["--groups"])
const GROUP_NUMBER_FLAGS = new Set(["--group-number"])

/**
 * @param {string | undefined} value - Tag argument value.
 * @returns {string[]} - Tags list.
 */
function splitTags(value) {
  if (!value) return []

  return value
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean)
}

/**
 * @param {string} value - Value.
 * @returns {string} - Escaped value for regex.
 */
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/**
 * @param {string[]} patterns - Patterns.
 * @returns {RegExp[]} - Normalized patterns.
 */
export function normalizeExamplePatterns(patterns) {
  const normalized = []

  for (const pattern of patterns) {
    const regexMatch = pattern.match(/^\/(.+)\/([gimsuy]*)$/)

    if (regexMatch) {
      normalized.push(new RegExp(regexMatch[1], regexMatch[2]))
    } else {
      normalized.push(new RegExp(escapeRegExp(pattern)))
    }
  }

  return normalized
}

/**
 * @typedef {object} ParseFiltersResult
 * @property {string[]} includeTags - Tags to include.
 * @property {string[]} excludeTags - Tags to exclude.
 * @property {string[]} examplePatterns - Example name patterns.
 * @property {string[]} filteredProcessArgs - Remaining process args with filter flags removed.
 * @property {number | undefined} groups - Total number of groups for test splitting.
 * @property {number | undefined} groupNumber - Which group to run (1-indexed).
 */

/**
 * @param {string[]} processArgs - Process args.
 * @returns {ParseFiltersResult} - Parsed tags, group options, and process args.
 */
export function parseFilters(processArgs) {
  const includeTags = []
  const excludeTags = []
  const filteredProcessArgs = processArgs.length > 0 ? [processArgs[0]] : []
  const examplePatterns = []

  /** @type {number | undefined} */
  let groups
  /** @type {number | undefined} */
  let groupNumber

  let inRestArgs = false

  for (let i = 1; i < processArgs.length; i++) {
    const arg = processArgs[i]

    if (arg === "--") {
      inRestArgs = true
      filteredProcessArgs.push(arg)
      continue
    }

    if (!inRestArgs) {
      if (INCLUDE_TAG_FLAGS.has(arg)) {
        const nextValue = processArgs[i + 1]

        if (nextValue && !nextValue.startsWith("-")) {
          includeTags.push(...splitTags(nextValue))
          i++
        }
        continue
      }

      if (EXCLUDE_TAG_FLAGS.has(arg)) {
        const nextValue = processArgs[i + 1]

        if (nextValue && !nextValue.startsWith("-")) {
          excludeTags.push(...splitTags(nextValue))
          i++
        }
        continue
      }

      if (arg.startsWith("--tag=")) {
        includeTags.push(...splitTags(arg.slice("--tag=".length)))
        continue
      }

      if (arg.startsWith("--include-tag=")) {
        includeTags.push(...splitTags(arg.slice("--include-tag=".length)))
        continue
      }

      if (arg.startsWith("--exclude-tag=")) {
        excludeTags.push(...splitTags(arg.slice("--exclude-tag=".length)))
        continue
      }

      if (arg.startsWith("--skip-tag=")) {
        excludeTags.push(...splitTags(arg.slice("--skip-tag=".length)))
        continue
      }

      if (EXAMPLE_FLAGS.has(arg)) {
        const nextValue = processArgs[i + 1]

        if (nextValue && !nextValue.startsWith("-")) {
          examplePatterns.push(nextValue)
          i++
        }
        continue
      }

      if (arg.startsWith("--example=")) {
        examplePatterns.push(arg.slice("--example=".length))
        continue
      }

      if (arg.startsWith("--name=")) {
        examplePatterns.push(arg.slice("--name=".length))
        continue
      }

      if (GROUPS_FLAGS.has(arg)) {
        const nextValue = processArgs[i + 1]

        if (nextValue && !nextValue.startsWith("-")) {
          groups = parseInt(nextValue, 10)
          i++
        }
        continue
      }

      if (arg.startsWith("--groups=")) {
        groups = parseInt(arg.slice("--groups=".length), 10)
        continue
      }

      if (GROUP_NUMBER_FLAGS.has(arg)) {
        const nextValue = processArgs[i + 1]

        if (nextValue && !nextValue.startsWith("-")) {
          groupNumber = parseInt(nextValue, 10)
          i++
        }
        continue
      }

      if (arg.startsWith("--group-number=")) {
        groupNumber = parseInt(arg.slice("--group-number=".length), 10)
        continue
      }
    }

    filteredProcessArgs.push(arg)
  }

  return {
    includeTags: Array.from(new Set(includeTags)),
    excludeTags: Array.from(new Set(excludeTags)),
    examplePatterns,
    filteredProcessArgs,
    groups,
    groupNumber
  }
}
