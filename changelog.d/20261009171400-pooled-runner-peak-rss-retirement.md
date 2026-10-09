# Pooled runner RSS retirement now tracks the child's peak RSS

The pooled-runner retirement gate compared the child's settled RSS at
job-outcome time against `pooledRunnerMaxRssBytes`. A child that spiked to
several gigabytes during a build burst reclaims that working set by the time the
outcome is reported, so the RSS limit never fired even though the child kept a
ratcheted high-water mark. The child now reports its monotonic peak RSS (the
kernel `VmHWM` high-water mark) on every job outcome and memory observation, and
the worker retires a child when that peak crosses `pooledRunnerMaxRssBytes`,
recycling it into a fresh low-baseline child. The memory observation log line
and the `PooledChildMemoryObservation` type carry the new `peakRssBytes` field;
children that cannot read `/proc/self/status` fall back to the settled sample.
