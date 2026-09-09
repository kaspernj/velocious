// @ts-check
/**
 * DropDatabaseArgsType type.
 * @typedef {object} DropDatabaseArgsType
 * @property {import("../drivers/base.js").default} driver - Database driver used to generate SQL.
 * @property {string} databaseName - Name of the database to drop.
 * @property {boolean} [ifExists] - Skip drop if the database does not exist.
 */
import QueryBase from "./base.js";
export default class VelociousDatabaseQueryDropDatabaseBase extends QueryBase {
    /**
     * Runs constructor.
     * @param {DropDatabaseArgsType} args - Options object.
     */
    constructor({ driver, databaseName, ifExists }) {
        super({ driver });
        this.databaseName = databaseName;
        this.ifExists = ifExists;
    }
    /**
     * Runs to sql.
     * @returns {string[]} - SQL statements.
     */
    toSql() {
        const { databaseName } = this;
        let sql = "DROP DATABASE";
        if (this.ifExists)
            sql += " IF EXISTS";
        sql += ` ${this.getOptions().quoteDatabaseName(databaseName)}`;
        return [sql];
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZHJvcC1kYXRhYmFzZS1iYXNlLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vc3JjL2RhdGFiYXNlL3F1ZXJ5L2Ryb3AtZGF0YWJhc2UtYmFzZS5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxZQUFZO0FBRVo7Ozs7OztHQU1HO0FBRUgsT0FBTyxTQUFTLE1BQU0sV0FBVyxDQUFBO0FBRWpDLE1BQU0sQ0FBQyxPQUFPLE9BQU8sc0NBQXVDLFNBQVEsU0FBUztJQUMzRTs7O09BR0c7SUFDSCxZQUFZLEVBQUMsTUFBTSxFQUFFLFlBQVksRUFBRSxRQUFRLEVBQUM7UUFDMUMsS0FBSyxDQUFDLEVBQUMsTUFBTSxFQUFDLENBQUMsQ0FBQTtRQUNmLElBQUksQ0FBQyxZQUFZLEdBQUcsWUFBWSxDQUFBO1FBQ2hDLElBQUksQ0FBQyxRQUFRLEdBQUcsUUFBUSxDQUFBO0lBQzFCLENBQUM7SUFFRDs7O09BR0c7SUFDSCxLQUFLO1FBQ0gsTUFBTSxFQUFDLFlBQVksRUFBQyxHQUFHLElBQUksQ0FBQTtRQUMzQixJQUFJLEdBQUcsR0FBRyxlQUFlLENBQUE7UUFFekIsSUFBSSxJQUFJLENBQUMsUUFBUTtZQUFFLEdBQUcsSUFBSSxZQUFZLENBQUE7UUFFdEMsR0FBRyxJQUFJLElBQUksSUFBSSxDQUFDLFVBQVUsRUFBRSxDQUFDLGlCQUFpQixDQUFDLFlBQVksQ0FBQyxFQUFFLENBQUE7UUFFOUQsT0FBTyxDQUFDLEdBQUcsQ0FBQyxDQUFBO0lBQ2QsQ0FBQztDQUNGIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbi8qKlxuICogRHJvcERhdGFiYXNlQXJnc1R5cGUgdHlwZS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IERyb3BEYXRhYmFzZUFyZ3NUeXBlXG4gKiBAcHJvcGVydHkge2ltcG9ydChcIi4uL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkcml2ZXIgLSBEYXRhYmFzZSBkcml2ZXIgdXNlZCB0byBnZW5lcmF0ZSBTUUwuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gZGF0YWJhc2VOYW1lIC0gTmFtZSBvZiB0aGUgZGF0YWJhc2UgdG8gZHJvcC5cbiAqIEBwcm9wZXJ0eSB7Ym9vbGVhbn0gW2lmRXhpc3RzXSAtIFNraXAgZHJvcCBpZiB0aGUgZGF0YWJhc2UgZG9lcyBub3QgZXhpc3QuXG4gKi9cblxuaW1wb3J0IFF1ZXJ5QmFzZSBmcm9tIFwiLi9iYXNlLmpzXCJcblxuZXhwb3J0IGRlZmF1bHQgY2xhc3MgVmVsb2Npb3VzRGF0YWJhc2VRdWVyeURyb3BEYXRhYmFzZUJhc2UgZXh0ZW5kcyBRdWVyeUJhc2Uge1xuICAvKipcbiAgICogUnVucyBjb25zdHJ1Y3Rvci5cbiAgICogQHBhcmFtIHtEcm9wRGF0YWJhc2VBcmdzVHlwZX0gYXJncyAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKi9cbiAgY29uc3RydWN0b3Ioe2RyaXZlciwgZGF0YWJhc2VOYW1lLCBpZkV4aXN0c30pIHtcbiAgICBzdXBlcih7ZHJpdmVyfSlcbiAgICB0aGlzLmRhdGFiYXNlTmFtZSA9IGRhdGFiYXNlTmFtZVxuICAgIHRoaXMuaWZFeGlzdHMgPSBpZkV4aXN0c1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgdG8gc3FsLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nW119IC0gU1FMIHN0YXRlbWVudHMuXG4gICAqL1xuICB0b1NxbCgpIHtcbiAgICBjb25zdCB7ZGF0YWJhc2VOYW1lfSA9IHRoaXNcbiAgICBsZXQgc3FsID0gXCJEUk9QIERBVEFCQVNFXCJcblxuICAgIGlmICh0aGlzLmlmRXhpc3RzKSBzcWwgKz0gXCIgSUYgRVhJU1RTXCJcblxuICAgIHNxbCArPSBgICR7dGhpcy5nZXRPcHRpb25zKCkucXVvdGVEYXRhYmFzZU5hbWUoZGF0YWJhc2VOYW1lKX1gXG5cbiAgICByZXR1cm4gW3NxbF1cbiAgfVxufVxuIl19