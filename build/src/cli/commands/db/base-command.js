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
     * @returns {Promise<void>} - Resolves when SQLs have been collected or executed.
     */
    async queryOrCollectSqls(sqls, resultEntryForSql) {
        if (this.args.testing) {
            this.collectSqlResults(sqls, resultEntryForSql);
        }
        else {
            await this.querySqls(sqls);
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
     * @returns {Promise<void>} - Resolves when complete.
     */
    async querySqls(sqls) {
        for (const sql of sqls) {
            await this.getDatabaseConnection().query(sql);
        }
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYmFzZS1jb21tYW5kLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vLi4vc3JjL2NsaS9jb21tYW5kcy9kYi9iYXNlLWNvbW1hbmQuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsT0FBTyxXQUFXLE1BQU0sdUJBQXVCLENBQUE7QUFDL0MsT0FBTyxFQUFDLElBQUksRUFBQyxNQUFNLFdBQVcsQ0FBQTtBQUU5QixNQUFNLENBQUMsT0FBTyxPQUFPLGFBQWMsU0FBUSxXQUFXO0lBQ3BEOztpRkFFNkU7SUFDN0Usa0JBQWtCLENBQUE7SUFFbEI7OzJDQUV1QztJQUN2QyxNQUFNLENBQUE7SUFFTjs7Ozs7T0FLRztJQUNILEtBQUssQ0FBQyw0QkFBNEIsQ0FBQyxtQkFBbUIsRUFBRSxRQUFRO1FBQzlELE1BQU0sV0FBVyxHQUFHLElBQUksQ0FBQyxtQkFBbUIsRUFBRSxRQUFRLENBQUMsQ0FBQTtRQUN2RCxNQUFNLGtCQUFrQixHQUFHLElBQUksV0FBVyxDQUFDLG1CQUFtQixFQUFFLElBQUksQ0FBQyxnQkFBZ0IsRUFBRSxDQUFDLENBQUE7UUFDeEYsSUFBSSxDQUFDLGtCQUFrQixHQUFHLGtCQUFrQixDQUFBO1FBRTVDLElBQUksQ0FBQztZQUNILE1BQU0sa0JBQWtCLENBQUMsT0FBTyxFQUFFLENBQUE7WUFDbEMsTUFBTSxRQUFRLEVBQUUsQ0FBQTtRQUNsQixDQUFDO2dCQUFTLENBQUM7WUFDVCxNQUFNLGtCQUFrQixDQUFDLEtBQUssRUFBRSxDQUFBO1FBQ2xDLENBQUM7SUFDSCxDQUFDO0lBRUQ7OztPQUdHO0lBQ0gscUJBQXFCO1FBQ25CLElBQUksQ0FBQyxJQUFJLENBQUMsa0JBQWtCO1lBQUUsTUFBTSxJQUFJLEtBQUssQ0FBQyx5Q0FBeUMsQ0FBQyxDQUFBO1FBRXhGLE9BQU8sSUFBSSxDQUFDLGtCQUFrQixDQUFBO0lBQ2hDLENBQUM7SUFFRDs7Ozs7T0FLRztJQUNILEtBQUssQ0FBQyxrQkFBa0IsQ0FBQyxJQUFJLEVBQUUsaUJBQWlCO1FBQzlDLElBQUksSUFBSSxDQUFDLElBQUksQ0FBQyxPQUFPLEVBQUUsQ0FBQztZQUN0QixJQUFJLENBQUMsaUJBQWlCLENBQUMsSUFBSSxFQUFFLGlCQUFpQixDQUFDLENBQUE7UUFDakQsQ0FBQzthQUFNLENBQUM7WUFDTixNQUFNLElBQUksQ0FBQyxTQUFTLENBQUMsSUFBSSxDQUFDLENBQUE7UUFDNUIsQ0FBQztJQUNILENBQUM7SUFFRDs7Ozs7T0FLRztJQUNILGlCQUFpQixDQUFDLElBQUksRUFBRSxpQkFBaUI7UUFDdkMsSUFBSSxDQUFDLElBQUksQ0FBQyxNQUFNO1lBQUUsTUFBTSxJQUFJLEtBQUssQ0FBQyxtREFBbUQsQ0FBQyxDQUFBO1FBRXRGLEtBQUssTUFBTSxHQUFHLElBQUksSUFBSSxFQUFFLENBQUM7WUFDdkIsSUFBSSxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsaUJBQWlCLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQTtRQUMxQyxDQUFDO0lBQ0gsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCxLQUFLLENBQUMsU0FBUyxDQUFDLElBQUk7UUFDbEIsS0FBSyxNQUFNLEdBQUcsSUFBSSxJQUFJLEVBQUUsQ0FBQztZQUN2QixNQUFNLElBQUksQ0FBQyxxQkFBcUIsRUFBRSxDQUFDLEtBQUssQ0FBQyxHQUFHLENBQUMsQ0FBQTtRQUMvQyxDQUFDO0lBQ0gsQ0FBQztDQUNGIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IEJhc2VDb21tYW5kIGZyb20gXCIuLi8uLi9iYXNlLWNvbW1hbmQuanNcIlxuaW1wb3J0IHtkaWdnfSBmcm9tIFwiZGlnZ2VyaXplXCJcblxuZXhwb3J0IGRlZmF1bHQgY2xhc3MgRGJCYXNlQ29tbWFuZCBleHRlbmRzIEJhc2VDb21tYW5kIHtcbiAgLyoqXG4gICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICogQHR5cGUge2ltcG9ydChcIi4uLy4uLy4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkfSAqL1xuICBkYXRhYmFzZUNvbm5lY3Rpb25cblxuICAvKipcbiAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgKiBAdHlwZSB7QXJyYXk8b2JqZWN0PiB8IHVuZGVmaW5lZH0gKi9cbiAgcmVzdWx0XG5cbiAgLyoqXG4gICAqIFJ1bnMgd2l0aCBkaXJlY3QgZGF0YWJhc2UgY29ubmVjdGlvbi5cbiAgICogQHBhcmFtIHtvYmplY3R9IGRyaXZlckNvbmZpZ3VyYXRpb24gLSBEcml2ZXIgY29uZmlndXJhdGlvbi5cbiAgICogQHBhcmFtIHsoKSA9PiBQcm9taXNlPHZvaWQ+fSBjYWxsYmFjayAtIENhbGxiYWNrIHRvIHJ1biB3aGlsZSB0aGUgY29ubmVjdGlvbiBpcyBvcGVuLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgd2l0aERpcmVjdERhdGFiYXNlQ29ubmVjdGlvbihkcml2ZXJDb25maWd1cmF0aW9uLCBjYWxsYmFjaykge1xuICAgIGNvbnN0IERyaXZlckNsYXNzID0gZGlnZyhkcml2ZXJDb25maWd1cmF0aW9uLCBcImRyaXZlclwiKVxuICAgIGNvbnN0IGRhdGFiYXNlQ29ubmVjdGlvbiA9IG5ldyBEcml2ZXJDbGFzcyhkcml2ZXJDb25maWd1cmF0aW9uLCB0aGlzLmdldENvbmZpZ3VyYXRpb24oKSlcbiAgICB0aGlzLmRhdGFiYXNlQ29ubmVjdGlvbiA9IGRhdGFiYXNlQ29ubmVjdGlvblxuXG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IGRhdGFiYXNlQ29ubmVjdGlvbi5jb25uZWN0KClcbiAgICAgIGF3YWl0IGNhbGxiYWNrKClcbiAgICB9IGZpbmFsbHkge1xuICAgICAgYXdhaXQgZGF0YWJhc2VDb25uZWN0aW9uLmNsb3NlKClcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgZGF0YWJhc2UgY29ubmVjdGlvbi5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4uLy4uLy4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSAtIEFjdGl2ZSBkYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKi9cbiAgZ2V0RGF0YWJhc2VDb25uZWN0aW9uKCkge1xuICAgIGlmICghdGhpcy5kYXRhYmFzZUNvbm5lY3Rpb24pIHRocm93IG5ldyBFcnJvcihcIkRhdGFiYXNlIGNvbm5lY3Rpb24gd2FzIG5vdCBpbml0aWFsaXplZFwiKVxuXG4gICAgcmV0dXJuIHRoaXMuZGF0YWJhc2VDb25uZWN0aW9uXG4gIH1cblxuICAvKipcbiAgICogUnVucyBxdWVyeSBvciBjb2xsZWN0IHNxbHMuXG4gICAqIEBwYXJhbSB7c3RyaW5nW119IHNxbHMgLSBTUUwgc3RhdGVtZW50cy5cbiAgICogQHBhcmFtIHsoc3FsOiBzdHJpbmcpID0+IG9iamVjdH0gcmVzdWx0RW50cnlGb3JTcWwgLSBUZXN0IHJlc3VsdCBlbnRyeSBidWlsZGVyLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIFNRTHMgaGF2ZSBiZWVuIGNvbGxlY3RlZCBvciBleGVjdXRlZC5cbiAgICovXG4gIGFzeW5jIHF1ZXJ5T3JDb2xsZWN0U3FscyhzcWxzLCByZXN1bHRFbnRyeUZvclNxbCkge1xuICAgIGlmICh0aGlzLmFyZ3MudGVzdGluZykge1xuICAgICAgdGhpcy5jb2xsZWN0U3FsUmVzdWx0cyhzcWxzLCByZXN1bHRFbnRyeUZvclNxbClcbiAgICB9IGVsc2Uge1xuICAgICAgYXdhaXQgdGhpcy5xdWVyeVNxbHMoc3FscylcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBjb2xsZWN0IHNxbCByZXN1bHRzLlxuICAgKiBAcGFyYW0ge3N0cmluZ1tdfSBzcWxzIC0gU1FMIHN0YXRlbWVudHMuXG4gICAqIEBwYXJhbSB7KHNxbDogc3RyaW5nKSA9PiBvYmplY3R9IHJlc3VsdEVudHJ5Rm9yU3FsIC0gVGVzdCByZXN1bHQgZW50cnkgYnVpbGRlci5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBjb2xsZWN0U3FsUmVzdWx0cyhzcWxzLCByZXN1bHRFbnRyeUZvclNxbCkge1xuICAgIGlmICghdGhpcy5yZXN1bHQpIHRocm93IG5ldyBFcnJvcihcIkV4cGVjdGVkIHRlc3QgcmVzdWx0IGNvbGxlY3Rpb24gdG8gYmUgaW5pdGlhbGl6ZWRcIilcblxuICAgIGZvciAoY29uc3Qgc3FsIG9mIHNxbHMpIHtcbiAgICAgIHRoaXMucmVzdWx0LnB1c2gocmVzdWx0RW50cnlGb3JTcWwoc3FsKSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBxdWVyeSBzcWxzLlxuICAgKiBAcGFyYW0ge3N0cmluZ1tdfSBzcWxzIC0gU1FMIHN0YXRlbWVudHMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyBxdWVyeVNxbHMoc3Fscykge1xuICAgIGZvciAoY29uc3Qgc3FsIG9mIHNxbHMpIHtcbiAgICAgIGF3YWl0IHRoaXMuZ2V0RGF0YWJhc2VDb25uZWN0aW9uKCkucXVlcnkoc3FsKVxuICAgIH1cbiAgfVxufVxuIl19