import BaseExpect from "./base-expect.js";
export default class ExpectToChange extends BaseExpect {
    expect: import("./expect.js").default;
    changeCallback: () => Promise<number>;
    count: number | undefined;
    oldCount: number | undefined;
    newCount: number | undefined;
    /**
     * Runs constructor.
     * @param {object} args - Options object.
     * @param {() => Promise<number>} args.changeCallback - Change callback.
     * @param {import("./expect.js").default} args.expect - Expect.
     */
    constructor({ changeCallback, expect, ...restArgs }: {
        changeCallback: () => Promise<number>;
        expect: import("./expect.js").default;
    });
    /**
     * Runs by.
     * @param {number} count - Count value.
     * @returns {import("./expect.js").default} - The by.
     */
    by(count: number): import("./expect.js").default;
    runBefore(): Promise<void>;
    runAfter(): Promise<void>;
    /**
     * Runs execute.
     * @returns {Promise<void>} - Resolves when complete.
     */
    execute(): Promise<void>;
}
//# sourceMappingURL=expect-to-change.d.ts.map