// @ts-check
/**
 * The outcome of an SyncUpstreamImporter import call.
 * @template T
 * @typedef {object} SyncUpstreamImportResult
 * @property {boolean} imported - Whether the upstream import ran (coalesced callers share the one run's outcome); false only when the throttle window suppressed the run.
 * @property {T | undefined} result - The importer's return value, or undefined when skipped.
 */
/**
 * Coalesces and throttles upstream imports that keep a sync feed self-sustaining.
 *
 * Apps serving a sync changes feed often need a slow upstream (for example a
 * legacy database) imported before the feed is served, so a pull returns fresh
 * data without the client calling a bespoke trigger endpoint first. This
 * importer owns the two generic mechanics that kind of trigger needs:
 *
 * - Coalescing: concurrent imports for the same key share one in-flight run, so
 *   a burst of pulls (sign-in, reconnect, several devices) starts exactly one
 *   upstream import.
 * - Throttling: callers that may pull very frequently (auto-resync, statistics
 *   screens) declare `throttleMs` and repeats inside the window skip the
 *   upstream run, because the feed already holds everything the last import
 *   found. A caller that must always import (for example an explicit legacy
 *   endpoint) simply omits `throttleMs`; its successful run still freshens the
 *   shared timestamp, so subsequent throttled callers see the feed as fresh.
 *
 * Failures propagate to every awaiter and never start the throttle window, so
 * the next call retries the upstream import.
 */
export default class SyncUpstreamImporter {
    /**
     * Runs constructor.
     * @param {object} [args] - Options.
     * @param {number} [args.maxSuccessAgeMs] - How long a success timestamp is retained before being swept on the next successful import (default 24 hours, far beyond any sane throttle window). Bounds the shared importer's memory when keys vary over the server lifetime (for example `tickets:<eventId>`).
     * @param {() => number} [args.now] - Clock override for specs.
     */
    constructor({ maxSuccessAgeMs = 86400000, now = () => Date.now() } = {}) {
        this.maxSuccessAgeMs = maxSuccessAgeMs;
        this.now = now;
        /** @type {Map<string, Promise<SyncUpstreamImportResult<unknown>>>} In-flight import per key; the cast back to the caller's T happens at the await site. */
        this.inFlightByKey = new Map();
        /** @type {Map<string, number>} Last successful import finish time per key. */
        this.lastSuccessAtByKey = new Map();
    }
    /**
     * Runs the upstream import for the key, coalescing concurrent callers and
     * skipping throttled callers while the last successful run is still fresh.
     * @template T
     * @param {object} args - Import args.
     * @param {string} args.key - What is being imported (for example `tickets:<eventId>`); coalescing and throttling are scoped per key.
     * @param {() => Promise<T>} args.importer - Performs the upstream import.
     * @param {number} [args.throttleMs] - Skip the run when the last successful import for the key finished less than this long ago.
     * @returns {Promise<SyncUpstreamImportResult<T>>} Import outcome.
     */
    async import({ key, importer, throttleMs }) {
        const inFlight = this.inFlightByKey.get(key);
        if (inFlight)
            return /** @type {SyncUpstreamImportResult<T>} */ (await inFlight);
        if (typeof throttleMs === "number") {
            const lastSuccessAt = this.lastSuccessAtByKey.get(key);
            if (lastSuccessAt !== undefined && this.now() - lastSuccessAt < throttleMs) {
                return { imported: false, result: undefined };
            }
        }
        const runPromise = (async () => {
            const result = await importer();
            this.lastSuccessAtByKey.set(key, this.now());
            this.sweepStaleSuccessTimestamps();
            return { imported: true, result };
        })();
        const trackedPromise = runPromise.finally(() => this.inFlightByKey.delete(key));
        this.inFlightByKey.set(key, trackedPromise);
        return await trackedPromise;
    }
    /**
     * Drops success timestamps past the maximum age. Runs on each successful
     * import so long-lived processes do not accumulate one map entry per key
     * ever imported.
     * @returns {void}
     */
    sweepStaleSuccessTimestamps() {
        const now = this.now();
        for (const [key, at] of this.lastSuccessAtByKey) {
            if (now - at >= this.maxSuccessAgeMs)
                this.lastSuccessAtByKey.delete(key);
        }
    }
}
/** @type {Map<import("../configuration.js").default, SyncUpstreamImporter>} Shared importer per configuration. */
const importersByConfiguration = new Map();
/**
 * Returns the shared upstream importer for a configuration, so every sync
 * resource instance and legacy endpoint serving the same backend coalesces and
 * throttles upstream imports together.
 * @param {import("../configuration.js").default} configuration - Configuration owning the importer.
 * @returns {SyncUpstreamImporter} Shared importer for the configuration.
 */
export function syncUpstreamImporterForConfiguration(configuration) {
    let importer = importersByConfiguration.get(configuration);
    if (!importer) {
        importer = new SyncUpstreamImporter();
        importersByConfiguration.set(configuration, importer);
    }
    return importer;
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic3luYy11cHN0cmVhbS1pbXBvcnRlci5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9zeW5jL3N5bmMtdXBzdHJlYW0taW1wb3J0ZXIuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaOzs7Ozs7R0FNRztBQUVIOzs7Ozs7Ozs7Ozs7Ozs7Ozs7OztHQW9CRztBQUNILE1BQU0sQ0FBQyxPQUFPLE9BQU8sb0JBQW9CO0lBQ3ZDOzs7OztPQUtHO0lBQ0gsWUFBWSxFQUFDLGVBQWUsR0FBRyxRQUFRLEVBQUUsR0FBRyxHQUFHLEdBQUcsRUFBRSxDQUFDLElBQUksQ0FBQyxHQUFHLEVBQUUsRUFBQyxHQUFHLEVBQUU7UUFDbkUsSUFBSSxDQUFDLGVBQWUsR0FBRyxlQUFlLENBQUE7UUFDdEMsSUFBSSxDQUFDLEdBQUcsR0FBRyxHQUFHLENBQUE7UUFFZCwySkFBMko7UUFDM0osSUFBSSxDQUFDLGFBQWEsR0FBRyxJQUFJLEdBQUcsRUFBRSxDQUFBO1FBRTlCLDhFQUE4RTtRQUM5RSxJQUFJLENBQUMsa0JBQWtCLEdBQUcsSUFBSSxHQUFHLEVBQUUsQ0FBQTtJQUNyQyxDQUFDO0lBRUQ7Ozs7Ozs7OztPQVNHO0lBQ0gsS0FBSyxDQUFDLE1BQU0sQ0FBQyxFQUFDLEdBQUcsRUFBRSxRQUFRLEVBQUUsVUFBVSxFQUFDO1FBQ3RDLE1BQU0sUUFBUSxHQUFHLElBQUksQ0FBQyxhQUFhLENBQUMsR0FBRyxDQUFDLEdBQUcsQ0FBQyxDQUFBO1FBRTVDLElBQUksUUFBUTtZQUFFLE9BQU8sMENBQTBDLENBQUMsQ0FBQyxNQUFNLFFBQVEsQ0FBQyxDQUFBO1FBRWhGLElBQUksT0FBTyxVQUFVLEtBQUssUUFBUSxFQUFFLENBQUM7WUFDbkMsTUFBTSxhQUFhLEdBQUcsSUFBSSxDQUFDLGtCQUFrQixDQUFDLEdBQUcsQ0FBQyxHQUFHLENBQUMsQ0FBQTtZQUV0RCxJQUFJLGFBQWEsS0FBSyxTQUFTLElBQUksSUFBSSxDQUFDLEdBQUcsRUFBRSxHQUFHLGFBQWEsR0FBRyxVQUFVLEVBQUUsQ0FBQztnQkFDM0UsT0FBTyxFQUFDLFFBQVEsRUFBRSxLQUFLLEVBQUUsTUFBTSxFQUFFLFNBQVMsRUFBQyxDQUFBO1lBQzdDLENBQUM7UUFDSCxDQUFDO1FBRUQsTUFBTSxVQUFVLEdBQUcsQ0FBQyxLQUFLLElBQUksRUFBRTtZQUM3QixNQUFNLE1BQU0sR0FBRyxNQUFNLFFBQVEsRUFBRSxDQUFBO1lBRS9CLElBQUksQ0FBQyxrQkFBa0IsQ0FBQyxHQUFHLENBQUMsR0FBRyxFQUFFLElBQUksQ0FBQyxHQUFHLEVBQUUsQ0FBQyxDQUFBO1lBQzVDLElBQUksQ0FBQywyQkFBMkIsRUFBRSxDQUFBO1lBRWxDLE9BQU8sRUFBQyxRQUFRLEVBQUUsSUFBSSxFQUFFLE1BQU0sRUFBQyxDQUFBO1FBQ2pDLENBQUMsQ0FBQyxFQUFFLENBQUE7UUFDSixNQUFNLGNBQWMsR0FBRyxVQUFVLENBQUMsT0FBTyxDQUFDLEdBQUcsRUFBRSxDQUFDLElBQUksQ0FBQyxhQUFhLENBQUMsTUFBTSxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUE7UUFFL0UsSUFBSSxDQUFDLGFBQWEsQ0FBQyxHQUFHLENBQUMsR0FBRyxFQUFFLGNBQWMsQ0FBQyxDQUFBO1FBRTNDLE9BQU8sTUFBTSxjQUFjLENBQUE7SUFDN0IsQ0FBQztJQUVEOzs7OztPQUtHO0lBQ0gsMkJBQTJCO1FBQ3pCLE1BQU0sR0FBRyxHQUFHLElBQUksQ0FBQyxHQUFHLEVBQUUsQ0FBQTtRQUV0QixLQUFLLE1BQU0sQ0FBQyxHQUFHLEVBQUUsRUFBRSxDQUFDLElBQUksSUFBSSxDQUFDLGtCQUFrQixFQUFFLENBQUM7WUFDaEQsSUFBSSxHQUFHLEdBQUcsRUFBRSxJQUFJLElBQUksQ0FBQyxlQUFlO2dCQUFFLElBQUksQ0FBQyxrQkFBa0IsQ0FBQyxNQUFNLENBQUMsR0FBRyxDQUFDLENBQUE7UUFDM0UsQ0FBQztJQUNILENBQUM7Q0FDRjtBQUVELGtIQUFrSDtBQUNsSCxNQUFNLHdCQUF3QixHQUFHLElBQUksR0FBRyxFQUFFLENBQUE7QUFFMUM7Ozs7OztHQU1HO0FBQ0gsTUFBTSxVQUFVLG9DQUFvQyxDQUFDLGFBQWE7SUFDaEUsSUFBSSxRQUFRLEdBQUcsd0JBQXdCLENBQUMsR0FBRyxDQUFDLGFBQWEsQ0FBQyxDQUFBO0lBRTFELElBQUksQ0FBQyxRQUFRLEVBQUUsQ0FBQztRQUNkLFFBQVEsR0FBRyxJQUFJLG9CQUFvQixFQUFFLENBQUE7UUFDckMsd0JBQXdCLENBQUMsR0FBRyxDQUFDLGFBQWEsRUFBRSxRQUFRLENBQUMsQ0FBQTtJQUN2RCxDQUFDO0lBRUQsT0FBTyxRQUFRLENBQUE7QUFDakIsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG4vKipcbiAqIFRoZSBvdXRjb21lIG9mIGFuIFN5bmNVcHN0cmVhbUltcG9ydGVyIGltcG9ydCBjYWxsLlxuICogQHRlbXBsYXRlIFRcbiAqIEB0eXBlZGVmIHtvYmplY3R9IFN5bmNVcHN0cmVhbUltcG9ydFJlc3VsdFxuICogQHByb3BlcnR5IHtib29sZWFufSBpbXBvcnRlZCAtIFdoZXRoZXIgdGhlIHVwc3RyZWFtIGltcG9ydCByYW4gKGNvYWxlc2NlZCBjYWxsZXJzIHNoYXJlIHRoZSBvbmUgcnVuJ3Mgb3V0Y29tZSk7IGZhbHNlIG9ubHkgd2hlbiB0aGUgdGhyb3R0bGUgd2luZG93IHN1cHByZXNzZWQgdGhlIHJ1bi5cbiAqIEBwcm9wZXJ0eSB7VCB8IHVuZGVmaW5lZH0gcmVzdWx0IC0gVGhlIGltcG9ydGVyJ3MgcmV0dXJuIHZhbHVlLCBvciB1bmRlZmluZWQgd2hlbiBza2lwcGVkLlxuICovXG5cbi8qKlxuICogQ29hbGVzY2VzIGFuZCB0aHJvdHRsZXMgdXBzdHJlYW0gaW1wb3J0cyB0aGF0IGtlZXAgYSBzeW5jIGZlZWQgc2VsZi1zdXN0YWluaW5nLlxuICpcbiAqIEFwcHMgc2VydmluZyBhIHN5bmMgY2hhbmdlcyBmZWVkIG9mdGVuIG5lZWQgYSBzbG93IHVwc3RyZWFtIChmb3IgZXhhbXBsZSBhXG4gKiBsZWdhY3kgZGF0YWJhc2UpIGltcG9ydGVkIGJlZm9yZSB0aGUgZmVlZCBpcyBzZXJ2ZWQsIHNvIGEgcHVsbCByZXR1cm5zIGZyZXNoXG4gKiBkYXRhIHdpdGhvdXQgdGhlIGNsaWVudCBjYWxsaW5nIGEgYmVzcG9rZSB0cmlnZ2VyIGVuZHBvaW50IGZpcnN0LiBUaGlzXG4gKiBpbXBvcnRlciBvd25zIHRoZSB0d28gZ2VuZXJpYyBtZWNoYW5pY3MgdGhhdCBraW5kIG9mIHRyaWdnZXIgbmVlZHM6XG4gKlxuICogLSBDb2FsZXNjaW5nOiBjb25jdXJyZW50IGltcG9ydHMgZm9yIHRoZSBzYW1lIGtleSBzaGFyZSBvbmUgaW4tZmxpZ2h0IHJ1biwgc29cbiAqICAgYSBidXJzdCBvZiBwdWxscyAoc2lnbi1pbiwgcmVjb25uZWN0LCBzZXZlcmFsIGRldmljZXMpIHN0YXJ0cyBleGFjdGx5IG9uZVxuICogICB1cHN0cmVhbSBpbXBvcnQuXG4gKiAtIFRocm90dGxpbmc6IGNhbGxlcnMgdGhhdCBtYXkgcHVsbCB2ZXJ5IGZyZXF1ZW50bHkgKGF1dG8tcmVzeW5jLCBzdGF0aXN0aWNzXG4gKiAgIHNjcmVlbnMpIGRlY2xhcmUgYHRocm90dGxlTXNgIGFuZCByZXBlYXRzIGluc2lkZSB0aGUgd2luZG93IHNraXAgdGhlXG4gKiAgIHVwc3RyZWFtIHJ1biwgYmVjYXVzZSB0aGUgZmVlZCBhbHJlYWR5IGhvbGRzIGV2ZXJ5dGhpbmcgdGhlIGxhc3QgaW1wb3J0XG4gKiAgIGZvdW5kLiBBIGNhbGxlciB0aGF0IG11c3QgYWx3YXlzIGltcG9ydCAoZm9yIGV4YW1wbGUgYW4gZXhwbGljaXQgbGVnYWN5XG4gKiAgIGVuZHBvaW50KSBzaW1wbHkgb21pdHMgYHRocm90dGxlTXNgOyBpdHMgc3VjY2Vzc2Z1bCBydW4gc3RpbGwgZnJlc2hlbnMgdGhlXG4gKiAgIHNoYXJlZCB0aW1lc3RhbXAsIHNvIHN1YnNlcXVlbnQgdGhyb3R0bGVkIGNhbGxlcnMgc2VlIHRoZSBmZWVkIGFzIGZyZXNoLlxuICpcbiAqIEZhaWx1cmVzIHByb3BhZ2F0ZSB0byBldmVyeSBhd2FpdGVyIGFuZCBuZXZlciBzdGFydCB0aGUgdGhyb3R0bGUgd2luZG93LCBzb1xuICogdGhlIG5leHQgY2FsbCByZXRyaWVzIHRoZSB1cHN0cmVhbSBpbXBvcnQuXG4gKi9cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIFN5bmNVcHN0cmVhbUltcG9ydGVyIHtcbiAgLyoqXG4gICAqIFJ1bnMgY29uc3RydWN0b3IuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBbYXJnc10gLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2FyZ3MubWF4U3VjY2Vzc0FnZU1zXSAtIEhvdyBsb25nIGEgc3VjY2VzcyB0aW1lc3RhbXAgaXMgcmV0YWluZWQgYmVmb3JlIGJlaW5nIHN3ZXB0IG9uIHRoZSBuZXh0IHN1Y2Nlc3NmdWwgaW1wb3J0IChkZWZhdWx0IDI0IGhvdXJzLCBmYXIgYmV5b25kIGFueSBzYW5lIHRocm90dGxlIHdpbmRvdykuIEJvdW5kcyB0aGUgc2hhcmVkIGltcG9ydGVyJ3MgbWVtb3J5IHdoZW4ga2V5cyB2YXJ5IG92ZXIgdGhlIHNlcnZlciBsaWZldGltZSAoZm9yIGV4YW1wbGUgYHRpY2tldHM6PGV2ZW50SWQ+YCkuXG4gICAqIEBwYXJhbSB7KCkgPT4gbnVtYmVyfSBbYXJncy5ub3ddIC0gQ2xvY2sgb3ZlcnJpZGUgZm9yIHNwZWNzLlxuICAgKi9cbiAgY29uc3RydWN0b3Ioe21heFN1Y2Nlc3NBZ2VNcyA9IDg2NDAwMDAwLCBub3cgPSAoKSA9PiBEYXRlLm5vdygpfSA9IHt9KSB7XG4gICAgdGhpcy5tYXhTdWNjZXNzQWdlTXMgPSBtYXhTdWNjZXNzQWdlTXNcbiAgICB0aGlzLm5vdyA9IG5vd1xuXG4gICAgLyoqIEB0eXBlIHtNYXA8c3RyaW5nLCBQcm9taXNlPFN5bmNVcHN0cmVhbUltcG9ydFJlc3VsdDx1bmtub3duPj4+fSBJbi1mbGlnaHQgaW1wb3J0IHBlciBrZXk7IHRoZSBjYXN0IGJhY2sgdG8gdGhlIGNhbGxlcidzIFQgaGFwcGVucyBhdCB0aGUgYXdhaXQgc2l0ZS4gKi9cbiAgICB0aGlzLmluRmxpZ2h0QnlLZXkgPSBuZXcgTWFwKClcblxuICAgIC8qKiBAdHlwZSB7TWFwPHN0cmluZywgbnVtYmVyPn0gTGFzdCBzdWNjZXNzZnVsIGltcG9ydCBmaW5pc2ggdGltZSBwZXIga2V5LiAqL1xuICAgIHRoaXMubGFzdFN1Y2Nlc3NBdEJ5S2V5ID0gbmV3IE1hcCgpXG4gIH1cblxuICAvKipcbiAgICogUnVucyB0aGUgdXBzdHJlYW0gaW1wb3J0IGZvciB0aGUga2V5LCBjb2FsZXNjaW5nIGNvbmN1cnJlbnQgY2FsbGVycyBhbmRcbiAgICogc2tpcHBpbmcgdGhyb3R0bGVkIGNhbGxlcnMgd2hpbGUgdGhlIGxhc3Qgc3VjY2Vzc2Z1bCBydW4gaXMgc3RpbGwgZnJlc2guXG4gICAqIEB0ZW1wbGF0ZSBUXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gSW1wb3J0IGFyZ3MuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmtleSAtIFdoYXQgaXMgYmVpbmcgaW1wb3J0ZWQgKGZvciBleGFtcGxlIGB0aWNrZXRzOjxldmVudElkPmApOyBjb2FsZXNjaW5nIGFuZCB0aHJvdHRsaW5nIGFyZSBzY29wZWQgcGVyIGtleS5cbiAgICogQHBhcmFtIHsoKSA9PiBQcm9taXNlPFQ+fSBhcmdzLmltcG9ydGVyIC0gUGVyZm9ybXMgdGhlIHVwc3RyZWFtIGltcG9ydC5cbiAgICogQHBhcmFtIHtudW1iZXJ9IFthcmdzLnRocm90dGxlTXNdIC0gU2tpcCB0aGUgcnVuIHdoZW4gdGhlIGxhc3Qgc3VjY2Vzc2Z1bCBpbXBvcnQgZm9yIHRoZSBrZXkgZmluaXNoZWQgbGVzcyB0aGFuIHRoaXMgbG9uZyBhZ28uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFN5bmNVcHN0cmVhbUltcG9ydFJlc3VsdDxUPj59IEltcG9ydCBvdXRjb21lLlxuICAgKi9cbiAgYXN5bmMgaW1wb3J0KHtrZXksIGltcG9ydGVyLCB0aHJvdHRsZU1zfSkge1xuICAgIGNvbnN0IGluRmxpZ2h0ID0gdGhpcy5pbkZsaWdodEJ5S2V5LmdldChrZXkpXG5cbiAgICBpZiAoaW5GbGlnaHQpIHJldHVybiAvKiogQHR5cGUge1N5bmNVcHN0cmVhbUltcG9ydFJlc3VsdDxUPn0gKi8gKGF3YWl0IGluRmxpZ2h0KVxuXG4gICAgaWYgKHR5cGVvZiB0aHJvdHRsZU1zID09PSBcIm51bWJlclwiKSB7XG4gICAgICBjb25zdCBsYXN0U3VjY2Vzc0F0ID0gdGhpcy5sYXN0U3VjY2Vzc0F0QnlLZXkuZ2V0KGtleSlcblxuICAgICAgaWYgKGxhc3RTdWNjZXNzQXQgIT09IHVuZGVmaW5lZCAmJiB0aGlzLm5vdygpIC0gbGFzdFN1Y2Nlc3NBdCA8IHRocm90dGxlTXMpIHtcbiAgICAgICAgcmV0dXJuIHtpbXBvcnRlZDogZmFsc2UsIHJlc3VsdDogdW5kZWZpbmVkfVxuICAgICAgfVxuICAgIH1cblxuICAgIGNvbnN0IHJ1blByb21pc2UgPSAoYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgaW1wb3J0ZXIoKVxuXG4gICAgICB0aGlzLmxhc3RTdWNjZXNzQXRCeUtleS5zZXQoa2V5LCB0aGlzLm5vdygpKVxuICAgICAgdGhpcy5zd2VlcFN0YWxlU3VjY2Vzc1RpbWVzdGFtcHMoKVxuXG4gICAgICByZXR1cm4ge2ltcG9ydGVkOiB0cnVlLCByZXN1bHR9XG4gICAgfSkoKVxuICAgIGNvbnN0IHRyYWNrZWRQcm9taXNlID0gcnVuUHJvbWlzZS5maW5hbGx5KCgpID0+IHRoaXMuaW5GbGlnaHRCeUtleS5kZWxldGUoa2V5KSlcblxuICAgIHRoaXMuaW5GbGlnaHRCeUtleS5zZXQoa2V5LCB0cmFja2VkUHJvbWlzZSlcblxuICAgIHJldHVybiBhd2FpdCB0cmFja2VkUHJvbWlzZVxuICB9XG5cbiAgLyoqXG4gICAqIERyb3BzIHN1Y2Nlc3MgdGltZXN0YW1wcyBwYXN0IHRoZSBtYXhpbXVtIGFnZS4gUnVucyBvbiBlYWNoIHN1Y2Nlc3NmdWxcbiAgICogaW1wb3J0IHNvIGxvbmctbGl2ZWQgcHJvY2Vzc2VzIGRvIG5vdCBhY2N1bXVsYXRlIG9uZSBtYXAgZW50cnkgcGVyIGtleVxuICAgKiBldmVyIGltcG9ydGVkLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIHN3ZWVwU3RhbGVTdWNjZXNzVGltZXN0YW1wcygpIHtcbiAgICBjb25zdCBub3cgPSB0aGlzLm5vdygpXG5cbiAgICBmb3IgKGNvbnN0IFtrZXksIGF0XSBvZiB0aGlzLmxhc3RTdWNjZXNzQXRCeUtleSkge1xuICAgICAgaWYgKG5vdyAtIGF0ID49IHRoaXMubWF4U3VjY2Vzc0FnZU1zKSB0aGlzLmxhc3RTdWNjZXNzQXRCeUtleS5kZWxldGUoa2V5KVxuICAgIH1cbiAgfVxufVxuXG4vKiogQHR5cGUge01hcDxpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLmpzXCIpLmRlZmF1bHQsIFN5bmNVcHN0cmVhbUltcG9ydGVyPn0gU2hhcmVkIGltcG9ydGVyIHBlciBjb25maWd1cmF0aW9uLiAqL1xuY29uc3QgaW1wb3J0ZXJzQnlDb25maWd1cmF0aW9uID0gbmV3IE1hcCgpXG5cbi8qKlxuICogUmV0dXJucyB0aGUgc2hhcmVkIHVwc3RyZWFtIGltcG9ydGVyIGZvciBhIGNvbmZpZ3VyYXRpb24sIHNvIGV2ZXJ5IHN5bmNcbiAqIHJlc291cmNlIGluc3RhbmNlIGFuZCBsZWdhY3kgZW5kcG9pbnQgc2VydmluZyB0aGUgc2FtZSBiYWNrZW5kIGNvYWxlc2NlcyBhbmRcbiAqIHRocm90dGxlcyB1cHN0cmVhbSBpbXBvcnRzIHRvZ2V0aGVyLlxuICogQHBhcmFtIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLmpzXCIpLmRlZmF1bHR9IGNvbmZpZ3VyYXRpb24gLSBDb25maWd1cmF0aW9uIG93bmluZyB0aGUgaW1wb3J0ZXIuXG4gKiBAcmV0dXJucyB7U3luY1Vwc3RyZWFtSW1wb3J0ZXJ9IFNoYXJlZCBpbXBvcnRlciBmb3IgdGhlIGNvbmZpZ3VyYXRpb24uXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzeW5jVXBzdHJlYW1JbXBvcnRlckZvckNvbmZpZ3VyYXRpb24oY29uZmlndXJhdGlvbikge1xuICBsZXQgaW1wb3J0ZXIgPSBpbXBvcnRlcnNCeUNvbmZpZ3VyYXRpb24uZ2V0KGNvbmZpZ3VyYXRpb24pXG5cbiAgaWYgKCFpbXBvcnRlcikge1xuICAgIGltcG9ydGVyID0gbmV3IFN5bmNVcHN0cmVhbUltcG9ydGVyKClcbiAgICBpbXBvcnRlcnNCeUNvbmZpZ3VyYXRpb24uc2V0KGNvbmZpZ3VyYXRpb24sIGltcG9ydGVyKVxuICB9XG5cbiAgcmV0dXJuIGltcG9ydGVyXG59XG4iXX0=