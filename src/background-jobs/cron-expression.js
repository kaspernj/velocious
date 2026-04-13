// @ts-check

/**
 * Minimal POSIX-style 5-field cron parser used by the background-job
 * scheduler. Supports `*`, single values, ranges (`N-M`), steps
 * (`*\/N` or `N-M/N`), comma-separated lists, and the common
 * `@hourly`/`@daily`/`@weekly`/`@monthly`/`@yearly`/`@midnight`
 * shortcuts. Month and day-of-week names (`jan`-`dec`, `sun`-`sat`,
 * case-insensitive) are also accepted.
 *
 * For day-of-month + day-of-week interaction, follows POSIX/Vixie
 * cron semantics: when both fields are restricted (neither `*`), the
 * job fires when EITHER matches. When one is `*` it has no effect.
 */

const MONTH_NAMES = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]
const DAY_NAMES = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"]

const SHORTCUTS = {
  "@hourly": "0 * * * *",
  "@daily": "0 0 * * *",
  "@midnight": "0 0 * * *",
  "@weekly": "0 0 * * 0",
  "@monthly": "0 0 1 * *",
  "@yearly": "0 0 1 1 *",
  "@annually": "0 0 1 1 *"
}

const FIELDS = [
  {name: "minute", min: 0, max: 59},
  {name: "hour", min: 0, max: 23},
  {name: "dayOfMonth", min: 1, max: 31},
  {name: "month", min: 1, max: 12, names: MONTH_NAMES},
  {name: "dayOfWeek", min: 0, max: 6, names: DAY_NAMES}
]

/**
 * @typedef {object} ParsedCron
 * @property {Set<number>} minute - Allowed minute values (0-59).
 * @property {Set<number>} hour - Allowed hour values (0-23).
 * @property {Set<number>} dayOfMonth - Allowed day-of-month values (1-31).
 * @property {Set<number>} month - Allowed month values (1-12).
 * @property {Set<number>} dayOfWeek - Allowed day-of-week values (0-6, 0=Sun).
 * @property {boolean} dayOfMonthRestricted - True when the dayOfMonth field is not `*`.
 * @property {boolean} dayOfWeekRestricted - True when the dayOfWeek field is not `*`.
 * @property {string} expression - Original expression for diagnostics.
 */

/**
 * @param {string} expression - Cron expression or shortcut.
 * @returns {ParsedCron}
 */
export function parseCronExpression(expression) {
  if (typeof expression !== "string" || !expression.trim()) {
    throw new Error(`Invalid cron expression: ${expression}`)
  }

  const trimmed = expression.trim().toLowerCase()
  const expanded = SHORTCUTS[/** @type {keyof typeof SHORTCUTS} */ (trimmed)] || trimmed
  const fields = expanded.split(/\s+/)

  if (fields.length !== 5) {
    throw new Error(`Invalid cron expression "${expression}": expected 5 fields, got ${fields.length}`)
  }

  const [minuteField, hourField, dayOfMonthField, monthField, dayOfWeekField] = fields
  const parsed = {
    minute: parseField(minuteField, FIELDS[0], expression),
    hour: parseField(hourField, FIELDS[1], expression),
    dayOfMonth: parseField(dayOfMonthField, FIELDS[2], expression),
    month: parseField(monthField, FIELDS[3], expression),
    // Cron treats both 0 and 7 as Sunday — normalize 7 down so the
    // rest of the matcher can use 0-6 exclusively.
    dayOfWeek: normalizeDayOfWeek(parseField(dayOfWeekField, FIELDS[4], expression, {extraNames: {"7": "0"}})),
    dayOfMonthRestricted: dayOfMonthField !== "*",
    dayOfWeekRestricted: dayOfWeekField !== "*",
    expression
  }

  return parsed
}

/**
 * @param {Set<number>} dayOfWeek
 * @returns {Set<number>}
 */
function normalizeDayOfWeek(dayOfWeek) {
  if (dayOfWeek.has(7)) {
    dayOfWeek.delete(7)
    dayOfWeek.add(0)
  }

  return dayOfWeek
}

/**
 * @param {string} field - Field expression.
 * @param {{name: string, min: number, max: number, names?: string[]}} fieldSpec - Field spec.
 * @param {string} expression - Whole cron expression for error messages.
 * @param {{extraNames?: Record<string, string>}} [options] - Extra name -> numeric aliases.
 * @returns {Set<number>}
 */
function parseField(field, fieldSpec, expression, options = {}) {
  const result = new Set()

  for (const part of field.split(",")) {
    addPartValues(part, fieldSpec, expression, result, options.extraNames)
  }

  return result
}

/**
 * @param {string} part - Single comma-separated chunk.
 * @param {{name: string, min: number, max: number, names?: string[]}} fieldSpec - Field spec.
 * @param {string} expression - Original expression for errors.
 * @param {Set<number>} result - Accumulator.
 * @param {Record<string, string>} [extraNames] - Extra raw aliases.
 * @returns {void}
 */
function addPartValues(part, fieldSpec, expression, result, extraNames) {
  if (!part) {
    throw new Error(`Invalid ${fieldSpec.name} field in cron expression "${expression}"`)
  }

  const [rangePart, stepPart] = part.split("/")
  const step = stepPart === undefined ? 1 : parseStep(stepPart, fieldSpec, expression)
  const [start, end] = parseRange(rangePart, fieldSpec, expression, stepPart !== undefined, extraNames)

  for (let value = start; value <= end; value += step) {
    if (value < fieldSpec.min || value > fieldSpec.max) {
      throw new Error(`Value ${value} out of range for ${fieldSpec.name} in cron expression "${expression}"`)
    }

    result.add(value)
  }
}

/**
 * @param {string} value - Step value.
 * @param {{name: string, min: number, max: number}} fieldSpec - Field spec.
 * @param {string} expression - Original expression for errors.
 * @returns {number}
 */
function parseStep(value, fieldSpec, expression) {
  const step = Number(value)

  if (!Number.isInteger(step) || step <= 0) {
    throw new Error(`Invalid step "${value}" for ${fieldSpec.name} in cron expression "${expression}"`)
  }

  return step
}

/**
 * @param {string} rangePart - Range portion (before any `/`).
 * @param {{name: string, min: number, max: number, names?: string[]}} fieldSpec - Field spec.
 * @param {string} expression - Original expression for errors.
 * @param {boolean} hasStep - Whether the part had a `/step` suffix.
 * @param {Record<string, string>} [extraNames] - Extra raw aliases (e.g. `{"7": "0"}`).
 * @returns {[number, number]}
 */
function parseRange(rangePart, fieldSpec, expression, hasStep, extraNames) {
  if (rangePart === "*") {
    return [fieldSpec.min, fieldSpec.max]
  }

  const dashIndex = rangePart.indexOf("-")

  if (dashIndex === -1) {
    const value = parseValue(rangePart, fieldSpec, expression, extraNames)

    // `N/step` is shorthand for `N-max/step` (Vixie cron).
    return [value, hasStep ? fieldSpec.max : value]
  }

  const start = parseValue(rangePart.slice(0, dashIndex), fieldSpec, expression, extraNames)
  const end = parseValue(rangePart.slice(dashIndex + 1), fieldSpec, expression, extraNames)

  if (start > end) {
    throw new Error(`Range start ${start} > end ${end} for ${fieldSpec.name} in cron expression "${expression}"`)
  }

  return [start, end]
}

/**
 * @param {string} rawValue - Raw value (may be a name).
 * @param {{name: string, min: number, max: number, names?: string[]}} fieldSpec - Field spec.
 * @param {string} expression - Original expression for errors.
 * @param {Record<string, string>} [extraNames] - Extra raw aliases.
 * @returns {number}
 */
function parseValue(rawValue, fieldSpec, expression, extraNames) {
  if (!rawValue) {
    throw new Error(`Invalid ${fieldSpec.name} value in cron expression "${expression}"`)
  }

  const aliased = extraNames?.[rawValue] ?? rawValue
  const namedIndex = fieldSpec.names?.indexOf(aliased)

  if (typeof namedIndex === "number" && namedIndex !== -1) {
    return namedIndex + fieldSpec.min
  }

  const value = Number(aliased)

  if (!Number.isInteger(value)) {
    throw new Error(`Invalid ${fieldSpec.name} value "${rawValue}" in cron expression "${expression}"`)
  }

  return value
}

const MAX_NEXT_FIRE_ITERATIONS = 366 * 24 * 60

/**
 * Returns the next Date strictly after `from` that satisfies `parsed`.
 * Operates at minute granularity. Bails out with an error after a year
 * of search, which only happens if the expression matches no real time
 * (e.g., `0 0 31 2 *` — Feb 31st).
 *
 * @param {ParsedCron} parsed - Parsed cron expression.
 * @param {Date} from - Reference Date — the next match is strictly after this.
 * @returns {Date}
 */
export function nextCronFireDate(parsed, from) {
  const candidate = new Date(from.getTime())

  candidate.setSeconds(0, 0)
  candidate.setMinutes(candidate.getMinutes() + 1)

  for (let iterations = 0; iterations < MAX_NEXT_FIRE_ITERATIONS; iterations += 1) {
    if (candidateMatches(candidate, parsed)) return candidate

    candidate.setMinutes(candidate.getMinutes() + 1)
  }

  throw new Error(`Cron expression "${parsed.expression}" never matches`)
}

/**
 * @param {Date} candidate - Candidate Date (in local time).
 * @param {ParsedCron} parsed - Parsed expression.
 * @returns {boolean}
 */
function candidateMatches(candidate, parsed) {
  if (!parsed.minute.has(candidate.getMinutes())) return false
  if (!parsed.hour.has(candidate.getHours())) return false
  if (!parsed.month.has(candidate.getMonth() + 1)) return false

  const dayOfMonthMatch = parsed.dayOfMonth.has(candidate.getDate())
  const dayOfWeekMatch = parsed.dayOfWeek.has(candidate.getDay())

  // POSIX/Vixie cron OR semantics: when both day fields are
  // restricted, fire when EITHER matches. When only one is
  // restricted, only that one applies.
  if (parsed.dayOfMonthRestricted && parsed.dayOfWeekRestricted) {
    return dayOfMonthMatch || dayOfWeekMatch
  }

  if (parsed.dayOfMonthRestricted) return dayOfMonthMatch
  if (parsed.dayOfWeekRestricted) return dayOfWeekMatch

  return true
}
