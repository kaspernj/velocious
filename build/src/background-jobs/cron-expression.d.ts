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
export type ParsedCron = {
    /**
     * - Allowed minute values (0-59).
     */
    minute: Set<number>;
    /**
     * - Allowed hour values (0-23).
     */
    hour: Set<number>;
    /**
     * - Allowed day-of-month values (1-31).
     */
    dayOfMonth: Set<number>;
    /**
     * - Allowed month values (1-12).
     */
    month: Set<number>;
    /**
     * - Allowed day-of-week values (0-6, 0=Sun).
     */
    dayOfWeek: Set<number>;
    /**
     * - True when the dayOfMonth field is not `?`.
     */
    dayOfMonthRestricted: boolean;
    /**
     * - True when the dayOfWeek field is not `?`.
     */
    dayOfWeekRestricted: boolean;
    /**
     * - Original expression for diagnostics.
     */
    expression: string;
};
/**
 * Runs the parseCronExpression helper.
 * @param {string} expression - Cron expression or shortcut.
 * @returns {ParsedCron} - Parsed cron schedule fields.
 */
export declare function parseCronExpression(expression: string): ParsedCron;
/**
 * Returns the next Date strictly after `from` that satisfies `parsed`.
 * Operates at minute granularity. Bails out with an error after five
 * years of search, which only happens if the expression matches no
 * real time (e.g., `0 0 31 2 *` — Feb 31st).
 * @param {ParsedCron} parsed - Parsed cron expression.
 * @param {Date} from - Reference Date — the next match is strictly after this.
 * @returns {Date} - Next date matching the expression.
 */
export declare function nextCronFireDate(parsed: ParsedCron, from: Date): Date;
//# sourceMappingURL=cron-expression.d.ts.map