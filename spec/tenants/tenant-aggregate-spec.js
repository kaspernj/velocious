// @ts-check

import Current from "../../src/current.js"
import {describe, expect, it} from "../../src/testing/test.js"
import Tenant from "../../src/tenants/tenant.js"
import TenantAggregator from "../../src/tenants/tenant-aggregator.js"
import {createTenantTestConfiguration} from "../helpers/tenant-test-helpers.js"

describe("Tenant.aggregateAcross", () => {
  /**
   * @param {{listTenants: () => Promise<Array<?>> | Array<?>}} provider - Tenant database provider.
   * @param {(args: {configuration: import("../../src/configuration.js").default}) => Promise<void>} callback - Test body.
   * @returns {Promise<void>}
   */
  async function withConfiguration(provider, callback) {
    const {cleanup, configuration} = await createTenantTestConfiguration("velocious-tenant-aggregate")
    let previousConfiguration

    configuration.setTenantDatabaseProviders({projectTenant: provider})

    try {
      try {
        previousConfiguration = Current.configuration()
      } catch {
        // Ignore missing current configuration.
      }

      configuration.setCurrent()

      await callback({configuration})
    } finally {
      previousConfiguration?.setCurrent()
      await cleanup()
    }
  }

  /**
   * @param {import("../../src/configuration.js").default} configuration - Configuration.
   * @param {string} tenantSlug - Tenant slug.
   * @param {Array<{dockerServerId: string, estimatedCpuUsage: number, status: string}>} builds - Rows to seed.
   * @returns {Promise<void>}
   */
  async function seedBuilds(configuration, tenantSlug, builds) {
    await configuration.runWithTenant({slug: tenantSlug}, async () => {
      await configuration.ensureConnections(async (dbs) => {
        const db = dbs.projectTenant

        await db.query("CREATE TABLE IF NOT EXISTS builds(docker_server_id varchar(255) NOT NULL, estimated_cpu_usage integer NOT NULL, status varchar(255) NOT NULL)")
        await db.query("DELETE FROM builds")

        for (const build of builds) {
          await db.query(`INSERT INTO builds(docker_server_id, estimated_cpu_usage, status) VALUES (${db.quote(build.dockerServerId)}, ${build.estimatedCpuUsage}, ${db.quote(build.status)})`)
        }
      })
    })
  }

  /**
   * @param {(args: SubqueryContextLike) => string} [subqueryOverride] - Optional subquery override.
   * @returns {(context: SubqueryContextLike) => string} - Subquery builder summing estimated_cpu_usage per docker server.
   * @typedef {{table: (name: string) => string, quote: ((value: ?) => string) & {list: (values: ?[]) => string}}} SubqueryContextLike
   */
  function reservedCpuSubquery(subqueryOverride) {
    return subqueryOverride ?? (({quote, table}) => `
      SELECT docker_server_id AS docker_server_id, estimated_cpu_usage AS reserved
      FROM ${table("builds")}
      WHERE status IN (${quote.list(["assigned", "running"])})
    `)
  }

  it("sums a column grouped by a key column across every tenant the provider lists", async () => {
    await withConfiguration({listTenants: () => [{slug: "alpha"}, {slug: "beta"}]}, async ({configuration}) => {
      await seedBuilds(configuration, "alpha", [
        {dockerServerId: "server-1", estimatedCpuUsage: 200, status: "assigned"},
        {dockerServerId: "server-1", estimatedCpuUsage: 300, status: "running"},
        {dockerServerId: "server-1", estimatedCpuUsage: 999, status: "passed"}
      ])
      await seedBuilds(configuration, "beta", [
        {dockerServerId: "server-1", estimatedCpuUsage: 150, status: "running"},
        {dockerServerId: "server-2", estimatedCpuUsage: 400, status: "assigned"}
      ])

      const rows = await Tenant.aggregateAcross({
        aggregates: {reserved: "SUM"},
        identifier: "projectTenant",
        keyColumns: ["docker_server_id"],
        subquery: reservedCpuSubquery()
      })

      const reservedByServer = Object.fromEntries(rows.map((row) => [row.docker_server_id, row.reserved]))

      // server-1: alpha 200 + 300 (passed excluded) + beta 150 = 650. server-2: beta 400.
      expect(reservedByServer).toEqual({"server-1": 650, "server-2": 400})
    })
  })

  it("aggregates only the tenants passed explicitly", async () => {
    await withConfiguration({listTenants: () => [{slug: "alpha"}, {slug: "beta"}]}, async ({configuration}) => {
      await seedBuilds(configuration, "alpha", [{dockerServerId: "server-1", estimatedCpuUsage: 200, status: "assigned"}])
      await seedBuilds(configuration, "beta", [{dockerServerId: "server-1", estimatedCpuUsage: 500, status: "assigned"}])

      const rows = await Tenant.aggregateAcross({
        aggregates: {reserved: "SUM"},
        identifier: "projectTenant",
        keyColumns: ["docker_server_id"],
        subquery: reservedCpuSubquery(),
        tenants: [{slug: "alpha"}]
      })

      expect(rows).toEqual([{docker_server_id: "server-1", reserved: 200}])
    })
  })

  it("applies the filter to the resolved tenant list", async () => {
    await withConfiguration({listTenants: () => [{slug: "alpha"}, {slug: "beta"}]}, async ({configuration}) => {
      await seedBuilds(configuration, "alpha", [{dockerServerId: "server-1", estimatedCpuUsage: 200, status: "assigned"}])
      await seedBuilds(configuration, "beta", [{dockerServerId: "server-1", estimatedCpuUsage: 500, status: "assigned"}])

      const rows = await Tenant.aggregateAcross({
        aggregates: {reserved: "SUM"},
        filter: (tenant) => tenant.slug !== "beta",
        identifier: "projectTenant",
        keyColumns: ["docker_server_id"],
        subquery: reservedCpuSubquery()
      })

      expect(rows).toEqual([{docker_server_id: "server-1", reserved: 200}])
    })
  })

  it("supports COUNT(*) alongside SUM in one pass", async () => {
    await withConfiguration({listTenants: () => [{slug: "alpha"}, {slug: "beta"}]}, async ({configuration}) => {
      await seedBuilds(configuration, "alpha", [
        {dockerServerId: "server-1", estimatedCpuUsage: 200, status: "assigned"},
        {dockerServerId: "server-1", estimatedCpuUsage: 300, status: "running"}
      ])
      await seedBuilds(configuration, "beta", [{dockerServerId: "server-1", estimatedCpuUsage: 150, status: "running"}])

      const rows = await Tenant.aggregateAcross({
        aggregates: {buildCount: {column: "*", op: "COUNT"}, reserved: "SUM"},
        identifier: "projectTenant",
        keyColumns: ["docker_server_id"],
        subquery: reservedCpuSubquery()
      })

      expect(rows).toEqual([{buildCount: 3, docker_server_id: "server-1", reserved: 650}])
    })
  })

  it("produces a single grand-total row when no key columns are given", async () => {
    await withConfiguration({listTenants: () => [{slug: "alpha"}, {slug: "beta"}]}, async ({configuration}) => {
      await seedBuilds(configuration, "alpha", [{dockerServerId: "server-1", estimatedCpuUsage: 200, status: "assigned"}])
      await seedBuilds(configuration, "beta", [{dockerServerId: "server-2", estimatedCpuUsage: 400, status: "running"}])

      const rows = await Tenant.aggregateAcross({
        aggregates: {reserved: "SUM"},
        identifier: "projectTenant",
        subquery: reservedCpuSubquery()
      })

      expect(rows).toEqual([{reserved: 600}])
    })
  })

  it("returns an empty result when there are no tenants", async () => {
    await withConfiguration({listTenants: () => []}, async () => {
      const rows = await Tenant.aggregateAcross({
        aggregates: {reserved: "SUM"},
        identifier: "projectTenant",
        keyColumns: ["docker_server_id"],
        subquery: reservedCpuSubquery()
      })

      expect(rows).toEqual([])
    })
  })

  it("builds one cross-database UNION ALL when the driver supports qualified references", () => {
    // Stubs MySQL-style backtick quoting so the test asserts the SQL composed by buildAggregateSql
    // without standing up a real database connection.
    const options = {
      quoteColumnName: (/** @type {string} */ name) => `\`${name}\``,
      quoteDatabaseName: (/** @type {string} */ name) => `\`${name}\``,
      quoteTableName: (/** @type {string} */ name) => `\`${name}\``
    }
    const connection = /** @type {import("../../src/database/drivers/base.js").default} */ (/** @type {unknown} */ ({
      options: () => options,
      quote: (value) => `'${value}'`,
      supportsCrossDatabaseReferences: () => true
    }))
    const aggregator = new TenantAggregator({
      aggregates: {reserved: "SUM"},
      configuration: /** @type {import("../../src/configuration.js").default} */ (/** @type {unknown} */ ({})),
      identifier: "projectTenant",
      keyColumns: ["docker_server_id"],
      subquery: ({table}) => `SELECT docker_server_id AS docker_server_id, estimated_cpu_usage AS reserved FROM ${table("builds")}`
    })

    const sql = aggregator.buildAggregateSql({
      connection,
      entries: [
        {database: "tenant_alpha", serverKey: "s", tenant: {slug: "alpha"}},
        {database: "tenant_beta", serverKey: "s", tenant: {slug: "beta"}}
      ],
      qualified: true
    })

    expect(sql).toContain("FROM `tenant_alpha`.`builds`")
    expect(sql).toContain("FROM `tenant_beta`.`builds`")
    expect(sql).toContain("UNION ALL")
    expect(sql).toContain("SUM(`reserved`) AS `reserved`")
    expect(sql).toContain("GROUP BY `docker_server_id`")
  })
})
