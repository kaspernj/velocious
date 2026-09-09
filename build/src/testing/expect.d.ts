import BaseExpect from "./base-expect.js";
import ExpectToChange from "./expect-to-change.js";
export default class Expect extends BaseExpect {
    _object: any;
    /**
     * Narrows the runtime value to the documented type.
     * @type {Array<Expect | ExpectToChange>} */
    expectations: Array<Expect | ExpectToChange>;
    _not: boolean | undefined;
    /**
     * Runs constructor.
     * @param {ReturnType<typeof JSON.parse>} object - Object.
     */
    constructor(object: ReturnType<typeof JSON.parse>);
    /**
     * Runs and change.
     * @param {() => Promise<number>} changeCallback - Change callback.
     * @returns {ExpectToChange} - The and change.
     */
    andChange(changeCallback: () => Promise<number>): ExpectToChange;
    /**
     * Returns not.
     * @returns {this} - A value.
     */
    get not(): this;
    /**
     * Runs to be.
     * @param {ReturnType<typeof JSON.parse>} result - Result.
     * @returns {void} - No return value.
     */
    toBe(result: ReturnType<typeof JSON.parse>): void;
    /**
     * Runs to be less than.
     * @param {number} result - Result.
     * @returns {void} - No return value.
     */
    toBeLessThan(result: number): void;
    /**
     * Runs to be less than or equal.
     * @param {number} result - Result.
     * @returns {void} - No return value.
     */
    toBeLessThanOrEqual(result: number): void;
    /**
     * Runs to be greater than.
     * @param {number} result - Result.
     * @returns {void} - No return value.
     */
    toBeGreaterThan(result: number): void;
    /**
     * Runs to be greater than or equal.
     * @param {number} result - Result.
     * @returns {void} - No return value.
     */
    toBeGreaterThanOrEqual(result: number): void;
    /**
     * Runs to be close to.
     * @param {number} result - Result.
     * @param {number} [precision] - Decimal precision.
     * @returns {void} - No return value.
     */
    toBeCloseTo(result: number, precision?: number): void;
    /**
     * Runs to have length.
     * @param {number} result - Expected length.
     * @returns {void} - No return value.
     */
    toHaveLength(result: number): void;
    /**
     * Runs to be defined.
     * @returns {void} - No return value.
     */
    toBeDefined(): void;
    /**
     * Runs to be instance of.
     * @param {new (...args: Array<ReturnType<typeof JSON.parse>>) => ReturnType<typeof JSON.parse>} klass - Class constructor to check against (e.g. a built-in like Error).
     * @returns {void} - No return value.
     */
    toBeInstanceOf(klass: new (...args: Array<ReturnType<typeof JSON.parse>>) => ReturnType<typeof JSON.parse>): void;
    /**
     * Runs to be false.
     * @returns {void} - No return value.
     */
    toBeFalse(): void;
    /**
     * Runs to be null.
     * @returns {void} - No return value.
     */
    toBeNull(): void;
    /**
     * Runs to be undefined.
     * @returns {void} - No return value.
     */
    toBeUndefined(): void;
    /**
     * Runs to be true.
     * @returns {void} - No return value.
     */
    toBeTrue(): void;
    /**
     * Runs to be truthy.
     * @returns {void} - No return value.
     */
    toBeTruthy(): void;
    /**
     * Runs to change.
     * @param {() => Promise<number>} changeCallback - Change callback.
     * @returns {ExpectToChange} - The change.
     */
    toChange(changeCallback: () => Promise<number>): ExpectToChange;
    /**
     * Runs to contain.
     * @param {ReturnType<typeof JSON.parse>} valueToContain - Value to contain.
     * @returns {void} - No return value.
     */
    toContain(valueToContain: ReturnType<typeof JSON.parse>): void;
    /**
     * Runs to contain equal.
     * @param {ReturnType<typeof JSON.parse>} valueToContain - Value to contain.
     * @returns {void} - No return value.
     */
    toContainEqual(valueToContain: ReturnType<typeof JSON.parse>): void;
    /**
     * Runs to include.
     * @param {ReturnType<typeof JSON.parse>} valueToInclude - Value to include.
     * @returns {void} - No return value.
     */
    toInclude(valueToInclude: ReturnType<typeof JSON.parse>): void;
    /**
     * Runs to equal.
     * @param {ReturnType<typeof JSON.parse>} result - Result.
     * @returns {void} - No return value.
     */
    toEqual(result: ReturnType<typeof JSON.parse>): void;
    /**
     * Runs to match.
     * @param {RegExp} regex - Regex.
     * @returns {void} - No return value.
     */
    toMatch(regex: RegExp): void;
    /**
     * Runs to match object.
     * @param {Record<string, ReturnType<typeof JSON.parse>> | Array<ReturnType<typeof JSON.parse>>} expected - Expected partial object.
     * @returns {void} - No return value.
     */
    toMatchObject(expected: Record<string, ReturnType<typeof JSON.parse>> | Array<ReturnType<typeof JSON.parse>>): void;
    /**
     * Runs to throw error.
     * @template T extends Error
     * @param {string|T} expectedError - Expected error.
     * @returns {Promise<void>} - Resolves when complete.
     */
    toThrowError<T>(expectedError: string | T): Promise<void>;
    /**
     * Runs to throw.
     * @param {string|RegExp|Error|((new (...args: Array<ReturnType<typeof JSON.parse>>) => Error))} [expected] - Expected error.
     * @returns {Promise<void>} - Resolves when complete.
     */
    toThrow(expected?: string | RegExp | Error | ((new (...args: Array<ReturnType<typeof JSON.parse>>) => Error))): Promise<void>;
    /**
     * Runs execute.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - Resolves with the execute.
     */
    execute(): Promise<ReturnType<typeof JSON.parse>>;
    /**
     * Runs to have attributes.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} result - Result.
     * @returns {void} - No return value.
     */
    toHaveAttributes(result: Record<string, ReturnType<typeof JSON.parse>>): void;
}
//# sourceMappingURL=expect.d.ts.map