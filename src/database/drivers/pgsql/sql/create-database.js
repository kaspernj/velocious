import CreateDatabaseBase from "../../../query/create-database-base.js"
import {digs} from "diggerize"

export default class VelociousDatabaseConnectionDriversPgsqlSqlCreateDatabase extends CreateDatabaseBase {
  toSql() {
    const {databaseName} = this
    const options = this.getOptions()
    const sqls = []

    if (this.ifNotExists) {
      // Its not our job to perform admin actions like this
      // sqls.push("CREATE EXTENSION IF NOT EXISTS dblink")

      const connectArgs = this._driver.connectArgs()
      const {password, username} = digs(connectArgs, "password", "username")
      const port = connectArgs.port || 5432
      const sql = `
        DO
        $do$
        BEGIN
          IF EXISTS (SELECT FROM ${options.quoteTableName("pg_database")} WHERE ${options.quoteColumnName("datname")} = ${options.quote(databaseName)}) THEN
            RAISE NOTICE 'Database already exists';  -- optional
          ELSE
            PERFORM dblink_connect('host=localhost port=' || ${port} || ' user=' || ${options.quote(username)} || ' password=' || ${options.quote(password)} || ' dbname=' || current_database());
            PERFORM dblink_exec('CREATE DATABASE ' || ${options.quote(databaseName)});
          END IF;
        END
        $do$;
      `

      sqls.push(sql)
    } else {
      sqls.push(`CREATE DATABASE ${options.quoteDatabaseName(databaseName)}`)
    }

    return sqls
  }
}
