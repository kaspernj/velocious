// @ts-check

/**
 * Describes how one table's rows are partitioned between tenants so a DataCopier can select
 * the subset that belongs to a given tenant key.
 *
 * A row belongs to the tenant when its `keyColumn` equals the tenant key value, or — for
 * tables that have no direct tenant column — when its `parentColumn` references a row of
 * `parentTableName` that was itself already selected as belonging to the tenant. Exactly
 * one of `keyColumn` or the (`parentTableName` + `parentColumn`) pair must be set; a
 * parent-scoped entry must appear after its parent in the plan so the parent ids are known
 * by the time the child is loaded.
 * @typedef {object} TenantTablePlanEntry
 * @property {string} tableName Name of the table whose rows are partitioned by tenant.
 * @property {string} [keyColumn] Column matched directly against the tenant key value.
 * @property {string} [parentTableName] Earlier-in-plan table whose selected rows scope this one.
 * @property {string} [parentColumn] Column on this table referencing the parent table's primary key.
 */

export {}
