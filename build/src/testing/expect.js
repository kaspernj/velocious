// @ts-check
import { formatValue, minifiedStringify } from "../utils/format-value.js";
import { anythingDifferent } from "set-state-compare/build/diff-utils.js";
import BaseExpect from "./base-expect.js";
import ExpectToChange from "./expect-to-change.js";
import { isArrayContaining, isObjectContaining, matchArrayContaining, matchObject } from "./expect-utils.js";
export default class Expect extends BaseExpect {
    /**
     * Runs constructor.
     * @param {ReturnType<typeof JSON.parse>} object - Object.
     */
    constructor(object) {
        super();
        this._object = object;
        /**
         * Narrows the runtime value to the documented type.
         * @type {Array<Expect | ExpectToChange>} */
        this.expectations = [];
    }
    /**
     * Runs and change.
     * @param {() => Promise<number>} changeCallback - Change callback.
     * @returns {ExpectToChange} - The and change.
     */
    andChange(changeCallback) {
        return this.toChange(changeCallback);
    }
    /**
     * Returns not.
     * @returns {this} - A value.
     */
    get not() {
        this._not = true;
        return this;
    }
    /**
     * Runs to be.
     * @param {ReturnType<typeof JSON.parse>} result - Result.
     * @returns {void} - No return value.
     */
    toBe(result) {
        if (this._not) {
            if (this._object === result) {
                const objectPrint = formatValue(this._object);
                const resultPrint = formatValue(result);
                throw new Error(`${objectPrint} was unexpected not to be ${resultPrint}`);
            }
        }
        else {
            if (this._object !== result) {
                const objectPrint = formatValue(this._object);
                const resultPrint = formatValue(result);
                throw new Error(`${objectPrint} wasn't expected be ${resultPrint}`);
            }
        }
    }
    /**
     * Runs to be less than.
     * @param {number} result - Result.
     * @returns {void} - No return value.
     */
    toBeLessThan(result) {
        if (typeof this._object !== "number" || typeof result !== "number") {
            throw new Error(`Expected numbers but got ${typeof this._object} and ${typeof result}`);
        }
        if (this._not) {
            if (this._object < result) {
                const objectPrint = formatValue(this._object);
                const resultPrint = formatValue(result);
                throw new Error(`${objectPrint} was unexpected to be less than ${resultPrint}`);
            }
        }
        else {
            if (this._object >= result) {
                const objectPrint = formatValue(this._object);
                const resultPrint = formatValue(result);
                throw new Error(`${objectPrint} wasn't expected to be greater than or equal to ${resultPrint}`);
            }
        }
    }
    /**
     * Runs to be less than or equal.
     * @param {number} result - Result.
     * @returns {void} - No return value.
     */
    toBeLessThanOrEqual(result) {
        if (typeof this._object !== "number" || typeof result !== "number") {
            throw new Error(`Expected numbers but got ${typeof this._object} and ${typeof result}`);
        }
        if (this._not) {
            if (this._object <= result) {
                const objectPrint = formatValue(this._object);
                const resultPrint = formatValue(result);
                throw new Error(`${objectPrint} was unexpected to be less than or equal to ${resultPrint}`);
            }
        }
        else {
            if (this._object > result) {
                const objectPrint = formatValue(this._object);
                const resultPrint = formatValue(result);
                throw new Error(`${objectPrint} wasn't expected to be greater than ${resultPrint}`);
            }
        }
    }
    /**
     * Runs to be greater than.
     * @param {number} result - Result.
     * @returns {void} - No return value.
     */
    toBeGreaterThan(result) {
        if (typeof this._object !== "number" || typeof result !== "number") {
            throw new Error(`Expected numbers but got ${typeof this._object} and ${typeof result}`);
        }
        if (this._not) {
            if (this._object > result) {
                const objectPrint = formatValue(this._object);
                const resultPrint = formatValue(result);
                throw new Error(`${objectPrint} was unexpected to be greater than ${resultPrint}`);
            }
        }
        else {
            if (this._object <= result) {
                const objectPrint = formatValue(this._object);
                const resultPrint = formatValue(result);
                throw new Error(`${objectPrint} wasn't expected to be less than or equal to ${resultPrint}`);
            }
        }
    }
    /**
     * Runs to be greater than or equal.
     * @param {number} result - Result.
     * @returns {void} - No return value.
     */
    toBeGreaterThanOrEqual(result) {
        if (typeof this._object !== "number" || typeof result !== "number") {
            throw new Error(`Expected numbers but got ${typeof this._object} and ${typeof result}`);
        }
        if (this._not) {
            if (this._object >= result) {
                const objectPrint = formatValue(this._object);
                const resultPrint = formatValue(result);
                throw new Error(`${objectPrint} was unexpected to be greater than or equal to ${resultPrint}`);
            }
        }
        else {
            if (this._object < result) {
                const objectPrint = formatValue(this._object);
                const resultPrint = formatValue(result);
                throw new Error(`${objectPrint} wasn't expected to be less than ${resultPrint}`);
            }
        }
    }
    /**
     * Runs to be close to.
     * @param {number} result - Result.
     * @param {number} [precision] - Decimal precision.
     * @returns {void} - No return value.
     */
    toBeCloseTo(result, precision = 2) {
        if (typeof this._object !== "number" || typeof result !== "number") {
            throw new Error(`Expected numbers but got ${typeof this._object} and ${typeof result}`);
        }
        if (typeof precision !== "number" || !Number.isFinite(precision)) {
            throw new Error(`Expected precision to be a number but got ${typeof precision}`);
        }
        const tolerance = 0.5 * Math.pow(10, -precision);
        const diff = Math.abs(this._object - result);
        const isClose = diff <= tolerance;
        if (this._not) {
            if (isClose) {
                const objectPrint = formatValue(this._object);
                const resultPrint = formatValue(result);
                throw new Error(`${objectPrint} was unexpected to be close to ${resultPrint}`);
            }
        }
        else {
            if (!isClose) {
                const objectPrint = formatValue(this._object);
                const resultPrint = formatValue(result);
                throw new Error(`${objectPrint} wasn't expected to be close to ${resultPrint}`);
            }
        }
    }
    /**
     * Runs to have length.
     * @param {number} result - Expected length.
     * @returns {void} - No return value.
     */
    toHaveLength(result) {
        if (typeof result !== "number") {
            throw new Error(`Expected length number but got ${typeof result}`);
        }
        if (this._object === null || this._object === undefined || typeof this._object.length !== "number") {
            throw new Error(`Expected value with length but got ${typeof this._object}`);
        }
        const objectPrint = formatValue(this._object);
        const resultPrint = formatValue(result);
        const lengthValue = this._object.length;
        if (this._not) {
            if (lengthValue === result) {
                throw new Error(`${objectPrint} was unexpected to have length ${resultPrint}`);
            }
        }
        else if (lengthValue !== result) {
            throw new Error(`${objectPrint} wasn't expected to have length ${resultPrint}`);
        }
    }
    /**
     * Runs to be defined.
     * @returns {void} - No return value.
     */
    toBeDefined() {
        if (this._not) {
            if (this._object !== undefined) {
                const objectPrint = formatValue(this._object);
                throw new Error(`${objectPrint} wasn´t expected to be defined`);
            }
        }
        else {
            if (this._object === undefined) {
                const objectPrint = formatValue(this._object);
                throw new Error(`${objectPrint} wasn't expected be undefined`);
            }
        }
    }
    /**
     * Runs to be instance of.
     * @param {new (...args: Array<ReturnType<typeof JSON.parse>>) => ReturnType<typeof JSON.parse>} klass - Class constructor to check against (e.g. a built-in like Error).
     * @returns {void} - No return value.
     */
    toBeInstanceOf(klass) {
        if (!(this._object instanceof klass)) {
            const objectPrint = formatValue(this._object);
            throw new Error(`Expected ${objectPrint} to be a ${klass.name} but it wasn't`);
        }
    }
    /**
     * Runs to be false.
     * @returns {void} - No return value.
     */
    toBeFalse() {
        this.toBe(false);
    }
    /**
     * Runs to be null.
     * @returns {void} - No return value.
     */
    toBeNull() {
        this.toBe(null);
    }
    /**
     * Runs to be undefined.
     * @returns {void} - No return value.
     */
    toBeUndefined() {
        this.toBe(undefined);
    }
    /**
     * Runs to be true.
     * @returns {void} - No return value.
     */
    toBeTrue() {
        this.toBe(true);
    }
    /**
     * Runs to be truthy.
     * @returns {void} - No return value.
     */
    toBeTruthy() {
        const objectPrint = formatValue(this._object);
        if (this._not) {
            if (this._object) {
                throw new Error(`${objectPrint} was unexpected to be truthy`);
            }
        }
        else {
            if (!this._object) {
                throw new Error(`${objectPrint} wasn't expected to be truthy`);
            }
        }
    }
    /**
     * Runs to change.
     * @param {() => Promise<number>} changeCallback - Change callback.
     * @returns {ExpectToChange} - The change.
     */
    toChange(changeCallback) {
        if (this._not)
            throw new Error("not stub");
        const expectToChange = new ExpectToChange({ changeCallback, expect: this });
        this.expectations.push(expectToChange);
        return expectToChange;
    }
    /**
     * Runs to contain.
     * @param {ReturnType<typeof JSON.parse>} valueToContain - Value to contain.
     * @returns {void} - No return value.
     */
    toContain(valueToContain) {
        if (typeof this._object == "string") {
            const matches = this._object.includes(String(valueToContain));
            const objectPrint = minifiedStringify(this._object);
            const valuePrint = typeof valueToContain == "string"
                ? minifiedStringify(valueToContain)
                : formatValue(valueToContain);
            if (this._not) {
                if (matches) {
                    throw new Error(`${objectPrint} was unexpected to contain ${valuePrint}`);
                }
            }
            else if (!matches) {
                throw new Error(`${objectPrint} doesn't contain ${valuePrint}`);
            }
            return;
        }
        if (!Array.isArray(this._object)) {
            throw new Error(`Expected array or string but got ${typeof this._object}`);
        }
        const matches = this._object.includes(valueToContain);
        const objectPrint = formatValue(this._object);
        const valuePrint = typeof valueToContain == "string"
            ? minifiedStringify(valueToContain)
            : formatValue(valueToContain);
        if (this._not) {
            if (matches) {
                throw new Error(`${objectPrint} was unexpected to contain ${valuePrint}`);
            }
        }
        else if (!matches) {
            throw new Error(`${objectPrint} doesn't contain ${valuePrint}`);
        }
    }
    /**
     * Runs to contain equal.
     * @param {ReturnType<typeof JSON.parse>} valueToContain - Value to contain.
     * @returns {void} - No return value.
     */
    toContainEqual(valueToContain) {
        if (!Array.isArray(this._object)) {
            throw new Error(`Expected array but got ${typeof this._object}`);
        }
        const matches = this._object.some((item) => !anythingDifferent(item, valueToContain));
        const objectPrint = formatValue(this._object);
        const valuePrint = typeof valueToContain == "string"
            ? minifiedStringify(valueToContain)
            : formatValue(valueToContain);
        if (this._not) {
            if (matches) {
                throw new Error(`${objectPrint} was unexpected to contain ${valuePrint}`);
            }
        }
        else if (!matches) {
            throw new Error(`${objectPrint} doesn't contain ${valuePrint}`);
        }
    }
    /**
     * Runs to include.
     * @param {ReturnType<typeof JSON.parse>} valueToInclude - Value to include.
     * @returns {void} - No return value.
     */
    toInclude(valueToInclude) {
        this.toContain(valueToInclude);
    }
    /**
     * Runs to equal.
     * @param {ReturnType<typeof JSON.parse>} result - Result.
     * @returns {void} - No return value.
     */
    toEqual(result) {
        if (this._object instanceof Set && result instanceof Set) {
            const objectPrint = formatValue(this._object);
            const resultPrint = formatValue(result);
            const actualItems = Array.from(this._object);
            const expectedItems = Array.from(result);
            const missingItems = expectedItems.filter((expectedItem) => {
                return !actualItems.some((actualItem) => !anythingDifferent(actualItem, expectedItem));
            });
            const unexpectedItems = actualItems.filter((actualItem) => {
                return !expectedItems.some((expectedItem) => !anythingDifferent(actualItem, expectedItem));
            });
            const isEqual = missingItems.length === 0 && unexpectedItems.length === 0;
            if (this._not) {
                if (isEqual) {
                    throw new Error(`${objectPrint} was unexpected equal to ${resultPrint}`);
                }
            }
            else if (!isEqual) {
                const missingStrings = missingItems.map((item) => minifiedStringify(item));
                const unexpectedStrings = unexpectedItems.map((item) => minifiedStringify(item));
                const diffParts = [];
                if (missingStrings.length > 0)
                    diffParts.push(`missing ${missingStrings.join(", ")}`);
                if (unexpectedStrings.length > 0)
                    diffParts.push(`unexpected ${unexpectedStrings.join(", ")}`);
                const diffMessage = diffParts.length > 0 ? ` (diff: ${diffParts.join("; ")})` : "";
                throw new Error(`${objectPrint} wasn't equal to ${resultPrint}${diffMessage}`);
            }
            return;
        }
        if (isObjectContaining(result)) {
            const expectedValue = /** @type {ReturnType<typeof JSON.parse>} */ (result).value;
            const { matches, differences } = matchObject(this._object, expectedValue);
            const objectPrint = formatValue(this._object);
            const expectedPrint = formatValue(expectedValue);
            if (this._not) {
                if (matches) {
                    throw new Error(`Expected ${objectPrint} not to match ${expectedPrint}`);
                }
            }
            else if (!matches) {
                const diffPrint = Object.keys(differences).length > 0 ? ` (diff: ${minifiedStringify(differences)})` : "";
                throw new Error(`Expected ${objectPrint} to match ${expectedPrint}${diffPrint}`);
            }
            return;
        }
        if (isArrayContaining(result)) {
            const expectedValue = /** @type {Array<ReturnType<typeof JSON.parse>>} */ ( /** @type {ReturnType<typeof JSON.parse>} */(result).value);
            const { matches, differences } = matchArrayContaining(this._object, expectedValue);
            const objectPrint = formatValue(this._object);
            const expectedPrint = formatValue(expectedValue);
            if (this._not) {
                if (matches) {
                    throw new Error(`Expected ${objectPrint} not to match ${expectedPrint}`);
                }
            }
            else if (!matches) {
                const diffPrint = Object.keys(differences).length > 0 ? ` (diff: ${minifiedStringify(differences)})` : "";
                throw new Error(`Expected ${objectPrint} to match ${expectedPrint}${diffPrint}`);
            }
            return;
        }
        if (this._not) {
            if (typeof this._object == "object" && typeof result == "object") {
                if (!anythingDifferent(this._object, result)) {
                    const objectPrint = formatValue(this._object);
                    const resultPrint = formatValue(result);
                    throw new Error(`${objectPrint} was unexpected equal to ${resultPrint}`);
                }
            }
            else {
                if (this._object == result) {
                    const objectPrint = formatValue(this._object);
                    const resultPrint = formatValue(result);
                    throw new Error(`${objectPrint} was unexpected equal to ${resultPrint}`);
                }
            }
        }
        else {
            if (typeof this._object == "object" && typeof result == "object") {
                if (anythingDifferent(this._object, result)) {
                    const objectPrint = formatValue(this._object);
                    const resultPrint = formatValue(result);
                    if (Array.isArray(this._object) && Array.isArray(result)) {
                        const actualStrings = this._object.map((item) => minifiedStringify(item));
                        const expectedStrings = result.map((item) => minifiedStringify(item));
                        const missingItems = expectedStrings.filter((item) => !actualStrings.includes(item));
                        const unexpectedItems = actualStrings.filter((item) => !expectedStrings.includes(item));
                        const diffParts = [];
                        if (missingItems.length > 0)
                            diffParts.push(`missing ${missingItems.join(", ")}`);
                        if (unexpectedItems.length > 0)
                            diffParts.push(`unexpected ${unexpectedItems.join(", ")}`);
                        const diffMessage = diffParts.length > 0 ? ` (diff: ${diffParts.join("; ")})` : "";
                        throw new Error(`${objectPrint} wasn't equal to ${resultPrint}${diffMessage}`);
                    }
                    throw new Error(`${objectPrint} wasn't equal to ${resultPrint}`);
                }
            }
            else {
                if (this._object != result) {
                    const objectPrint = formatValue(this._object);
                    const resultPrint = formatValue(result);
                    throw new Error(`${objectPrint} wasn't equal to ${resultPrint}`);
                }
            }
        }
    }
    /**
     * Runs to match.
     * @param {RegExp} regex - Regex.
     * @returns {void} - No return value.
     */
    toMatch(regex) {
        if (typeof this._object !== "string") {
            throw new Error(`Expected string but got ${typeof this._object}`);
        }
        const match = this._object.match(regex);
        const objectPrint = minifiedStringify(this._object);
        if (this._not) {
            if (match) {
                throw new Error(`${objectPrint} shouldn't match ${regex}`);
            }
        }
        else {
            if (!match) {
                throw new Error(`${objectPrint} didn't match ${regex}`);
            }
        }
    }
    /**
     * Runs to match object.
     * @param {Record<string, ReturnType<typeof JSON.parse>> | Array<ReturnType<typeof JSON.parse>>} expected - Expected partial object.
     * @returns {void} - No return value.
     */
    toMatchObject(expected) {
        if (expected === null || typeof expected !== "object") {
            throw new Error(`Expected object but got ${typeof expected}`);
        }
        const { matches, differences } = matchObject(this._object, expected);
        const objectPrint = formatValue(this._object);
        const expectedPrint = formatValue(expected);
        if (this._not) {
            if (matches) {
                throw new Error(`Expected ${objectPrint} not to match ${expectedPrint}`);
            }
        }
        else if (!matches) {
            const diffPrint = Object.keys(differences).length > 0 ? ` (diff: ${minifiedStringify(differences)})` : "";
            throw new Error(`Expected ${objectPrint} to match ${expectedPrint}${diffPrint}`);
        }
    }
    /**
     * Runs to throw error.
     * @template T extends Error
     * @param {string|T} expectedError - Expected error.
     * @returns {Promise<void>} - Resolves when complete.
     */
    async toThrowError(expectedError) {
        if (this._not)
            throw new Error("not stub");
        let failedError;
        try {
            if (typeof this._object !== "function") {
                throw new Error(`Expected function but got ${typeof this._object}`);
            }
            await this._object();
        }
        catch (error) {
            failedError = error;
        }
        if (!failedError)
            throw new Error("Expected to fail but didn't");
        let expectedErrorMessage, failedErrorMessage;
        if (typeof failedError == "string") {
            failedErrorMessage = failedError;
        }
        else if (failedError instanceof Error) {
            failedErrorMessage = failedError.message;
        }
        else {
            failedErrorMessage = String(failedError);
        }
        if (typeof expectedError == "string") {
            expectedErrorMessage = expectedError;
        }
        else if (expectedError instanceof Error) {
            expectedErrorMessage = expectedError.message;
        }
        else {
            expectedErrorMessage = String(expectedError);
        }
        if (failedErrorMessage != expectedErrorMessage) {
            throw new Error(`Expected to fail with '${expectedErrorMessage}' but failed with '${failedErrorMessage}'`);
        }
    }
    /**
     * Runs to throw.
     * @param {string|RegExp|Error|((new (...args: Array<ReturnType<typeof JSON.parse>>) => Error))} [expected] - Expected error.
     * @returns {Promise<void>} - Resolves when complete.
     */
    async toThrow(expected) {
        if (typeof this._object !== "function") {
            throw new Error(`Expected function but got ${typeof this._object}`);
        }
        let failedError;
        try {
            await this._object();
        }
        catch (error) {
            failedError = error;
        }
        const objectPrint = formatValue(this._object);
        if (this._not) {
            if (failedError) {
                throw new Error(`${objectPrint} was unexpected to throw`);
            }
            return;
        }
        if (!failedError)
            throw new Error("Expected to fail but didn't");
        if (expected === undefined)
            return;
        const failedErrorMessage = failedError instanceof Error ? failedError.message : String(failedError);
        const failedErrorName = failedError instanceof Error ? failedError.name : typeof failedError;
        if (expected instanceof RegExp) {
            if (!expected.test(failedErrorMessage)) {
                throw new Error(`Expected to fail with message matching ${expected} but failed with '${failedErrorMessage}'`);
            }
            return;
        }
        if (typeof expected === "function" && (expected.prototype instanceof Error || expected === Error)) {
            if (!(failedError instanceof expected)) {
                throw new Error(`Expected to throw ${expected.name} but threw ${failedErrorName}`);
            }
            return;
        }
        let expectedMessage;
        if (typeof expected === "string") {
            expectedMessage = expected;
        }
        else if (expected instanceof Error) {
            expectedMessage = expected.message;
        }
        else {
            expectedMessage = String(expected);
        }
        if (failedErrorMessage != expectedMessage) {
            throw new Error(`Expected to fail with '${expectedMessage}' but failed with '${failedErrorMessage}'`);
        }
    }
    /**
     * Runs execute.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - Resolves with the execute.
     */
    async execute() {
        for (const expectation of this.expectations) {
            await expectation.runBefore();
        }
        if (typeof this._object !== "function") {
            throw new Error(`Expected function but got ${typeof this._object}`);
        }
        const result = await this._object();
        for (const expectation of this.expectations) {
            await expectation.runAfter();
        }
        for (const expectation of this.expectations) {
            await expectation.execute();
        }
        return result;
    }
    /**
     * Runs to have attributes.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} result - Result.
     * @returns {void} - No return value.
     */
    toHaveAttributes(result) {
        if (this._not)
            throw new Error("not stub");
        /**
         * Differences.
         * @type {Record<string, Array<ReturnType<typeof JSON.parse>>>} */
        const differences = {};
        const objectAsRecord = /** @type {Record<string, ReturnType<typeof JSON.parse>>} */ (this._object);
        for (const key in result) {
            const value = result[key];
            if (!(key in objectAsRecord))
                throw new Error(`${this._object.constructor.name} doesn't respond to ${key}`);
            const objectValue = /** @type {() => ReturnType<typeof JSON.parse>} */ (objectAsRecord[key])();
            if (value != objectValue) {
                differences[key] = [value, objectValue];
            }
        }
        if (Object.keys(differences).length > 0) {
            throw new Error(`Object had differet values: ${minifiedStringify(differences)}`);
        }
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZXhwZWN0LmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL3Rlc3RpbmcvZXhwZWN0LmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLEVBQUMsV0FBVyxFQUFFLGlCQUFpQixFQUFDLE1BQU0sMEJBQTBCLENBQUE7QUFDdkUsT0FBTyxFQUFDLGlCQUFpQixFQUFDLE1BQU0sdUNBQXVDLENBQUE7QUFDdkUsT0FBTyxVQUFVLE1BQU0sa0JBQWtCLENBQUE7QUFDekMsT0FBTyxjQUFjLE1BQU0sdUJBQXVCLENBQUE7QUFDbEQsT0FBTyxFQUNMLGlCQUFpQixFQUNqQixrQkFBa0IsRUFDbEIsb0JBQW9CLEVBQ3BCLFdBQVcsRUFDWixNQUFNLG1CQUFtQixDQUFBO0FBRTFCLE1BQU0sQ0FBQyxPQUFPLE9BQU8sTUFBTyxTQUFRLFVBQVU7SUFDNUM7OztPQUdHO0lBQ0gsWUFBWSxNQUFNO1FBQ2hCLEtBQUssRUFBRSxDQUFBO1FBQ1AsSUFBSSxDQUFDLE9BQU8sR0FBRyxNQUFNLENBQUE7UUFFckI7O29EQUU0QztRQUM1QyxJQUFJLENBQUMsWUFBWSxHQUFHLEVBQUUsQ0FBQTtJQUN4QixDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILFNBQVMsQ0FBQyxjQUFjO1FBQ3RCLE9BQU8sSUFBSSxDQUFDLFFBQVEsQ0FBQyxjQUFjLENBQUMsQ0FBQTtJQUN0QyxDQUFDO0lBRUQ7OztPQUdHO0lBQ0gsSUFBSSxHQUFHO1FBQ0wsSUFBSSxDQUFDLElBQUksR0FBRyxJQUFJLENBQUE7UUFFaEIsT0FBTyxJQUFJLENBQUE7SUFDYixDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILElBQUksQ0FBQyxNQUFNO1FBQ1QsSUFBSSxJQUFJLENBQUMsSUFBSSxFQUFFLENBQUM7WUFDZCxJQUFJLElBQUksQ0FBQyxPQUFPLEtBQUssTUFBTSxFQUFFLENBQUM7Z0JBQzVCLE1BQU0sV0FBVyxHQUFHLFdBQVcsQ0FBQyxJQUFJLENBQUMsT0FB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QUFBO1FBRWxHLEtBQUssTUFBTSxHQUFHLElBQUksTUFBTSxFQUFFLENBQUM7WUFDekIsTUFBTSxLQUFLLEdBQUcsTUFBTSxDQUFDLEdBQUcsQ0FBQyxDQUFBO1lBRXpCLElBQUksQ0FBQyxDQUFDLEdBQUcsSUFBSSxjQUFjLENBQUM7Z0JBQUUsTUFBTSxJQUFJLEtBQUssQ0FBQyxHQUFHLElBQUksQ0FBQyxPQUFPLENBQUMsV0FBVyxDQUFDLElBQUksdUJBQXVCLEdBQUcsRUFBRSxDQUFDLENBQUE7WUFFM0csTUFBTSxXQUFXLEdBQUcsa0RBQWtELENBQUMsQ0FBQyxjQUFjLENBQUMsR0FBRyxDQUFDLENBQUMsRUFBRSxDQUFBO1lBRTlGLElBQUksS0FBSyxJQUFJLFdBQVcsRUFBRSxDQUFDO2dCQUN6QixXQUFXLENBQUMsR0FBRyxDQUFDLEdBQUcsQ0FBQyxLQUFLLEVBQUUsV0FBVyxDQUFDLENBQUE7WUFDekMsQ0FBQztRQUNILENBQUM7UUFFRCxJQUFJLE1BQU0sQ0FBQyxJQUFJLENBQUMsV0FBVyxDQUFDLENBQUMsTUFBTSxHQUFHLENBQUMsRUFBRSxDQUFDO1lBQ3hDLE1BQU0sSUFBSSxLQUFLLENBQUMsK0JBQStCLGlCQUFpQixDQUFDLFdBQVcsQ0FBQyxFQUFFLENBQUMsQ0FBQTtRQUNsRixDQUFDO0lBQ0gsQ0FBQztDQUNGIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbmltcG9ydCB7Zm9ybWF0VmFsdWUsIG1pbmlmaWVkU3RyaW5naWZ5fSBmcm9tIFwiLi4vdXRpbHMvZm9ybWF0LXZhbHVlLmpzXCJcbmltcG9ydCB7YW55dGhpbmdEaWZmZXJlbnR9IGZyb20gXCJzZXQtc3RhdGUtY29tcGFyZS9idWlsZC9kaWZmLXV0aWxzLmpzXCJcbmltcG9ydCBCYXNlRXhwZWN0IGZyb20gXCIuL2Jhc2UtZXhwZWN0LmpzXCJcbmltcG9ydCBFeHBlY3RUb0NoYW5nZSBmcm9tIFwiLi9leHBlY3QtdG8tY2hhbmdlLmpzXCJcbmltcG9ydCB7XG4gIGlzQXJyYXlDb250YWluaW5nLFxuICBpc09iamVjdENvbnRhaW5pbmcsXG4gIG1hdGNoQXJyYXlDb250YWluaW5nLFxuICBtYXRjaE9iamVjdFxufSBmcm9tIFwiLi9leHBlY3QtdXRpbHMuanNcIlxuXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBFeHBlY3QgZXh0ZW5kcyBCYXNlRXhwZWN0IHtcbiAgLyoqXG4gICAqIFJ1bnMgY29uc3RydWN0b3IuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IG9iamVjdCAtIE9iamVjdC5cbiAgICovXG4gIGNvbnN0cnVjdG9yKG9iamVjdCkge1xuICAgIHN1cGVyKClcbiAgICB0aGlzLl9vYmplY3QgPSBvYmplY3RcblxuICAgIC8qKlxuICAgICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICAgKiBAdHlwZSB7QXJyYXk8RXhwZWN0IHwgRXhwZWN0VG9DaGFuZ2U+fSAqL1xuICAgIHRoaXMuZXhwZWN0YXRpb25zID0gW11cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGFuZCBjaGFuZ2UuXG4gICAqIEBwYXJhbSB7KCkgPT4gUHJvbWlzZTxudW1iZXI+fSBjaGFuZ2VDYWxsYmFjayAtIENoYW5nZSBjYWxsYmFjay5cbiAgICogQHJldHVybnMge0V4cGVjdFRvQ2hhbmdlfSAtIFRoZSBhbmQgY2hhbmdlLlxuICAgKi9cbiAgYW5kQ2hhbmdlKGNoYW5nZUNhbGxiYWNrKSB7XG4gICAgcmV0dXJuIHRoaXMudG9DaGFuZ2UoY2hhbmdlQ2FsbGJhY2spXG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyBub3QuXG4gICAqIEByZXR1cm5zIHt0aGlzfSAtIEEgdmFsdWUuXG4gICAqL1xuICBnZXQgbm90KCkge1xuICAgIHRoaXMuX25vdCA9IHRydWVcblxuICAgIHJldHVybiB0aGlzXG4gIH1cblxuICAvKipcbiAgICogUnVucyB0byBiZS5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gcmVzdWx0IC0gUmVzdWx0LlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICB0b0JlKHJlc3VsdCkge1xuICAgIGlmICh0aGlzLl9ub3QpIHtcbiAgICAgIGlmICh0aGlzLl9vYmplY3QgPT09IHJlc3VsdCkge1xuICAgICAgICBjb25zdCBvYmplY3RQcmludCA9IGZvcm1hdFZhbHVlKHRoaXMuX29iamVjdClcbiAgICAgICAgY29uc3QgcmVzdWx0UHJpbnQgPSBmb3JtYXRWYWx1ZShyZXN1bHQpXG5cbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGAke29iamVjdFByaW50fSB3YXMgdW5leHBlY3RlZCBub3QgdG8gYmUgJHtyZXN1bHRQcmludH1gKVxuICAgICAgfVxuICAgIH0gZWxzZSB7XG4gICAgICBpZiAodGhpcy5fb2JqZWN0ICE9PSByZXN1bHQpIHtcbiAgICAgICAgY29uc3Qgb2JqZWN0UHJpbnQgPSBmb3JtYXRWYWx1ZSh0aGlzLl9vYmplY3QpXG4gICAgICAgIGNvbnN0IHJlc3VsdFByaW50ID0gZm9ybWF0VmFsdWUocmVzdWx0KVxuXG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgJHtvYmplY3RQcmludH0gd2Fzbid0IGV4cGVjdGVkIGJlICR7cmVzdWx0UHJpbnR9YClcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyB0byBiZSBsZXNzIHRoYW4uXG4gICAqIEBwYXJhbSB7bnVtYmVyfSByZXN1bHQgLSBSZXN1bHQuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIHRvQmVMZXNzVGhhbihyZXN1bHQpIHtcbiAgICBpZiAodHlwZW9mIHRoaXMuX29iamVjdCAhPT0gXCJudW1iZXJcIiB8fCB0eXBlb2YgcmVzdWx0ICE9PSBcIm51bWJlclwiKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYEV4cGVjdGVkIG51bWJlcnMgYnV0IGdvdCAke3R5cGVvZiB0aGlzLl9vYmplY3R9IGFuZCAke3R5cGVvZiByZXN1bHR9YClcbiAgICB9XG5cbiAgICBpZiAodGhpcy5fbm90KSB7XG4gICAgICBpZiAodGhpcy5fb2JqZWN0IDwgcmVzdWx0KSB7XG4gICAgICAgIGNvbnN0IG9iamVjdFByaW50ID0gZm9ybWF0VmFsdWUodGhpcy5fb2JqZWN0KVxuICAgICAgICBjb25zdCByZXN1bHRQcmludCA9IGZvcm1hdFZhbHVlKHJlc3VsdClcblxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYCR7b2JqZWN0UHJpbnR9IHdhcyB1bmV4cGVjdGVkIHRvIGJlIGxlc3MgdGhhbiAke3Jlc3VsdFByaW50fWApXG4gICAgICB9XG4gICAgfSBlbHNlIHtcbiAgICAgIGlmICh0aGlzLl9vYmplY3QgPj0gcmVzdWx0KSB7XG4gICAgICAgIGNvbnN0IG9iamVjdFByaW50ID0gZm9ybWF0VmFsdWUodGhpcy5fb2JqZWN0KVxuICAgICAgICBjb25zdCByZXN1bHRQcmludCA9IGZvcm1hdFZhbHVlKHJlc3VsdClcblxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYCR7b2JqZWN0UHJpbnR9IHdhc24ndCBleHBlY3RlZCB0byBiZSBncmVhdGVyIHRoYW4gb3IgZXF1YWwgdG8gJHtyZXN1bHRQcmludH1gKVxuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHRvIGJlIGxlc3MgdGhhbiBvciBlcXVhbC5cbiAgICogQHBhcmFtIHtudW1iZXJ9IHJlc3VsdCAtIFJlc3VsdC5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgdG9CZUxlc3NUaGFuT3JFcXVhbChyZXN1bHQpIHtcbiAgICBpZiAodHlwZW9mIHRoaXMuX29iamVjdCAhPT0gXCJudW1iZXJcIiB8fCB0eXBlb2YgcmVzdWx0ICE9PSBcIm51bWJlclwiKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYEV4cGVjdGVkIG51bWJlcnMgYnV0IGdvdCAke3R5cGVvZiB0aGlzLl9vYmplY3R9IGFuZCAke3R5cGVvZiByZXN1bHR9YClcbiAgICB9XG5cbiAgICBpZiAodGhpcy5fbm90KSB7XG4gICAgICBpZiAodGhpcy5fb2JqZWN0IDw9IHJlc3VsdCkge1xuICAgICAgICBjb25zdCBvYmplY3RQcmludCA9IGZvcm1hdFZhbHVlKHRoaXMuX29iamVjdClcbiAgICAgICAgY29uc3QgcmVzdWx0UHJpbnQgPSBmb3JtYXRWYWx1ZShyZXN1bHQpXG5cbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGAke29iamVjdFByaW50fSB3YXMgdW5leHBlY3RlZCB0byBiZSBsZXNzIHRoYW4gb3IgZXF1YWwgdG8gJHtyZXN1bHRQcmludH1gKVxuICAgICAgfVxuICAgIH0gZWxzZSB7XG4gICAgICBpZiAodGhpcy5fb2JqZWN0ID4gcmVzdWx0KSB7XG4gICAgICAgIGNvbnN0IG9iamVjdFByaW50ID0gZm9ybWF0VmFsdWUodGhpcy5fb2JqZWN0KVxuICAgICAgICBjb25zdCByZXN1bHRQcmludCA9IGZvcm1hdFZhbHVlKHJlc3VsdClcblxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYCR7b2JqZWN0UHJpbnR9IHdhc24ndCBleHBlY3RlZCB0byBiZSBncmVhdGVyIHRoYW4gJHtyZXN1bHRQcmludH1gKVxuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHRvIGJlIGdyZWF0ZXIgdGhhbi5cbiAgICogQHBhcmFtIHtudW1iZXJ9IHJlc3VsdCAtIFJlc3VsdC5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgdG9CZUdyZWF0ZXJUaGFuKHJlc3VsdCkge1xuICAgIGlmICh0eXBlb2YgdGhpcy5fb2JqZWN0ICE9PSBcIm51bWJlclwiIHx8IHR5cGVvZiByZXN1bHQgIT09IFwibnVtYmVyXCIpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgRXhwZWN0ZWQgbnVtYmVycyBidXQgZ290ICR7dHlwZW9mIHRoaXMuX29iamVjdH0gYW5kICR7dHlwZW9mIHJlc3VsdH1gKVxuICAgIH1cblxuICAgIGlmICh0aGlzLl9ub3QpIHtcbiAgICAgIGlmICh0aGlzLl9vYmplY3QgPiByZXN1bHQpIHtcbiAgICAgICAgY29uc3Qgb2JqZWN0UHJpbnQgPSBmb3JtYXRWYWx1ZSh0aGlzLl9vYmplY3QpXG4gICAgICAgIGNvbnN0IHJlc3VsdFByaW50ID0gZm9ybWF0VmFsdWUocmVzdWx0KVxuXG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgJHtvYmplY3RQcmludH0gd2FzIHVuZXhwZWN0ZWQgdG8gYmUgZ3JlYXRlciB0aGFuICR7cmVzdWx0UHJpbnR9YClcbiAgICAgIH1cbiAgICB9IGVsc2Uge1xuICAgICAgaWYgKHRoaXMuX29iamVjdCA8PSByZXN1bHQpIHtcbiAgICAgICAgY29uc3Qgb2JqZWN0UHJpbnQgPSBmb3JtYXRWYWx1ZSh0aGlzLl9vYmplY3QpXG4gICAgICAgIGNvbnN0IHJlc3VsdFByaW50ID0gZm9ybWF0VmFsdWUocmVzdWx0KVxuXG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgJHtvYmplY3RQcmludH0gd2Fzbid0IGV4cGVjdGVkIHRvIGJlIGxlc3MgdGhhbiBvciBlcXVhbCB0byAke3Jlc3VsdFByaW50fWApXG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgdG8gYmUgZ3JlYXRlciB0aGFuIG9yIGVxdWFsLlxuICAgKiBAcGFyYW0ge251bWJlcn0gcmVzdWx0IC0gUmVzdWx0LlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICB0b0JlR3JlYXRlclRoYW5PckVxdWFsKHJlc3VsdCkge1xuICAgIGlmICh0eXBlb2YgdGhpcy5fb2JqZWN0ICE9PSBcIm51bWJlclwiIHx8IHR5cGVvZiByZXN1bHQgIT09IFwibnVtYmVyXCIpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgRXhwZWN0ZWQgbnVtYmVycyBidXQgZ290ICR7dHlwZW9mIHRoaXMuX29iamVjdH0gYW5kICR7dHlwZW9mIHJlc3VsdH1gKVxuICAgIH1cblxuICAgIGlmICh0aGlzLl9ub3QpIHtcbiAgICAgIGlmICh0aGlzLl9vYmplY3QgPj0gcmVzdWx0KSB7XG4gICAgICAgIGNvbnN0IG9iamVjdFByaW50ID0gZm9ybWF0VmFsdWUodGhpcy5fb2JqZWN0KVxuICAgICAgICBjb25zdCByZXN1bHRQcmludCA9IGZvcm1hdFZhbHVlKHJlc3VsdClcblxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYCR7b2JqZWN0UHJpbnR9IHdhcyB1bmV4cGVjdGVkIHRvIGJlIGdyZWF0ZXIgdGhhbiBvciBlcXVhbCB0byAke3Jlc3VsdFByaW50fWApXG4gICAgICB9XG4gICAgfSBlbHNlIHtcbiAgICAgIGlmICh0aGlzLl9vYmplY3QgPCByZXN1bHQpIHtcbiAgICAgICAgY29uc3Qgb2JqZWN0UHJpbnQgPSBmb3JtYXRWYWx1ZSh0aGlzLl9vYmplY3QpXG4gICAgICAgIGNvbnN0IHJlc3VsdFByaW50ID0gZm9ybWF0VmFsdWUocmVzdWx0KVxuXG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgJHtvYmplY3RQcmludH0gd2Fzbid0IGV4cGVjdGVkIHRvIGJlIGxlc3MgdGhhbiAke3Jlc3VsdFByaW50fWApXG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgdG8gYmUgY2xvc2UgdG8uXG4gICAqIEBwYXJhbSB7bnVtYmVyfSByZXN1bHQgLSBSZXN1bHQuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBbcHJlY2lzaW9uXSAtIERlY2ltYWwgcHJlY2lzaW9uLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICB0b0JlQ2xvc2VUbyhyZXN1bHQsIHByZWNpc2lvbiA9IDIpIHtcbiAgICBpZiAodHlwZW9mIHRoaXMuX29iamVjdCAhPT0gXCJudW1iZXJcIiB8fCB0eXBlb2YgcmVzdWx0ICE9PSBcIm51bWJlclwiKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYEV4cGVjdGVkIG51bWJlcnMgYnV0IGdvdCAke3R5cGVvZiB0aGlzLl9vYmplY3R9IGFuZCAke3R5cGVvZiByZXN1bHR9YClcbiAgICB9XG5cbiAgICBpZiAodHlwZW9mIHByZWNpc2lvbiAhPT0gXCJudW1iZXJcIiB8fCAhTnVtYmVyLmlzRmluaXRlKHByZWNpc2lvbikpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgRXhwZWN0ZWQgcHJlY2lzaW9uIHRvIGJlIGEgbnVtYmVyIGJ1dCBnb3QgJHt0eXBlb2YgcHJlY2lzaW9ufWApXG4gICAgfVxuXG4gICAgY29uc3QgdG9sZXJhbmNlID0gMC41ICogTWF0aC5wb3coMTAsIC1wcmVjaXNpb24pXG4gICAgY29uc3QgZGlmZiA9IE1hdGguYWJzKHRoaXMuX29iamVjdCAtIHJlc3VsdClcbiAgICBjb25zdCBpc0Nsb3NlID0gZGlmZiA8PSB0b2xlcmFuY2VcblxuICAgIGlmICh0aGlzLl9ub3QpIHtcbiAgICAgIGlmIChpc0Nsb3NlKSB7XG4gICAgICAgIGNvbnN0IG9iamVjdFByaW50ID0gZm9ybWF0VmFsdWUodGhpcy5fb2JqZWN0KVxuICAgICAgICBjb25zdCByZXN1bHRQcmludCA9IGZvcm1hdFZhbHVlKHJlc3VsdClcblxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYCR7b2JqZWN0UHJpbnR9IHdhcyB1bmV4cGVjdGVkIHRvIGJlIGNsb3NlIHRvICR7cmVzdWx0UHJpbnR9YClcbiAgICAgIH1cbiAgICB9IGVsc2Uge1xuICAgICAgaWYgKCFpc0Nsb3NlKSB7XG4gICAgICAgIGNvbnN0IG9iamVjdFByaW50ID0gZm9ybWF0VmFsdWUodGhpcy5fb2JqZWN0KVxuICAgICAgICBjb25zdCByZXN1bHRQcmludCA9IGZvcm1hdFZhbHVlKHJlc3VsdClcblxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYCR7b2JqZWN0UHJpbnR9IHdhc24ndCBleHBlY3RlZCB0byBiZSBjbG9zZSB0byAke3Jlc3VsdFByaW50fWApXG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgdG8gaGF2ZSBsZW5ndGguXG4gICAqIEBwYXJhbSB7bnVtYmVyfSByZXN1bHQgLSBFeHBlY3RlZCBsZW5ndGguXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIHRvSGF2ZUxlbmd0aChyZXN1bHQpIHtcbiAgICBpZiAodHlwZW9mIHJlc3VsdCAhPT0gXCJudW1iZXJcIikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBFeHBlY3RlZCBsZW5ndGggbnVtYmVyIGJ1dCBnb3QgJHt0eXBlb2YgcmVzdWx0fWApXG4gICAgfVxuXG4gICAgaWYgKHRoaXMuX29iamVjdCA9PT0gbnVsbCB8fCB0aGlzLl9vYmplY3QgPT09IHVuZGVmaW5lZCB8fCB0eXBlb2YgdGhpcy5fb2JqZWN0Lmxlbmd0aCAhPT0gXCJudW1iZXJcIikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBFeHBlY3RlZCB2YWx1ZSB3aXRoIGxlbmd0aCBidXQgZ290ICR7dHlwZW9mIHRoaXMuX29iamVjdH1gKVxuICAgIH1cblxuICAgIGNvbnN0IG9iamVjdFByaW50ID0gZm9ybWF0VmFsdWUodGhpcy5fb2JqZWN0KVxuICAgIGNvbnN0IHJlc3VsdFByaW50ID0gZm9ybWF0VmFsdWUocmVzdWx0KVxuICAgIGNvbnN0IGxlbmd0aFZhbHVlID0gdGhpcy5fb2JqZWN0Lmxlbmd0aFxuXG4gICAgaWYgKHRoaXMuX25vdCkge1xuICAgICAgaWYgKGxlbmd0aFZhbHVlID09PSByZXN1bHQpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGAke29iamVjdFByaW50fSB3YXMgdW5leHBlY3RlZCB0byBoYXZlIGxlbmd0aCAke3Jlc3VsdFByaW50fWApXG4gICAgICB9XG4gICAgfSBlbHNlIGlmIChsZW5ndGhWYWx1ZSAhPT0gcmVzdWx0KSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYCR7b2JqZWN0UHJpbnR9IHdhc24ndCBleHBlY3RlZCB0byBoYXZlIGxlbmd0aCAke3Jlc3VsdFByaW50fWApXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgdG8gYmUgZGVmaW5lZC5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgdG9CZURlZmluZWQoKSB7XG4gICAgaWYgKHRoaXMuX25vdCkge1xuICAgICAgaWYgKHRoaXMuX29iamVjdCAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgIGNvbnN0IG9iamVjdFByaW50ID0gZm9ybWF0VmFsdWUodGhpcy5fb2JqZWN0KVxuXG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgJHtvYmplY3RQcmludH0gd2FzbsK0dCBleHBlY3RlZCB0byBiZSBkZWZpbmVkYClcbiAgICAgIH1cbiAgICB9IGVsc2Uge1xuICAgICAgaWYgKHRoaXMuX29iamVjdCA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICAgIGNvbnN0IG9iamVjdFByaW50ID0gZm9ybWF0VmFsdWUodGhpcy5fb2JqZWN0KVxuXG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgJHtvYmplY3RQcmludH0gd2Fzbid0IGV4cGVjdGVkIGJlIHVuZGVmaW5lZGApXG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgdG8gYmUgaW5zdGFuY2Ugb2YuXG4gICAqIEBwYXJhbSB7bmV3ICguLi5hcmdzOiBBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4pID0+IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBrbGFzcyAtIENsYXNzIGNvbnN0cnVjdG9yIHRvIGNoZWNrIGFnYWluc3QgKGUuZy4gYSBidWlsdC1pbiBsaWtlIEVycm9yKS5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgdG9CZUluc3RhbmNlT2Yoa2xhc3MpIHtcbiAgICBpZiAoISh0aGlzLl9vYmplY3QgaW5zdGFuY2VvZiBrbGFzcykpIHtcbiAgICAgIGNvbnN0IG9iamVjdFByaW50ID0gZm9ybWF0VmFsdWUodGhpcy5fb2JqZWN0KVxuXG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYEV4cGVjdGVkICR7b2JqZWN0UHJpbnR9IHRvIGJlIGEgJHtrbGFzcy5uYW1lfSBidXQgaXQgd2Fzbid0YClcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyB0byBiZSBmYWxzZS5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgdG9CZUZhbHNlKCkge1xuICAgIHRoaXMudG9CZShmYWxzZSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHRvIGJlIG51bGwuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIHRvQmVOdWxsKCkge1xuICAgIHRoaXMudG9CZShudWxsKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgdG8gYmUgdW5kZWZpbmVkLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICB0b0JlVW5kZWZpbmVkKCkge1xuICAgIHRoaXMudG9CZSh1bmRlZmluZWQpXG4gIH1cblxuICAvKipcbiAgICogUnVucyB0byBiZSB0cnVlLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICB0b0JlVHJ1ZSgpIHtcbiAgICB0aGlzLnRvQmUodHJ1ZSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHRvIGJlIHRydXRoeS5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgdG9CZVRydXRoeSgpIHtcbiAgICBjb25zdCBvYmplY3RQcmludCA9IGZvcm1hdFZhbHVlKHRoaXMuX29iamVjdClcblxuICAgIGlmICh0aGlzLl9ub3QpIHtcbiAgICAgIGlmICh0aGlzLl9vYmplY3QpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGAke29iamVjdFByaW50fSB3YXMgdW5leHBlY3RlZCB0byBiZSB0cnV0aHlgKVxuICAgICAgfVxuICAgIH0gZWxzZSB7XG4gICAgICBpZiAoIXRoaXMuX29iamVjdCkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYCR7b2JqZWN0UHJpbnR9IHdhc24ndCBleHBlY3RlZCB0byBiZSB0cnV0aHlgKVxuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHRvIGNoYW5nZS5cbiAgICogQHBhcmFtIHsoKSA9PiBQcm9taXNlPG51bWJlcj59IGNoYW5nZUNhbGxiYWNrIC0gQ2hhbmdlIGNhbGxiYWNrLlxuICAgKiBAcmV0dXJucyB7RXhwZWN0VG9DaGFuZ2V9IC0gVGhlIGNoYW5nZS5cbiAgICovXG4gIHRvQ2hhbmdlKGNoYW5nZUNhbGxiYWNrKSB7XG4gICAgaWYgKHRoaXMuX25vdCkgdGhyb3cgbmV3IEVycm9yKFwibm90IHN0dWJcIilcblxuICAgIGNvbnN0IGV4cGVjdFRvQ2hhbmdlID0gbmV3IEV4cGVjdFRvQ2hhbmdlKHtjaGFuZ2VDYWxsYmFjaywgZXhwZWN0OiB0aGlzfSlcblxuICAgIHRoaXMuZXhwZWN0YXRpb25zLnB1c2goZXhwZWN0VG9DaGFuZ2UpXG5cbiAgICByZXR1cm4gZXhwZWN0VG9DaGFuZ2VcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHRvIGNvbnRhaW4uXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHZhbHVlVG9Db250YWluIC0gVmFsdWUgdG8gY29udGFpbi5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgdG9Db250YWluKHZhbHVlVG9Db250YWluKSB7XG4gICAgaWYgKHR5cGVvZiB0aGlzLl9vYmplY3QgPT0gXCJzdHJpbmdcIikge1xuICAgICAgY29uc3QgbWF0Y2hlcyA9IHRoaXMuX29iamVjdC5pbmNsdWRlcyhTdHJpbmcodmFsdWVUb0NvbnRhaW4pKVxuICAgICAgY29uc3Qgb2JqZWN0UHJpbnQgPSBtaW5pZmllZFN0cmluZ2lmeSh0aGlzLl9vYmplY3QpXG4gICAgICBjb25zdCB2YWx1ZVByaW50ID0gdHlwZW9mIHZhbHVlVG9Db250YWluID09IFwic3RyaW5nXCJcbiAgICAgICAgPyBtaW5pZmllZFN0cmluZ2lmeSh2YWx1ZVRvQ29udGFpbilcbiAgICAgICAgOiBmb3JtYXRWYWx1ZSh2YWx1ZVRvQ29udGFpbilcblxuICAgICAgaWYgKHRoaXMuX25vdCkge1xuICAgICAgICBpZiAobWF0Y2hlcykge1xuICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgJHtvYmplY3RQcmludH0gd2FzIHVuZXhwZWN0ZWQgdG8gY29udGFpbiAke3ZhbHVlUHJpbnR9YClcbiAgICAgICAgfVxuICAgICAgfSBlbHNlIGlmICghbWF0Y2hlcykge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYCR7b2JqZWN0UHJpbnR9IGRvZXNuJ3QgY29udGFpbiAke3ZhbHVlUHJpbnR9YClcbiAgICAgIH1cblxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgaWYgKCFBcnJheS5pc0FycmF5KHRoaXMuX29iamVjdCkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgRXhwZWN0ZWQgYXJyYXkgb3Igc3RyaW5nIGJ1dCBnb3QgJHt0eXBlb2YgdGhpcy5fb2JqZWN0fWApXG4gICAgfVxuXG4gICAgY29uc3QgbWF0Y2hlcyA9IHRoaXMuX29iamVjdC5pbmNsdWRlcyh2YWx1ZVRvQ29udGFpbilcbiAgICBjb25zdCBvYmplY3RQcmludCA9IGZvcm1hdFZhbHVlKHRoaXMuX29iamVjdClcbiAgICBjb25zdCB2YWx1ZVByaW50ID0gdHlwZW9mIHZhbHVlVG9Db250YWluID09IFwic3RyaW5nXCJcbiAgICAgID8gbWluaWZpZWRTdHJpbmdpZnkodmFsdWVUb0NvbnRhaW4pXG4gICAgICA6IGZvcm1hdFZhbHVlKHZhbHVlVG9Db250YWluKVxuXG4gICAgaWYgKHRoaXMuX25vdCkge1xuICAgICAgaWYgKG1hdGNoZXMpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGAke29iamVjdFByaW50fSB3YXMgdW5leHBlY3RlZCB0byBjb250YWluICR7dmFsdWVQcmludH1gKVxuICAgICAgfVxuICAgIH0gZWxzZSBpZiAoIW1hdGNoZXMpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgJHtvYmplY3RQcmludH0gZG9lc24ndCBjb250YWluICR7dmFsdWVQcmludH1gKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHRvIGNvbnRhaW4gZXF1YWwuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHZhbHVlVG9Db250YWluIC0gVmFsdWUgdG8gY29udGFpbi5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgdG9Db250YWluRXF1YWwodmFsdWVUb0NvbnRhaW4pIHtcbiAgICBpZiAoIUFycmF5LmlzQXJyYXkodGhpcy5fb2JqZWN0KSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBFeHBlY3RlZCBhcnJheSBidXQgZ290ICR7dHlwZW9mIHRoaXMuX29iamVjdH1gKVxuICAgIH1cblxuICAgIGNvbnN0IG1hdGNoZXMgPSB0aGlzLl9vYmplY3Quc29tZSgoaXRlbSkgPT4gIWFueXRoaW5nRGlmZmVyZW50KGl0ZW0sIHZhbHVlVG9Db250YWluKSlcbiAgICBjb25zdCBvYmplY3RQcmludCA9IGZvcm1hdFZhbHVlKHRoaXMuX29iamVjdClcbiAgICBjb25zdCB2YWx1ZVByaW50ID0gdHlwZW9mIHZhbHVlVG9Db250YWluID09IFwic3RyaW5nXCJcbiAgICAgID8gbWluaWZpZWRTdHJpbmdpZnkodmFsdWVUb0NvbnRhaW4pXG4gICAgICA6IGZvcm1hdFZhbHVlKHZhbHVlVG9Db250YWluKVxuXG4gICAgaWYgKHRoaXMuX25vdCkge1xuICAgICAgaWYgKG1hdGNoZXMpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGAke29iamVjdFByaW50fSB3YXMgdW5leHBlY3RlZCB0byBjb250YWluICR7dmFsdWVQcmludH1gKVxuICAgICAgfVxuICAgIH0gZWxzZSBpZiAoIW1hdGNoZXMpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgJHtvYmplY3RQcmludH0gZG9lc24ndCBjb250YWluICR7dmFsdWVQcmludH1gKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHRvIGluY2x1ZGUuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHZhbHVlVG9JbmNsdWRlIC0gVmFsdWUgdG8gaW5jbHVkZS5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgdG9JbmNsdWRlKHZhbHVlVG9JbmNsdWRlKSB7XG4gICAgdGhpcy50b0NvbnRhaW4odmFsdWVUb0luY2x1ZGUpXG4gIH1cblxuICAvKipcbiAgICogUnVucyB0byBlcXVhbC5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gcmVzdWx0IC0gUmVzdWx0LlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICB0b0VxdWFsKHJlc3VsdCkge1xuICAgIGlmICh0aGlzLl9vYmplY3QgaW5zdGFuY2VvZiBTZXQgJiYgcmVzdWx0IGluc3RhbmNlb2YgU2V0KSB7XG4gICAgICBjb25zdCBvYmplY3RQcmludCA9IGZvcm1hdFZhbHVlKHRoaXMuX29iamVjdClcbiAgICAgIGNvbnN0IHJlc3VsdFByaW50ID0gZm9ybWF0VmFsdWUocmVzdWx0KVxuICAgICAgY29uc3QgYWN0dWFsSXRlbXMgPSBBcnJheS5mcm9tKHRoaXMuX29iamVjdClcbiAgICAgIGNvbnN0IGV4cGVjdGVkSXRlbXMgPSBBcnJheS5mcm9tKHJlc3VsdClcbiAgICAgIGNvbnN0IG1pc3NpbmdJdGVtcyA9IGV4cGVjdGVkSXRlbXMuZmlsdGVyKChleHBlY3RlZEl0ZW0pID0+IHtcbiAgICAgICAgcmV0dXJuICFhY3R1YWxJdGVtcy5zb21lKChhY3R1YWxJdGVtKSA9PiAhYW55dGhpbmdEaWZmZXJlbnQoYWN0dWFsSXRlbSwgZXhwZWN0ZWRJdGVtKSlcbiAgICAgIH0pXG4gICAgICBjb25zdCB1bmV4cGVjdGVkSXRlbXMgPSBhY3R1YWxJdGVtcy5maWx0ZXIoKGFjdHVhbEl0ZW0pID0+IHtcbiAgICAgICAgcmV0dXJuICFleHBlY3RlZEl0ZW1zLnNvbWUoKGV4cGVjdGVkSXRlbSkgPT4gIWFueXRoaW5nRGlmZmVyZW50KGFjdHVhbEl0ZW0sIGV4cGVjdGVkSXRlbSkpXG4gICAgICB9KVxuICAgICAgY29uc3QgaXNFcXVhbCA9IG1pc3NpbmdJdGVtcy5sZW5ndGggPT09IDAgJiYgdW5leHBlY3RlZEl0ZW1zLmxlbmd0aCA9PT0gMFxuXG4gICAgICBpZiAodGhpcy5fbm90KSB7XG4gICAgICAgIGlmIChpc0VxdWFsKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGAke29iamVjdFByaW50fSB3YXMgdW5leHBlY3RlZCBlcXVhbCB0byAke3Jlc3VsdFByaW50fWApXG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSBpZiAoIWlzRXF1YWwpIHtcbiAgICAgICAgY29uc3QgbWlzc2luZ1N0cmluZ3MgPSBtaXNzaW5nSXRlbXMubWFwKChpdGVtKSA9PiBtaW5pZmllZFN0cmluZ2lmeShpdGVtKSlcbiAgICAgICAgY29uc3QgdW5leHBlY3RlZFN0cmluZ3MgPSB1bmV4cGVjdGVkSXRlbXMubWFwKChpdGVtKSA9PiBtaW5pZmllZFN0cmluZ2lmeShpdGVtKSlcbiAgICAgICAgY29uc3QgZGlmZlBhcnRzID0gW11cblxuICAgICAgICBpZiAobWlzc2luZ1N0cmluZ3MubGVuZ3RoID4gMCkgZGlmZlBhcnRzLnB1c2goYG1pc3NpbmcgJHttaXNzaW5nU3RyaW5ncy5qb2luKFwiLCBcIil9YClcbiAgICAgICAgaWYgKHVuZXhwZWN0ZWRTdHJpbmdzLmxlbmd0aCA+IDApIGRpZmZQYXJ0cy5wdXNoKGB1bmV4cGVjdGVkICR7dW5leHBlY3RlZFN0cmluZ3Muam9pbihcIiwgXCIpfWApXG5cbiAgICAgICAgY29uc3QgZGlmZk1lc3NhZ2UgPSBkaWZmUGFydHMubGVuZ3RoID4gMCA/IGAgKGRpZmY6ICR7ZGlmZlBhcnRzLmpvaW4oXCI7IFwiKX0pYCA6IFwiXCJcblxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYCR7b2JqZWN0UHJpbnR9IHdhc24ndCBlcXVhbCB0byAke3Jlc3VsdFByaW50fSR7ZGlmZk1lc3NhZ2V9YClcbiAgICAgIH1cblxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgaWYgKGlzT2JqZWN0Q29udGFpbmluZyhyZXN1bHQpKSB7XG4gICAgICBjb25zdCBleHBlY3RlZFZhbHVlID0gLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi8gKHJlc3VsdCkudmFsdWVcbiAgICAgIGNvbnN0IHttYXRjaGVzLCBkaWZmZXJlbmNlc30gPSBtYXRjaE9iamVjdCh0aGlzLl9vYmplY3QsIGV4cGVjdGVkVmFsdWUpXG4gICAgICBjb25zdCBvYmplY3RQcmludCA9IGZvcm1hdFZhbHVlKHRoaXMuX29iamVjdClcbiAgICAgIGNvbnN0IGV4cGVjdGVkUHJpbnQgPSBmb3JtYXRWYWx1ZShleHBlY3RlZFZhbHVlKVxuXG4gICAgICBpZiAodGhpcy5fbm90KSB7XG4gICAgICAgIGlmIChtYXRjaGVzKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBFeHBlY3RlZCAke29iamVjdFByaW50fSBub3QgdG8gbWF0Y2ggJHtleHBlY3RlZFByaW50fWApXG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSBpZiAoIW1hdGNoZXMpIHtcbiAgICAgICAgY29uc3QgZGlmZlByaW50ID0gT2JqZWN0LmtleXMoZGlmZmVyZW5jZXMpLmxlbmd0aCA+IDAgPyBgIChkaWZmOiAke21pbmlmaWVkU3RyaW5naWZ5KGRpZmZlcmVuY2VzKX0pYCA6IFwiXCJcblxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYEV4cGVjdGVkICR7b2JqZWN0UHJpbnR9IHRvIG1hdGNoICR7ZXhwZWN0ZWRQcmludH0ke2RpZmZQcmludH1gKVxuICAgICAgfVxuXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBpZiAoaXNBcnJheUNvbnRhaW5pbmcocmVzdWx0KSkge1xuICAgICAgY29uc3QgZXhwZWN0ZWRWYWx1ZSA9IC8qKiBAdHlwZSB7QXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAoLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi8gKHJlc3VsdCkudmFsdWUpXG4gICAgICBjb25zdCB7bWF0Y2hlcywgZGlmZmVyZW5jZXN9ID0gbWF0Y2hBcnJheUNvbnRhaW5pbmcodGhpcy5fb2JqZWN0LCBleHBlY3RlZFZhbHVlKVxuICAgICAgY29uc3Qgb2JqZWN0UHJpbnQgPSBmb3JtYXRWYWx1ZSh0aGlzLl9vYmplY3QpXG4gICAgICBjb25zdCBleHBlY3RlZFByaW50ID0gZm9ybWF0VmFsdWUoZXhwZWN0ZWRWYWx1ZSlcblxuICAgICAgaWYgKHRoaXMuX25vdCkge1xuICAgICAgICBpZiAobWF0Y2hlcykge1xuICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgRXhwZWN0ZWQgJHtvYmplY3RQcmludH0gbm90IHRvIG1hdGNoICR7ZXhwZWN0ZWRQcmludH1gKVxuICAgICAgICB9XG4gICAgICB9IGVsc2UgaWYgKCFtYXRjaGVzKSB7XG4gICAgICAgIGNvbnN0IGRpZmZQcmludCA9IE9iamVjdC5rZXlzKGRpZmZlcmVuY2VzKS5sZW5ndGggPiAwID8gYCAoZGlmZjogJHttaW5pZmllZFN0cmluZ2lmeShkaWZmZXJlbmNlcyl9KWAgOiBcIlwiXG5cbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBFeHBlY3RlZCAke29iamVjdFByaW50fSB0byBtYXRjaCAke2V4cGVjdGVkUHJpbnR9JHtkaWZmUHJpbnR9YClcbiAgICAgIH1cblxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgaWYgKHRoaXMuX25vdCkge1xuICAgICAgaWYgKHR5cGVvZiB0aGlzLl9vYmplY3QgPT0gXCJvYmplY3RcIiAmJiB0eXBlb2YgcmVzdWx0ID09IFwib2JqZWN0XCIpIHtcbiAgICAgICAgaWYgKCFhbnl0aGluZ0RpZmZlcmVudCh0aGlzLl9vYmplY3QsIHJlc3VsdCkpIHtcbiAgICAgICAgICBjb25zdCBvYmplY3RQcmludCA9IGZvcm1hdFZhbHVlKHRoaXMuX29iamVjdClcbiAgICAgICAgICBjb25zdCByZXN1bHRQcmludCA9IGZvcm1hdFZhbHVlKHJlc3VsdClcblxuICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgJHtvYmplY3RQcmludH0gd2FzIHVuZXhwZWN0ZWQgZXF1YWwgdG8gJHtyZXN1bHRQcmludH1gKVxuICAgICAgICB9XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBpZiAodGhpcy5fb2JqZWN0ID09IHJlc3VsdCkge1xuICAgICAgICAgIGNvbnN0IG9iamVjdFByaW50ID0gZm9ybWF0VmFsdWUodGhpcy5fb2JqZWN0KVxuICAgICAgICAgIGNvbnN0IHJlc3VsdFByaW50ID0gZm9ybWF0VmFsdWUocmVzdWx0KVxuXG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGAke29iamVjdFByaW50fSB3YXMgdW5leHBlY3RlZCBlcXVhbCB0byAke3Jlc3VsdFByaW50fWApXG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9IGVsc2Uge1xuICAgICAgaWYgKHR5cGVvZiB0aGlzLl9vYmplY3QgPT0gXCJvYmplY3RcIiAmJiB0eXBlb2YgcmVzdWx0ID09IFwib2JqZWN0XCIpIHtcbiAgICAgICAgaWYgKGFueXRoaW5nRGlmZmVyZW50KHRoaXMuX29iamVjdCwgcmVzdWx0KSkge1xuICAgICAgICAgIGNvbnN0IG9iamVjdFByaW50ID0gZm9ybWF0VmFsdWUodGhpcy5fb2JqZWN0KVxuICAgICAgICAgIGNvbnN0IHJlc3VsdFByaW50ID0gZm9ybWF0VmFsdWUocmVzdWx0KVxuXG4gICAgICAgICAgaWYgKEFycmF5LmlzQXJyYXkodGhpcy5fb2JqZWN0KSAmJiBBcnJheS5pc0FycmF5KHJlc3VsdCkpIHtcbiAgICAgICAgICAgIGNvbnN0IGFjdHVhbFN0cmluZ3MgPSB0aGlzLl9vYmplY3QubWFwKChpdGVtKSA9PiBtaW5pZmllZFN0cmluZ2lmeShpdGVtKSlcbiAgICAgICAgICAgIGNvbnN0IGV4cGVjdGVkU3RyaW5ncyA9IHJlc3VsdC5tYXAoKGl0ZW0pID0+IG1pbmlmaWVkU3RyaW5naWZ5KGl0ZW0pKVxuXG4gICAgICAgICAgICBjb25zdCBtaXNzaW5nSXRlbXMgPSBleHBlY3RlZFN0cmluZ3MuZmlsdGVyKChpdGVtKSA9PiAhYWN0dWFsU3RyaW5ncy5pbmNsdWRlcyhpdGVtKSlcbiAgICAgICAgICAgIGNvbnN0IHVuZXhwZWN0ZWRJdGVtcyA9IGFjdHVhbFN0cmluZ3MuZmlsdGVyKChpdGVtKSA9PiAhZXhwZWN0ZWRTdHJpbmdzLmluY2x1ZGVzKGl0ZW0pKVxuXG4gICAgICAgICAgICBjb25zdCBkaWZmUGFydHMgPSBbXVxuXG4gICAgICAgICAgICBpZiAobWlzc2luZ0l0ZW1zLmxlbmd0aCA+IDApIGRpZmZQYXJ0cy5wdXNoKGBtaXNzaW5nICR7bWlzc2luZ0l0ZW1zLmpvaW4oXCIsIFwiKX1gKVxuICAgICAgICAgICAgaWYgKHVuZXhwZWN0ZWRJdGVtcy5sZW5ndGggPiAwKSBkaWZmUGFydHMucHVzaChgdW5leHBlY3RlZCAke3VuZXhwZWN0ZWRJdGVtcy5qb2luKFwiLCBcIil9YClcblxuICAgICAgICAgICAgY29uc3QgZGlmZk1lc3NhZ2UgPSBkaWZmUGFydHMubGVuZ3RoID4gMCA/IGAgKGRpZmY6ICR7ZGlmZlBhcnRzLmpvaW4oXCI7IFwiKX0pYCA6IFwiXCJcblxuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGAke29iamVjdFByaW50fSB3YXNuJ3QgZXF1YWwgdG8gJHtyZXN1bHRQcmludH0ke2RpZmZNZXNzYWdlfWApXG4gICAgICAgICAgfVxuXG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGAke29iamVjdFByaW50fSB3YXNuJ3QgZXF1YWwgdG8gJHtyZXN1bHRQcmludH1gKVxuICAgICAgICB9XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBpZiAodGhpcy5fb2JqZWN0ICE9IHJlc3VsdCkge1xuICAgICAgICAgIGNvbnN0IG9iamVjdFByaW50ID0gZm9ybWF0VmFsdWUodGhpcy5fb2JqZWN0KVxuICAgICAgICAgIGNvbnN0IHJlc3VsdFByaW50ID0gZm9ybWF0VmFsdWUocmVzdWx0KVxuXG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGAke29iamVjdFByaW50fSB3YXNuJ3QgZXF1YWwgdG8gJHtyZXN1bHRQcmludH1gKVxuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgdG8gbWF0Y2guXG4gICAqIEBwYXJhbSB7UmVnRXhwfSByZWdleCAtIFJlZ2V4LlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICB0b01hdGNoKHJlZ2V4KSB7XG4gICAgaWYgKHR5cGVvZiB0aGlzLl9vYmplY3QgIT09IFwic3RyaW5nXCIpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgRXhwZWN0ZWQgc3RyaW5nIGJ1dCBnb3QgJHt0eXBlb2YgdGhpcy5fb2JqZWN0fWApXG4gICAgfVxuXG4gICAgY29uc3QgbWF0Y2ggPSB0aGlzLl9vYmplY3QubWF0Y2gocmVnZXgpXG4gICAgY29uc3Qgb2JqZWN0UHJpbnQgPSBtaW5pZmllZFN0cmluZ2lmeSh0aGlzLl9vYmplY3QpXG5cbiAgICBpZiAodGhpcy5fbm90KSB7XG4gICAgICBpZiAobWF0Y2gpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGAke29iamVjdFByaW50fSBzaG91bGRuJ3QgbWF0Y2ggJHtyZWdleH1gKVxuICAgICAgfVxuICAgIH0gZWxzZSB7XG4gICAgICBpZiAoIW1hdGNoKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgJHtvYmplY3RQcmludH0gZGlkbid0IG1hdGNoICR7cmVnZXh9YClcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyB0byBtYXRjaCBvYmplY3QuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+IHwgQXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBleHBlY3RlZCAtIEV4cGVjdGVkIHBhcnRpYWwgb2JqZWN0LlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICB0b01hdGNoT2JqZWN0KGV4cGVjdGVkKSB7XG4gICAgaWYgKGV4cGVjdGVkID09PSBudWxsIHx8IHR5cGVvZiBleHBlY3RlZCAhPT0gXCJvYmplY3RcIikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBFeHBlY3RlZCBvYmplY3QgYnV0IGdvdCAke3R5cGVvZiBleHBlY3RlZH1gKVxuICAgIH1cblxuICAgIGNvbnN0IHttYXRjaGVzLCBkaWZmZXJlbmNlc30gPSBtYXRjaE9iamVjdCh0aGlzLl9vYmplY3QsIGV4cGVjdGVkKVxuICAgIGNvbnN0IG9iamVjdFByaW50ID0gZm9ybWF0VmFsdWUodGhpcy5fb2JqZWN0KVxuICAgIGNvbnN0IGV4cGVjdGVkUHJpbnQgPSBmb3JtYXRWYWx1ZShleHBlY3RlZClcblxuICAgIGlmICh0aGlzLl9ub3QpIHtcbiAgICAgIGlmIChtYXRjaGVzKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgRXhwZWN0ZWQgJHtvYmplY3RQcmludH0gbm90IHRvIG1hdGNoICR7ZXhwZWN0ZWRQcmludH1gKVxuICAgICAgfVxuICAgIH0gZWxzZSBpZiAoIW1hdGNoZXMpIHtcbiAgICAgIGNvbnN0IGRpZmZQcmludCA9IE9iamVjdC5rZXlzKGRpZmZlcmVuY2VzKS5sZW5ndGggPiAwID8gYCAoZGlmZjogJHttaW5pZmllZFN0cmluZ2lmeShkaWZmZXJlbmNlcyl9KWAgOiBcIlwiXG5cbiAgICAgIHRocm93IG5ldyBFcnJvcihgRXhwZWN0ZWQgJHtvYmplY3RQcmludH0gdG8gbWF0Y2ggJHtleHBlY3RlZFByaW50fSR7ZGlmZlByaW50fWApXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgdG8gdGhyb3cgZXJyb3IuXG4gICAqIEB0ZW1wbGF0ZSBUIGV4dGVuZHMgRXJyb3JcbiAgICogQHBhcmFtIHtzdHJpbmd8VH0gZXhwZWN0ZWRFcnJvciAtIEV4cGVjdGVkIGVycm9yLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgdG9UaHJvd0Vycm9yKGV4cGVjdGVkRXJyb3IpIHtcbiAgICBpZiAodGhpcy5fbm90KSB0aHJvdyBuZXcgRXJyb3IoXCJub3Qgc3R1YlwiKVxuXG4gICAgbGV0IGZhaWxlZEVycm9yXG5cbiAgICB0cnkge1xuICAgICAgaWYgKHR5cGVvZiB0aGlzLl9vYmplY3QgIT09IFwiZnVuY3Rpb25cIikge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYEV4cGVjdGVkIGZ1bmN0aW9uIGJ1dCBnb3QgJHt0eXBlb2YgdGhpcy5fb2JqZWN0fWApXG4gICAgICB9XG5cbiAgICAgIGF3YWl0IHRoaXMuX29iamVjdCgpXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGZhaWxlZEVycm9yID0gZXJyb3JcbiAgICB9XG5cbiAgICBpZiAoIWZhaWxlZEVycm9yKSB0aHJvdyBuZXcgRXJyb3IoXCJFeHBlY3RlZCB0byBmYWlsIGJ1dCBkaWRuJ3RcIilcblxuICAgIGxldCBleHBlY3RlZEVycm9yTWVzc2FnZSwgZmFpbGVkRXJyb3JNZXNzYWdlXG5cbiAgICBpZiAodHlwZW9mIGZhaWxlZEVycm9yID09IFwic3RyaW5nXCIpIHtcbiAgICAgIGZhaWxlZEVycm9yTWVzc2FnZSA9IGZhaWxlZEVycm9yXG4gICAgfSBlbHNlIGlmIChmYWlsZWRFcnJvciBpbnN0YW5jZW9mIEVycm9yKSB7XG4gICAgICBmYWlsZWRFcnJvck1lc3NhZ2UgPSBmYWlsZWRFcnJvci5tZXNzYWdlXG4gICAgfSBlbHNlIHtcbiAgICAgIGZhaWxlZEVycm9yTWVzc2FnZSA9IFN0cmluZyhmYWlsZWRFcnJvcilcbiAgICB9XG5cbiAgICBpZiAodHlwZW9mIGV4cGVjdGVkRXJyb3IgPT0gXCJzdHJpbmdcIikge1xuICAgICAgZXhwZWN0ZWRFcnJvck1lc3NhZ2UgPSBleHBlY3RlZEVycm9yXG4gICAgfSBlbHNlIGlmIChleHBlY3RlZEVycm9yIGluc3RhbmNlb2YgRXJyb3IpIHtcbiAgICAgIGV4cGVjdGVkRXJyb3JNZXNzYWdlID0gZXhwZWN0ZWRFcnJvci5tZXNzYWdlXG4gICAgfSBlbHNlIHtcbiAgICAgIGV4cGVjdGVkRXJyb3JNZXNzYWdlID0gU3RyaW5nKGV4cGVjdGVkRXJyb3IpXG4gICAgfVxuXG4gICAgaWYgKGZhaWxlZEVycm9yTWVzc2FnZSAhPSBleHBlY3RlZEVycm9yTWVzc2FnZSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBFeHBlY3RlZCB0byBmYWlsIHdpdGggJyR7ZXhwZWN0ZWRFcnJvck1lc3NhZ2V9JyBidXQgZmFpbGVkIHdpdGggJyR7ZmFpbGVkRXJyb3JNZXNzYWdlfSdgKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHRvIHRocm93LlxuICAgKiBAcGFyYW0ge3N0cmluZ3xSZWdFeHB8RXJyb3J8KChuZXcgKC4uLmFyZ3M6IEFycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PikgPT4gRXJyb3IpKX0gW2V4cGVjdGVkXSAtIEV4cGVjdGVkIGVycm9yLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgdG9UaHJvdyhleHBlY3RlZCkge1xuICAgIGlmICh0eXBlb2YgdGhpcy5fb2JqZWN0ICE9PSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgRXhwZWN0ZWQgZnVuY3Rpb24gYnV0IGdvdCAke3R5cGVvZiB0aGlzLl9vYmplY3R9YClcbiAgICB9XG5cbiAgICBsZXQgZmFpbGVkRXJyb3JcblxuICAgIHRyeSB7XG4gICAgICBhd2FpdCB0aGlzLl9vYmplY3QoKVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBmYWlsZWRFcnJvciA9IGVycm9yXG4gICAgfVxuXG4gICAgY29uc3Qgb2JqZWN0UHJpbnQgPSBmb3JtYXRWYWx1ZSh0aGlzLl9vYmplY3QpXG5cbiAgICBpZiAodGhpcy5fbm90KSB7XG4gICAgICBpZiAoZmFpbGVkRXJyb3IpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGAke29iamVjdFByaW50fSB3YXMgdW5leHBlY3RlZCB0byB0aHJvd2ApXG4gICAgICB9XG5cbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGlmICghZmFpbGVkRXJyb3IpIHRocm93IG5ldyBFcnJvcihcIkV4cGVjdGVkIHRvIGZhaWwgYnV0IGRpZG4ndFwiKVxuICAgIGlmIChleHBlY3RlZCA9PT0gdW5kZWZpbmVkKSByZXR1cm5cblxuICAgIGNvbnN0IGZhaWxlZEVycm9yTWVzc2FnZSA9IGZhaWxlZEVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBmYWlsZWRFcnJvci5tZXNzYWdlIDogU3RyaW5nKGZhaWxlZEVycm9yKVxuICAgIGNvbnN0IGZhaWxlZEVycm9yTmFtZSA9IGZhaWxlZEVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBmYWlsZWRFcnJvci5uYW1lIDogdHlwZW9mIGZhaWxlZEVycm9yXG5cbiAgICBpZiAoZXhwZWN0ZWQgaW5zdGFuY2VvZiBSZWdFeHApIHtcbiAgICAgIGlmICghZXhwZWN0ZWQudGVzdChmYWlsZWRFcnJvck1lc3NhZ2UpKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgRXhwZWN0ZWQgdG8gZmFpbCB3aXRoIG1lc3NhZ2UgbWF0Y2hpbmcgJHtleHBlY3RlZH0gYnV0IGZhaWxlZCB3aXRoICcke2ZhaWxlZEVycm9yTWVzc2FnZX0nYClcbiAgICAgIH1cblxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgaWYgKHR5cGVvZiBleHBlY3RlZCA9PT0gXCJmdW5jdGlvblwiICYmIChleHBlY3RlZC5wcm90b3R5cGUgaW5zdGFuY2VvZiBFcnJvciB8fCBleHBlY3RlZCA9PT0gRXJyb3IpKSB7XG4gICAgICBpZiAoIShmYWlsZWRFcnJvciBpbnN0YW5jZW9mIGV4cGVjdGVkKSkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYEV4cGVjdGVkIHRvIHRocm93ICR7ZXhwZWN0ZWQubmFtZX0gYnV0IHRocmV3ICR7ZmFpbGVkRXJyb3JOYW1lfWApXG4gICAgICB9XG5cbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGxldCBleHBlY3RlZE1lc3NhZ2VcblxuICAgIGlmICh0eXBlb2YgZXhwZWN0ZWQgPT09IFwic3RyaW5nXCIpIHtcbiAgICAgIGV4cGVjdGVkTWVzc2FnZSA9IGV4cGVjdGVkXG4gICAgfSBlbHNlIGlmIChleHBlY3RlZCBpbnN0YW5jZW9mIEVycm9yKSB7XG4gICAgICBleHBlY3RlZE1lc3NhZ2UgPSBleHBlY3RlZC5tZXNzYWdlXG4gICAgfSBlbHNlIHtcbiAgICAgIGV4cGVjdGVkTWVzc2FnZSA9IFN0cmluZyhleHBlY3RlZClcbiAgICB9XG5cbiAgICBpZiAoZmFpbGVkRXJyb3JNZXNzYWdlICE9IGV4cGVjdGVkTWVzc2FnZSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBFeHBlY3RlZCB0byBmYWlsIHdpdGggJyR7ZXhwZWN0ZWRNZXNzYWdlfScgYnV0IGZhaWxlZCB3aXRoICcke2ZhaWxlZEVycm9yTWVzc2FnZX0nYClcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBleGVjdXRlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgZXhlY3V0ZS5cbiAgICovXG4gIGFzeW5jIGV4ZWN1dGUoKSB7XG4gICAgZm9yIChjb25zdCBleHBlY3RhdGlvbiBvZiB0aGlzLmV4cGVjdGF0aW9ucykge1xuICAgICAgYXdhaXQgZXhwZWN0YXRpb24ucnVuQmVmb3JlKClcbiAgICB9XG5cbiAgICBpZiAodHlwZW9mIHRoaXMuX29iamVjdCAhPT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYEV4cGVjdGVkIGZ1bmN0aW9uIGJ1dCBnb3QgJHt0eXBlb2YgdGhpcy5fb2JqZWN0fWApXG4gICAgfVxuXG4gICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgdGhpcy5fb2JqZWN0KClcblxuICAgIGZvciAoY29uc3QgZXhwZWN0YXRpb24gb2YgdGhpcy5leHBlY3RhdGlvbnMpIHtcbiAgICAgIGF3YWl0IGV4cGVjdGF0aW9uLnJ1bkFmdGVyKClcbiAgICB9XG5cbiAgICBmb3IgKGNvbnN0IGV4cGVjdGF0aW9uIG9mIHRoaXMuZXhwZWN0YXRpb25zKSB7XG4gICAgICBhd2FpdCBleHBlY3RhdGlvbi5leGVjdXRlKClcbiAgICB9XG5cbiAgICByZXR1cm4gcmVzdWx0XG4gIH1cblxuICAvKipcbiAgICogUnVucyB0byBoYXZlIGF0dHJpYnV0ZXMuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSByZXN1bHQgLSBSZXN1bHQuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIHRvSGF2ZUF0dHJpYnV0ZXMocmVzdWx0KSB7XG4gICAgaWYgKHRoaXMuX25vdCkgdGhyb3cgbmV3IEVycm9yKFwibm90IHN0dWJcIilcblxuICAgIC8qKlxuICAgICAqIERpZmZlcmVuY2VzLlxuICAgICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+fSAqL1xuICAgIGNvbnN0IGRpZmZlcmVuY2VzID0ge31cbiAgICBjb25zdCBvYmplY3RBc1JlY29yZCA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAodGhpcy5fb2JqZWN0KVxuXG4gICAgZm9yIChjb25zdCBrZXkgaW4gcmVzdWx0KSB7XG4gICAgICBjb25zdCB2YWx1ZSA9IHJlc3VsdFtrZXldXG5cbiAgICAgIGlmICghKGtleSBpbiBvYmplY3RBc1JlY29yZCkpIHRocm93IG5ldyBFcnJvcihgJHt0aGlzLl9vYmplY3QuY29uc3RydWN0b3IubmFtZX0gZG9lc24ndCByZXNwb25kIHRvICR7a2V5fWApXG5cbiAgICAgIGNvbnN0IG9iamVjdFZhbHVlID0gLyoqIEB0eXBlIHsoKSA9PiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi8gKG9iamVjdEFzUmVjb3JkW2tleV0pKClcblxuICAgICAgaWYgKHZhbHVlICE9IG9iamVjdFZhbHVlKSB7XG4gICAgICAgIGRpZmZlcmVuY2VzW2tleV0gPSBbdmFsdWUsIG9iamVjdFZhbHVlXVxuICAgICAgfVxuICAgIH1cblxuICAgIGlmIChPYmplY3Qua2V5cyhkaWZmZXJlbmNlcykubGVuZ3RoID4gMCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBPYmplY3QgaGFkIGRpZmZlcmV0IHZhbHVlczogJHttaW5pZmllZFN0cmluZ2lmeShkaWZmZXJlbmNlcyl9YClcbiAgICB9XG4gIH1cbn1cbiJdfQ==