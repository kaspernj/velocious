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
    static async run({ concurrency = 8, items, worker }) {
        if (!Number.isInteger(concurrency) || concurrency < 1) {
            throw new Error(`Concurrency must be a positive integer but got ${String(concurrency)}`);
        }
        /** @type {R[]} */
        const results = new Array(items.length);
        let nextIndex = 0;
        const runNext = async () => {
            while (nextIndex < items.length) {
                const index = nextIndex;
                nextIndex += 1;
                results[index] = await worker(items[index], index);
            }
        };
        /** @type {Promise<void>[]} */
        const runners = [];
        for (let index = 0; index < Math.min(concurrency, items.length); index++) {
            runners.push(runNext());
        }
        await Promise.all(runners);
        return results;
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYm91bmRlZC10YXNrLXJ1bm5lci5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy91dGlscy9ib3VuZGVkLXRhc2stcnVubmVyLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWjs7Ozs7OztHQU9HO0FBQ0gsTUFBTSxDQUFDLE9BQU8sT0FBTyxpQkFBaUI7SUFDcEM7Ozs7Ozs7OztPQVNHO0lBQ0gsTUFBTSxDQUFDLEtBQUssQ0FBQyxHQUFHLENBQUMsRUFBQyxXQUFXLEdBQUcsQ0FBQyxFQUFFLEtBQUssRUFBRSxNQUFNLEVBQUM7UUFDL0MsSUFBSSxDQUFDLE1BQU0sQ0FBQyxTQUFTLENBQUMsV0FBVyxDQUFDLElBQUksV0FBVyxHQUFHLENBQUMsRUFBRSxDQUFDO1lBQ3RELE1BQU0sSUFBSSxLQUFLLENBQUMsa0RBQWtELE1BQU0sQ0FBQyxXQUFXLENBQUMsRUFBRSxDQUFDLENBQUE7UUFDMUYsQ0FBQztRQUVELGtCQUFrQjtRQUNsQixNQUFNLE9BQU8sR0FBRyxJQUFJLEtBQUssQ0FBQyxLQUFLLENBQUMsTUFBTSxDQUFDLENBQUE7UUFDdkMsSUFBSSxTQUFTLEdBQUcsQ0FBQyxDQUFBO1FBRWpCLE1BQU0sT0FBTyxHQUFHLEtBQUssSUFBSSxFQUFFO1lBQ3pCLE9BQU8sU0FBUyxHQUFHLEtBQUssQ0FBQyxNQUFNLEVBQUUsQ0FBQztnQkFDaEMsTUFBTSxLQUFLLEdBQUcsU0FBUyxDQUFBO2dCQUV2QixTQUFTLElBQUksQ0FBQyxDQUFBO2dCQUNkLE9BQU8sQ0FBQyxLQUFLLENBQUMsR0FBRyxNQUFNLE1BQU0sQ0FBQyxLQUFLLENBQUMsS0FBSyxDQUFDLEVBQUUsS0FBSyxDQUFDLENBQUE7WUFDcEQsQ0FBQztRQUNILENBQUMsQ0FBQTtRQUVELDhCQUE4QjtRQUM5QixNQUFNLE9BQU8sR0FBRyxFQUFFLENBQUE7UUFFbEIsS0FBSyxJQUFJLEtBQUssR0FBRyxDQUFDLEVBQUUsS0FBSyxHQUFHLElBQUksQ0FBQyxHQUFHLENBQUMsV0FBVyxFQUFFLEtBQUssQ0FBQyxNQUFNLENBQUMsRUFBRSxLQUFLLEVBQUUsRUFBRSxDQUFDO1lBQ3pFLE9BQU8sQ0FBQyxJQUFJLENBQUMsT0FBTyxFQUFFLENBQUMsQ0FBQTtRQUN6QixDQUFDO1FBRUQsTUFBTSxPQUFPLENBQUMsR0FBRyxDQUFDLE9BQU8sQ0FBQyxDQUFBO1FBRTFCLE9BQU8sT0FBTyxDQUFBO0lBQ2hCLENBQUM7Q0FDRiIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG4vKipcbiAqIFJ1bnMgb25lIGNhbGxiYWNrIHBlciBpdGVtIHdpdGggYSBib3VuZGVkIG51bWJlciBvZiBjYWxsYmFja3MgaW4gZmxpZ2h0LlxuICpcbiAqIFVzZWQgd2hlcmUgYSBzdGFydHVwIHBhc3MgaGFzIHRvIHRvdWNoIG1hbnkgaW5kZXBlbmRlbnQgcmVjb3JkcyAobW9kZWxcbiAqIG1ldGFkYXRhLCBwZXItdGFibGUgc2NoZW1hIHJlYWRzKSBhbmQgcnVubmluZyB0aGVtIHNlcXVlbnRpYWxseSBtdWx0aXBsaWVzIHRoZVxuICogcm91bmQtdHJpcCBsYXRlbmN5IGJ5IHRoZSBpdGVtIGNvdW50LCB3aGlsZSBydW5uaW5nIHRoZW0gYWxsIGF0IG9uY2Ugd291bGRcbiAqIG9wZW4gYW4gdW5ib3VuZGVkIG51bWJlciBvZiBkYXRhYmFzZSBjb25uZWN0aW9ucy5cbiAqL1xuZXhwb3J0IGRlZmF1bHQgY2xhc3MgQm91bmRlZFRhc2tSdW5uZXIge1xuICAvKipcbiAgICogUnVucyB0aGUgd29ya2VyIGZvciBldmVyeSBpdGVtLCBrZWVwaW5nIGF0IG1vc3QgYGNvbmN1cnJlbmN5YCBjYWxsYmFja3MgaW5cbiAgICogZmxpZ2h0IGFuZCByZXR1cm5pbmcgdGhlIHJlc3VsdHMgaW4gaW5wdXQgb3JkZXIuXG4gICAqIEB0ZW1wbGF0ZSBULCBSXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gUnVuIGFyZ3MuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBbYXJncy5jb25jdXJyZW5jeV0gLSBNYXhpbXVtIGNhbGxiYWNrcyBpbiBmbGlnaHQuXG4gICAqIEBwYXJhbSB7VFtdfSBhcmdzLml0ZW1zIC0gSXRlbXMgdG8gcHJvY2Vzcy5cbiAgICogQHBhcmFtIHsoaXRlbTogVCwgaW5kZXg6IG51bWJlcikgPT4gUHJvbWlzZTxSPn0gYXJncy53b3JrZXIgLSBDYWxsYmFjayBwZXIgaXRlbS5cbiAgICogQHJldHVybnMge1Byb21pc2U8UltdPn0gLSBSZXN1bHRzIGluIGlucHV0IG9yZGVyLlxuICAgKi9cbiAgc3RhdGljIGFzeW5jIHJ1bih7Y29uY3VycmVuY3kgPSA4LCBpdGVtcywgd29ya2VyfSkge1xuICAgIGlmICghTnVtYmVyLmlzSW50ZWdlcihjb25jdXJyZW5jeSkgfHwgY29uY3VycmVuY3kgPCAxKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYENvbmN1cnJlbmN5IG11c3QgYmUgYSBwb3NpdGl2ZSBpbnRlZ2VyIGJ1dCBnb3QgJHtTdHJpbmcoY29uY3VycmVuY3kpfWApXG4gICAgfVxuXG4gICAgLyoqIEB0eXBlIHtSW119ICovXG4gICAgY29uc3QgcmVzdWx0cyA9IG5ldyBBcnJheShpdGVtcy5sZW5ndGgpXG4gICAgbGV0IG5leHRJbmRleCA9IDBcblxuICAgIGNvbnN0IHJ1bk5leHQgPSBhc3luYyAoKSA9PiB7XG4gICAgICB3aGlsZSAobmV4dEluZGV4IDwgaXRlbXMubGVuZ3RoKSB7XG4gICAgICAgIGNvbnN0IGluZGV4ID0gbmV4dEluZGV4XG5cbiAgICAgICAgbmV4dEluZGV4ICs9IDFcbiAgICAgICAgcmVzdWx0c1tpbmRleF0gPSBhd2FpdCB3b3JrZXIoaXRlbXNbaW5kZXhdLCBpbmRleClcbiAgICAgIH1cbiAgICB9XG5cbiAgICAvKiogQHR5cGUge1Byb21pc2U8dm9pZD5bXX0gKi9cbiAgICBjb25zdCBydW5uZXJzID0gW11cblxuICAgIGZvciAobGV0IGluZGV4ID0gMDsgaW5kZXggPCBNYXRoLm1pbihjb25jdXJyZW5jeSwgaXRlbXMubGVuZ3RoKTsgaW5kZXgrKykge1xuICAgICAgcnVubmVycy5wdXNoKHJ1bk5leHQoKSlcbiAgICB9XG5cbiAgICBhd2FpdCBQcm9taXNlLmFsbChydW5uZXJzKVxuXG4gICAgcmV0dXJuIHJlc3VsdHNcbiAgfVxufVxuIl19