// @ts-check
import WhereBase from "./where-base.js";
export default class VelociousDatabaseQueryWhereNot extends WhereBase {
    /**
     * Runs constructor.
     * @param {import("./where-base.js").default} where - Where clause.
     */
    constructor(where) {
        super();
        this.where = where;
        this.query = where.getQuery();
    }
    /**
     * Runs to sql.
     * @returns {string} - SQL string.
     */
    toSql() {
        return `NOT (${this.where.toSql()})`;
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoid2hlcmUtbm90LmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vc3JjL2RhdGFiYXNlL3F1ZXJ5L3doZXJlLW5vdC5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxZQUFZO0FBRVosT0FBTyxTQUFTLE1BQU0saUJBQWlCLENBQUE7QUFFdkMsTUFBTSxDQUFDLE9BQU8sT0FBTyw4QkFBK0IsU0FBUSxTQUFTO0lBQ25FOzs7T0FHRztJQUNILFlBQVksS0FBSztRQUNmLEtBQUssRUFBRSxDQUFBO1FBQ1AsSUFBSSxDQUFDLEtBQUssR0FBRyxLQUFLLENBQUE7UUFDbEIsSUFBSSxDQUFDLEtBQUssR0FBRyxLQUFLLENBQUMsUUFBUSxFQUFFLENBQUE7SUFDL0IsQ0FBQztJQUVEOzs7T0FHRztJQUNILEtBQUs7UUFDSCxPQUFPLFFBQVEsSUFBSSxDQUFDLEtBQUssQ0FBQyxLQUFLLEVBQUUsR0FBRyxDQUFBO0lBQ3RDLENBQUM7Q0FDRiIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG5pbXBvcnQgV2hlcmVCYXNlIGZyb20gXCIuL3doZXJlLWJhc2UuanNcIlxuXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBWZWxvY2lvdXNEYXRhYmFzZVF1ZXJ5V2hlcmVOb3QgZXh0ZW5kcyBXaGVyZUJhc2Uge1xuICAvKipcbiAgICogUnVucyBjb25zdHJ1Y3Rvci5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3doZXJlLWJhc2UuanNcIikuZGVmYXVsdH0gd2hlcmUgLSBXaGVyZSBjbGF1c2UuXG4gICAqL1xuICBjb25zdHJ1Y3Rvcih3aGVyZSkge1xuICAgIHN1cGVyKClcbiAgICB0aGlzLndoZXJlID0gd2hlcmVcbiAgICB0aGlzLnF1ZXJ5ID0gd2hlcmUuZ2V0UXVlcnkoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgdG8gc3FsLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFNRTCBzdHJpbmcuXG4gICAqL1xuICB0b1NxbCgpIHtcbiAgICByZXR1cm4gYE5PVCAoJHt0aGlzLndoZXJlLnRvU3FsKCl9KWBcbiAgfVxufVxuIl19