// @ts-check
/** @typedef {string | number | boolean | null} InValue */
export default class WhereIn {
    /**
     * Validates an explicit membership descriptor at a column boundary.
     * @param {unknown} condition - Untrusted column condition, narrowed before use.
     * @returns {InValue[]} - Validated members in a new array.
     */
    static values(condition) {
        if (condition === null || typeof condition !== "object" ||
            !Object.hasOwn(condition, "in") || !("in" in condition) ||
            Reflect.ownKeys(condition).length !== 1 || !Array.isArray(condition.in)) {
            throw new Error("Invalid IN condition: expected an object with only an own 'in' array");
        }
        /** @type {InValue[]} */
        const values = [];
        for (const value of condition.in) {
            if (value !== null && typeof value !== "string" && typeof value !== "boolean" &&
                !(typeof value === "number" && Number.isFinite(value))) {
                throw new Error("Invalid IN condition: members must be strings, finite numbers, booleans or null");
            }
            values.push(value);
        }
        return values;
    }
    /**
     * Renders membership without letting its null branch escape sibling filters.
     * @param {{columnSql: string, inColumnSql?: string, values: InValue[], options: import("../query-parser/options.js").default}} args - Quoted column operands, normalized members and driver quoting.
     * @returns {string} - Complete membership predicate.
     */
    static toSql({ columnSql, inColumnSql = columnSql, values, options }) {
        const nonNullValues = values.filter((value) => value !== null);
        const includesNull = values.includes(null);
        if (nonNullValues.length === 0)
            return includesNull ? `${columnSql} IS NULL` : "1=0";
        const membershipSql = `${inColumnSql} IN (${nonNullValues.map((value) => options.quote(value)).join(", ")})`;
        return includesNull ? `(${membershipSql} OR ${columnSql} IS NULL)` : membershipSql;
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoid2hlcmUtaW4uanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvZGF0YWJhc2UvcXVlcnkvd2hlcmUtaW4uanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLDBEQUEwRDtBQUUxRCxNQUFNLENBQUMsT0FBTyxPQUFPLE9BQU87SUFDMUI7Ozs7T0FJRztJQUNILE1BQU0sQ0FBQyxNQUFNLENBQUMsU0FBUztRQUNyQixJQUFJLFNBQVMsS0FBSyxJQUFJLElBQUksT0FBTyxTQUFTLEtBQUssUUFBUTtZQUNyRCxDQUFDLE1BQU0sQ0FBQyxNQUFNLENBQUMsU0FBUyxFQUFFLElBQUksQ0FBQyxJQUFJLENBQUMsQ0FBQyxJQUFJLElBQUksU0FBUyxDQUFDO1lBQ3ZELE9BQU8sQ0FBQyxPQUFPLENBQUMsU0FBUyxDQUFDLENBQUMsTUFBTSxLQUFLLENBQUMsSUFBSSxDQUFDLEtBQUssQ0FBQyxPQUFPLENBQUMsU0FBUyxDQUFDLEVBQUUsQ0FBQyxFQUFFLENBQUM7WUFDMUUsTUFBTSxJQUFJLEtBQUssQ0FBQyxzRUFBc0UsQ0FBQyxDQUFBO1FBQ3pGLENBQUM7UUFFRCx3QkFBd0I7UUFDeEIsTUFBTSxNQUFNLEdBQUcsRUFBRSxDQUFBO1FBRWpCLEtBQUssTUFBTSxLQUFLLElBQUksU0FBUyxDQUFDLEVBQUUsRUFBRSxDQUFDO1lBQ2pDLElBQUksS0FBSyxLQUFLLElBQUksSUFBSSxPQUFPLEtBQUssS0FBSyxRQUFRLElBQUksT0FBTyxLQUFLLEtBQUssU0FBUztnQkFDM0UsQ0FBQyxDQUFDLE9BQU8sS0FBSyxLQUFLLFFBQVEsSUFBSSxNQUFNLENBQUMsUUFBUSxDQUFDLEtBQUssQ0FBQyxDQUFDLEVBQUUsQ0FBQztnQkFDekQsTUFBTSxJQUFJLEtBQUssQ0FBQyxpRkFBaUYsQ0FBQyxDQUFBO1lBQ3BHLENBQUM7WUFFRCxNQUFNLENBQUMsSUFBSSxDQUFDLEtBQUssQ0FBQyxDQUFBO1FBQ3BCLENBQUM7UUFFRCxPQUFPLE1BQU0sQ0FBQTtJQUNmLENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsTUFBTSxDQUFDLEtBQUssQ0FBQyxFQUFDLFNBQVMsRUFBRSxXQUFXLEdBQUcsU0FBUyxFQUFFLE1BQU0sRUFBRSxPQUFPLEVBQUM7UUFDaEUsTUFBTSxhQUFhLEdBQUcsTUFBTSxDQUFDLE1BQU0sQ0FBQyxDQUFDLEtBQUssRUFBRSxFQUFFLENBQUMsS0FBSyxLQUFLLElBQUksQ0FBQyxDQUFBO1FBQzlELE1BQU0sWUFBWSxHQUFHLE1BQU0sQ0FBQyxRQUFRLENBQUMsSUFBSSxDQUFDLENBQUE7UUFFMUMsSUFBSSxhQUFhLENBQUMsTUFBTSxLQUFLLENBQUM7WUFBRSxPQUFPLFlBQVksQ0FBQyxDQUFDLENBQUMsR0FBRyxTQUFTLFVBQVUsQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFBO1FBRXBGLE1BQU0sYUFBYSxHQUFHLEdBQUcsV0FBVyxRQUFRLGFBQWEsQ0FBQyxHQUFHLENBQUMsQ0FBQyxLQUFLLEVBQUUsRUFBRSxDQUFDLE9BQU8sQ0FBQyxLQUFLLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLEdBQUcsQ0FBQTtRQUU1RyxPQUFPLFlBQVksQ0FBQyxDQUFDLENBQUMsSUFBSSxhQUFhLE9BQU8sU0FBUyxXQUFXLENBQUMsQ0FBQyxDQUFDLGFBQWEsQ0FBQTtJQUNwRixDQUFDO0NBQ0YiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuLyoqIEB0eXBlZGVmIHtzdHJpbmcgfCBudW1iZXIgfCBib29sZWFuIHwgbnVsbH0gSW5WYWx1ZSAqL1xuXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBXaGVyZUluIHtcbiAgLyoqXG4gICAqIFZhbGlkYXRlcyBhbiBleHBsaWNpdCBtZW1iZXJzaGlwIGRlc2NyaXB0b3IgYXQgYSBjb2x1bW4gYm91bmRhcnkuXG4gICAqIEBwYXJhbSB7dW5rbm93bn0gY29uZGl0aW9uIC0gVW50cnVzdGVkIGNvbHVtbiBjb25kaXRpb24sIG5hcnJvd2VkIGJlZm9yZSB1c2UuXG4gICAqIEByZXR1cm5zIHtJblZhbHVlW119IC0gVmFsaWRhdGVkIG1lbWJlcnMgaW4gYSBuZXcgYXJyYXkuXG4gICAqL1xuICBzdGF0aWMgdmFsdWVzKGNvbmRpdGlvbikge1xuICAgIGlmIChjb25kaXRpb24gPT09IG51bGwgfHwgdHlwZW9mIGNvbmRpdGlvbiAhPT0gXCJvYmplY3RcIiB8fFxuICAgICAgIU9iamVjdC5oYXNPd24oY29uZGl0aW9uLCBcImluXCIpIHx8ICEoXCJpblwiIGluIGNvbmRpdGlvbikgfHxcbiAgICAgIFJlZmxlY3Qub3duS2V5cyhjb25kaXRpb24pLmxlbmd0aCAhPT0gMSB8fCAhQXJyYXkuaXNBcnJheShjb25kaXRpb24uaW4pKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJJbnZhbGlkIElOIGNvbmRpdGlvbjogZXhwZWN0ZWQgYW4gb2JqZWN0IHdpdGggb25seSBhbiBvd24gJ2luJyBhcnJheVwiKVxuICAgIH1cblxuICAgIC8qKiBAdHlwZSB7SW5WYWx1ZVtdfSAqL1xuICAgIGNvbnN0IHZhbHVlcyA9IFtdXG5cbiAgICBmb3IgKGNvbnN0IHZhbHVlIG9mIGNvbmRpdGlvbi5pbikge1xuICAgICAgaWYgKHZhbHVlICE9PSBudWxsICYmIHR5cGVvZiB2YWx1ZSAhPT0gXCJzdHJpbmdcIiAmJiB0eXBlb2YgdmFsdWUgIT09IFwiYm9vbGVhblwiICYmXG4gICAgICAgICEodHlwZW9mIHZhbHVlID09PSBcIm51bWJlclwiICYmIE51bWJlci5pc0Zpbml0ZSh2YWx1ZSkpKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihcIkludmFsaWQgSU4gY29uZGl0aW9uOiBtZW1iZXJzIG11c3QgYmUgc3RyaW5ncywgZmluaXRlIG51bWJlcnMsIGJvb2xlYW5zIG9yIG51bGxcIilcbiAgICAgIH1cblxuICAgICAgdmFsdWVzLnB1c2godmFsdWUpXG4gICAgfVxuXG4gICAgcmV0dXJuIHZhbHVlc1xuICB9XG5cbiAgLyoqXG4gICAqIFJlbmRlcnMgbWVtYmVyc2hpcCB3aXRob3V0IGxldHRpbmcgaXRzIG51bGwgYnJhbmNoIGVzY2FwZSBzaWJsaW5nIGZpbHRlcnMuXG4gICAqIEBwYXJhbSB7e2NvbHVtblNxbDogc3RyaW5nLCBpbkNvbHVtblNxbD86IHN0cmluZywgdmFsdWVzOiBJblZhbHVlW10sIG9wdGlvbnM6IGltcG9ydChcIi4uL3F1ZXJ5LXBhcnNlci9vcHRpb25zLmpzXCIpLmRlZmF1bHR9fSBhcmdzIC0gUXVvdGVkIGNvbHVtbiBvcGVyYW5kcywgbm9ybWFsaXplZCBtZW1iZXJzIGFuZCBkcml2ZXIgcXVvdGluZy5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBDb21wbGV0ZSBtZW1iZXJzaGlwIHByZWRpY2F0ZS5cbiAgICovXG4gIHN0YXRpYyB0b1NxbCh7Y29sdW1uU3FsLCBpbkNvbHVtblNxbCA9IGNvbHVtblNxbCwgdmFsdWVzLCBvcHRpb25zfSkge1xuICAgIGNvbnN0IG5vbk51bGxWYWx1ZXMgPSB2YWx1ZXMuZmlsdGVyKCh2YWx1ZSkgPT4gdmFsdWUgIT09IG51bGwpXG4gICAgY29uc3QgaW5jbHVkZXNOdWxsID0gdmFsdWVzLmluY2x1ZGVzKG51bGwpXG5cbiAgICBpZiAobm9uTnVsbFZhbHVlcy5sZW5ndGggPT09IDApIHJldHVybiBpbmNsdWRlc051bGwgPyBgJHtjb2x1bW5TcWx9IElTIE5VTExgIDogXCIxPTBcIlxuXG4gICAgY29uc3QgbWVtYmVyc2hpcFNxbCA9IGAke2luQ29sdW1uU3FsfSBJTiAoJHtub25OdWxsVmFsdWVzLm1hcCgodmFsdWUpID0+IG9wdGlvbnMucXVvdGUodmFsdWUpKS5qb2luKFwiLCBcIil9KWBcblxuICAgIHJldHVybiBpbmNsdWRlc051bGwgPyBgKCR7bWVtYmVyc2hpcFNxbH0gT1IgJHtjb2x1bW5TcWx9IElTIE5VTEwpYCA6IG1lbWJlcnNoaXBTcWxcbiAgfVxufVxuIl19