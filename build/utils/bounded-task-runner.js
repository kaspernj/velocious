// @ts-check

/**
 * Runs one callback per item with a bounded number of callbacks in flight.
 *
 * Used where a startup pass has to touch many independent records (model
 * metadata, per-table schema reads) and running them sequentially multiplies the
 * round-trip latency by the item count, while running them all at once would
 * open an unbounded number of database connections.
 */
export default class BoundedTaskRunner {
  /**
   * Runs the worker for every item, keeping at most `concurrency` callbacks in
   * flight and returning the results in input order.
   * @template T, R
   * @param {object} args - Run args.
   * @param {number} [args.concurrency] - Maximum callbacks in flight.
   * @param {T[]} args.items - Items to process.
   * @param {(item: T, index: number) => Promise<R>} args.worker - Callback per item.
   * @returns {Promise<R[]>} - Results in input order.
   */
  static async run({concurrency = 8, items, worker}) {
    if (!Number.isInteger(concurrency) || concurrency < 1) {
      throw new Error(`Concurrency must be a positive integer but got ${String(concurrency)}`)
    }

    /** @type {R[]} */
    const results = new Array(items.length)
    let nextIndex = 0

    const runNext = async () => {
      while (nextIndex < items.length) {
        const index = nextIndex

        nextIndex += 1
        results[index] = await worker(items[index], index)
      }
    }

    /** @type {Promise<void>[]} */
    const runners = []

    for (let index = 0; index < Math.min(concurrency, items.length); index++) {
      runners.push(runNext())
    }

    await Promise.all(runners)

    return results
  }
}
