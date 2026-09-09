// @ts-check
/**
 * Runs base methods forward.
 * @param {typeof import("./base.js").default} PoolBase - Pool base.
 * @returns {void} - No return value.
 */
export default function baseMethodsForward(PoolBase) {
    const forwardMethods = [
        "alterTable",
        "alterTableSQLs",
        "createIndex",
        "createIndexSQLs",
        "createTable",
        "createTableSql",
        "delete",
        "deleteSql",
        "getTables",
        "insert",
        "insertSql",
        "primaryKeyType",
        "query",
        "quote",
        "quoteColumn",
        "quoteTable",
        "removeIndexSQLs",
        "select",
        "update",
        "updateSql"
    ];
    const prototype = /** @type {Record<string, (...args: Array<ReturnType<typeof JSON.parse>>) => ReturnType<typeof JSON.parse>>} */ ( /** @type {ReturnType<typeof JSON.parse>} */(PoolBase.prototype));
    for (const forwardMethod of forwardMethods) {
        prototype[forwardMethod] = function (...args) {
            const connection = this.getCurrentConnection();
            const connectionRecord = /** @type {Record<string, (...args: Array<ReturnType<typeof JSON.parse>>) => ReturnType<typeof JSON.parse>>} */ ( /** @type {ReturnType<typeof JSON.parse>} */(connection));
            const connectionMethod = connectionRecord[forwardMethod];
            if (!connectionMethod)
                throw new Error(`${forwardMethod} isn't defined on driver`);
            return connectionMethod.apply(connection, args);
        };
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYmFzZS1tZXRob2RzLWZvcndhcmQuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvZGF0YWJhc2UvcG9vbC9iYXNlLW1ldGhvZHMtZm9yd2FyZC5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxZQUFZO0FBRVo7Ozs7R0FJRztBQUNILE1BQU0sQ0FBQyxPQUFPLFVBQVUsa0JBQWtCLENBQUMsUUFBUTtJQUNqRCxNQUFNLGNBQWMsR0FBRztRQUNyQixZQUFZO1FBQ1osZ0JBQWdCO1FBQ2hCLGFBQWE7UUFDYixpQkFBaUI7UUFDakIsYUFBYTtRQUNiLGdCQUFnQjtRQUNoQixRQUFRO1FBQ1IsV0FBVztRQUNYLFdBQVc7UUFDWCxRQUFRO1FBQ1IsV0FBVztRQUNYLGdCQUFnQjtRQUNoQixPQUFPO1FBQ1AsT0FBTztRQUNQLGFBQWE7UUFDYixZQUFZO1FBQ1osaUJBQWlCO1FBQ2pCLFFBQVE7UUFDUixRQUFRO1FBQ1IsV0FBVztLQUNaLENBQUE7SUFFRCxNQUFNLFNBQVMsR0FBRywrR0FBK0csQ0FBQyxFQUFDLDRDQUE2QyxDQUFDLFFBQVEsQ0FBQyxTQUFTLENBQUMsQ0FBQyxDQUFBO0lBRXJNLEtBQUssTUFBTSxhQUFhLElBQUksY0FBYyxFQUFFLENBQUM7UUFDM0MsU0FBUyxDQUFDLGFBQWEsQ0FBQyxHQUFHLFVBQVMsR0FBRyxJQUFJO1lBQ3pDLE1BQU0sVUFBVSxHQUFHLElBQUksQ0FBQyxvQkFBb0IsRUFBRSxDQUFBO1lBQzlDLE1BQU0sZ0JBQWdCLEdBQUcsK0dBQStHLENBQUMsRUFBQyw0Q0FBNkMsQ0FBQyxVQUFVLENBQUMsQ0FBQyxDQUFBO1lBQ3BNLE1BQU0sZ0JBQWdCLEdBQUcsZ0JBQWdCLENBQUMsYUFBYSxDQUFDLENBQUE7WUFFeEQsSUFBSSxDQUFDLGdCQUFnQjtnQkFBRSxNQUFNLElBQUksS0FBSyxDQUFDLEdBQUcsYUFBYSwwQkFBMEIsQ0FBQyxDQUFBO1lBRWxGLE9BQU8sZ0JBQWdCLENBQUMsS0FBSyxDQUFDLFVBQVUsRUFBRSxJQUFJLENBQUMsQ0FBQTtRQUNqRCxDQUFDLENBQUE7SUFDSCxDQUFDO0FBQ0gsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG4vKipcbiAqIFJ1bnMgYmFzZSBtZXRob2RzIGZvcndhcmQuXG4gKiBAcGFyYW0ge3R5cGVvZiBpbXBvcnQoXCIuL2Jhc2UuanNcIikuZGVmYXVsdH0gUG9vbEJhc2UgLSBQb29sIGJhc2UuXG4gKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gKi9cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uIGJhc2VNZXRob2RzRm9yd2FyZChQb29sQmFzZSkge1xuICBjb25zdCBmb3J3YXJkTWV0aG9kcyA9IFtcbiAgICBcImFsdGVyVGFibGVcIixcbiAgICBcImFsdGVyVGFibGVTUUxzXCIsXG4gICAgXCJjcmVhdGVJbmRleFwiLFxuICAgIFwiY3JlYXRlSW5kZXhTUUxzXCIsXG4gICAgXCJjcmVhdGVUYWJsZVwiLFxuICAgIFwiY3JlYXRlVGFibGVTcWxcIixcbiAgICBcImRlbGV0ZVwiLFxuICAgIFwiZGVsZXRlU3FsXCIsXG4gICAgXCJnZXRUYWJsZXNcIixcbiAgICBcImluc2VydFwiLFxuICAgIFwiaW5zZXJ0U3FsXCIsXG4gICAgXCJwcmltYXJ5S2V5VHlwZVwiLFxuICAgIFwicXVlcnlcIixcbiAgICBcInF1b3RlXCIsXG4gICAgXCJxdW90ZUNvbHVtblwiLFxuICAgIFwicXVvdGVUYWJsZVwiLFxuICAgIFwicmVtb3ZlSW5kZXhTUUxzXCIsXG4gICAgXCJzZWxlY3RcIixcbiAgICBcInVwZGF0ZVwiLFxuICAgIFwidXBkYXRlU3FsXCJcbiAgXVxuXG4gIGNvbnN0IHByb3RvdHlwZSA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgKC4uLmFyZ3M6IEFycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PikgPT4gUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAoLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi8gKFBvb2xCYXNlLnByb3RvdHlwZSkpXG5cbiAgZm9yIChjb25zdCBmb3J3YXJkTWV0aG9kIG9mIGZvcndhcmRNZXRob2RzKSB7XG4gICAgcHJvdG90eXBlW2ZvcndhcmRNZXRob2RdID0gZnVuY3Rpb24oLi4uYXJncykge1xuICAgICAgY29uc3QgY29ubmVjdGlvbiA9IHRoaXMuZ2V0Q3VycmVudENvbm5lY3Rpb24oKVxuICAgICAgY29uc3QgY29ubmVjdGlvblJlY29yZCA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgKC4uLmFyZ3M6IEFycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PikgPT4gUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAoLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi8gKGNvbm5lY3Rpb24pKVxuICAgICAgY29uc3QgY29ubmVjdGlvbk1ldGhvZCA9IGNvbm5lY3Rpb25SZWNvcmRbZm9yd2FyZE1ldGhvZF1cblxuICAgICAgaWYgKCFjb25uZWN0aW9uTWV0aG9kKSB0aHJvdyBuZXcgRXJyb3IoYCR7Zm9yd2FyZE1ldGhvZH0gaXNuJ3QgZGVmaW5lZCBvbiBkcml2ZXJgKVxuXG4gICAgICByZXR1cm4gY29ubmVjdGlvbk1ldGhvZC5hcHBseShjb25uZWN0aW9uLCBhcmdzKVxuICAgIH1cbiAgfVxufVxuIl19