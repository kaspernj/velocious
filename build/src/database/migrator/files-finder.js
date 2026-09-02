// @ts-check
import fs from "fs/promises";
import * as inflection from "inflection";
import restArgsError from "../../utils/rest-args-error.js";
export default class VelociousDatabaseMigratorFilesFinder {
    /**
     * Runs constructor.
     * @param {object} args - Options object.
     * @param {string} args.path - Path.
     */
    constructor({ path, ...restArgs }) {
        restArgsError(restArgs);
        if (!path)
            throw new Error("No path given");
        this.path = path;
    }
    /**
     * Runs find files.
     * @returns {Promise<Array<import("./types.js").MigrationObjectType>>} - Resolves with the files.
     */
    async findFiles() {
        let files = await fs.readdir(this.path);
        /**
         * Result.
         * @type {import("./types.js").MigrationObjectType[]} */
        let result = [];
        for (const file of files) {
            const match = file.match(/^(\d{14})-(.+)\.js$/);
            if (!match)
                continue;
            const date = parseInt(match[1]);
            const migrationName = match[2];
            const migrationClassName = inflection.camelize(migrationName.replaceAll("-", "_"));
            result.push({
                file,
                fullPath: `${this.path}/${file}`,
                date,
                migrationClassName
            });
        }
        result = result.sort((migration1, migration2) => migration1.date - migration2.date);
        return result;
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZmlsZXMtZmluZGVyLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vc3JjL2RhdGFiYXNlL21pZ3JhdG9yL2ZpbGVzLWZpbmRlci5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxZQUFZO0FBRVosT0FBTyxFQUFFLE1BQU0sYUFBYSxDQUFBO0FBQzVCLE9BQU8sS0FBSyxVQUFVLE1BQU0sWUFBWSxDQUFBO0FBRXhDLE9BQU8sYUFBYSxNQUFNLGdDQUFnQyxDQUFBO0FBRTFELE1BQU0sQ0FBQyxPQUFPLE9BQU8sb0NBQW9DO0lBQ3ZEOzs7O09BSUc7SUFDSCxZQUFZLEVBQUMsSUFBSSxFQUFFLEdBQUcsUUFBUSxFQUFDO1FBQzdCLGFBQWEsQ0FBQyxRQUFRLENBQUMsQ0FBQTtRQUV2QixJQUFJLENBQUMsSUFBSTtZQUFFLE1BQU0sSUFBSSxLQUFLLENBQUMsZUFBZSxDQUFDLENBQUE7UUFFM0MsSUFBSSxDQUFDLElBQUksR0FBRyxJQUFJLENBQUE7SUFDbEIsQ0FBQztJQUVEOzs7T0FHRztJQUNILEtBQUssQ0FBQyxTQUFTO1FBQ2IsSUFBSSxLQUFLLEdBQUcsTUFBTSxFQUFFLENBQUMsT0FBTyxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsQ0FBQTtRQUV2Qzs7Z0VBRXdEO1FBQ3hELElBQUksTUFBTSxHQUFHLEVBQUUsQ0FBQTtRQUVmLEtBQUssTUFBTSxJQUFJLElBQUksS0FBSyxFQUFFLENBQUM7WUFDekIsTUFBTSxLQUFLLEdBQUcsSUFBSSxDQUFDLEtBQUssQ0FBQyxxQkFBcUIsQ0FBQyxDQUFBO1lBRS9DLElBQUksQ0FBQyxLQUFLO2dCQUFFLFNBQVE7WUFFcEIsTUFBTSxJQUFJLEdBQUcsUUFBUSxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFBO1lBQy9CLE1BQU0sYUFBYSxHQUFHLEtBQUssQ0FBQyxDQUFDLENBQUMsQ0FBQTtZQUM5QixNQUFNLGtCQUFrQixHQUFHLFVBQVUsQ0FBQyxRQUFRLENBQUMsYUFBYSxDQUFDLFVBQVUsQ0FBQyxHQUFHLEVBQUUsR0FBRyxDQUFDLENBQUMsQ0FBQTtZQUVsRixNQUFNLENBQUMsSUFBSSxDQUFDO2dCQUNWLElBQUk7Z0JBQ0osUUFBUSxFQUFFLEdBQUcsSUFBSSxDQUFDLElBQUksSUFBSSxJQUFJLEVBQUU7Z0JBQ2hDLElBQUk7Z0JBQ0osa0JBQWtCO2FBQ25CLENBQUMsQ0FBQTtRQUNKLENBQUM7UUFFRCxNQUFNLEdBQUcsTUFBTSxDQUFDLElBQUksQ0FBQyxDQUFDLFVBQVUsRUFBRSxVQUFVLEVBQUUsRUFBRSxDQUFDLFVBQVUsQ0FBQyxJQUFJLEdBQUcsVUFBVSxDQUFDLElBQUksQ0FBQyxDQUFBO1FBRW5GLE9BQU8sTUFBTSxDQUFBO0lBQ2YsQ0FBQztDQUNGIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbmltcG9ydCBmcyBmcm9tIFwiZnMvcHJvbWlzZXNcIlxuaW1wb3J0ICogYXMgaW5mbGVjdGlvbiBmcm9tIFwiaW5mbGVjdGlvblwiXG5cbmltcG9ydCByZXN0QXJnc0Vycm9yIGZyb20gXCIuLi8uLi91dGlscy9yZXN0LWFyZ3MtZXJyb3IuanNcIlxuXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBWZWxvY2lvdXNEYXRhYmFzZU1pZ3JhdG9yRmlsZXNGaW5kZXIge1xuICAvKipcbiAgICogUnVucyBjb25zdHJ1Y3Rvci5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MucGF0aCAtIFBhdGguXG4gICAqL1xuICBjb25zdHJ1Y3Rvcih7cGF0aCwgLi4ucmVzdEFyZ3N9KSB7XG4gICAgcmVzdEFyZ3NFcnJvcihyZXN0QXJncylcblxuICAgIGlmICghcGF0aCkgdGhyb3cgbmV3IEVycm9yKFwiTm8gcGF0aCBnaXZlblwiKVxuXG4gICAgdGhpcy5wYXRoID0gcGF0aFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZmluZCBmaWxlcy5cbiAgICogQHJldHVybnMge1Byb21pc2U8QXJyYXk8aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5NaWdyYXRpb25PYmplY3RUeXBlPj59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgZmlsZXMuXG4gICAqL1xuICBhc3luYyBmaW5kRmlsZXMoKSB7XG4gICAgbGV0IGZpbGVzID0gYXdhaXQgZnMucmVhZGRpcih0aGlzLnBhdGgpXG5cbiAgICAvKipcbiAgICAgKiBSZXN1bHQuXG4gICAgICogQHR5cGUge2ltcG9ydChcIi4vdHlwZXMuanNcIikuTWlncmF0aW9uT2JqZWN0VHlwZVtdfSAqL1xuICAgIGxldCByZXN1bHQgPSBbXVxuXG4gICAgZm9yIChjb25zdCBmaWxlIG9mIGZpbGVzKSB7XG4gICAgICBjb25zdCBtYXRjaCA9IGZpbGUubWF0Y2goL14oXFxkezE0fSktKC4rKVxcLmpzJC8pXG5cbiAgICAgIGlmICghbWF0Y2gpIGNvbnRpbnVlXG5cbiAgICAgIGNvbnN0IGRhdGUgPSBwYXJzZUludChtYXRjaFsxXSlcbiAgICAgIGNvbnN0IG1pZ3JhdGlvbk5hbWUgPSBtYXRjaFsyXVxuICAgICAgY29uc3QgbWlncmF0aW9uQ2xhc3NOYW1lID0gaW5mbGVjdGlvbi5jYW1lbGl6ZShtaWdyYXRpb25OYW1lLnJlcGxhY2VBbGwoXCItXCIsIFwiX1wiKSlcblxuICAgICAgcmVzdWx0LnB1c2goe1xuICAgICAgICBmaWxlLFxuICAgICAgICBmdWxsUGF0aDogYCR7dGhpcy5wYXRofS8ke2ZpbGV9YCxcbiAgICAgICAgZGF0ZSxcbiAgICAgICAgbWlncmF0aW9uQ2xhc3NOYW1lXG4gICAgICB9KVxuICAgIH1cblxuICAgIHJlc3VsdCA9IHJlc3VsdC5zb3J0KChtaWdyYXRpb24xLCBtaWdyYXRpb24yKSA9PiBtaWdyYXRpb24xLmRhdGUgLSBtaWdyYXRpb24yLmRhdGUpXG5cbiAgICByZXR1cm4gcmVzdWx0XG4gIH1cbn1cbiJdfQ==