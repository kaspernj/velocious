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
    static run<T, R>({ concurrency, items, worker }: {
        concurrency?: number;
        items: T[];
        worker: (item: T, index: number) => Promise<R>;
    }): Promise<R[]>;
}
//# sourceMappingURL=bounded-task-runner.d.ts.map