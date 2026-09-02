// @ts-check
import BaseColumn from "../base-column.js";
import { digg } from "diggerize";
export default class VelociousDatabaseDriversPgsqlColumn extends BaseColumn {
    /**
     * Runs constructor.
     * @param {import("../base-table.js").default} table - Table.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} data - Data payload.
     */
    constructor(table, data) {
        super();
        this.data = data;
        this.table = table;
    }
    getAutoIncrement() {
        return this.getDefault() == `nextval('${this.getTable().getName()}_${this.getName()}_seq'::regclass)`;
    }
    getPrimaryKey() {
        return digg(this, "data", "is_primary_key") === 1;
    }
    async getIndexes() {
        const indexes = await this.getTable().getIndexes();
        return indexes.filter((index) => index.getColumnNames().includes(this.getName()));
    }
    getDefault() {
        return digg(this, "data", "column_default");
    }
    getMaxLength() {
        return digg(this, "data", "character_maximum_length");
    }
    getName() {
        return digg(this, "data", "column_name");
    }
    getNotes() {
        return digg(this, "data", "column_comment") || undefined;
    }
    getNull() {
        const nullValue = digg(this, "data", "is_nullable");
        if (nullValue == "NO") {
            return false;
        }
        else {
            return true;
        }
    }
    getType() {
        const typeHint = this.getTypeHintFromNotes();
        if (typeHint == "boolean")
            return "boolean";
        return digg(this, "data", "data_type");
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY29sdW1uLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vLi4vc3JjL2RhdGFiYXNlL2RyaXZlcnMvcGdzcWwvY29sdW1uLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLFVBQVUsTUFBTSxtQkFBbUIsQ0FBQTtBQUMxQyxPQUFPLEVBQUMsSUFBSSxFQUFDLE1BQU0sV0FBVyxDQUFBO0FBRTlCLE1BQU0sQ0FBQyxPQUFPLE9BQU8sbUNBQW9DLFNBQVEsVUFBVTtJQUN6RTs7OztPQUlHO0lBQ0gsWUFBWSxLQUFLLEVBQUUsSUFBSTtRQUNyQixLQUFLLEVBQUUsQ0FBQTtRQUNQLElBQUksQ0FBQyxJQUFJLEdBQUcsSUFBSSxDQUFBO1FBQ2hCLElBQUksQ0FBQyxLQUFLLEdBQUcsS0FBSyxDQUFBO0lBQ3BCLENBQUM7SUFFRCxnQkFBZ0I7UUFDZCxPQUFPLElBQUksQ0FBQyxVQUFVLEVBQUUsSUFBSSxZQUFZLElBQUksQ0FBQyxRQUFRLEVBQUUsQ0FBQyxPQUFPLEVBQUUsSUFBSSxJQUFJLENBQUMsT0FBTyxFQUFFLGtCQUFrQixDQUFBO0lBQ3ZHLENBQUM7SUFFRCxhQUFhO1FBQ1gsT0FBTyxJQUFJLENBQUMsSUFBSSxFQUFFLE1BQU0sRUFBRSxnQkFBZ0IsQ0FBQyxLQUFLLENBQUMsQ0FBQTtJQUNuRCxDQUFDO0lBRUQsS0FBSyxDQUFDLFVBQVU7UUFDZCxNQUFNLE9BQU8sR0FBRyxNQUFNLElBQUksQ0FBQyxRQUFRLEVBQUUsQ0FBQyxVQUFVLEVBQUUsQ0FBQTtRQUVsRCxPQUFPLE9BQU8sQ0FBQyxNQUFNLENBQUMsQ0FBQyxLQUFLLEVBQUUsRUFBRSxDQUFDLEtBQUssQ0FBQyxjQUFjLEVBQUUsQ0FBQyxRQUFRLENBQUMsSUFBSSxDQUFDLE9BQU8sRUFBRSxDQUFDLENBQUMsQ0FBQTtJQUNuRixDQUFDO0lBRUQsVUFBVTtRQUNSLE9BQU8sSUFBSSxDQUFDLElBQUksRUFBRSxNQUFNLEVBQUUsZ0JBQWdCLENBQUMsQ0FBQTtJQUM3QyxDQUFDO0lBRUQsWUFBWTtRQUNWLE9BQU8sSUFBSSxDQUFDLElBQUksRUFBRSxNQUFNLEVBQUUsMEJBQTBCLENBQUMsQ0FBQTtJQUN2RCxDQUFDO0lBRUQsT0FBTztRQUNMLE9BQU8sSUFBSSxDQUFDLElBQUksRUFBRSxNQUFNLEVBQUUsYUFBYSxDQUFDLENBQUE7SUFDMUMsQ0FBQztJQUVELFFBQVE7UUFDTixPQUFPLElBQUksQ0FBQyxJQUFJLEVBQUUsTUFBTSxFQUFFLGdCQUFnQixDQUFDLElBQUksU0FBUyxDQUFBO0lBQzFELENBQUM7SUFFRCxPQUFPO1FBQ0wsTUFBTSxTQUFTLEdBQUcsSUFBSSxDQUFDLElBQUksRUFBRSxNQUFNLEVBQUUsYUFBYSxDQUFDLENBQUE7UUFFbkQsSUFBSSxTQUFTLElBQUksSUFBSSxFQUFFLENBQUM7WUFDdEIsT0FBTyxLQUFLLENBQUE7UUFDZCxDQUFDO2FBQU0sQ0FBQztZQUNOLE9BQU8sSUFBSSxDQUFBO1FBQ2IsQ0FBQztJQUNILENBQUM7SUFFRCxPQUFPO1FBQ0wsTUFBTSxRQUFRLEdBQUcsSUFBSSxDQUFDLG9CQUFvQixFQUFFLENBQUE7UUFFNUMsSUFBSSxRQUFRLElBQUksU0FBUztZQUFFLE9BQU8sU0FBUyxDQUFBO1FBRTNDLE9BQU8sSUFBSSxDQUFDLElBQUksRUFBRSxNQUFNLEVBQUUsV0FBVyxDQUFDLENBQUE7SUFDeEMsQ0FBQztDQUNGIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbmltcG9ydCBCYXNlQ29sdW1uIGZyb20gXCIuLi9iYXNlLWNvbHVtbi5qc1wiXG5pbXBvcnQge2RpZ2d9IGZyb20gXCJkaWdnZXJpemVcIlxuXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBWZWxvY2lvdXNEYXRhYmFzZURyaXZlcnNQZ3NxbENvbHVtbiBleHRlbmRzIEJhc2VDb2x1bW4ge1xuICAvKipcbiAgICogUnVucyBjb25zdHJ1Y3Rvci5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9iYXNlLXRhYmxlLmpzXCIpLmRlZmF1bHR9IHRhYmxlIC0gVGFibGUuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBkYXRhIC0gRGF0YSBwYXlsb2FkLlxuICAgKi9cbiAgY29uc3RydWN0b3IodGFibGUsIGRhdGEpIHtcbiAgICBzdXBlcigpXG4gICAgdGhpcy5kYXRhID0gZGF0YVxuICAgIHRoaXMudGFibGUgPSB0YWJsZVxuICB9XG5cbiAgZ2V0QXV0b0luY3JlbWVudCgpIHtcbiAgICByZXR1cm4gdGhpcy5nZXREZWZhdWx0KCkgPT0gYG5leHR2YWwoJyR7dGhpcy5nZXRUYWJsZSgpLmdldE5hbWUoKX1fJHt0aGlzLmdldE5hbWUoKX1fc2VxJzo6cmVnY2xhc3MpYFxuICB9XG5cbiAgZ2V0UHJpbWFyeUtleSgpIHtcbiAgICByZXR1cm4gZGlnZyh0aGlzLCBcImRhdGFcIiwgXCJpc19wcmltYXJ5X2tleVwiKSA9PT0gMVxuICB9XG5cbiAgYXN5bmMgZ2V0SW5kZXhlcygpIHtcbiAgICBjb25zdCBpbmRleGVzID0gYXdhaXQgdGhpcy5nZXRUYWJsZSgpLmdldEluZGV4ZXMoKVxuXG4gICAgcmV0dXJuIGluZGV4ZXMuZmlsdGVyKChpbmRleCkgPT4gaW5kZXguZ2V0Q29sdW1uTmFtZXMoKS5pbmNsdWRlcyh0aGlzLmdldE5hbWUoKSkpXG4gIH1cblxuICBnZXREZWZhdWx0KCkge1xuICAgIHJldHVybiBkaWdnKHRoaXMsIFwiZGF0YVwiLCBcImNvbHVtbl9kZWZhdWx0XCIpXG4gIH1cblxuICBnZXRNYXhMZW5ndGgoKSB7XG4gICAgcmV0dXJuIGRpZ2codGhpcywgXCJkYXRhXCIsIFwiY2hhcmFjdGVyX21heGltdW1fbGVuZ3RoXCIpXG4gIH1cblxuICBnZXROYW1lKCkge1xuICAgIHJldHVybiBkaWdnKHRoaXMsIFwiZGF0YVwiLCBcImNvbHVtbl9uYW1lXCIpXG4gIH1cblxuICBnZXROb3RlcygpIHtcbiAgICByZXR1cm4gZGlnZyh0aGlzLCBcImRhdGFcIiwgXCJjb2x1bW5fY29tbWVudFwiKSB8fCB1bmRlZmluZWRcbiAgfVxuXG4gIGdldE51bGwoKSB7XG4gICAgY29uc3QgbnVsbFZhbHVlID0gZGlnZyh0aGlzLCBcImRhdGFcIiwgXCJpc19udWxsYWJsZVwiKVxuXG4gICAgaWYgKG51bGxWYWx1ZSA9PSBcIk5PXCIpIHtcbiAgICAgIHJldHVybiBmYWxzZVxuICAgIH0gZWxzZSB7XG4gICAgICByZXR1cm4gdHJ1ZVxuICAgIH1cbiAgfVxuXG4gIGdldFR5cGUoKSB7XG4gICAgY29uc3QgdHlwZUhpbnQgPSB0aGlzLmdldFR5cGVIaW50RnJvbU5vdGVzKClcblxuICAgIGlmICh0eXBlSGludCA9PSBcImJvb2xlYW5cIikgcmV0dXJuIFwiYm9vbGVhblwiXG5cbiAgICByZXR1cm4gZGlnZyh0aGlzLCBcImRhdGFcIiwgXCJkYXRhX3R5cGVcIilcbiAgfVxufVxuIl19