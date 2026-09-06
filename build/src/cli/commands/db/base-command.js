import BaseCommand from "../../base-command.js";
import { digg } from "diggerize";
export default class DbBaseCommand extends BaseCommand {
    /**
     * Narrows the runtime value to the documented type.
     * @type {import("../../../database/drivers/base.js").default | undefined} */
    databaseConnection;
    /**
     * Narrows the runtime value to the documented type.
     * @type {Array<object> | undefined} */
    result;
    /**
     * Runs with direct database connection.
     * @param {object} driverConfiguration - Driver configuration.
     * @param {() => Promise<void>} callback - Callback to run while the connection is open.
     * @returns {Promise<void>} - Resolves when complete.
     */
    async withDirectDatabaseConnection(driverConfiguration, callback) {
        const DriverClass = digg(driverConfiguration, "driver");
        const databaseConnection = new DriverClass(driverConfiguration, this.getConfiguration());
        this.databaseConnection = databaseConnection;
        try {
            await databaseConnection.connect();
            await callback();
        }
        finally {
            await databaseConnection.close();
        }
    }
    /**
     * Runs get database connection.
     * @returns {import("../../../database/drivers/base.js").default} - Active database connection.
     */
    getDatabaseConnection() {
        if (!this.databaseConnection)
            throw new Error("Database connection was not initialized");
        return this.databaseConnection;
    }
    /**
     * Runs query or collect sqls.
     * @param {string[]} sqls - SQL statements.
     * @param {(sql: string) => object} resultEntryForSql - Test result entry builder.
     * @param {import("../../../database/drivers/base.js").QueryOptions} [options] - Query options.
     * @returns {Promise<void>} - Resolves when SQLs have been collected or executed.
     */
    async queryOrCollectSqls(sqls, resultEntryForSql, options = {}) {
        if (this.args.testing) {
            this.collectSqlResults(sqls, resultEntryForSql);
        }
        else {
            await this.querySqls(sqls, options);
        }
    }
    /**
     * Runs collect sql results.
     * @param {string[]} sqls - SQL statements.
     * @param {(sql: string) => object} resultEntryForSql - Test result entry builder.
     * @returns {void}
     */
    collectSqlResults(sqls, resultEntryForSql) {
        if (!this.result)
            throw new Error("Expected test result collection to be initialized");
        for (const sql of sqls) {
            this.result.push(resultEntryForSql(sql));
        }
    }
    /**
     * Runs query sqls.
     * @param {string[]} sqls - SQL statements.
     * @param {import("../../../database/drivers/base.js").QueryOptions} [options] - Query options.
     * @returns {Promise<void>} - Resolves when complete.
     */
    async querySqls(sqls, options = {}) {
        for (const sql of sqls) {
            await this.getDatabaseConnection().query(sql, options);
        }
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYmFzZS1jb21tYW5kLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vLi4vc3JjL2NsaS9jb21tYW5kcy9kYi9iYXNlLWNvbW1hbmQuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsT0FBTyxXQUFXLE1BQU0sdUJBQXVCLENBQUE7QUFDL0MsT0FBTyxFQUFDLElBQUksRUFBQyxNQUFNLFdBQVcsQ0FBQTtBQUU5QixNQUFNLENBQUMsT0FBTyxPQUFPLGFBQWMsU0FBUSxXQUFXO0lBQ3BEOztpRkFFNkU7SUFDN0Usa0JBQWtCLENBQUE7SUFFbEI7OzJDQUV1QztJQUN2QyxNQUFNLENBQUE7SUFFTjs7Ozs7T0FLRztJQUNILEtBQUssQ0FBQyw0QkFBNEIsQ0FBQyxtQkFBbUIsRUFBRSxRQUFRO1FBQzlELE1BQU0sV0FBVyxHQUFHLElBQUksQ0FBQyxtQkFBbUIsRUFBRSxRQUFRLENBQUMsQ0FBQTtRQUN2RCxNQUFNLGtCQUFrQixHQUFHLElBQUksV0FBVyxDQUFDLG1CQUFtQixFQUFFLElBQUksQ0FBQyxnQkFBZ0IsRUFBRSxDQUFDLENBQUE7UUFDeEYsSUFBSSxDQUFDLGtCQUFrQixHQUFHLGtCQUFrQixDQUFBO1FBRTVDLElBQUksQ0FBQztZQUNILE1BQU0sa0JBQWtCLENBQUMsT0FBTyxFQUFFLENBQUE7WUFDbEMsTUFBTSxRQUFRLEVBQUUsQ0FBQTtRQUNsQixDQUFDO2dCQUFTLENBQUM7WUFDVCxNQUFNLGtCQUFrQixDQUFDLEtBQUssRUFBRSxDQUFBO1FBQ2xDLENBQUM7SUFDSCxDQUFDO0lBRUQ7OztPQUdHO0lBQ0gscUJBQXFCO1FBQ25CLElBQUksQ0FBQyxJQUFJLENBQUMsa0JBQWtCO1lBQUUsTUFBTSxJQUFJLEtBQUssQ0FBQyx5Q0FBeUMsQ0FBQyxDQUFBO1FBRXhGLE9BQU8sSUFBSSxDQUFDLGtCQUFrQixDQUFBO0lBQ2hDLENBQUM7SUFFRDs7Ozs7O09BTUc7SUFDSCxLQUFLLENBQUMsa0JBQWtCLENBQUMsSUFBSSxFQUFFLGlCQUFpQixFQUFFLE9BQU8sR0FBRyxFQUFFO1FBQzVELElBQUksSUFBSSxDQUFDLElBQUksQ0FBQyxPQUFPLEVBQUUsQ0FBQztZQUN0QixJQUFJLENBQUMsaUJBQWlCLENBQUMsSUFBSSxFQUFFLGlCQUFpQixDQUFDLENBQUE7UUFDakQsQ0FBQzthQUFNLENBQUM7WUFDTixNQUFNLElBQUksQ0FBQyxTQUFTLENBQUMsSUFBSSxFQUFFLE9BQU8sQ0FBQyxDQUFBO1FBQ3JDLENBQUM7SUFDSCxDQUFDO0lBRUQ7Ozs7O09BS0c7SUFDSCxpQkFBaUIsQ0FBQyxJQUFJLEVBQUUsaUJBQWlCO1FBQ3ZDLElBQUksQ0FBQyxJQUFJLENBQUMsTUFBTTtZQUFFLE1BQU0sSUFBSSxLQUFLLENBQUMsbURBQW1ELENBQUMsQ0FBQTtRQUV0RixLQUFLLE1BQU0sR0FBRyxJQUFJLElBQUksRUFBRSxDQUFDO1lBQ3ZCLElBQUksQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLGlCQUFpQixDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUE7UUFDMUMsQ0FBQztJQUNILENBQUM7SUFFRDs7Ozs7T0FLRztJQUNILEtBQUssQ0FBQyxTQUFTLENBQUMsSUFBSSxFQUFFLE9BQU8sR0FBRyxFQUFFO1FBQ2hDLEtBQUssTUFBTSxHQUFHLElBQUksSUFBSSxFQUFFLENBQUM7WUFDdkIsTUFBTSxJQUFJLENBQUMscUJBQXFCLEVBQUUsQ0FBQyxLQUFLLENBQUMsR0FBRyxFQUFFLE9BQU8sQ0FBQyxDQUFBO1FBQ3hELENBQUM7SUFDSCxDQUFDO0NBQ0YiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgQmFzZUNvbW1hbmQgZnJvbSBcIi4uLy4uL2Jhc2UtY29tbWFuZC5qc1wiXG5pbXBvcnQge2RpZ2d9IGZyb20gXCJkaWdnZXJpemVcIlxuXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBEYkJhc2VDb21tYW5kIGV4dGVuZHMgQmFzZUNvbW1hbmQge1xuICAvKipcbiAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgKiBAdHlwZSB7aW1wb3J0KFwiLi4vLi4vLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHQgfCB1bmRlZmluZWR9ICovXG4gIGRhdGFiYXNlQ29ubmVjdGlvblxuXG4gIC8qKlxuICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAqIEB0eXBlIHtBcnJheTxvYmplY3Q+IHwgdW5kZWZpbmVkfSAqL1xuICByZXN1bHRcblxuICAvKipcbiAgICogUnVucyB3aXRoIGRpcmVjdCBkYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAcGFyYW0ge29iamVjdH0gZHJpdmVyQ29uZmlndXJhdGlvbiAtIERyaXZlciBjb25maWd1cmF0aW9uLlxuICAgKiBAcGFyYW0geygpID0+IFByb21pc2U8dm9pZD59IGNhbGxiYWNrIC0gQ2FsbGJhY2sgdG8gcnVuIHdoaWxlIHRoZSBjb25uZWN0aW9uIGlzIG9wZW4uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyB3aXRoRGlyZWN0RGF0YWJhc2VDb25uZWN0aW9uKGRyaXZlckNvbmZpZ3VyYXRpb24sIGNhbGxiYWNrKSB7XG4gICAgY29uc3QgRHJpdmVyQ2xhc3MgPSBkaWdnKGRyaXZlckNvbmZpZ3VyYXRpb24sIFwiZHJpdmVyXCIpXG4gICAgY29uc3QgZGF0YWJhc2VDb25uZWN0aW9uID0gbmV3IERyaXZlckNsYXNzKGRyaXZlckNvbmZpZ3VyYXRpb24sIHRoaXMuZ2V0Q29uZmlndXJhdGlvbigpKVxuICAgIHRoaXMuZGF0YWJhc2VDb25uZWN0aW9uID0gZGF0YWJhc2VDb25uZWN0aW9uXG5cbiAgICB0cnkge1xuICAgICAgYXdhaXQgZGF0YWJhc2VDb25uZWN0aW9uLmNvbm5lY3QoKVxuICAgICAgYXdhaXQgY2FsbGJhY2soKVxuICAgIH0gZmluYWxseSB7XG4gICAgICBhd2FpdCBkYXRhYmFzZUNvbm5lY3Rpb24uY2xvc2UoKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBkYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi4vLi4vLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IC0gQWN0aXZlIGRhdGFiYXNlIGNvbm5lY3Rpb24uXG4gICAqL1xuICBnZXREYXRhYmFzZUNvbm5lY3Rpb24oKSB7XG4gICAgaWYgKCF0aGlzLmRhdGFiYXNlQ29ubmVjdGlvbikgdGhyb3cgbmV3IEVycm9yKFwiRGF0YWJhc2UgY29ubmVjdGlvbiB3YXMgbm90IGluaXRpYWxpemVkXCIpXG5cbiAgICByZXR1cm4gdGhpcy5kYXRhYmFzZUNvbm5lY3Rpb25cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHF1ZXJ5IG9yIGNvbGxlY3Qgc3Fscy5cbiAgICogQHBhcmFtIHtzdHJpbmdbXX0gc3FscyAtIFNRTCBzdGF0ZW1lbnRzLlxuICAgKiBAcGFyYW0geyhzcWw6IHN0cmluZykgPT4gb2JqZWN0fSByZXN1bHRFbnRyeUZvclNxbCAtIFRlc3QgcmVzdWx0IGVudHJ5IGJ1aWxkZXIuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vLi4vLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLlF1ZXJ5T3B0aW9uc30gW29wdGlvbnNdIC0gUXVlcnkgb3B0aW9ucy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBTUUxzIGhhdmUgYmVlbiBjb2xsZWN0ZWQgb3IgZXhlY3V0ZWQuXG4gICAqL1xuICBhc3luYyBxdWVyeU9yQ29sbGVjdFNxbHMoc3FscywgcmVzdWx0RW50cnlGb3JTcWwsIG9wdGlvbnMgPSB7fSkge1xuICAgIGlmICh0aGlzLmFyZ3MudGVzdGluZykge1xuICAgICAgdGhpcy5jb2xsZWN0U3FsUmVzdWx0cyhzcWxzLCByZXN1bHRFbnRyeUZvclNxbClcbiAgICB9IGVsc2Uge1xuICAgICAgYXdhaXQgdGhpcy5xdWVyeVNxbHMoc3Fscywgb3B0aW9ucylcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBjb2xsZWN0IHNxbCByZXN1bHRzLlxuICAgKiBAcGFyYW0ge3N0cmluZ1tdfSBzcWxzIC0gU1FMIHN0YXRlbWVudHMuXG4gICAqIEBwYXJhbSB7KHNxbDogc3RyaW5nKSA9PiBvYmplY3R9IHJlc3VsdEVudHJ5Rm9yU3FsIC0gVGVzdCByZXN1bHQgZW50cnkgYnVpbGRlci5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBjb2xsZWN0U3FsUmVzdWx0cyhzcWxzLCByZXN1bHRFbnRyeUZvclNxbCkge1xuICAgIGlmICghdGhpcy5yZXN1bHQpIHRocm93IG5ldyBFcnJvcihcIkV4cGVjdGVkIHRlc3QgcmVzdWx0IGNvbGxlY3Rpb24gdG8gYmUgaW5pdGlhbGl6ZWRcIilcblxuICAgIGZvciAoY29uc3Qgc3FsIG9mIHNxbHMpIHtcbiAgICAgIHRoaXMucmVzdWx0LnB1c2gocmVzdWx0RW50cnlGb3JTcWwoc3FsKSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBxdWVyeSBzcWxzLlxuICAgKiBAcGFyYW0ge3N0cmluZ1tdfSBzcWxzIC0gU1FMIHN0YXRlbWVudHMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vLi4vLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLlF1ZXJ5T3B0aW9uc30gW29wdGlvbnNdIC0gUXVlcnkgb3B0aW9ucy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIHF1ZXJ5U3FscyhzcWxzLCBvcHRpb25zID0ge30pIHtcbiAgICBmb3IgKGNvbnN0IHNxbCBvZiBzcWxzKSB7XG4gICAgICBhd2FpdCB0aGlzLmdldERhdGFiYXNlQ29ubmVjdGlvbigpLnF1ZXJ5KHNxbCwgb3B0aW9ucylcbiAgICB9XG4gIH1cbn1cbiJdfQ==