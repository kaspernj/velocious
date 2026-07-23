Initialize existing deferred tenant model metadata before `Tenant.with` and `Tenant.each` runtime callbacks, sharing in-progress initialization across concurrent tenant entries.
