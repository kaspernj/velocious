// @ts-check
import OrderBase from "./order-base.js";
/**
 * OrderColumnInput type.
 * @typedef {object} OrderColumnInput
 * @property {string} column - Column name.
 * @property {"ASC" | "DESC" | "asc" | "desc"} [direction] - Sort direction.
 * @property {string} [tableName] - Optional table or alias name.
 */
/**
 * Runs normalize direction.
 * @param {string | undefined} direction - Direction input.
 * @returns {"ASC" | "DESC"} - Normalized direction.
 */
function normalizeDirection(direction) {
    if (typeof direction == "undefined")
        return "ASC";
    const normalized = direction.toUpperCase();
    if (normalized == "ASC" || normalized == "DESC")
        return normalized;
    throw new Error(`Invalid order direction: ${direction}`);
}
/**
 * Runs reverse direction.
 * @param {"ASC" | "DESC"} direction - Direction.
 * @returns {"ASC" | "DESC"} - Reversed direction.
 */
function reverseDirection(direction) {
    return direction == "ASC" ? "DESC" : "ASC";
}
export default class VelociousDatabaseQueryOrderColumn extends OrderBase {
    /**
     * Runs constructor.
     * @param {import("./index.js").default} query - Query instance.
     * @param {OrderColumnInput} input - Column order input.
     */
    constructor(query, input) {
        super(query);
        if (!input.column)
            throw new Error("Order column is required");
        this.column = input.column;
        this.direction = normalizeDirection(input.direction);
        this.reverseOrder = false;
        this.tableName = input.tableName;
    }
    /**
     * Runs set reverse order.
     * @param {boolean} [reverseOrder] - Whether to reverse the order.
     * @returns {void}
     */
    setReverseOrder(reverseOrder = true) {
        this.reverseOrder = reverseOrder;
    }
    /**
     * Runs to sql.
     * @returns {string} - SQL string.
     */
    toSql() {
        const options = this.getOptions();
        const direction = this.reverseOrder ? reverseDirection(this.direction) : this.direction;
        let sql = "";
        if (this.tableName)
            sql += `${options.quoteTableName(this.tableName)}.`;
        sql += `${options.quoteColumnName(this.column)} ${direction}`;
        return sql;
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoib3JkZXItY29sdW1uLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vc3JjL2RhdGFiYXNlL3F1ZXJ5L29yZGVyLWNvbHVtbi5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxZQUFZO0FBRVosT0FBTyxTQUFTLE1BQU0saUJBQWlCLENBQUE7QUFFdkM7Ozs7OztHQU1HO0FBRUg7Ozs7R0FJRztBQUNILFNBQVMsa0JBQWtCLENBQUMsU0FBUztJQUNuQyxJQUFJLE9BQU8sU0FBUyxJQUFJLFdBQVc7UUFBRSxPQUFPLEtBQUssQ0FBQTtJQUVqRCxNQUFNLFVBQVUsR0FBRyxTQUFTLENBQUMsV0FBVyxFQUFFLENBQUE7SUFDMUMsSUFBSSxVQUFVLElBQUksS0FBSyxJQUFJLFVBQVUsSUFBSSxNQUFNO1FBQUUsT0FBTyxVQUFVLENBQUE7SUFFbEUsTUFBTSxJQUFJLEtBQUssQ0FBQyw0QkFBNEIsU0FBUyxFQUFFLENBQUMsQ0FBQTtBQUMxRCxDQUFDO0FBRUQ7Ozs7R0FJRztBQUNILFNBQVMsZ0JBQWdCLENBQUMsU0FBUztJQUNqQyxPQUFPLFNBQVMsSUFBSSxLQUFLLENBQUMsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFBO0FBQzVDLENBQUM7QUFFRCxNQUFNLENBQUMsT0FBTyxPQUFPLGlDQUFrQyxTQUFRLFNBQVM7SUFDdEU7Ozs7T0FJRztJQUNILFlBQVksS0FBSyxFQUFFLEtBQUs7UUFDdEIsS0FBSyxDQUFDLEtBQUssQ0FBQyxDQUFBO1FBRVosSUFBSSxDQUFDLEtBQUssQ0FBQyxNQUFNO1lBQUUsTUFBTSxJQUFJLEtBQUssQ0FBQywwQkFBMEIsQ0FBQyxDQUFBO1FBRTlELElBQUksQ0FBQyxNQUFNLEdBQUcsS0FBSyxDQUFDLE1BQU0sQ0FBQTtRQUMxQixJQUFJLENBQUMsU0FBUyxHQUFHLGtCQUFrQixDQUFDLEtBQUssQ0FBQyxTQUFTLENBQUMsQ0FBQTtRQUNwRCxJQUFJLENBQUMsWUFBWSxHQUFHLEtBQUssQ0FBQTtRQUN6QixJQUFJLENBQUMsU0FBUyxHQUFHLEtBQUssQ0FBQyxTQUFTLENBQUE7SUFDbEMsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCxlQUFlLENBQUMsWUFBWSxHQUFHLElBQUk7UUFDakMsSUFBSSxDQUFDLFlBQVksR0FBRyxZQUFZLENBQUE7SUFDbEMsQ0FBQztJQUVEOzs7T0FHRztJQUNILEtBQUs7UUFDSCxNQUFNLE9BQU8sR0FBRyxJQUFJLENBQUMsVUFBVSxFQUFFLENBQUE7UUFDakMsTUFBTSxTQUFTLEdBQUcsSUFBSSxDQUFDLFlBQVksQ0FBQyxDQUFDLENBQUMsZ0JBQWdCLENBQUMsSUFBSSxDQUFDLFNBQVMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsU0FBUyxDQUFBO1FBQ3ZGLElBQUksR0FBRyxHQUFHLEVBQUUsQ0FBQTtRQUVaLElBQUksSUFBSSxDQUFDLFNBQVM7WUFBRSxHQUFHLElBQUksR0FBRyxPQUFPLENBQUMsY0FBYyxDQUFDLElBQUksQ0FBQyxTQUFTLENBQUMsR0FBRyxDQUFBO1FBRXZFLEdBQUcsSUFBSSxHQUFHLE9BQU8sQ0FBQyxlQUFlLENBQUMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxJQUFJLFNBQVMsRUFBRSxDQUFBO1FBRTdELE9BQU8sR0FBRyxDQUFBO0lBQ1osQ0FBQztDQUNGIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbmltcG9ydCBPcmRlckJhc2UgZnJvbSBcIi4vb3JkZXItYmFzZS5qc1wiXG5cbi8qKlxuICogT3JkZXJDb2x1bW5JbnB1dCB0eXBlLlxuICogQHR5cGVkZWYge29iamVjdH0gT3JkZXJDb2x1bW5JbnB1dFxuICogQHByb3BlcnR5IHtzdHJpbmd9IGNvbHVtbiAtIENvbHVtbiBuYW1lLlxuICogQHByb3BlcnR5IHtcIkFTQ1wiIHwgXCJERVNDXCIgfCBcImFzY1wiIHwgXCJkZXNjXCJ9IFtkaXJlY3Rpb25dIC0gU29ydCBkaXJlY3Rpb24uXG4gKiBAcHJvcGVydHkge3N0cmluZ30gW3RhYmxlTmFtZV0gLSBPcHRpb25hbCB0YWJsZSBvciBhbGlhcyBuYW1lLlxuICovXG5cbi8qKlxuICogUnVucyBub3JtYWxpemUgZGlyZWN0aW9uLlxuICogQHBhcmFtIHtzdHJpbmcgfCB1bmRlZmluZWR9IGRpcmVjdGlvbiAtIERpcmVjdGlvbiBpbnB1dC5cbiAqIEByZXR1cm5zIHtcIkFTQ1wiIHwgXCJERVNDXCJ9IC0gTm9ybWFsaXplZCBkaXJlY3Rpb24uXG4gKi9cbmZ1bmN0aW9uIG5vcm1hbGl6ZURpcmVjdGlvbihkaXJlY3Rpb24pIHtcbiAgaWYgKHR5cGVvZiBkaXJlY3Rpb24gPT0gXCJ1bmRlZmluZWRcIikgcmV0dXJuIFwiQVNDXCJcblxuICBjb25zdCBub3JtYWxpemVkID0gZGlyZWN0aW9uLnRvVXBwZXJDYXNlKClcbiAgaWYgKG5vcm1hbGl6ZWQgPT0gXCJBU0NcIiB8fCBub3JtYWxpemVkID09IFwiREVTQ1wiKSByZXR1cm4gbm9ybWFsaXplZFxuXG4gIHRocm93IG5ldyBFcnJvcihgSW52YWxpZCBvcmRlciBkaXJlY3Rpb246ICR7ZGlyZWN0aW9ufWApXG59XG5cbi8qKlxuICogUnVucyByZXZlcnNlIGRpcmVjdGlvbi5cbiAqIEBwYXJhbSB7XCJBU0NcIiB8IFwiREVTQ1wifSBkaXJlY3Rpb24gLSBEaXJlY3Rpb24uXG4gKiBAcmV0dXJucyB7XCJBU0NcIiB8IFwiREVTQ1wifSAtIFJldmVyc2VkIGRpcmVjdGlvbi5cbiAqL1xuZnVuY3Rpb24gcmV2ZXJzZURpcmVjdGlvbihkaXJlY3Rpb24pIHtcbiAgcmV0dXJuIGRpcmVjdGlvbiA9PSBcIkFTQ1wiID8gXCJERVNDXCIgOiBcIkFTQ1wiXG59XG5cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIFZlbG9jaW91c0RhdGFiYXNlUXVlcnlPcmRlckNvbHVtbiBleHRlbmRzIE9yZGVyQmFzZSB7XG4gIC8qKlxuICAgKiBSdW5zIGNvbnN0cnVjdG9yLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vaW5kZXguanNcIikuZGVmYXVsdH0gcXVlcnkgLSBRdWVyeSBpbnN0YW5jZS5cbiAgICogQHBhcmFtIHtPcmRlckNvbHVtbklucHV0fSBpbnB1dCAtIENvbHVtbiBvcmRlciBpbnB1dC5cbiAgICovXG4gIGNvbnN0cnVjdG9yKHF1ZXJ5LCBpbnB1dCkge1xuICAgIHN1cGVyKHF1ZXJ5KVxuXG4gICAgaWYgKCFpbnB1dC5jb2x1bW4pIHRocm93IG5ldyBFcnJvcihcIk9yZGVyIGNvbHVtbiBpcyByZXF1aXJlZFwiKVxuXG4gICAgdGhpcy5jb2x1bW4gPSBpbnB1dC5jb2x1bW5cbiAgICB0aGlzLmRpcmVjdGlvbiA9IG5vcm1hbGl6ZURpcmVjdGlvbihpbnB1dC5kaXJlY3Rpb24pXG4gICAgdGhpcy5yZXZlcnNlT3JkZXIgPSBmYWxzZVxuICAgIHRoaXMudGFibGVOYW1lID0gaW5wdXQudGFibGVOYW1lXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzZXQgcmV2ZXJzZSBvcmRlci5cbiAgICogQHBhcmFtIHtib29sZWFufSBbcmV2ZXJzZU9yZGVyXSAtIFdoZXRoZXIgdG8gcmV2ZXJzZSB0aGUgb3JkZXIuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgc2V0UmV2ZXJzZU9yZGVyKHJldmVyc2VPcmRlciA9IHRydWUpIHtcbiAgICB0aGlzLnJldmVyc2VPcmRlciA9IHJldmVyc2VPcmRlclxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgdG8gc3FsLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFNRTCBzdHJpbmcuXG4gICAqL1xuICB0b1NxbCgpIHtcbiAgICBjb25zdCBvcHRpb25zID0gdGhpcy5nZXRPcHRpb25zKClcbiAgICBjb25zdCBkaXJlY3Rpb24gPSB0aGlzLnJldmVyc2VPcmRlciA/IHJldmVyc2VEaXJlY3Rpb24odGhpcy5kaXJlY3Rpb24pIDogdGhpcy5kaXJlY3Rpb25cbiAgICBsZXQgc3FsID0gXCJcIlxuXG4gICAgaWYgKHRoaXMudGFibGVOYW1lKSBzcWwgKz0gYCR7b3B0aW9ucy5xdW90ZVRhYmxlTmFtZSh0aGlzLnRhYmxlTmFtZSl9LmBcblxuICAgIHNxbCArPSBgJHtvcHRpb25zLnF1b3RlQ29sdW1uTmFtZSh0aGlzLmNvbHVtbil9ICR7ZGlyZWN0aW9ufWBcblxuICAgIHJldHVybiBzcWxcbiAgfVxufVxuIl19