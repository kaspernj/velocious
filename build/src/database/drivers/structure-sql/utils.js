// @ts-check
/**
 * Runs the normalizeSqlStatement helper.
 * @param {string} statement - Statement.
 * @returns {string} - SQL string.
 */
export function normalizeSqlStatement(statement) {
    const trimmed = statement.trim();
    if (!trimmed)
        return "";
    if (trimmed.endsWith(";"))
        return trimmed;
    return `${trimmed};`;
}
/**
 * Runs the normalizeCreateStatement helper.
 * @param {object} args - Options object.
 * @param {import("../base.js").default} args.db - Database connection.
 * @param {string} args.objectName - Object name.
 * @param {string} args.statement - Statement.
 * @param {string} args.type - Type identifier.
 * @returns {string} - The create statement.
 */
export function normalizeCreateStatement({ db, objectName, statement, type }) {
    const trimmed = statement.trim();
    if (!trimmed)
        return trimmed;
    if (trimmed.toLowerCase().startsWith("create "))
        return trimmed;
    return `CREATE ${type} ${db.quoteTable(objectName)} AS ${trimmed}`;
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidXRpbHMuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi8uLi9zcmMvZGF0YWJhc2UvZHJpdmVycy9zdHJ1Y3R1cmUtc3FsL3V0aWxzLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWjs7OztHQUlHO0FBQ0gsTUFBTSxVQUFVLHFCQUFxQixDQUFDLFNBQVM7SUFDN0MsTUFBTSxPQUFPLEdBQUcsU0FBUyxDQUFDLElBQUksRUFBRSxDQUFBO0lBRWhDLElBQUksQ0FBQyxPQUFPO1FBQUUsT0FBTyxFQUFFLENBQUE7SUFFdkIsSUFBSSxPQUFPLENBQUMsUUFBUSxDQUFDLEdBQUcsQ0FBQztRQUFFLE9BQU8sT0FBTyxDQUFBO0lBRXpDLE9BQU8sR0FBRyxPQUFPLEdBQUcsQ0FBQTtBQUN0QixDQUFDO0FBRUQ7Ozs7Ozs7O0dBUUc7QUFDSCxNQUFNLFVBQVUsd0JBQXdCLENBQUMsRUFBQyxFQUFFLEVBQUUsVUFBVSxFQUFFLFNBQVMsRUFBRSxJQUFJLEVBQUM7SUFDeEUsTUFBTSxPQUFPLEdBQUcsU0FBUyxDQUFDLElBQUksRUFBRSxDQUFBO0lBRWhDLElBQUksQ0FBQyxPQUFPO1FBQUUsT0FBTyxPQUFPLENBQUE7SUFFNUIsSUFBSSxPQUFPLENBQUMsV0FBVyxFQUFFLENBQUMsVUFBVSxDQUFDLFNBQVMsQ0FBQztRQUFFLE9BQU8sT0FBTyxDQUFBO0lBRS9ELE9BQU8sVUFBVSxJQUFJLElBQUksRUFBRSxDQUFDLFVBQVUsQ0FBQyxVQUFVLENBQUMsT0FBTyxPQUFPLEVBQUUsQ0FBQTtBQUNwRSxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbi8qKlxuICogUnVucyB0aGUgbm9ybWFsaXplU3FsU3RhdGVtZW50IGhlbHBlci5cbiAqIEBwYXJhbSB7c3RyaW5nfSBzdGF0ZW1lbnQgLSBTdGF0ZW1lbnQuXG4gKiBAcmV0dXJucyB7c3RyaW5nfSAtIFNRTCBzdHJpbmcuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBub3JtYWxpemVTcWxTdGF0ZW1lbnQoc3RhdGVtZW50KSB7XG4gIGNvbnN0IHRyaW1tZWQgPSBzdGF0ZW1lbnQudHJpbSgpXG5cbiAgaWYgKCF0cmltbWVkKSByZXR1cm4gXCJcIlxuXG4gIGlmICh0cmltbWVkLmVuZHNXaXRoKFwiO1wiKSkgcmV0dXJuIHRyaW1tZWRcblxuICByZXR1cm4gYCR7dHJpbW1lZH07YFxufVxuXG4vKipcbiAqIFJ1bnMgdGhlIG5vcm1hbGl6ZUNyZWF0ZVN0YXRlbWVudCBoZWxwZXIuXG4gKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMgb2JqZWN0LlxuICogQHBhcmFtIHtpbXBvcnQoXCIuLi9iYXNlLmpzXCIpLmRlZmF1bHR9IGFyZ3MuZGIgLSBEYXRhYmFzZSBjb25uZWN0aW9uLlxuICogQHBhcmFtIHtzdHJpbmd9IGFyZ3Mub2JqZWN0TmFtZSAtIE9iamVjdCBuYW1lLlxuICogQHBhcmFtIHtzdHJpbmd9IGFyZ3Muc3RhdGVtZW50IC0gU3RhdGVtZW50LlxuICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MudHlwZSAtIFR5cGUgaWRlbnRpZmllci5cbiAqIEByZXR1cm5zIHtzdHJpbmd9IC0gVGhlIGNyZWF0ZSBzdGF0ZW1lbnQuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBub3JtYWxpemVDcmVhdGVTdGF0ZW1lbnQoe2RiLCBvYmplY3ROYW1lLCBzdGF0ZW1lbnQsIHR5cGV9KSB7XG4gIGNvbnN0IHRyaW1tZWQgPSBzdGF0ZW1lbnQudHJpbSgpXG5cbiAgaWYgKCF0cmltbWVkKSByZXR1cm4gdHJpbW1lZFxuXG4gIGlmICh0cmltbWVkLnRvTG93ZXJDYXNlKCkuc3RhcnRzV2l0aChcImNyZWF0ZSBcIikpIHJldHVybiB0cmltbWVkXG5cbiAgcmV0dXJuIGBDUkVBVEUgJHt0eXBlfSAke2RiLnF1b3RlVGFibGUob2JqZWN0TmFtZSl9IEFTICR7dHJpbW1lZH1gXG59XG4iXX0=