Add explicit background job execution modes. Jobs now default to attached `forked`
child processes, `inline` remains available for in-worker execution, and the
legacy runner behavior is available as `spawned`.
