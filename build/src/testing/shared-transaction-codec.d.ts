export type EncodedBrokerValue = {
    [TAG]: string;
    value?: string | number | boolean | EncodedBrokerValue[] | Record<string, EncodedBrokerValue>;
};
/** @typedef {{[TAG]: string, value?: string | number | boolean | EncodedBrokerValue[] | Record<string, EncodedBrokerValue>}} EncodedBrokerValue */
declare const TAG = "$velociousSharedTransaction";
/**
 * Encodes values crossing the test-only shared-transaction transport without
 * relying on JSON's lossy Date, bigint, non-finite-number, or undefined rules.
 * @param {ReturnType<typeof JSON.parse> | bigint | Buffer | Date | Error | undefined} value - Runtime value.
 * @returns {EncodedBrokerValue} - Tagged transport value.
 */
export declare function encodeBrokerValue(value: ReturnType<typeof JSON.parse> | bigint | Buffer | Date | Error | undefined): EncodedBrokerValue;
/**
 * Decodes a tagged broker transport value.
 * @param {EncodedBrokerValue} encoded - Tagged transport value.
 * @returns {ReturnType<typeof JSON.parse> | bigint | Buffer | Date | Error | undefined} - Runtime value.
 */
export declare function decodeBrokerValue(encoded: EncodedBrokerValue): ReturnType<typeof JSON.parse> | bigint | Buffer | Date | Error | undefined;
export {};
//# sourceMappingURL=shared-transaction-codec.d.ts.map