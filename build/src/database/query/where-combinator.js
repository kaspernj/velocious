// @ts-check
import WhereBase from "./where-base.js";
export default class VelociousDatabaseQueryWhereCombinator extends WhereBase {
    /**
     * Runs constructor.
     * @param {object} args - Options.
     * @param {"and" | "or"} args.combinator - SQL boolean combinator.
     * @param {import("./index.js").default} args.query - Query instance.
     * @param {import("./where-base.js").default[]} args.wheres - Where clauses to combine.
     */
    constructor({ combinator, query, wheres }) {
        super();
        this.combinator = combinator;
        this.query = query;
        this.wheres = wheres;
    }
    /**
     * Returns the toSql result.
     * @returns {string} - SQL string.
     */
    toSql() {
        if (this.wheres.length < 1)
            return "(1=1)";
        const separator = ` ${this.combinator.toUpperCase()} `;
        return `(${this.wheres.map((where) => where.toSql()).join(separator)})`;
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoid2hlcmUtY29tYmluYXRvci5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy9kYXRhYmFzZS9xdWVyeS93aGVyZS1jb21iaW5hdG9yLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLFNBQVMsTUFBTSxpQkFBaUIsQ0FBQTtBQUV2QyxNQUFNLENBQUMsT0FBTyxPQUFPLHFDQUFzQyxTQUFRLFNBQVM7SUFDMUU7Ozs7OztPQU1HO0lBQ0gsWUFBWSxFQUFDLFVBQVUsRUFBRSxLQUFLLEVBQUUsTUFBTSxFQUFDO1FBQ3JDLEtBQUssRUFBRSxDQUFBO1FBQ1AsSUFBSSxDQUFDLFVBQVUsR0FBRyxVQUFVLENBQUE7UUFDNUIsSUFBSSxDQUFDLEtBQUssR0FBRyxLQUFLLENBQUE7UUFDbEIsSUFBSSxDQUFDLE1BQU0sR0FBRyxNQUFNLENBQUE7SUFDdEIsQ0FBQztJQUVEOzs7T0FHRztJQUNILEtBQUs7UUFDSCxJQUFJLElBQUksQ0FBQyxNQUFNLENBQUMsTUFBTSxHQUFHLENBQUM7WUFBRSxPQUFPLE9BQU8sQ0FBQTtRQUUxQyxNQUFNLFNBQVMsR0FBRyxJQUFJLElBQUksQ0FBQyxVQUFVLENBQUMsV0FBVyxFQUFFLEdBQUcsQ0FBQTtRQUV0RCxPQUFPLElBQUksSUFBSSxDQUFDLE1BQU0sQ0FBQyxHQUFHLENBQUMsQ0FBQyxLQUFLLEVBQUUsRUFBRSxDQUFDLEtBQUssQ0FBQyxLQUFLLEVBQUUsQ0FBQyxDQUFDLElBQUksQ0FBQyxTQUFTLENBQUMsR0FBRyxDQUFBO0lBQ3pFLENBQUM7Q0FDRiIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG5pbXBvcnQgV2hlcmVCYXNlIGZyb20gXCIuL3doZXJlLWJhc2UuanNcIlxuXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBWZWxvY2lvdXNEYXRhYmFzZVF1ZXJ5V2hlcmVDb21iaW5hdG9yIGV4dGVuZHMgV2hlcmVCYXNlIHtcbiAgLyoqXG4gICAqIFJ1bnMgY29uc3RydWN0b3IuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtcImFuZFwiIHwgXCJvclwifSBhcmdzLmNvbWJpbmF0b3IgLSBTUUwgYm9vbGVhbiBjb21iaW5hdG9yLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vaW5kZXguanNcIikuZGVmYXVsdH0gYXJncy5xdWVyeSAtIFF1ZXJ5IGluc3RhbmNlLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vd2hlcmUtYmFzZS5qc1wiKS5kZWZhdWx0W119IGFyZ3Mud2hlcmVzIC0gV2hlcmUgY2xhdXNlcyB0byBjb21iaW5lLlxuICAgKi9cbiAgY29uc3RydWN0b3Ioe2NvbWJpbmF0b3IsIHF1ZXJ5LCB3aGVyZXN9KSB7XG4gICAgc3VwZXIoKVxuICAgIHRoaXMuY29tYmluYXRvciA9IGNvbWJpbmF0b3JcbiAgICB0aGlzLnF1ZXJ5ID0gcXVlcnlcbiAgICB0aGlzLndoZXJlcyA9IHdoZXJlc1xuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgdGhlIHRvU3FsIHJlc3VsdC5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBTUUwgc3RyaW5nLlxuICAgKi9cbiAgdG9TcWwoKSB7XG4gICAgaWYgKHRoaXMud2hlcmVzLmxlbmd0aCA8IDEpIHJldHVybiBcIigxPTEpXCJcblxuICAgIGNvbnN0IHNlcGFyYXRvciA9IGAgJHt0aGlzLmNvbWJpbmF0b3IudG9VcHBlckNhc2UoKX0gYFxuXG4gICAgcmV0dXJuIGAoJHt0aGlzLndoZXJlcy5tYXAoKHdoZXJlKSA9PiB3aGVyZS50b1NxbCgpKS5qb2luKHNlcGFyYXRvcil9KWBcbiAgfVxufVxuIl19