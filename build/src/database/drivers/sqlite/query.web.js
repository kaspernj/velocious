// @ts-check
/**
 * Runs query.
 * @param {import("sql.js").Database} connection - Connection.
 * @param {string} sql - SQL string.
 * @returns {Promise<Record<string, ReturnType<typeof JSON.parse>>[]>} - Resolves with string value.
 */
export default async function query(connection, sql) {
    const rows = [];
    let result;
    try {
        result = connection.exec(sql);
    }
    catch (error) {
        let sqlInErrorMessage = `${sql}`;
        if (sqlInErrorMessage.length >= 4096) {
            sqlInErrorMessage = `${sqlInErrorMessage.substring(0, 4096)}...`;
        }
        if (error instanceof Error) {
            error.message += `\n\n${sqlInErrorMessage}`;
        }
        else {
            throw new Error(`An error occurred: ${error} [${typeof error}]\n\n${sqlInErrorMessage}`, { cause: error });
        }
        throw error;
    }
    if (result[0]) {
        const columns = result[0].columns;
        for (const rowValues of result[0].values) {
            /**
             * Row.
             * @type {Record<string, ReturnType<typeof JSON.parse>>} */
            const row = {};
            for (const columnIndex in columns) {
                row[columns[columnIndex]] = rowValues[columnIndex];
            }
            rows.push(row);
        }
    }
    return rows;
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicXVlcnkud2ViLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vLi4vc3JjL2RhdGFiYXNlL2RyaXZlcnMvc3FsaXRlL3F1ZXJ5LndlYi5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxZQUFZO0FBRVo7Ozs7O0dBS0c7QUFDSCxNQUFNLENBQUMsT0FBTyxDQUFDLEtBQUssVUFBVSxLQUFLLENBQUMsVUFBVSxFQUFFLEdBQUc7SUFDakQsTUFBTSxJQUFJLEdBQUcsRUFBRSxDQUFBO0lBQ2YsSUFBSSxNQUFNLENBQUE7SUFFVixJQUFJLENBQUM7UUFDSCxNQUFNLEdBQUcsVUFBVSxDQUFDLElBQUksQ0FBQyxHQUFHLENBQUMsQ0FBQTtJQUMvQixDQUFDO0lBQUMsT0FBTyxLQUFLLEVBQUUsQ0FBQztRQUNmLElBQUksaUJBQWlCLEdBQUcsR0FBRyxHQUFHLEVBQUUsQ0FBQTtRQUVoQyxJQUFJLGlCQUFpQixDQUFDLE1BQU0sSUFBSSxJQUFJLEVBQUUsQ0FBQztZQUNyQyxpQkFBaUIsR0FBRyxHQUFHLGlCQUFpQixDQUFDLFNBQVMsQ0FBQyxDQUFDLEVBQUUsSUFBSSxDQUFDLEtBQUssQ0FBQTtRQUNsRSxDQUFDO1FBRUQsSUFBSSxLQUFLLFlBQVksS0FBSyxFQUFFLENBQUM7WUFDM0IsS0FBSyxDQUFDLE9BQU8sSUFBSSxPQUFPLGlCQUFpQixFQUFFLENBQUE7UUFDN0MsQ0FBQzthQUFNLENBQUM7WUFDTixNQUFNLElBQUksS0FBSyxDQUFDLHNCQUFzQixLQUFLLEtBQUssT0FBTyxLQUFLLFFBQVEsaUJBQWlCLEVBQUUsRUFBRSxFQUFDLEtBQUssRUFBRSxLQUFLLEVBQUMsQ0FBQyxDQUFBO1FBQzFHLENBQUM7UUFFRCxNQUFNLEtBQUssQ0FBQTtJQUNiLENBQUM7SUFFRCxJQUFJLE1BQU0sQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDO1FBQ2QsTUFBTSxPQUFPLEdBQUcsTUFBTSxDQUFDLENBQUMsQ0FBQyxDQUFDLE9BQU8sQ0FBQTtRQUVqQyxLQUFLLE1BQU0sU0FBUyxJQUFJLE1BQU0sQ0FBQyxDQUFDLENBQUMsQ0FBQyxNQUFNLEVBQUUsQ0FBQztZQUN6Qzs7dUVBRTJEO1lBQzNELE1BQU0sR0FBRyxHQUFHLEVBQUUsQ0FBQTtZQUVkLEtBQUssTUFBTSxXQUFXLElBQUksT0FBTyxFQUFFLENBQUM7Z0JBQ2xDLEdBQUcsQ0FBQyxPQUFPLENBQUMsV0FBVyxDQUFDLENBQUMsR0FBRyxTQUFTLENBQUMsV0FBVyxDQUFDLENBQUE7WUFDcEQsQ0FBQztZQUVELElBQUksQ0FBQyxJQUFJLENBQUMsR0FBRyxDQUFDLENBQUE7UUFDaEIsQ0FBQztJQUNILENBQUM7SUFFRCxPQUFPLElBQUksQ0FBQTtBQUNiLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuLyoqXG4gKiBSdW5zIHF1ZXJ5LlxuICogQHBhcmFtIHtpbXBvcnQoXCJzcWwuanNcIikuRGF0YWJhc2V9IGNvbm5lY3Rpb24gLSBDb25uZWN0aW9uLlxuICogQHBhcmFtIHtzdHJpbmd9IHNxbCAtIFNRTCBzdHJpbmcuXG4gKiBAcmV0dXJucyB7UHJvbWlzZTxSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj5bXT59IC0gUmVzb2x2ZXMgd2l0aCBzdHJpbmcgdmFsdWUuXG4gKi9cbmV4cG9ydCBkZWZhdWx0IGFzeW5jIGZ1bmN0aW9uIHF1ZXJ5KGNvbm5lY3Rpb24sIHNxbCkge1xuICBjb25zdCByb3dzID0gW11cbiAgbGV0IHJlc3VsdFxuXG4gIHRyeSB7XG4gICAgcmVzdWx0ID0gY29ubmVjdGlvbi5leGVjKHNxbClcbiAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICBsZXQgc3FsSW5FcnJvck1lc3NhZ2UgPSBgJHtzcWx9YFxuXG4gICAgaWYgKHNxbEluRXJyb3JNZXNzYWdlLmxlbmd0aCA+PSA0MDk2KSB7XG4gICAgICBzcWxJbkVycm9yTWVzc2FnZSA9IGAke3NxbEluRXJyb3JNZXNzYWdlLnN1YnN0cmluZygwLCA0MDk2KX0uLi5gXG4gICAgfVxuXG4gICAgaWYgKGVycm9yIGluc3RhbmNlb2YgRXJyb3IpIHtcbiAgICAgIGVycm9yLm1lc3NhZ2UgKz0gYFxcblxcbiR7c3FsSW5FcnJvck1lc3NhZ2V9YFxuICAgIH0gZWxzZSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYEFuIGVycm9yIG9jY3VycmVkOiAke2Vycm9yfSBbJHt0eXBlb2YgZXJyb3J9XVxcblxcbiR7c3FsSW5FcnJvck1lc3NhZ2V9YCwge2NhdXNlOiBlcnJvcn0pXG4gICAgfVxuXG4gICAgdGhyb3cgZXJyb3JcbiAgfVxuXG4gIGlmIChyZXN1bHRbMF0pIHtcbiAgICBjb25zdCBjb2x1bW5zID0gcmVzdWx0WzBdLmNvbHVtbnNcblxuICAgIGZvciAoY29uc3Qgcm93VmFsdWVzIG9mIHJlc3VsdFswXS52YWx1ZXMpIHtcbiAgICAgIC8qKlxuICAgICAgICogUm93LlxuICAgICAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi9cbiAgICAgIGNvbnN0IHJvdyA9IHt9XG5cbiAgICAgIGZvciAoY29uc3QgY29sdW1uSW5kZXggaW4gY29sdW1ucykge1xuICAgICAgICByb3dbY29sdW1uc1tjb2x1bW5JbmRleF1dID0gcm93VmFsdWVzW2NvbHVtbkluZGV4XVxuICAgICAgfVxuXG4gICAgICByb3dzLnB1c2gocm93KVxuICAgIH1cbiAgfVxuXG4gIHJldHVybiByb3dzXG59XG4iXX0=