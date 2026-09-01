// @ts-check

/**
 * Thrown when a query is aborted via its `AbortSignal`/deadline. This is a
 * terminal, non-retryable outcome whether cancellation happened before checkout
 * or after an in-flight connection had to be destroyed.
 */
export default class QueryAbortedError extends Error {
  /**
   * Runs constructor.
   * @param {object} [args] - Options.
   * @param {unknown} [args.cause] - Error cause.
   * @param {boolean} [args.connectionDestroyed] - Whether cancellation destroyed an in-flight connection.
   * @param {string} [args.sql] - The SQL that was aborted.
   */
  constructor({cause, connectionDestroyed = false, sql} = {}) {
    super("Query aborted before it completed", {cause})

    this.name = "QueryAbortedError"
    this.code = "VELOCIOUS_QUERY_ABORTED"
    this.connectionDestroyed = connectionDestroyed
    this.sql = sql
  }
}
