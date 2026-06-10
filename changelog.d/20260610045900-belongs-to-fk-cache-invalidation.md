Fix `belongsTo` relationship caches when assigning a foreign key directly so subsequent relationship loads return the new target instead of stale cached records.
