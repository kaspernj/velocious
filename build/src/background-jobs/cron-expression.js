/**
 * ParsedCron type.
 * @typedef {object} ParsedCron
 * @property {Set<number>} minute - Allowed minute values (0-59).
 * @property {Set<number>} hour - Allowed hour values (0-23).
 * @property {Set<number>} dayOfMonth - Allowed day-of-month values (1-31).
 * @property {Set<number>} month - Allowed month values (1-12).
 * @property {Set<number>} dayOfWeek - Allowed day-of-week values (0-6, 0=Sun).
 * @property {boolean} dayOfMonthRestricted - True when the dayOfMonth field is not `?`.
 * @property {boolean} dayOfWeekRestricted - True when the dayOfWeek field is not `?`.
 * @property {string} expression - Original expression for diagnostics.
 */
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
const MONTH_NAMES = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const DAY_NAMES = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const SHORTCUTS = {
    "@hourly": "0 * * * *",
    "@daily": "0 0 * * *",
    "@midnight": "0 0 * * *",
    "@weekly": "0 0 * * 0",
    "@monthly": "0 0 1 * *",
    "@yearly": "0 0 1 1 *",
    "@annually": "0 0 1 1 *"
};
const FIELDS = [
    { name: "minute", min: 0, max: 59 },
    { name: "hour", min: 0, max: 23 },
    { name: "dayOfMonth", min: 1, max: 31 },
    { name: "month", min: 1, max: 12, names: MONTH_NAMES },
    // Accept 0-7 so ranges like `5-7` (Fri-Sun) work; we normalize 7
    // down to 0 after parsing in `normalizeDayOfWeek` below.
    { name: "dayOfWeek", min: 0, max: 7, names: DAY_NAMES }
];
/**
 * Runs the parseCronExpression helper.
 * @param {string} expression - Cron expression or shortcut.
 * @returns {ParsedCron} - Parsed cron schedule fields.
 */
export function parseCronExpression(expression) {
    if (typeof expression !== "string" || !expression.trim()) {
        throw new Error(`Invalid cron expression: ${expression}`);
    }
    const trimmed = expression.trim().toLowerCase();
    const expanded = SHORTCUTS[ /** @type {keyof typeof SHORTCUTS} */(trimmed)] || trimmed;
    const fields = expanded.split(/\s+/);
    if (fields.length !== 5) {
        throw new Error(`Invalid cron expression "${expression}": expected 5 fields, got ${fields.length}`);
    }
    const [minuteField, hourField, dayOfMonthField, monthField, dayOfWeekField] = fields;
    const parsed = {
        minute: parseField(minuteField, FIELDS[0], expression),
        hour: parseField(hourField, FIELDS[1], expression),
        dayOfMonth: parseField(dayOfMonthField, FIELDS[2], expression),
        month: parseField(monthField, FIELDS[3], expression),
        // Cron treats both 0 and 7 as Sunday. We accept 7 throughout the
        // parse pass (so `5-7` for Fri-Sun works) and then normalize any
        // 7s down to 0 so the matcher only deals with 0-6.
        dayOfWeek: normalizeDayOfWeek(parseField(dayOfWeekField, FIELDS[4], expression)),
        dayOfMonthRestricted: dayOfMonthField !== "*",
        dayOfWeekRestricted: dayOfWeekField !== "*",
        expression
    };
    return parsed;
}
/**
 * Runs normalize day of week.
 * @param {Set<number>} dayOfWeek - Day-of-week values.
 * @returns {Set<number>} - Normalized day-of-week values.
 */
function normalizeDayOfWeek(dayOfWeek) {
    if (dayOfWeek.has(7)) {
        dayOfWeek.delete(7);
        dayOfWeek.add(0);
    }
    return dayOfWeek;
}
/**
 * Runs parse field.
 * @param {string} field - Field expression.
 * @param {{name: string, min: number, max: number, names?: string[]}} fieldSpec - Field spec.
 * @param {string} expression - Whole cron expression for error messages.
 * @returns {Set<number>} - Parsed allowed field values.
 */
function parseField(field, fieldSpec, expression) {
    const result = new Set();
    for (const part of field.split(",")) {
        addPartValues(part, fieldSpec, expression, result);
    }
    return result;
}
/**
 * Runs add part values.
 * @param {string} part - Single comma-separated chunk.
 * @param {{name: string, min: number, max: number, names?: string[]}} fieldSpec - Field spec.
 * @param {string} expression - Original expression for errors.
 * @param {Set<number>} result - Accumulator.
 * @returns {void}
 */
function addPartValues(part, fieldSpec, expression, result) {
    if (!part) {
        throw new Error(`Invalid ${fieldSpec.name} field in cron expression "${expression}"`);
    }
    const [rangePart, stepPart] = part.split("/");
    const step = stepPart === undefined ? 1 : parseStep(stepPart, fieldSpec, expression);
    const [start, end] = parseRange(rangePart, fieldSpec, expression, stepPart !== undefined);
    for (let value = start; value <= end; value += step) {
        if (value < fieldSpec.min || value > fieldSpec.max) {
            throw new Error(`Value ${value} out of range for ${fieldSpec.name} in cron expression "${expression}"`);
        }
        result.add(value);
    }
}
/**
 * Runs parse step.
 * @param {string} value - Step value.
 * @param {{name: string, min: number, max: number}} fieldSpec - Field spec.
 * @param {string} expression - Original expression for errors.
 * @returns {number} - Parsed positive step size.
 */
function parseStep(value, fieldSpec, expression) {
    const step = Number(value);
    if (!Number.isInteger(step) || step <= 0) {
        throw new Error(`Invalid step "${value}" for ${fieldSpec.name} in cron expression "${expression}"`);
    }
    return step;
}
/**
 * Runs parse range.
 * @param {string} rangePart - Range portion (before ? `/`).
 * @param {{name: string, min: number, max: number, names?: string[]}} fieldSpec - Field spec.
 * @param {string} expression - Original expression for errors.
 * @param {boolean} hasStep - Whether the part had a `/step` suffix.
 * @returns {[number, number]} - Inclusive field range.
 */
function parseRange(rangePart, fieldSpec, expression, hasStep) {
    if (rangePart === "*") {
        return [fieldSpec.min, fieldSpec.max];
    }
    const dashIndex = rangePart.indexOf("-");
    if (dashIndex === -1) {
        const value = parseValue(rangePart, fieldSpec, expression);
        // `N/step` is shorthand for `N-max/step` (Vixie cron).
        return [value, hasStep ? fieldSpec.max : value];
    }
    const start = parseValue(rangePart.slice(0, dashIndex), fieldSpec, expression);
    const end = parseValue(rangePart.slice(dashIndex + 1), fieldSpec, expression);
    if (start > end) {
        throw new Error(`Range start ${start} > end ${end} for ${fieldSpec.name} in cron expression "${expression}"`);
    }
    return [start, end];
}
/**
 * Runs parse value.
 * @param {string} rawValue - Raw value (may be a name).
 * @param {{name: string, min: number, max: number, names?: string[]}} fieldSpec - Field spec.
 * @param {string} expression - Original expression for errors.
 * @returns {number} - Parsed numeric field value.
 */
function parseValue(rawValue, fieldSpec, expression) {
    if (!rawValue) {
        throw new Error(`Invalid ${fieldSpec.name} value in cron expression "${expression}"`);
    }
    const namedIndex = fieldSpec.names?.indexOf(rawValue);
    if (typeof namedIndex === "number" && namedIndex !== -1) {
        return namedIndex + fieldSpec.min;
    }
    const value = Number(rawValue);
    if (!Number.isInteger(value)) {
        throw new Error(`Invalid ${fieldSpec.name} value "${rawValue}" in cron expression "${expression}"`);
    }
    return value;
}
// 5 years of minutes — covers the worst-case legitimate gap, the
// `0 0 29 2 *` (Feb 29) leap-year-only schedule, with a one-year
// buffer so we never report a real cron pattern as "never matches".
const MAX_NEXT_FIRE_ITERATIONS = 5 * 366 * 24 * 60;
/**
 * Returns the next Date strictly after `from` that satisfies `parsed`.
 * Operates at minute granularity. Bails out with an error after five
 * years of search, which only happens if the expression matches no
 * real time (e.g., `0 0 31 2 *` — Feb 31st).
 * @param {ParsedCron} parsed - Parsed cron expression.
 * @param {Date} from - Reference Date — the next match is strictly after this.
 * @returns {Date} - Next date matching the expression.
 */
export function nextCronFireDate(parsed, from) {
    const candidate = new Date(from.getTime());
    candidate.setSeconds(0, 0);
    candidate.setMinutes(candidate.getMinutes() + 1);
    for (let iterations = 0; iterations < MAX_NEXT_FIRE_ITERATIONS; iterations += 1) {
        if (candidateMatches(candidate, parsed))
            return candidate;
        candidate.setMinutes(candidate.getMinutes() + 1);
    }
    throw new Error(`Cron expression "${parsed.expression}" never matches`);
}
/**
 * Runs candidate matches.
 * @param {Date} candidate - Candidate Date (in local time).
 * @param {ParsedCron} parsed - Parsed expression.
 * @returns {boolean} - Whether the candidate matches the parsed schedule.
 */
function candidateMatches(candidate, parsed) {
    if (!parsed.minute.has(candidate.getMinutes()))
        return false;
    if (!parsed.hour.has(candidate.getHours()))
        return false;
    if (!parsed.month.has(candidate.getMonth() + 1))
        return false;
    const dayOfMonthMatch = parsed.dayOfMonth.has(candidate.getDate());
    const dayOfWeekMatch = parsed.dayOfWeek.has(candidate.getDay());
    // POSIX/Vixie cron OR semantics: when both day fields are
    // restricted, fire when EITHER matches. When only one is
    // restricted, only that one applies.
    if (parsed.dayOfMonthRestricted && parsed.dayOfWeekRestricted) {
        return dayOfMonthMatch || dayOfWeekMatch;
    }
    if (parsed.dayOfMonthRestricted)
        return dayOfMonthMatch;
    if (parsed.dayOfWeekRestricted)
        return dayOfWeekMatch;
    return true;
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY3Jvbi1leHByZXNzaW9uLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL2JhY2tncm91bmQtam9icy9jcm9uLWV4cHJlc3Npb24uanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUE7Ozs7Ozs7Ozs7O0dBV0c7QUFDSCxZQUFZO0FBRVo7Ozs7Ozs7Ozs7O0dBV0c7QUFFSCxNQUFNLFdBQVcsR0FBRyxDQUFDLEtBQUssRUFBRSxLQUFLLEVBQUUsS0FBSyxFQUFFLEtBQUssRUFBRSxLQUFLLEVBQUUsS0FBSyxFQUFFLEtBQUssRUFBRSxLQUFLLEVBQUUsS0FBSyxFQUFFLEtBQUssRUFBRSxLQUFLLEVBQUUsS0FBSyxDQUFDLENBQUE7QUFDeEcsTUFBTSxTQUFTLEdBQUcsQ0FBQyxLQUFLLEVBQUUsS0FBSyxFQUFFLEtBQUssRUFBRSxLQUFLLEVBQUUsS0FBSyxFQUFFLEtBQUssRUFBRSxLQUFLLENBQUMsQ0FBQTtBQUVuRSxNQUFNLFNBQVMsR0FBRztJQUNoQixTQUFTLEVBQUUsV0FBVztJQUN0QixRQUFRLEVBQUUsV0FBVztJQUNyQixXQUFXLEVBQUUsV0FBVztJQUN4QixTQUFTLEVBQUUsV0FBVztJQUN0QixVQUFVLEVBQUUsV0FBVztJQUN2QixTQUFTLEVBQUUsV0FBVztJQUN0QixXQUFXLEVBQUUsV0FBVztDQUN6QixDQUFBO0FBRUQsTUFBTSxNQUFNLEdBQUc7SUFDYixFQUFDLElBQUksRUFBRSxRQUFRLEVBQUUsR0FBRyxFQUFFLENBQUMsRUFBRSxHQUFHLEVBQUUsRUFBRSxFQUFDO0lBQ2pDLEVBQUMsSUFBSSxFQUFFLE1BQU0sRUFBRSxHQUFHLEVBQUUsQ0FBQyxFQUFFLEdBQUcsRUFBRSxFQUFFLEVBQUM7SUFDL0IsRUFBQyxJQUFJLEVBQUUsWUFBWSxFQUFFLEdBQUcsRUFBRSxDQUFDLEVBQUUsR0FBRyxFQUFFLEVBQUUsRUFBQztJQUNyQyxFQUFDLElBQUksRUFBRSxPQUFPLEVBQUUsR0FBRyxFQUFFLENBQUMs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QU0sQ0FBQyxTQUFTLENBQUMsR0FBRyxDQUFDLFNBQVMsQ0FBQyxNQUFNLEVBQUUsQ0FBQyxDQUFBO0lBRS9ELDBEQUEwRDtJQUMxRCx5REFBeUQ7SUFDekQscUNBQXFDO0lBQ3JDLElBQUksTUFBTSxDQUFDLG9CQUFvQixJQUFJLE1BQU0sQ0FBQyxtQkFBbUIsRUFBRSxDQUFDO1FBQzlELE9BQU8sZUFBZSxJQUFJLGNBQWMsQ0FBQTtJQUMxQyxDQUFDO0lBRUQsSUFBSSxNQUFNLENBQUMsb0JBQW9CO1FBQUUsT0FBTyxlQUFlLENBQUE7SUFDdkQsSUFBSSxNQUFNLENBQUMsbUJBQW1CO1FBQUUsT0FBTyxjQUFjLENBQUE7SUFFckQsT0FBTyxJQUFJLENBQUE7QUFDYixDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiLyoqXG4gKiBQYXJzZWRDcm9uIHR5cGUuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBQYXJzZWRDcm9uXG4gKiBAcHJvcGVydHkge1NldDxudW1iZXI+fSBtaW51dGUgLSBBbGxvd2VkIG1pbnV0ZSB2YWx1ZXMgKDAtNTkpLlxuICogQHByb3BlcnR5IHtTZXQ8bnVtYmVyPn0gaG91ciAtIEFsbG93ZWQgaG91ciB2YWx1ZXMgKDAtMjMpLlxuICogQHByb3BlcnR5IHtTZXQ8bnVtYmVyPn0gZGF5T2ZNb250aCAtIEFsbG93ZWQgZGF5LW9mLW1vbnRoIHZhbHVlcyAoMS0zMSkuXG4gKiBAcHJvcGVydHkge1NldDxudW1iZXI+fSBtb250aCAtIEFsbG93ZWQgbW9udGggdmFsdWVzICgxLTEyKS5cbiAqIEBwcm9wZXJ0eSB7U2V0PG51bWJlcj59IGRheU9mV2VlayAtIEFsbG93ZWQgZGF5LW9mLXdlZWsgdmFsdWVzICgwLTYsIDA9U3VuKS5cbiAqIEBwcm9wZXJ0eSB7Ym9vbGVhbn0gZGF5T2ZNb250aFJlc3RyaWN0ZWQgLSBUcnVlIHdoZW4gdGhlIGRheU9mTW9udGggZmllbGQgaXMgbm90IGA/YC5cbiAqIEBwcm9wZXJ0eSB7Ym9vbGVhbn0gZGF5T2ZXZWVrUmVzdHJpY3RlZCAtIFRydWUgd2hlbiB0aGUgZGF5T2ZXZWVrIGZpZWxkIGlzIG5vdCBgP2AuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gZXhwcmVzc2lvbiAtIE9yaWdpbmFsIGV4cHJlc3Npb24gZm9yIGRpYWdub3N0aWNzLlxuICovXG4vLyBAdHMtY2hlY2tcblxuLyoqXG4gKiBNaW5pbWFsIFBPU0lYLXN0eWxlIDUtZmllbGQgY3JvbiBwYXJzZXIgdXNlZCBieSB0aGUgYmFja2dyb3VuZC1qb2JcbiAqIHNjaGVkdWxlci4gU3VwcG9ydHMgYCpgLCBzaW5nbGUgdmFsdWVzLCByYW5nZXMgKGBOLU1gKSwgc3RlcHNcbiAqIChgKlxcL05gIG9yIGBOLU0vTmApLCBjb21tYS1zZXBhcmF0ZWQgbGlzdHMsIGFuZCB0aGUgY29tbW9uXG4gKiBgQGhvdXJseWAvYEBkYWlseWAvYEB3ZWVrbHlgL2BAbW9udGhseWAvYEB5ZWFybHlgL2BAbWlkbmlnaHRgXG4gKiBzaG9ydGN1dHMuIE1vbnRoIGFuZCBkYXktb2Ytd2VlayBuYW1lcyAoYGphbmAtYGRlY2AsIGBzdW5gLWBzYXRgLFxuICogY2FzZS1pbnNlbnNpdGl2ZSkgYXJlIGFsc28gYWNjZXB0ZWQuXG4gKlxuICogRm9yIGRheS1vZi1tb250aCArIGRheS1vZi13ZWVrIGludGVyYWN0aW9uLCBmb2xsb3dzIFBPU0lYL1ZpeGllXG4gKiBjcm9uIHNlbWFudGljczogd2hlbiBib3RoIGZpZWxkcyBhcmUgcmVzdHJpY3RlZCAobmVpdGhlciBgKmApLCB0aGVcbiAqIGpvYiBmaXJlcyB3aGVuIEVJVEhFUiBtYXRjaGVzLiBXaGVuIG9uZSBpcyBgKmAgaXQgaGFzIG5vIGVmZmVjdC5cbiAqL1xuXG5jb25zdCBNT05USF9OQU1FUyA9IFtcImphblwiLCBcImZlYlwiLCBcIm1hclwiLCBcImFwclwiLCBcIm1heVwiLCBcImp1blwiLCBcImp1bFwiLCBcImF1Z1wiLCBcInNlcFwiLCBcIm9jdFwiLCBcIm5vdlwiLCBcImRlY1wiXVxuY29uc3QgREFZX05BTUVTID0gW1wic3VuXCIsIFwibW9uXCIsIFwidHVlXCIsIFwid2VkXCIsIFwidGh1XCIsIFwiZnJpXCIsIFwic2F0XCJdXG5cbmNvbnN0IFNIT1JUQ1VUUyA9IHtcbiAgXCJAaG91cmx5XCI6IFwiMCAqICogKiAqXCIsXG4gIFwiQGRhaWx5XCI6IFwiMCAwICogKiAqXCIsXG4gIFwiQG1pZG5pZ2h0XCI6IFwiMCAwICogKiAqXCIsXG4gIFwiQHdlZWtseVwiOiBcIjAgMCAqICogMFwiLFxuICBcIkBtb250aGx5XCI6IFwiMCAwIDEgKiAqXCIsXG4gIFwiQHllYXJseVwiOiBcIjAgMCAxIDEgKlwiLFxuICBcIkBhbm51YWxseVwiOiBcIjAgMCAxIDEgKlwiXG59XG5cbmNvbnN0IEZJRUxEUyA9IFtcbiAge25hbWU6IFwibWludXRlXCIsIG1pbjogMCwgbWF4OiA1OX0sXG4gIHtuYW1lOiBcImhvdXJcIiwgbWluOiAwLCBtYXg6IDIzfSxcbiAge25hbWU6IFwiZGF5T2ZNb250aFwiLCBtaW46IDEsIG1heDogMzF9LFxuICB7bmFtZTogXCJtb250aFwiLCBtaW46IDEsIG1heDogMTIsIG5hbWVzOiBNT05USF9OQU1FU30sXG4gIC8vIEFjY2VwdCAwLTcgc28gcmFuZ2VzIGxpa2UgYDUtN2AgKEZyaS1TdW4pIHdvcms7IHdlIG5vcm1hbGl6ZSA3XG4gIC8vIGRvd24gdG8gMCBhZnRlciBwYXJzaW5nIGluIGBub3JtYWxpemVEYXlPZldlZWtgIGJlbG93LlxuICB7bmFtZTogXCJkYXlPZldlZWtcIiwgbWluOiAwLCBtYXg6IDcsIG5hbWVzOiBEQVlfTkFNRVN9XG5dXG5cbi8qKlxuICogUnVucyB0aGUgcGFyc2VDcm9uRXhwcmVzc2lvbiBoZWxwZXIuXG4gKiBAcGFyYW0ge3N0cmluZ30gZXhwcmVzc2lvbiAtIENyb24gZXhwcmVzc2lvbiBvciBzaG9ydGN1dC5cbiAqIEByZXR1cm5zIHtQYXJzZWRDcm9ufSAtIFBhcnNlZCBjcm9uIHNjaGVkdWxlIGZpZWxkcy5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHBhcnNlQ3JvbkV4cHJlc3Npb24oZXhwcmVzc2lvbikge1xuICBpZiAodHlwZW9mIGV4cHJlc3Npb24gIT09IFwic3RyaW5nXCIgfHwgIWV4cHJlc3Npb24udHJpbSgpKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGBJbnZhbGlkIGNyb24gZXhwcmVzc2lvbjogJHtleHByZXNzaW9ufWApXG4gIH1cblxuICBjb25zdCB0cmltbWVkID0gZXhwcmVzc2lvbi50cmltKCkudG9Mb3dlckNhc2UoKVxuICBjb25zdCBleHBhbmRlZCA9IFNIT1JUQ1VUU1svKiogQHR5cGUge2tleW9mIHR5cGVvZiBTSE9SVENVVFN9ICovICh0cmltbWVkKV0gfHwgdHJpbW1lZFxuICBjb25zdCBmaWVsZHMgPSBleHBhbmRlZC5zcGxpdCgvXFxzKy8pXG5cbiAgaWYgKGZpZWxkcy5sZW5ndGggIT09IDUpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYEludmFsaWQgY3JvbiBleHByZXNzaW9uIFwiJHtleHByZXNzaW9ufVwiOiBleHBlY3RlZCA1IGZpZWxkcywgZ290ICR7ZmllbGRzLmxlbmd0aH1gKVxuICB9XG5cbiAgY29uc3QgW21pbnV0ZUZpZWxkLCBob3VyRmllbGQsIGRheU9mTW9udGhGaWVsZCwgbW9udGhGaWVsZCwgZGF5T2ZXZWVrRmllbGRdID0gZmllbGRzXG4gIGNvbnN0IHBhcnNlZCA9IHtcbiAgICBtaW51dGU6IHBhcnNlRmllbGQobWludXRlRmllbGQsIEZJRUxEU1swXSwgZXhwcmVzc2lvbiksXG4gICAgaG91cjogcGFyc2VGaWVsZChob3VyRmllbGQsIEZJRUxEU1sxXSwgZXhwcmVzc2lvbiksXG4gICAgZGF5T2ZNb250aDogcGFyc2VGaWVsZChkYXlPZk1vbnRoRmllbGQsIEZJRUxEU1syXSwgZXhwcmVzc2lvbiksXG4gICAgbW9udGg6IHBhcnNlRmllbGQobW9udGhGaWVsZCwgRklFTERTWzNdLCBleHByZXNzaW9uKSxcbiAgICAvLyBDcm9uIHRyZWF0cyBib3RoIDAgYW5kIDcgYXMgU3VuZGF5LiBXZSBhY2NlcHQgNyB0aHJvdWdob3V0IHRoZVxuICAgIC8vIHBhcnNlIHBhc3MgKHNvIGA1LTdgIGZvciBGcmktU3VuIHdvcmtzKSBhbmQgdGhlbiBub3JtYWxpemUgYW55XG4gICAgLy8gN3MgZG93biB0byAwIHNvIHRoZSBtYXRjaGVyIG9ubHkgZGVhbHMgd2l0aCAwLTYuXG4gICAgZGF5T2ZXZWVrOiBub3JtYWxpemVEYXlPZldlZWsocGFyc2VGaWVsZChkYXlPZldlZWtGaWVsZCwgRklFTERTWzRdLCBleHByZXNzaW9uKSksXG4gICAgZGF5T2ZNb250aFJlc3RyaWN0ZWQ6IGRheU9mTW9udGhGaWVsZCAhPT0gXCIqXCIsXG4gICAgZGF5T2ZXZWVrUmVzdHJpY3RlZDogZGF5T2ZXZWVrRmllbGQgIT09IFwiKlwiLFxuICAgIGV4cHJlc3Npb25cbiAgfVxuXG4gIHJldHVybiBwYXJzZWRcbn1cblxuLyoqXG4gKiBSdW5zIG5vcm1hbGl6ZSBkYXkgb2Ygd2Vlay5cbiAqIEBwYXJhbSB7U2V0PG51bWJlcj59IGRheU9mV2VlayAtIERheS1vZi13ZWVrIHZhbHVlcy5cbiAqIEByZXR1cm5zIHtTZXQ8bnVtYmVyPn0gLSBOb3JtYWxpemVkIGRheS1vZi13ZWVrIHZhbHVlcy5cbiAqL1xuZnVuY3Rpb24gbm9ybWFsaXplRGF5T2ZXZWVrKGRheU9mV2Vlaykge1xuICBpZiAoZGF5T2ZXZWVrLmhhcyg3KSkge1xuICAgIGRheU9mV2Vlay5kZWxldGUoNylcbiAgICBkYXlPZldlZWsuYWRkKDApXG4gIH1cblxuICByZXR1cm4gZGF5T2ZXZWVrXG59XG5cbi8qKlxuICogUnVucyBwYXJzZSBmaWVsZC5cbiAqIEBwYXJhbSB7c3RyaW5nfSBmaWVsZCAtIEZpZWxkIGV4cHJlc3Npb24uXG4gKiBAcGFyYW0ge3tuYW1lOiBzdHJpbmcsIG1pbjogbnVtYmVyLCBtYXg6IG51bWJlciwgbmFtZXM/OiBzdHJpbmdbXX19IGZpZWxkU3BlYyAtIEZpZWxkIHNwZWMuXG4gKiBAcGFyYW0ge3N0cmluZ30gZXhwcmVzc2lvbiAtIFdob2xlIGNyb24gZXhwcmVzc2lvbiBmb3IgZXJyb3IgbWVzc2FnZXMuXG4gKiBAcmV0dXJucyB7U2V0PG51bWJlcj59IC0gUGFyc2VkIGFsbG93ZWQgZmllbGQgdmFsdWVzLlxuICovXG5mdW5jdGlvbiBwYXJzZUZpZWxkKGZpZWxkLCBmaWVsZFNwZWMsIGV4cHJlc3Npb24pIHtcbiAgY29uc3QgcmVzdWx0ID0gbmV3IFNldCgpXG5cbiAgZm9yIChjb25zdCBwYXJ0IG9mIGZpZWxkLnNwbGl0KFwiLFwiKSkge1xuICAgIGFkZFBhcnRWYWx1ZXMocGFydCwgZmllbGRTcGVjLCBleHByZXNzaW9uLCByZXN1bHQpXG4gIH1cblxuICByZXR1cm4gcmVzdWx0XG59XG5cbi8qKlxuICogUnVucyBhZGQgcGFydCB2YWx1ZXMuXG4gKiBAcGFyYW0ge3N0cmluZ30gcGFydCAtIFNpbmdsZSBjb21tYS1zZXBhcmF0ZWQgY2h1bmsuXG4gKiBAcGFyYW0ge3tuYW1lOiBzdHJpbmcsIG1pbjogbnVtYmVyLCBtYXg6IG51bWJlciwgbmFtZXM/OiBzdHJpbmdbXX19IGZpZWxkU3BlYyAtIEZpZWxkIHNwZWMuXG4gKiBAcGFyYW0ge3N0cmluZ30gZXhwcmVzc2lvbiAtIE9yaWdpbmFsIGV4cHJlc3Npb24gZm9yIGVycm9ycy5cbiAqIEBwYXJhbSB7U2V0PG51bWJlcj59IHJlc3VsdCAtIEFjY3VtdWxhdG9yLlxuICogQHJldHVybnMge3ZvaWR9XG4gKi9cbmZ1bmN0aW9uIGFkZFBhcnRWYWx1ZXMocGFydCwgZmllbGRTcGVjLCBleHByZXNzaW9uLCByZXN1bHQpIHtcbiAgaWYgKCFwYXJ0KSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGBJbnZhbGlkICR7ZmllbGRTcGVjLm5hbWV9IGZpZWxkIGluIGNyb24gZXhwcmVzc2lvbiBcIiR7ZXhwcmVzc2lvbn1cImApXG4gIH1cblxuICBjb25zdCBbcmFuZ2VQYXJ0LCBzdGVwUGFydF0gPSBwYXJ0LnNwbGl0KFwiL1wiKVxuICBjb25zdCBzdGVwID0gc3RlcFBhcnQgPT09IHVuZGVmaW5lZCA/IDEgOiBwYXJzZVN0ZXAoc3RlcFBhcnQsIGZpZWxkU3BlYywgZXhwcmVzc2lvbilcbiAgY29uc3QgW3N0YXJ0LCBlbmRdID0gcGFyc2VSYW5nZShyYW5nZVBhcnQsIGZpZWxkU3BlYywgZXhwcmVzc2lvbiwgc3RlcFBhcnQgIT09IHVuZGVmaW5lZClcblxuICBmb3IgKGxldCB2YWx1ZSA9IHN0YXJ0OyB2YWx1ZSA8PSBlbmQ7IHZhbHVlICs9IHN0ZXApIHtcbiAgICBpZiAodmFsdWUgPCBmaWVsZFNwZWMubWluIHx8IHZhbHVlID4gZmllbGRTcGVjLm1heCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBWYWx1ZSAke3ZhbHVlfSBvdXQgb2YgcmFuZ2UgZm9yICR7ZmllbGRTcGVjLm5hbWV9IGluIGNyb24gZXhwcmVzc2lvbiBcIiR7ZXhwcmVzc2lvbn1cImApXG4gICAgfVxuXG4gICAgcmVzdWx0LmFkZCh2YWx1ZSlcbiAgfVxufVxuXG4vKipcbiAqIFJ1bnMgcGFyc2Ugc3RlcC5cbiAqIEBwYXJhbSB7c3RyaW5nfSB2YWx1ZSAtIFN0ZXAgdmFsdWUuXG4gKiBAcGFyYW0ge3tuYW1lOiBzdHJpbmcsIG1pbjogbnVtYmVyLCBtYXg6IG51bWJlcn19IGZpZWxkU3BlYyAtIEZpZWxkIHNwZWMuXG4gKiBAcGFyYW0ge3N0cmluZ30gZXhwcmVzc2lvbiAtIE9yaWdpbmFsIGV4cHJlc3Npb24gZm9yIGVycm9ycy5cbiAqIEByZXR1cm5zIHtudW1iZXJ9IC0gUGFyc2VkIHBvc2l0aXZlIHN0ZXAgc2l6ZS5cbiAqL1xuZnVuY3Rpb24gcGFyc2VTdGVwKHZhbHVlLCBmaWVsZFNwZWMsIGV4cHJlc3Npb24pIHtcbiAgY29uc3Qgc3RlcCA9IE51bWJlcih2YWx1ZSlcblxuICBpZiAoIU51bWJlci5pc0ludGVnZXIoc3RlcCkgfHwgc3RlcCA8PSAwKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGBJbnZhbGlkIHN0ZXAgXCIke3ZhbHVlfVwiIGZvciAke2ZpZWxkU3BlYy5uYW1lfSBpbiBjcm9uIGV4cHJlc3Npb24gXCIke2V4cHJlc3Npb259XCJgKVxuICB9XG5cbiAgcmV0dXJuIHN0ZXBcbn1cblxuLyoqXG4gKiBSdW5zIHBhcnNlIHJhbmdlLlxuICogQHBhcmFtIHtzdHJpbmd9IHJhbmdlUGFydCAtIFJhbmdlIHBvcnRpb24gKGJlZm9yZSA/IGAvYCkuXG4gKiBAcGFyYW0ge3tuYW1lOiBzdHJpbmcsIG1pbjogbnVtYmVyLCBtYXg6IG51bWJlciwgbmFtZXM/OiBzdHJpbmdbXX19IGZpZWxkU3BlYyAtIEZpZWxkIHNwZWMuXG4gKiBAcGFyYW0ge3N0cmluZ30gZXhwcmVzc2lvbiAtIE9yaWdpbmFsIGV4cHJlc3Npb24gZm9yIGVycm9ycy5cbiAqIEBwYXJhbSB7Ym9vbGVhbn0gaGFzU3RlcCAtIFdoZXRoZXIgdGhlIHBhcnQgaGFkIGEgYC9zdGVwYCBzdWZmaXguXG4gKiBAcmV0dXJucyB7W251bWJlciwgbnVtYmVyXX0gLSBJbmNsdXNpdmUgZmllbGQgcmFuZ2UuXG4gKi9cbmZ1bmN0aW9uIHBhcnNlUmFuZ2UocmFuZ2VQYXJ0LCBmaWVsZFNwZWMsIGV4cHJlc3Npb24sIGhhc1N0ZXApIHtcbiAgaWYgKHJhbmdlUGFydCA9PT0gXCIqXCIpIHtcbiAgICByZXR1cm4gW2ZpZWxkU3BlYy5taW4sIGZpZWxkU3BlYy5tYXhdXG4gIH1cblxuICBjb25zdCBkYXNoSW5kZXggPSByYW5nZVBhcnQuaW5kZXhPZihcIi1cIilcblxuICBpZiAoZGFzaEluZGV4ID09PSAtMSkge1xuICAgIGNvbnN0IHZhbHVlID0gcGFyc2VWYWx1ZShyYW5nZVBhcnQsIGZpZWxkU3BlYywgZXhwcmVzc2lvbilcblxuICAgIC8vIGBOL3N0ZXBgIGlzIHNob3J0aGFuZCBmb3IgYE4tbWF4L3N0ZXBgIChWaXhpZSBjcm9uKS5cbiAgICByZXR1cm4gW3ZhbHVlLCBoYXNTdGVwID8gZmllbGRTcGVjLm1heCA6IHZhbHVlXVxuICB9XG5cbiAgY29uc3Qgc3RhcnQgPSBwYXJzZVZhbHVlKHJhbmdlUGFydC5zbGljZSgwLCBkYXNoSW5kZXgpLCBmaWVsZFNwZWMsIGV4cHJlc3Npb24pXG4gIGNvbnN0IGVuZCA9IHBhcnNlVmFsdWUocmFuZ2VQYXJ0LnNsaWNlKGRhc2hJbmRleCArIDEpLCBmaWVsZFNwZWMsIGV4cHJlc3Npb24pXG5cbiAgaWYgKHN0YXJ0ID4gZW5kKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGBSYW5nZSBzdGFydCAke3N0YXJ0fSA+IGVuZCAke2VuZH0gZm9yICR7ZmllbGRTcGVjLm5hbWV9IGluIGNyb24gZXhwcmVzc2lvbiBcIiR7ZXhwcmVzc2lvbn1cImApXG4gIH1cblxuICByZXR1cm4gW3N0YXJ0LCBlbmRdXG59XG5cbi8qKlxuICogUnVucyBwYXJzZSB2YWx1ZS5cbiAqIEBwYXJhbSB7c3RyaW5nfSByYXdWYWx1ZSAtIFJhdyB2YWx1ZSAobWF5IGJlIGEgbmFtZSkuXG4gKiBAcGFyYW0ge3tuYW1lOiBzdHJpbmcsIG1pbjogbnVtYmVyLCBtYXg6IG51bWJlciwgbmFtZXM/OiBzdHJpbmdbXX19IGZpZWxkU3BlYyAtIEZpZWxkIHNwZWMuXG4gKiBAcGFyYW0ge3N0cmluZ30gZXhwcmVzc2lvbiAtIE9yaWdpbmFsIGV4cHJlc3Npb24gZm9yIGVycm9ycy5cbiAqIEByZXR1cm5zIHtudW1iZXJ9IC0gUGFyc2VkIG51bWVyaWMgZmllbGQgdmFsdWUuXG4gKi9cbmZ1bmN0aW9uIHBhcnNlVmFsdWUocmF3VmFsdWUsIGZpZWxkU3BlYywgZXhwcmVzc2lvbikge1xuICBpZiAoIXJhd1ZhbHVlKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGBJbnZhbGlkICR7ZmllbGRTcGVjLm5hbWV9IHZhbHVlIGluIGNyb24gZXhwcmVzc2lvbiBcIiR7ZXhwcmVzc2lvbn1cImApXG4gIH1cblxuICBjb25zdCBuYW1lZEluZGV4ID0gZmllbGRTcGVjLm5hbWVzPy5pbmRleE9mKHJhd1ZhbHVlKVxuXG4gIGlmICh0eXBlb2YgbmFtZWRJbmRleCA9PT0gXCJudW1iZXJcIiAmJiBuYW1lZEluZGV4ICE9PSAtMSkge1xuICAgIHJldHVybiBuYW1lZEluZGV4ICsgZmllbGRTcGVjLm1pblxuICB9XG5cbiAgY29uc3QgdmFsdWUgPSBOdW1iZXIocmF3VmFsdWUpXG5cbiAgaWYgKCFOdW1iZXIuaXNJbnRlZ2VyKHZhbHVlKSkge1xuICAgIHRocm93IG5ldyBFcnJvcihgSW52YWxpZCAke2ZpZWxkU3BlYy5uYW1lfSB2YWx1ZSBcIiR7cmF3VmFsdWV9XCIgaW4gY3JvbiBleHByZXNzaW9uIFwiJHtleHByZXNzaW9ufVwiYClcbiAgfVxuXG4gIHJldHVybiB2YWx1ZVxufVxuXG4vLyA1IHllYXJzIG9mIG1pbnV0ZXMg4oCUIGNvdmVycyB0aGUgd29yc3QtY2FzZSBsZWdpdGltYXRlIGdhcCwgdGhlXG4vLyBgMCAwIDI5IDIgKmAgKEZlYiAyOSkgbGVhcC15ZWFyLW9ubHkgc2NoZWR1bGUsIHdpdGggYSBvbmUteWVhclxuLy8gYnVmZmVyIHNvIHdlIG5ldmVyIHJlcG9ydCBhIHJlYWwgY3JvbiBwYXR0ZXJuIGFzIFwibmV2ZXIgbWF0Y2hlc1wiLlxuY29uc3QgTUFYX05FWFRfRklSRV9JVEVSQVRJT05TID0gNSAqIDM2NiAqIDI0ICogNjBcblxuLyoqXG4gKiBSZXR1cm5zIHRoZSBuZXh0IERhdGUgc3RyaWN0bHkgYWZ0ZXIgYGZyb21gIHRoYXQgc2F0aXNmaWVzIGBwYXJzZWRgLlxuICogT3BlcmF0ZXMgYXQgbWludXRlIGdyYW51bGFyaXR5LiBCYWlscyBvdXQgd2l0aCBhbiBlcnJvciBhZnRlciBmaXZlXG4gKiB5ZWFycyBvZiBzZWFyY2gsIHdoaWNoIG9ubHkgaGFwcGVucyBpZiB0aGUgZXhwcmVzc2lvbiBtYXRjaGVzIG5vXG4gKiByZWFsIHRpbWUgKGUuZy4sIGAwIDAgMzEgMiAqYCDigJQgRmViIDMxc3QpLlxuICogQHBhcmFtIHtQYXJzZWRDcm9ufSBwYXJzZWQgLSBQYXJzZWQgY3JvbiBleHByZXNzaW9uLlxuICogQHBhcmFtIHtEYXRlfSBmcm9tIC0gUmVmZXJlbmNlIERhdGUg4oCUIHRoZSBuZXh0IG1hdGNoIGlzIHN0cmljdGx5IGFmdGVyIHRoaXMuXG4gKiBAcmV0dXJucyB7RGF0ZX0gLSBOZXh0IGRhdGUgbWF0Y2hpbmcgdGhlIGV4cHJlc3Npb24uXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBuZXh0Q3JvbkZpcmVEYXRlKHBhcnNlZCwgZnJvbSkge1xuICBjb25zdCBjYW5kaWRhdGUgPSBuZXcgRGF0ZShmcm9tLmdldFRpbWUoKSlcblxuICBjYW5kaWRhdGUuc2V0U2Vjb25kcygwLCAwKVxuICBjYW5kaWRhdGUuc2V0TWludXRlcyhjYW5kaWRhdGUuZ2V0TWludXRlcygpICsgMSlcblxuICBmb3IgKGxldCBpdGVyYXRpb25zID0gMDsgaXRlcmF0aW9ucyA8IE1BWF9ORVhUX0ZJUkVfSVRFUkFUSU9OUzsgaXRlcmF0aW9ucyArPSAxKSB7XG4gICAgaWYgKGNhbmRpZGF0ZU1hdGNoZXMoY2FuZGlkYXRlLCBwYXJzZWQpKSByZXR1cm4gY2FuZGlkYXRlXG5cbiAgICBjYW5kaWRhdGUuc2V0TWludXRlcyhjYW5kaWRhdGUuZ2V0TWludXRlcygpICsgMSlcbiAgfVxuXG4gIHRocm93IG5ldyBFcnJvcihgQ3JvbiBleHByZXNzaW9uIFwiJHtwYXJzZWQuZXhwcmVzc2lvbn1cIiBuZXZlciBtYXRjaGVzYClcbn1cblxuLyoqXG4gKiBSdW5zIGNhbmRpZGF0ZSBtYXRjaGVzLlxuICogQHBhcmFtIHtEYXRlfSBjYW5kaWRhdGUgLSBDYW5kaWRhdGUgRGF0ZSAoaW4gbG9jYWwgdGltZSkuXG4gKiBAcGFyYW0ge1BhcnNlZENyb259IHBhcnNlZCAtIFBhcnNlZCBleHByZXNzaW9uLlxuICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciB0aGUgY2FuZGlkYXRlIG1hdGNoZXMgdGhlIHBhcnNlZCBzY2hlZHVsZS5cbiAqL1xuZnVuY3Rpb24gY2FuZGlkYXRlTWF0Y2hlcyhjYW5kaWRhdGUsIHBhcnNlZCkge1xuICBpZiAoIXBhcnNlZC5taW51dGUuaGFzKGNhbmRpZGF0ZS5nZXRNaW51dGVzKCkpKSByZXR1cm4gZmFsc2VcbiAgaWYgKCFwYXJzZWQuaG91ci5oYXMoY2FuZGlkYXRlLmdldEhvdXJzKCkpKSByZXR1cm4gZmFsc2VcbiAgaWYgKCFwYXJzZWQubW9udGguaGFzKGNhbmRpZGF0ZS5nZXRNb250aCgpICsgMSkpIHJldHVybiBmYWxzZVxuXG4gIGNvbnN0IGRheU9mTW9udGhNYXRjaCA9IHBhcnNlZC5kYXlPZk1vbnRoLmhhcyhjYW5kaWRhdGUuZ2V0RGF0ZSgpKVxuICBjb25zdCBkYXlPZldlZWtNYXRjaCA9IHBhcnNlZC5kYXlPZldlZWsuaGFzKGNhbmRpZGF0ZS5nZXREYXkoKSlcblxuICAvLyBQT1NJWC9WaXhpZSBjcm9uIE9SIHNlbWFudGljczogd2hlbiBib3RoIGRheSBmaWVsZHMgYXJlXG4gIC8vIHJlc3RyaWN0ZWQsIGZpcmUgd2hlbiBFSVRIRVIgbWF0Y2hlcy4gV2hlbiBvbmx5IG9uZSBpc1xuICAvLyByZXN0cmljdGVkLCBvbmx5IHRoYXQgb25lIGFwcGxpZXMuXG4gIGlmIChwYXJzZWQuZGF5T2ZNb250aFJlc3RyaWN0ZWQgJiYgcGFyc2VkLmRheU9mV2Vla1Jlc3RyaWN0ZWQpIHtcbiAgICByZXR1cm4gZGF5T2ZNb250aE1hdGNoIHx8IGRheU9mV2Vla01hdGNoXG4gIH1cblxuICBpZiAocGFyc2VkLmRheU9mTW9udGhSZXN0cmljdGVkKSByZXR1cm4gZGF5T2ZNb250aE1hdGNoXG4gIGlmIChwYXJzZWQuZGF5T2ZXZWVrUmVzdHJpY3RlZCkgcmV0dXJuIGRheU9mV2Vla01hdGNoXG5cbiAgcmV0dXJuIHRydWVcbn1cbiJdfQ==