// @ts-check

/**
 * @typedef {object} ServerMetrics
 * @property {number | null} threadsConnected - MySQL Threads_connected, or null when unavailable.
 * @property {number | null} threadsCreated - MySQL Threads_created, or null when unavailable.
 */

/**
 * @typedef {object} IdleReapingSample
 * @property {ServerMetrics} baselineServerMetrics - MySQL status after prepare and before the first idle interval.
 * @property {number} checkoutWaitMs - Time spent acquiring the outer-pool connection.
 * @property {number} firstQueryMs - Checkout plus first-query latency after an idle interval.
 * @property {number | null} idleTimeoutMillis - Configured outer-pool idle timeout.
 * @property {number} idleReapDisposalCount - Cumulative idle-reaper disposal count.
 * @property {ServerMetrics} serverMetrics - MySQL status after the query.
 */

/**
 * Returns a nearest-rank percentile.
 * @param {number[]} values - Samples.
 * @param {number} percentile - Percentile from zero through one.
 * @returns {number} - Selected value.
 */
export function percentile(values, percentile) {
  if (values.length === 0) throw new Error("Cannot calculate a percentile without samples")

  const sorted = [...values].sort((left, right) => left - right)
  const index = Math.max(0, Math.ceil(sorted.length * percentile) - 1)

  return sorted[index]
}

/**
 * Runs identical idle intervals for each outer-pool timeout.
 * @param {object} args - Runner dependencies.
 * @param {number[]} args.idleIntervalsMillis - Idle intervals applied in order.
 * @param {Array<number | null>} args.idleTimeoutsMillis - Timeout variants.
 * @param {(idleTimeoutMillis: number | null) => Promise<ServerMetrics>} args.prepare - Applies a variant, primes its pool, and captures pre-idle server status.
 * @param {(idleTimeoutMillis: number | null) => Promise<Omit<IdleReapingSample, "idleTimeoutMillis">>} args.sample - Executes the first query after an idle interval.
 * @param {(milliseconds: number) => Promise<void>} args.sleep - Wait implementation.
 * @returns {Promise<Array<IdleReapingSample>>} - Samples in deterministic variant/interval order.
 */
export async function runIdleReapingBenchmark({idleIntervalsMillis, idleTimeoutsMillis, prepare, sample, sleep}) {
  const samples = []

  for (const idleTimeoutMillis of idleTimeoutsMillis) {
    const baselineServerMetrics = await prepare(idleTimeoutMillis)

    for (const idleIntervalMillis of idleIntervalsMillis) {
      await sleep(idleIntervalMillis)
      samples.push({baselineServerMetrics, idleTimeoutMillis, ...await sample(idleTimeoutMillis)})
    }
  }

  return samples
}

/**
 * Summarizes samples by timeout without hiding unavailable server metrics.
 * @param {IdleReapingSample[]} samples - Completed samples.
 * @returns {Array<Record<string, number | string | null>>} - One row per timeout.
 */
export function summarizeIdleReapingSamples(samples) {
  const timeoutLabels = [...new Set(samples.map(({idleTimeoutMillis}) => idleTimeoutMillis === null ? "disabled" : String(idleTimeoutMillis)))]

  return timeoutLabels.map((timeoutLabel) => {
    const matching = samples.filter(({idleTimeoutMillis}) => (idleTimeoutMillis === null ? "disabled" : String(idleTimeoutMillis)) === timeoutLabel)
    const firstQuery = matching.map(({firstQueryMs}) => firstQueryMs)
    const checkoutWait = matching.map(({checkoutWaitMs}) => checkoutWaitMs)
    const baselineServerMetrics = matching[0].baselineServerMetrics
    const lastServerMetrics = matching[matching.length - 1].serverMetrics

    return {
      checkoutWaitP95Ms: percentile(checkoutWait, 0.95),
      firstQueryP50Ms: percentile(firstQuery, 0.5),
      firstQueryP95Ms: percentile(firstQuery, 0.95),
      idleReapDisposals: matching[matching.length - 1].idleReapDisposalCount,
      idleTimeoutMillis: timeoutLabel,
      threadsConnectedAfter: lastServerMetrics.threadsConnected,
      threadsCreatedAfter: lastServerMetrics.threadsCreated,
      threadsCreatedDelta: baselineServerMetrics.threadsCreated === null || lastServerMetrics.threadsCreated === null
        ? null
        : lastServerMetrics.threadsCreated - baselineServerMetrics.threadsCreated
    }
  })
}
