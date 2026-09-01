/**
 * Run a query using the native SQLite async API.
 * @param {import("sqlite3").Database & {getAllAsync: (sql: string) => Promise<Record<string, ReturnType<typeof JSON.parse>>[]>}} connection - SQLite connection instance.
 * @param {string} sql - SQL string to execute.
 * @returns {Promise<Record<string, ReturnType<typeof JSON.parse>>[]>} - Resolves with the result rows.
 */
export default async function query(connection, sql) {
    const rows = [];
    let result;
    try {
        result = await connection.getAllAsync(sql);
    }
    catch (error) {
        let sqlInErrorMessage = `${sql}`;
        if (sqlInErrorMessage.length >= 4096) {
            sqlInErrorMessage = `${sqlInErrorMessage.substring(0, 4096)}...`;
        }
        if (error instanceof Error) {
            error.message += `\n\n${sqlInErrorMessage}`;
            // Re-throw to recover stack trace
            throw new Error(error.message, { cause: error });
        }
        throw new Error(`An error occurred: ${error}\n\n${sqlInErrorMessage}`, { cause: error });
    }
    for await (const entry of result) {
        rows.push(entry);
    }
    return rows;
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicXVlcnkubmF0aXZlLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vLi4vc3JjL2RhdGFiYXNlL2RyaXZlcnMvc3FsaXRlL3F1ZXJ5Lm5hdGl2ZS5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQTs7Ozs7R0FLRztBQUNILE1BQU0sQ0FBQyxPQUFPLENBQUMsS0FBSyxVQUFVLEtBQUssQ0FBQyxVQUFVLEVBQUUsR0FBRztJQUNqRCxNQUFNLElBQUksR0FBRyxFQUFFLENBQUE7SUFDZixJQUFJLE1BQU0sQ0FBQTtJQUVWLElBQUksQ0FBQztRQUNILE1BQU0sR0FBRyxNQUFNLFVBQVUsQ0FBQyxXQUFXLENBQUMsR0FBRyxDQUFDLENBQUE7SUFDNUMsQ0FBQztJQUFDLE9BQU8sS0FBSyxFQUFFLENBQUM7UUFDZixJQUFJLGlCQUFpQixHQUFHLEdBQUcsR0FBRyxFQUFFLENBQUE7UUFFaEMsSUFBSSxpQkFBaUIsQ0FBQyxNQUFNLElBQUksSUFBSSxFQUFFLENBQUM7WUFDckMsaUJBQWlCLEdBQUcsR0FBRyxpQkFBaUIsQ0FBQyxTQUFTLENBQUMsQ0FBQyxFQUFFLElBQUksQ0FBQyxLQUFLLENBQUE7UUFDbEUsQ0FBQztRQUVELElBQUksS0FBSyxZQUFZLEtBQUssRUFBRSxDQUFDO1lBQzNCLEtBQUssQ0FBQyxPQUFPLElBQUksT0FBTyxpQkFBaUIsRUFBRSxDQUFBO1lBRTNDLGtDQUFrQztZQUNsQyxNQUFNLElBQUksS0FBSyxDQUFDLEtBQUssQ0FBQyxPQUFPLEVBQUUsRUFBQyxLQUFLLEVBQUUsS0FBSyxFQUFDLENBQUMsQ0FBQTtRQUNoRCxDQUFDO1FBRUQsTUFBTSxJQUFJLEtBQUssQ0FBQyxzQkFBc0IsS0FBSyxPQUFPLGlCQUFpQixFQUFFLEVBQUUsRUFBQyxLQUFLLEVBQUUsS0FBSyxFQUFDLENBQUMsQ0FBQTtJQUN4RixDQUFDO0lBRUQsSUFBSSxLQUFLLEVBQUUsTUFBTSxLQUFLLElBQUksTUFBTSxFQUFFLENBQUM7UUFDakMsSUFBSSxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsQ0FBQTtJQUNsQixDQUFDO0lBRUQsT0FBTyxJQUFJLENBQUE7QUFDYixDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiLyoqXG4gKiBSdW4gYSBxdWVyeSB1c2luZyB0aGUgbmF0aXZlIFNRTGl0ZSBhc3luYyBBUEkuXG4gKiBAcGFyYW0ge2ltcG9ydChcInNxbGl0ZTNcIikuRGF0YWJhc2UgJiB7Z2V0QWxsQXN5bmM6IChzcWw6IHN0cmluZykgPT4gUHJvbWlzZTxSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj5bXT59fSBjb25uZWN0aW9uIC0gU1FMaXRlIGNvbm5lY3Rpb24gaW5zdGFuY2UuXG4gKiBAcGFyYW0ge3N0cmluZ30gc3FsIC0gU1FMIHN0cmluZyB0byBleGVjdXRlLlxuICogQHJldHVybnMge1Byb21pc2U8UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+W10+fSAtIFJlc29sdmVzIHdpdGggdGhlIHJlc3VsdCByb3dzLlxuICovXG5leHBvcnQgZGVmYXVsdCBhc3luYyBmdW5jdGlvbiBxdWVyeShjb25uZWN0aW9uLCBzcWwpIHtcbiAgY29uc3Qgcm93cyA9IFtdXG4gIGxldCByZXN1bHRcblxuICB0cnkge1xuICAgIHJlc3VsdCA9IGF3YWl0IGNvbm5lY3Rpb24uZ2V0QWxsQXN5bmMoc3FsKVxuICB9IGNhdGNoIChlcnJvcikge1xuICAgIGxldCBzcWxJbkVycm9yTWVzc2FnZSA9IGAke3NxbH1gXG5cbiAgICBpZiAoc3FsSW5FcnJvck1lc3NhZ2UubGVuZ3RoID49IDQwOTYpIHtcbiAgICAgIHNxbEluRXJyb3JNZXNzYWdlID0gYCR7c3FsSW5FcnJvck1lc3NhZ2Uuc3Vic3RyaW5nKDAsIDQwOTYpfS4uLmBcbiAgICB9XG5cbiAgICBpZiAoZXJyb3IgaW5zdGFuY2VvZiBFcnJvcikge1xuICAgICAgZXJyb3IubWVzc2FnZSArPSBgXFxuXFxuJHtzcWxJbkVycm9yTWVzc2FnZX1gXG5cbiAgICAgIC8vIFJlLXRocm93IHRvIHJlY292ZXIgc3RhY2sgdHJhY2VcbiAgICAgIHRocm93IG5ldyBFcnJvcihlcnJvci5tZXNzYWdlLCB7Y2F1c2U6IGVycm9yfSlcbiAgICB9XG5cbiAgICB0aHJvdyBuZXcgRXJyb3IoYEFuIGVycm9yIG9jY3VycmVkOiAke2Vycm9yfVxcblxcbiR7c3FsSW5FcnJvck1lc3NhZ2V9YCwge2NhdXNlOiBlcnJvcn0pXG4gIH1cblxuICBmb3IgYXdhaXQgKGNvbnN0IGVudHJ5IG9mIHJlc3VsdCkge1xuICAgIHJvd3MucHVzaChlbnRyeSlcbiAgfVxuXG4gIHJldHVybiByb3dzXG59XG4iXX0=