Fix pooled background-job workers advertising only a single consumable readiness token, which could leave available runner concurrency idle until an earlier job completed.
