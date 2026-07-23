// @ts-check

/**
 * Thrown when an in-flight query is aborted via its `AbortSignal`/deadline. The
 * underlying connection has already been destroyed (never returned to the pool
 * half-drained), so this is a terminal, non-retryable outcome: the `query()`
 * retry loop treats it as non-retryable, so a deliberately-cancelled query is
 * never silently re-run against a fresh connection.
 */
export default class QueryAbortedError extends Error {
  /**
   * Runs constructor.
   * @param {object} [args] - Options.
   * @param {unknown} [args.cause] - Error cause.
   * @param {string} [args.sql] - The SQL that was aborted.
   */
  constructor({cause, sql} = {}) {
    super("Query aborted before it completed", {cause})

    this.name = "QueryAbortedError"
    this.code = "VELOCIOUS_QUERY_ABORTED"
    this.sql = sql
  }
}
