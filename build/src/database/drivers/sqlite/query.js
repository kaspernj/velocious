// @ts-check
/**
 * Runs query.
 * @param {import("sqlite").Database} connection - Connection.
 * @param {string} sql - SQL string.
 * @returns {Promise<Record<string, ReturnType<typeof JSON.parse>>[]>} - Resolves with string value.
 */
export default async function query(connection, sql) {
    try {
        /**
         * Defines result.
         * @type {Record<string, ReturnType<typeof JSON.parse>>[]} */
        let result;
        result = await connection.all(sql);
        return result;
    }
    catch (error) {
        let sqlInErrorMessage = `${sql}`;
        if (sqlInErrorMessage.length >= 4096) {
            sqlInErrorMessage = `${sqlInErrorMessage.substring(0, 4096)}...`;
        }
        if (error instanceof Error) {
            error.message += `\n\n${sqlInErrorMessage}`;
            throw new Error(error.message, { cause: error });
        }
        else {
            throw new Error(`An error occurred: ${error}\n\n${sql}`, { cause: error });
        }
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicXVlcnkuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi8uLi9zcmMvZGF0YWJhc2UvZHJpdmVycy9zcWxpdGUvcXVlcnkuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaOzs7OztHQUtHO0FBQ0gsTUFBTSxDQUFDLE9BQU8sQ0FBQyxLQUFLLFVBQVUsS0FBSyxDQUFDLFVBQVUsRUFBRSxHQUFHO0lBQ2pELElBQUksQ0FBQztRQUNIOztxRUFFNkQ7UUFDN0QsSUFBSSxNQUFNLENBQUE7UUFFVixNQUFNLEdBQUcsTUFBTSxVQUFVLENBQUMsR0FBRyxDQUFDLEdBQUcsQ0FBQyxDQUFBO1FBRWxDLE9BQU8sTUFBTSxDQUFBO0lBQ2YsQ0FBQztJQUFDLE9BQU8sS0FBSyxFQUFFLENBQUM7UUFDZixJQUFJLGlCQUFpQixHQUFHLEdBQUcsR0FBRyxFQUFFLENBQUE7UUFFaEMsSUFBSSxpQkFBaUIsQ0FBQyxNQUFNLElBQUksSUFBSSxFQUFFLENBQUM7WUFDckMsaUJBQWlCLEdBQUcsR0FBRyxpQkFBaUIsQ0FBQyxTQUFTLENBQUMsQ0FBQyxFQUFFLElBQUksQ0FBQyxLQUFLLENBQUE7UUFDbEUsQ0FBQztRQUVELElBQUksS0FBSyxZQUFZLEtBQUssRUFBRSxDQUFDO1lBQzNCLEtBQUssQ0FBQyxPQUFPLElBQUksT0FBTyxpQkFBaUIsRUFBRSxDQUFBO1lBRTNDLE1BQU0sSUFBSSxLQUFLLENBQUMsS0FBSyxDQUFDLE9BQU8sRUFBRSxFQUFDLEtBQUssRUFBRSxLQUFLLEVBQUMsQ0FBQyxDQUFBO1FBQ2hELENBQUM7YUFBTSxDQUFDO1lBQ04sTUFBTSxJQUFJLEtBQUssQ0FBQyxzQkFBc0IsS0FBSyxPQUFPLEdBQUcsRUFBRSxFQUFFLEVBQUMsS0FBSyxFQUFFLEtBQUssRUFBQyxDQUFDLENBQUE7UUFDMUUsQ0FBQztJQUNILENBQUM7QUFDSCxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbi8qKlxuICogUnVucyBxdWVyeS5cbiAqIEBwYXJhbSB7aW1wb3J0KFwic3FsaXRlXCIpLkRhdGFiYXNlfSBjb25uZWN0aW9uIC0gQ29ubmVjdGlvbi5cbiAqIEBwYXJhbSB7c3RyaW5nfSBzcWwgLSBTUUwgc3RyaW5nLlxuICogQHJldHVybnMge1Byb21pc2U8UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+W10+fSAtIFJlc29sdmVzIHdpdGggc3RyaW5nIHZhbHVlLlxuICovXG5leHBvcnQgZGVmYXVsdCBhc3luYyBmdW5jdGlvbiBxdWVyeShjb25uZWN0aW9uLCBzcWwpIHtcbiAgdHJ5IHtcbiAgICAvKipcbiAgICAgKiBEZWZpbmVzIHJlc3VsdC5cbiAgICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+W119ICovXG4gICAgbGV0IHJlc3VsdFxuXG4gICAgcmVzdWx0ID0gYXdhaXQgY29ubmVjdGlvbi5hbGwoc3FsKVxuXG4gICAgcmV0dXJuIHJlc3VsdFxuICB9IGNhdGNoIChlcnJvcikge1xuICAgIGxldCBzcWxJbkVycm9yTWVzc2FnZSA9IGAke3NxbH1gXG5cbiAgICBpZiAoc3FsSW5FcnJvck1lc3NhZ2UubGVuZ3RoID49IDQwOTYpIHtcbiAgICAgIHNxbEluRXJyb3JNZXNzYWdlID0gYCR7c3FsSW5FcnJvck1lc3NhZ2Uuc3Vic3RyaW5nKDAsIDQwOTYpfS4uLmBcbiAgICB9XG5cbiAgICBpZiAoZXJyb3IgaW5zdGFuY2VvZiBFcnJvcikge1xuICAgICAgZXJyb3IubWVzc2FnZSArPSBgXFxuXFxuJHtzcWxJbkVycm9yTWVzc2FnZX1gXG5cbiAgICAgIHRocm93IG5ldyBFcnJvcihlcnJvci5tZXNzYWdlLCB7Y2F1c2U6IGVycm9yfSlcbiAgICB9IGVsc2Uge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBBbiBlcnJvciBvY2N1cnJlZDogJHtlcnJvcn1cXG5cXG4ke3NxbH1gLCB7Y2F1c2U6IGVycm9yfSlcbiAgICB9XG4gIH1cbn1cbiJdfQ==