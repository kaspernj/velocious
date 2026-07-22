// @ts-check

/**
 * SequenceFormatter type. Receives the synchronously-allocated numeric value and
 * returns the formatted value (optionally asynchronously).
 * @typedef {(args: {value: number}) => (? | Promise<?>)} SequenceFormatter
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
  constructor({name, initial = 1, formatter, aliases = []}) {
    /** @type {string} - Primary sequence name. */
    this.name = name

    /** @type {number} - First value the sequence yields. */
    this.initial = initial

    /** @type {SequenceFormatter | undefined} - Optional value formatter. */
    this.formatter = formatter

    /** @type {string[]} - Names that share this sequence's counter. */
    this.aliases = aliases

    /** @type {number} - Next value to allocate. */
    this._next = initial
  }

  /**
   * Allocates and consumes the next numeric value synchronously.
   * @returns {number} - The allocated raw value.
   */
  _allocate() {
    const value = this._next

    this._next += 1

    return value
  }

  /**
   * Advances the sequence and returns the formatted value. The numeric value is
   * consumed synchronously before awaiting the formatter, so a rejected formatter
   * still advances the counter.
   * @returns {Promise<?>} - The formatted value.
   */
  async next() {
    const value = this._allocate()

    if (!this.formatter) return value

    return await this.formatter({value})
  }

  /**
   * Returns the value the next `next()` call will allocate without consuming it.
   * @returns {number} - The upcoming raw value.
   */
  peek() {
    return this._next
  }

  /**
   * Sets the next value the sequence will allocate.
   * @param {number} value - Next raw value.
   * @returns {void}
   */
  set(value) {
    this._next = value
  }

  /**
   * Resets the counter back to its initial value.
   * @returns {void}
   */
  rewind() {
    this._next = this.initial
  }
}
