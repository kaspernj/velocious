// @ts-check
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
    /**
     * Builds a sequence.
     * @param {object} args - Options.
     * @param {string} args.name - Primary sequence name.
     * @param {number} [args.initial] - First value the sequence yields. Defaults to 1.
     * @param {SequenceFormatter} [args.formatter] - Optional formatter for the value.
     * @param {string[]} [args.aliases] - Additional names that share this sequence's state.
     */
    constructor({ name, initial = 1, formatter, aliases = [] }) {
        /** @type {string} - Primary sequence name. */
        this.name = name;
        /** @type {number} - First value the sequence yields. */
        this.initial = initial;
        /** @type {SequenceFormatter | undefined} - Optional value formatter. */
        this.formatter = formatter;
        /** @type {string[]} - Names that share this sequence's counter. */
        this.aliases = aliases;
        /** @type {number} - Next value to allocate. */
        this._next = initial;
    }
    /**
     * Allocates and consumes the next numeric value synchronously.
     * @returns {number} - The allocated raw value.
     */
    _allocate() {
        const value = this._next;
        this._next += 1;
        return value;
    }
    /**
     * Advances the sequence and returns the formatted value. The numeric value is
     * consumed synchronously before awaiting the formatter, so a rejected formatter
     * still advances the counter.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - The formatted value.
     */
    async next() {
        const value = this._allocate();
        if (!this.formatter)
            return value;
        return await this.formatter({ value });
    }
    /**
     * Returns the value the next `next()` call will allocate without consuming it.
     * @returns {number} - The upcoming raw value.
     */
    peek() {
        return this._next;
    }
    /**
     * Sets the next value the sequence will allocate.
     * @param {number} value - Next raw value.
     * @returns {void}
     */
    set(value) {
        this._next = value;
    }
    /**
     * Resets the counter back to its initial value.
     * @returns {void}
     */
    rewind() {
        this._next = this.initial;
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic2VxdWVuY2UuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvdGVzdGluZy9mYWN0b3J5L3NlcXVlbmNlLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWjs7OztHQUlHO0FBRUg7Ozs7O0dBS0c7QUFDSCxNQUFNLENBQUMsT0FBTyxPQUFPLFFBQVE7SUFDM0I7Ozs7Ozs7T0FPRztJQUNILFlBQVksRUFBQyxJQUFJLEVBQUUsT0FBTyxHQUFHLENBQUMsRUFBRSxTQUFTLEVBQUUsT0FBTyxHQUFHLEVBQUUsRUFBQztRQUN0RCw4Q0FBOEM7UUFDOUMsSUFBSSxDQUFDLElBQUksR0FBRyxJQUFJLENBQUE7UUFFaEIsd0RBQXdEO1FBQ3hELElBQUksQ0FBQyxPQUFPLEdBQUcsT0FBTyxDQUFBO1FBRXRCLHdFQUF3RTtRQUN4RSxJQUFJLENBQUMsU0FBUyxHQUFHLFNBQVMsQ0FBQTtRQUUxQixtRUFBbUU7UUFDbkUsSUFBSSxDQUFDLE9BQU8sR0FBRyxPQUFPLENBQUE7UUFFdEIsK0NBQStDO1FBQy9DLElBQUksQ0FBQyxLQUFLLEdBQUcsT0FBTyxDQUFBO0lBQ3RCLENBQUM7SUFFRDs7O09BR0c7SUFDSCxTQUFTO1FBQ1AsTUFBTSxLQUFLLEdBQUcsSUFBSSxDQUFDLEtBQUssQ0FBQTtRQUV4QixJQUFJLENBQUMsS0FBSyxJQUFJLENBQUMsQ0FBQTtRQUVmLE9BQU8sS0FBSyxDQUFBO0lBQ2QsQ0FBQztJQUVEOzs7OztPQUtHO0lBQ0gsS0FBSyxDQUFDLElBQUk7UUFDUixNQUFNLEtBQUssR0FBRyxJQUFJLENBQUMsU0FBUyxFQUFFLENBQUE7UUFFOUIsSUFBSSxDQUFDLElBQUksQ0FBQyxTQUFTO1lBQUUsT0FBTyxLQUFLLENBQUE7UUFFakMsT0FBTyxNQUFNLElBQUksQ0FBQyxTQUFTLENBQUMsRUFBQyxLQUFLLEVBQUMsQ0FBQyxDQUFBO0lBQ3RDLENBQUM7SUFFRDs7O09BR0c7SUFDSCxJQUFJO1FBQ0YsT0FBTyxJQUFJLENBQUMsS0FBSyxDQUFBO0lBQ25CLENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsR0FBRyxDQUFDLEtBQUs7UUFDUCxJQUFJLENBQUMsS0FBSyxHQUFHLEtBQUssQ0FBQTtJQUNwQixDQUFDO0lBRUQ7OztPQUdHO0lBQ0gsTUFBTTtRQUNKLElBQUksQ0FBQyxLQUFLLEdBQUcsSUFBSSxDQUFDLE9BQU8sQ0FBQTtJQUMzQixDQUFDO0NBQ0YiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuLyoqXG4gKiBTZXF1ZW5jZUZvcm1hdHRlciB0eXBlLiBSZWNlaXZlcyB0aGUgc3luY2hyb25vdXNseS1hbGxvY2F0ZWQgbnVtZXJpYyB2YWx1ZSBhbmRcbiAqIHJldHVybnMgdGhlIGZvcm1hdHRlZCB2YWx1ZSAob3B0aW9uYWxseSBhc3luY2hyb25vdXNseSkuXG4gKiBAdHlwZWRlZiB7KGFyZ3M6IHt2YWx1ZTogbnVtYmVyfSkgPT4gKFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+IHwgUHJvbWlzZTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4pfSBTZXF1ZW5jZUZvcm1hdHRlclxuICovXG5cbi8qKlxuICogQSBudW1lcmljIGNvdW50ZXIgc2VxdWVuY2UuIFZhbHVlcyBhcmUgYWxsb2NhdGVkIGFuZCBjb25zdW1lZCBzeW5jaHJvbm91c2x5XG4gKiBiZWZvcmUgdGhlIChwb3NzaWJseSBhc3luYykgZm9ybWF0dGVyIHJ1bnMsIHNvIGEgcmVqZWN0ZWQgZm9ybWF0dGVyIHN0aWxsXG4gKiBhZHZhbmNlcyB0aGUgY291bnRlciBhbmQgY29uY3VycmVudCBgUHJvbWlzZS5hbGxgIGFsbG9jYXRpb24gbmV2ZXIgY29sbGlkZXMg4oCUXG4gKiBtYXRjaGluZyBGYWN0b3J5Qm90J3MgZmFpbGVkLXZhbHVlLWNvbnN1bXB0aW9uIGJlaGF2aW91ci5cbiAqL1xuZXhwb3J0IGRlZmF1bHQgY2xhc3MgU2VxdWVuY2Uge1xuICAvKipcbiAgICogQnVpbGRzIGEgc2VxdWVuY2UuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MubmFtZSAtIFByaW1hcnkgc2VxdWVuY2UgbmFtZS5cbiAgICogQHBhcmFtIHtudW1iZXJ9IFthcmdzLmluaXRpYWxdIC0gRmlyc3QgdmFsdWUgdGhlIHNlcXVlbmNlIHlpZWxkcy4gRGVmYXVsdHMgdG8gMS5cbiAgICogQHBhcmFtIHtTZXF1ZW5jZUZvcm1hdHRlcn0gW2FyZ3MuZm9ybWF0dGVyXSAtIE9wdGlvbmFsIGZvcm1hdHRlciBmb3IgdGhlIHZhbHVlLlxuICAgKiBAcGFyYW0ge3N0cmluZ1tdfSBbYXJncy5hbGlhc2VzXSAtIEFkZGl0aW9uYWwgbmFtZXMgdGhhdCBzaGFyZSB0aGlzIHNlcXVlbmNlJ3Mgc3RhdGUuXG4gICAqL1xuICBjb25zdHJ1Y3Rvcih7bmFtZSwgaW5pdGlhbCA9IDEsIGZvcm1hdHRlciwgYWxpYXNlcyA9IFtdfSkge1xuICAgIC8qKiBAdHlwZSB7c3RyaW5nfSAtIFByaW1hcnkgc2VxdWVuY2UgbmFtZS4gKi9cbiAgICB0aGlzLm5hbWUgPSBuYW1lXG5cbiAgICAvKiogQHR5cGUge251bWJlcn0gLSBGaXJzdCB2YWx1ZSB0aGUgc2VxdWVuY2UgeWllbGRzLiAqL1xuICAgIHRoaXMuaW5pdGlhbCA9IGluaXRpYWxcblxuICAgIC8qKiBAdHlwZSB7U2VxdWVuY2VGb3JtYXR0ZXIgfCB1bmRlZmluZWR9IC0gT3B0aW9uYWwgdmFsdWUgZm9ybWF0dGVyLiAqL1xuICAgIHRoaXMuZm9ybWF0dGVyID0gZm9ybWF0dGVyXG5cbiAgICAvKiogQHR5cGUge3N0cmluZ1tdfSAtIE5hbWVzIHRoYXQgc2hhcmUgdGhpcyBzZXF1ZW5jZSdzIGNvdW50ZXIuICovXG4gICAgdGhpcy5hbGlhc2VzID0gYWxpYXNlc1xuXG4gICAgLyoqIEB0eXBlIHtudW1iZXJ9IC0gTmV4dCB2YWx1ZSB0byBhbGxvY2F0ZS4gKi9cbiAgICB0aGlzLl9uZXh0ID0gaW5pdGlhbFxuICB9XG5cbiAgLyoqXG4gICAqIEFsbG9jYXRlcyBhbmQgY29uc3VtZXMgdGhlIG5leHQgbnVtZXJpYyB2YWx1ZSBzeW5jaHJvbm91c2x5LlxuICAgKiBAcmV0dXJucyB7bnVtYmVyfSAtIFRoZSBhbGxvY2F0ZWQgcmF3IHZhbHVlLlxuICAgKi9cbiAgX2FsbG9jYXRlKCkge1xuICAgIGNvbnN0IHZhbHVlID0gdGhpcy5fbmV4dFxuXG4gICAgdGhpcy5fbmV4dCArPSAxXG5cbiAgICByZXR1cm4gdmFsdWVcbiAgfVxuXG4gIC8qKlxuICAgKiBBZHZhbmNlcyB0aGUgc2VxdWVuY2UgYW5kIHJldHVybnMgdGhlIGZvcm1hdHRlZCB2YWx1ZS4gVGhlIG51bWVyaWMgdmFsdWUgaXNcbiAgICogY29uc3VtZWQgc3luY2hyb25vdXNseSBiZWZvcmUgYXdhaXRpbmcgdGhlIGZvcm1hdHRlciwgc28gYSByZWplY3RlZCBmb3JtYXR0ZXJcbiAgICogc3RpbGwgYWR2YW5jZXMgdGhlIGNvdW50ZXIuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBUaGUgZm9ybWF0dGVkIHZhbHVlLlxuICAgKi9cbiAgYXN5bmMgbmV4dCgpIHtcbiAgICBjb25zdCB2YWx1ZSA9IHRoaXMuX2FsbG9jYXRlKClcblxuICAgIGlmICghdGhpcy5mb3JtYXR0ZXIpIHJldHVybiB2YWx1ZVxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuZm9ybWF0dGVyKHt2YWx1ZX0pXG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyB0aGUgdmFsdWUgdGhlIG5leHQgYG5leHQoKWAgY2FsbCB3aWxsIGFsbG9jYXRlIHdpdGhvdXQgY29uc3VtaW5nIGl0LlxuICAgKiBAcmV0dXJucyB7bnVtYmVyfSAtIFRoZSB1cGNvbWluZyByYXcgdmFsdWUuXG4gICAqL1xuICBwZWVrKCkge1xuICAgIHJldHVybiB0aGlzLl9uZXh0XG4gIH1cblxuICAvKipcbiAgICogU2V0cyB0aGUgbmV4dCB2YWx1ZSB0aGUgc2VxdWVuY2Ugd2lsbCBhbGxvY2F0ZS5cbiAgICogQHBhcmFtIHtudW1iZXJ9IHZhbHVlIC0gTmV4dCByYXcgdmFsdWUuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgc2V0KHZhbHVlKSB7XG4gICAgdGhpcy5fbmV4dCA9IHZhbHVlXG4gIH1cblxuICAvKipcbiAgICogUmVzZXRzIHRoZSBjb3VudGVyIGJhY2sgdG8gaXRzIGluaXRpYWwgdmFsdWUuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgcmV3aW5kKCkge1xuICAgIHRoaXMuX25leHQgPSB0aGlzLmluaXRpYWxcbiAgfVxufVxuIl19