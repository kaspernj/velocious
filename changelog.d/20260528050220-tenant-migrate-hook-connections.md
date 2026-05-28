Tenant database `afterMigrateTenant` hooks now run inside the active migration connection scope, including when tenant commands use `--parallel`.
