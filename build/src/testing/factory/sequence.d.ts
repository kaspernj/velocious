export type SequenceFormatter = (args: {
    value: number;
}) => (ReturnType<typeof JSON.parse> | Promise<ReturnType<typeof JSON.parse>>);
/**
 * SequenceFormatter type. Receives the synchronously-allocated numeric value and
 * returns the formatted value (optionally asynchronously).
 * @typedef {(args: {value: number}) => (ReturnType<typeof JSON.parse> | Promise<ReturnType<typeof JSON.parse>>)} SequenceFormatter
 */
/**
 * A numeric counter sequence. Values are allocated and consumed synchronously
 * before the (possibly async) formatter runs, so a rejected formatter still
 * advances the counter and concurrent `Promise.all` allocation never collides —
 * matching FactoryBot's failed-value-consumption behaviour.
 */
export default class Sequence {
    /** @type {string} - Primary sequence name. */
    name: string;
    /** @type {number} - First value the sequence yields. */
    initial: number;
    /** @type {SequenceFormatter | undefined} - Optional value formatter. */
    formatter: SequenceFormatter | undefined;
    /** @type {string[]} - Names that share this sequence's counter. */
    aliases: string[];
    /** @type {number} - Next value to allocate. */
    _next: number;
    /**
     * Builds a sequence.
     * @param {object} args - Options.
     * @param {string} args.name - Primary sequence name.
     * @param {number} [args.initial] - First value the sequence yields. Defaults to 1.
     * @param {SequenceFormatter} [args.formatter] - Optional formatter for the value.
     * @param {string[]} [args.aliases] - Additional names that share this sequence's state.
     */
    constructor({ name, initial, formatter, aliases }: {
        name: string;
        initial?: number;
        formatter?: SequenceFormatter;
        aliases?: string[];
    });
    /**
     * Allocates and consumes the next numeric value synchronously.
     * @returns {number} - The allocated raw value.
     */
    _allocate(): number;
    /**
     * Advances the sequence and returns the formatted value. The numeric value is
     * consumed synchronously before awaiting the formatter, so a rejected formatter
     * still advances the counter.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - The formatted value.
     */
    next(): Promise<ReturnType<typeof JSON.parse>>;
    /**
     * Returns the value the next `next()` call will allocate without consuming it.
     * @returns {number} - The upcoming raw value.
     */
    peek(): number;
    /**
     * Sets the next value the sequence will allocate.
     * @param {number} value - Next raw value.
     * @returns {void}
     */
    set(value: number): void;
    /**
     * Resets the counter back to its initial value.
     * @returns {void}
     */
    rewind(): void;
}
//# sourceMappingURL=sequence.d.ts.map