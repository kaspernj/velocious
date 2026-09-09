Restore transaction cleanup for the request-parser specs so database-backed test
isolation uses the shared transaction path without the suite-wide performance
cost of fallback cleanup.
