// @ts-check
import QueryBase from "./base.js";
/**
 * RemoveIndexBaseArgsType type.
 * @typedef {object} RemoveIndexBaseArgsType
 * @property {import("../drivers/base.js").default} driver - Database driver used to generate SQL.
 * @property {string} name - Index name to drop.
 * @property {string} tableName - Name of the table the index belongs to.
 */
export default class VelociousDatabaseQueryRemoveIndexBase extends QueryBase {
    /**
     * Runs constructor.
     * @param {RemoveIndexBaseArgsType} args - Options object.
     */
    constructor({ driver, name, tableName }) {
        super({ driver });
        this.name = name;
        this.tableName = tableName;
    }
    /**
     * Runs to sqls.
     * @returns {Promise<string[]>} - Resolves with SQL statements.
     */
    async toSQLs() {
        const databaseType = this.getDriver().getType();
        const options = this.getOptions();
        let sql = `DROP INDEX ${options.quoteIndexName(this.name)}`;
        if (databaseType == "mssql" || databaseType == "mysql") {
            sql += ` ON ${options.quoteTableName(this.tableName)}`;
        }
        return [sql];
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicmVtb3ZlLWluZGV4LWJhc2UuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvZGF0YWJhc2UvcXVlcnkvcmVtb3ZlLWluZGV4LWJhc2UuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLE9BQU8sU0FBUyxNQUFNLFdBQVcsQ0FBQTtBQUVqQzs7Ozs7O0dBTUc7QUFFSCxNQUFNLENBQUMsT0FBTyxPQUFPLHFDQUFzQyxTQUFRLFNBQVM7SUFDMUU7OztPQUdHO0lBQ0gsWUFBWSxFQUFDLE1BQU0sRUFBRSxJQUFJLEVBQUUsU0FBUyxFQUFDO1FBQ25DLEtBQUssQ0FBQyxFQUFDLE1BQU0sRUFBQyxDQUFDLENBQUE7UUFDZixJQUFJLENBQUMsSUFBSSxHQUFHLElBQUksQ0FBQTtRQUNoQixJQUFJLENBQUMsU0FBUyxHQUFHLFNBQVMsQ0FBQTtJQUM1QixDQUFDO0lBRUQ7OztPQUdHO0lBQ0gsS0FBSyxDQUFDLE1BQU07UUFDVixNQUFNLFlBQVksR0FBRyxJQUFJLENBQUMsU0FBUyxFQUFFLENBQUMsT0FBTyxFQUFFLENBQUE7UUFDL0MsTUFBTSxPQUFPLEdBQUcsSUFBSSxDQUFDLFVBQVUsRUFBRSxDQUFBO1FBQ2pDLElBQUksR0FBRyxHQUFHLGNBQWMsT0FBTyxDQUFDLGNBQWMsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLEVBQUUsQ0FBQTtRQUUzRCxJQUFJLFlBQVksSUFBSSxPQUFPLElBQUksWUFBWSxJQUFJLE9BQU8sRUFBRSxDQUFDO1lBQ3ZELEdBQUcsSUFBSSxPQUFPLE9BQU8sQ0FBQyxjQUFjLENBQUMsSUFBSSxDQUFDLFNBQVMsQ0FBQyxFQUFFLENBQUE7UUFDeEQsQ0FBQztRQUVELE9BQU8sQ0FBQyxHQUFHLENBQUMsQ0FBQTtJQUNkLENBQUM7Q0FDRiIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG5pbXBvcnQgUXVlcnlCYXNlIGZyb20gXCIuL2Jhc2UuanNcIlxuXG4vKipcbiAqIFJlbW92ZUluZGV4QmFzZUFyZ3NUeXBlIHR5cGUuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBSZW1vdmVJbmRleEJhc2VBcmdzVHlwZVxuICogQHByb3BlcnR5IHtpbXBvcnQoXCIuLi9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZHJpdmVyIC0gRGF0YWJhc2UgZHJpdmVyIHVzZWQgdG8gZ2VuZXJhdGUgU1FMLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IG5hbWUgLSBJbmRleCBuYW1lIHRvIGRyb3AuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gdGFibGVOYW1lIC0gTmFtZSBvZiB0aGUgdGFibGUgdGhlIGluZGV4IGJlbG9uZ3MgdG8uXG4gKi9cblxuZXhwb3J0IGRlZmF1bHQgY2xhc3MgVmVsb2Npb3VzRGF0YWJhc2VRdWVyeVJlbW92ZUluZGV4QmFzZSBleHRlbmRzIFF1ZXJ5QmFzZSB7XG4gIC8qKlxuICAgKiBSdW5zIGNvbnN0cnVjdG9yLlxuICAgKiBAcGFyYW0ge1JlbW92ZUluZGV4QmFzZUFyZ3NUeXBlfSBhcmdzIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqL1xuICBjb25zdHJ1Y3Rvcih7ZHJpdmVyLCBuYW1lLCB0YWJsZU5hbWV9KSB7XG4gICAgc3VwZXIoe2RyaXZlcn0pXG4gICAgdGhpcy5uYW1lID0gbmFtZVxuICAgIHRoaXMudGFibGVOYW1lID0gdGFibGVOYW1lXG4gIH1cblxuICAvKipcbiAgICogUnVucyB0byBzcWxzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxzdHJpbmdbXT59IC0gUmVzb2x2ZXMgd2l0aCBTUUwgc3RhdGVtZW50cy5cbiAgICovXG4gIGFzeW5jIHRvU1FMcygpIHtcbiAgICBjb25zdCBkYXRhYmFzZVR5cGUgPSB0aGlzLmdldERyaXZlcigpLmdldFR5cGUoKVxuICAgIGNvbnN0IG9wdGlvbnMgPSB0aGlzLmdldE9wdGlvbnMoKVxuICAgIGxldCBzcWwgPSBgRFJPUCBJTkRFWCAke29wdGlvbnMucXVvdGVJbmRleE5hbWUodGhpcy5uYW1lKX1gXG5cbiAgICBpZiAoZGF0YWJhc2VUeXBlID09IFwibXNzcWxcIiB8fCBkYXRhYmFzZVR5cGUgPT0gXCJteXNxbFwiKSB7XG4gICAgICBzcWwgKz0gYCBPTiAke29wdGlvbnMucXVvdGVUYWJsZU5hbWUodGhpcy50YWJsZU5hbWUpfWBcbiAgICB9XG5cbiAgICByZXR1cm4gW3NxbF1cbiAgfVxufVxuIl19