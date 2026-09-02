// @ts-check
import JoinBase from "./join-base.js";
import WhereHash from "./where-hash.js";
import WhereNot from "./where-not.js";
/**
 * VelociousDatabaseQueryJoinObject class.
 * @typedef {{[key: string]: boolean | string | string[] | JoinObjectInput}} JoinObjectInput
 * @typedef {{[key: string]: boolean | JoinObject}} JoinObject
 */
export default class VelociousDatabaseQueryJoinObject extends JoinBase {
    /**
     * Runs constructor.
     * @param {JoinObject} object - Object.
     * @param {string[]} [basePath] - Join base path relative to the root query.
     */
    constructor(object, basePath = []) {
        super();
        this.object = object;
        this.basePath = basePath;
    }
    toSql() {
        const query = this.getQuery();
        if (query.constructor.name != "VelociousDatabaseQueryModelClassQuery") {
            throw new Error(`Query has to be a ModelClassQuery but was a ${query.constructor.name}`);
        }
        const modelQuery = /** @type {import("./model-class-query.js").default} */ (query);
        const ModelClass = /** @type {typeof import("../record/index.js").default} */ (this.basePath.length > 0 ? modelQuery._resolveModelClassForJoinPath(this.basePath) : modelQuery.modelClass);
        return this.joinObject(this.object, ModelClass, "", 0, modelQuery.getJoinBasePath().concat(this.basePath));
    }
    /**
     * Runs join object.
     * @param {JoinObject} join - Join.
     * @param {typeof import("../record/index.js").default} modelClass - Model class.
     * @param {string} sql - SQL string.
     * @param {number} joinsCount - Joins count.
     * @param {string[]} path - Join path.
     * @returns {string} - The join object.
     */
    joinObject(join, modelClass, sql, joinsCount, path) {
        const pretty = this.pretty;
        const conn = this.getQuery().driver;
        const query = /** @type {import("./model-class-query.js").default} */ (this.getQuery());
        for (const joinKey in join) {
            const joinValue = join[joinKey];
            const relationship = modelClass.getRelationshipByName(joinKey);
            const rawTargetModelClass = relationship.getTargetModelClass();
            if (!rawTargetModelClass) {
                throw new Error(`Relationship ${modelClass.name}#${joinKey} has no target model class`);
            }
            const targetModelClass = query.bindModelClass(rawTargetModelClass);
            const foreignKey = relationship.getForeignKeyForModelClasses({ modelClass, targetModelClass });
            const joinPath = path.concat([joinKey]);
            const parentTableRef = query.getJoinTableReference(path);
            const targetEntry = query._registerJoinPath(joinPath);
            const targetTableRef = targetEntry.alias || targetEntry.tableName;
            const joinTableSql = targetEntry.alias
                ? `${conn.quoteTable(targetEntry.tableName)} AS ${conn.quoteTable(targetEntry.alias)}`
                : conn.quoteTable(targetEntry.tableName);
            if (joinsCount > 0) {
                if (pretty) {
                    sql += "\n\n";
                }
                else {
                    sql += " ";
                }
            }
            sql += `LEFT JOIN ${joinTableSql} ON `;
            if (relationship.getType() == "belongsTo") {
                sql += `${conn.quoteTable(targetTableRef)}.${conn.quoteColumn(relationship.getPrimaryKey())} = `;
                sql += `${conn.quoteTable(parentTableRef)}.${conn.quoteColumn(foreignKey)}`;
            }
            else if (relationship.getType() == "hasMany" || relationship.getType() == "hasOne") {
                sql += `${conn.quoteTable(targetTableRef)}.${conn.quoteColumn(foreignKey)} = `;
                sql += `${conn.quoteTable(parentTableRef)}.${conn.quoteColumn(relationship.getPrimaryKey())}`;
            }
            else {
                throw new Error(`Unknown relationship type: ${relationship.getType()}`);
            }
            const scopeSql = this._scopeSql({ relationship, query, targetModelClass, joinPath, targetTableRef });
            if (scopeSql) {
                sql += ` AND ${scopeSql}`;
            }
            if (typeof joinValue == "object") {
                sql = this.joinObject(joinValue, targetModelClass, sql, joinsCount + 1, joinPath);
            }
        }
        return sql;
    }
    /**
     * Runs scope sql.
     * @param {object} args - Options object.
     * @param {import("../record/relationships/base.js").default} args.relationship - Relationship definition.
     * @param {import("./model-class-query.js").default} args.query - Model class query.
     * @param {typeof import("../record/index.js").default} args.targetModelClass - Target model class.
     * @param {string[]} args.joinPath - Join path.
     * @param {string} args.targetTableRef - Target table reference.
     * @returns {string} - Scope SQL.
     */
    _scopeSql({ relationship, query, targetModelClass, joinPath, targetTableRef }) {
        if (!relationship.getScope())
            return "";
        const scopedQuery = query.buildJoinScopeQuery(targetModelClass, joinPath);
        const appliedQuery = relationship.applyScope(scopedQuery) || scopedQuery;
        const wheres = appliedQuery._wheres;
        if (!wheres || wheres.length === 0)
            return "";
        const parts = [];
        for (const where of wheres) {
            parts.push(this._scopeSqlForWhere(where, targetTableRef));
        }
        return parts.join(" AND ");
    }
    /**
     * Runs scope sql for where.
     * @param {import("./where-base.js").default} where - Where.
     * @param {string} targetTableRef - Target table reference.
     * @returns {string} - Scope where SQL.
     */
    _scopeSqlForWhere(where, targetTableRef) {
        if (where instanceof WhereHash) {
            const hash = where.hash;
            const hasNested = Object.values(hash).some((value) => value !== null && typeof value === "object" && !Array.isArray(value));
            return hasNested
                ? where.toSql()
                : `(${where._whereSQLFromHash(hash, targetTableRef)})`;
        }
        if (where instanceof WhereNot && where.where instanceof WhereHash) {
            const hash = where.where.hash;
            const hasNested = Object.values(hash).some((value) => value !== null && typeof value === "object" && !Array.isArray(value));
            const innerSql = hasNested
                ? where.where.toSql()
                : `(${where.where._whereSQLFromHash(hash, targetTableRef)})`;
            return `NOT (${innerSql})`;
        }
        return where.toSql();
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiam9pbi1vYmplY3QuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvZGF0YWJhc2UvcXVlcnkvam9pbi1vYmplY3QuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLE9BQU8sUUFBUSxNQUFNLGdCQUFnQixDQUFBO0FBQ3JDLE9BQU8sU0FBUyxNQUFNLGlCQUFpQixDQUFBO0FBQ3ZDLE9BQU8sUUFBUSxNQUFNLGdCQUFnQixDQUFBO0FBRXJDOzs7O0dBSUc7QUFFSCxNQUFNLENBQUMsT0FBTyxPQUFPLGdDQUFpQyxTQUFRLFFBQVE7SUFDcEU7Ozs7T0FJRztJQUNILFlBQVksTUFBTSxFQUFFLFFBQVEsR0FBRyxFQUFFO1FBQy9CLEtBQUssRUFBRSxDQUFBO1FBQ1AsSUFBSSxDQUFDLE1BQU0sR0FBRyxNQUFNLENBQUE7UUFDcEIsSUFBSSxDQUFDLFFBQVEsR0FBRyxRQUFRLENBQUE7SUFDMUIsQ0FBQztJQUVELEtBQUs7UUFDSCxNQUFNLEtBQUssR0FBRyxJQUFJLENBQUMsUUFBUSxFQUFFLENBQUE7UUFFN0IsSUFBSSxLQUFLLENBQUMsV0FBVyxDQUFDLElBQUksSUFBSSx1Q0FBdUMsRUFBRSxDQUFDO1lBQ3RFLE1BQU0sSUFBSSxLQUFLLENBQUMsK0NBQStDLEtBQUssQ0FBQyxXQUFXLENBQUMsSUFBSSxFQUFFLENBQUMsQ0FBQTtRQUMxRixDQUFDO1FBRUQsTUFBTSxVQUFVLEdBQUcsdURBQXVELENBQUMsQ0FBQyxLQUFLLENBQUMsQ0FBQTtRQUNsRixNQUFNLFVBQVUsR0FBRywwREFBMEQsQ0FBQyxDQUM1RSxJQUFJLENBQUMsUUFBUSxDQUFDLE1BQU0sR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDLFVBQVUsQ0FBQyw2QkFBNkIsQ0FBQyxJQUFJLENBQUMsUUFBUSxDQUFDLENBQUMsQ0FBQyxDQUFDLFVBQVUsQ0FBQyxVQUFVLENBQzNHLENBQUE7UUFFRCxPQUFPLElBQUksQ0FBQyxVQUFVLENB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QUFDLEtBQUssWUFBWSxTQUFTLEVBQUUsQ0FBQztZQUNsRSxNQUFNLElBQUksR0FBRyxLQUFLLENBQUMsS0FBSyxDQUFDLElBQUksQ0FBQTtZQUM3QixNQUFNLFNBQVMsR0FBRyxNQUFNLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDLEtBQUssRUFBRSxFQUFFLENBQUMsS0FBSyxLQUFLLElBQUksSUFBSSxPQUFPLEtBQUssS0FBSyxRQUFRLElBQUksQ0FBQyxLQUFLLENBQUMsT0FBTyxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUE7WUFDM0gsTUFBTSxRQUFRLEdBQUcsU0FBUztnQkFDeEIsQ0FBQyxDQUFDLEtBQUssQ0FBQyxLQUFLLENBQUMsS0FBSyxFQUFFO2dCQUNyQixDQUFDLENBQUMsSUFBSSxLQUFLLENBQUMsS0FBSyxDQUFDLGlCQUFpQixDQUFDLElBQUksRUFBRSxjQUFjLENBQUMsR0FBRyxDQUFBO1lBRTlELE9BQU8sUUFBUSxRQUFRLEdBQUcsQ0FBQTtRQUM1QixDQUFDO1FBRUQsT0FBTyxLQUFLLENBQUMsS0FBSyxFQUFFLENBQUE7SUFDdEIsQ0FBQztDQUNGIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbmltcG9ydCBKb2luQmFzZSBmcm9tIFwiLi9qb2luLWJhc2UuanNcIlxuaW1wb3J0IFdoZXJlSGFzaCBmcm9tIFwiLi93aGVyZS1oYXNoLmpzXCJcbmltcG9ydCBXaGVyZU5vdCBmcm9tIFwiLi93aGVyZS1ub3QuanNcIlxuXG4vKipcbiAqIFZlbG9jaW91c0RhdGFiYXNlUXVlcnlKb2luT2JqZWN0IGNsYXNzLlxuICogQHR5cGVkZWYge3tba2V5OiBzdHJpbmddOiBib29sZWFuIHwgc3RyaW5nIHwgc3RyaW5nW10gfCBKb2luT2JqZWN0SW5wdXR9fSBKb2luT2JqZWN0SW5wdXRcbiAqIEB0eXBlZGVmIHt7W2tleTogc3RyaW5nXTogYm9vbGVhbiB8IEpvaW5PYmplY3R9fSBKb2luT2JqZWN0XG4gKi9cblxuZXhwb3J0IGRlZmF1bHQgY2xhc3MgVmVsb2Npb3VzRGF0YWJhc2VRdWVyeUpvaW5PYmplY3QgZXh0ZW5kcyBKb2luQmFzZSB7XG4gIC8qKlxuICAgKiBSdW5zIGNvbnN0cnVjdG9yLlxuICAgKiBAcGFyYW0ge0pvaW5PYmplY3R9IG9iamVjdCAtIE9iamVjdC5cbiAgICogQHBhcmFtIHtzdHJpbmdbXX0gW2Jhc2VQYXRoXSAtIEpvaW4gYmFzZSBwYXRoIHJlbGF0aXZlIHRvIHRoZSByb290IHF1ZXJ5LlxuICAgKi9cbiAgY29uc3RydWN0b3Iob2JqZWN0LCBiYXNlUGF0aCA9IFtdKSB7XG4gICAgc3VwZXIoKVxuICAgIHRoaXMub2JqZWN0ID0gb2JqZWN0XG4gICAgdGhpcy5iYXNlUGF0aCA9IGJhc2VQYXRoXG4gIH1cblxuICB0b1NxbCgpIHtcbiAgICBjb25zdCBxdWVyeSA9IHRoaXMuZ2V0UXVlcnkoKVxuXG4gICAgaWYgKHF1ZXJ5LmNvbnN0cnVjdG9yLm5hbWUgIT0gXCJWZWxvY2lvdXNEYXRhYmFzZVF1ZXJ5TW9kZWxDbGFzc1F1ZXJ5XCIpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgUXVlcnkgaGFzIHRvIGJlIGEgTW9kZWxDbGFzc1F1ZXJ5IGJ1dCB3YXMgYSAke3F1ZXJ5LmNvbnN0cnVjdG9yLm5hbWV9YClcbiAgICB9XG5cbiAgICBjb25zdCBtb2RlbFF1ZXJ5ID0gLyoqIEB0eXBlIHtpbXBvcnQoXCIuL21vZGVsLWNsYXNzLXF1ZXJ5LmpzXCIpLmRlZmF1bHR9ICovIChxdWVyeSlcbiAgICBjb25zdCBNb2RlbENsYXNzID0gLyoqIEB0eXBlIHt0eXBlb2YgaW1wb3J0KFwiLi4vcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9ICovIChcbiAgICAgIHRoaXMuYmFzZVBhdGgubGVuZ3RoID4gMCA/IG1vZGVsUXVlcnkuX3Jlc29sdmVNb2RlbENsYXNzRm9ySm9pblBhdGgodGhpcy5iYXNlUGF0aCkgOiBtb2RlbFF1ZXJ5Lm1vZGVsQ2xhc3NcbiAgICApXG5cbiAgICByZXR1cm4gdGhpcy5qb2luT2JqZWN0KHRoaXMub2JqZWN0LCBNb2RlbENsYXNzLCBcIlwiLCAwLCBtb2RlbFF1ZXJ5LmdldEpvaW5CYXNlUGF0aCgpLmNvbmNhdCh0aGlzLmJhc2VQYXRoKSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGpvaW4gb2JqZWN0LlxuICAgKiBAcGFyYW0ge0pvaW5PYmplY3R9IGpvaW4gLSBKb2luLlxuICAgKiBAcGFyYW0ge3R5cGVvZiBpbXBvcnQoXCIuLi9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gbW9kZWxDbGFzcyAtIE1vZGVsIGNsYXNzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gc3FsIC0gU1FMIHN0cmluZy5cbiAgICogQHBhcmFtIHtudW1iZXJ9IGpvaW5zQ291bnQgLSBKb2lucyBjb3VudC5cbiAgICogQHBhcmFtIHtzdHJpbmdbXX0gcGF0aCAtIEpvaW4gcGF0aC5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBUaGUgam9pbiBvYmplY3QuXG4gICAqL1xuICBqb2luT2JqZWN0KGpvaW4sIG1vZGVsQ2xhc3MsIHNxbCwgam9pbnNDb3VudCwgcGF0aCkge1xuICAgIGNvbnN0IHByZXR0eSA9IHRoaXMucHJldHR5XG4gICAgY29uc3QgY29ubiA9IHRoaXMuZ2V0UXVlcnkoKS5kcml2ZXJcbiAgICBjb25zdCBxdWVyeSA9IC8qKiBAdHlwZSB7aW1wb3J0KFwiLi9tb2RlbC1jbGFzcy1xdWVyeS5qc1wiKS5kZWZhdWx0fSAqLyAodGhpcy5nZXRRdWVyeSgpKVxuXG4gICAgZm9yIChjb25zdCBqb2luS2V5IGluIGpvaW4pIHtcbiAgICAgIGNvbnN0IGpvaW5WYWx1ZSA9IGpvaW5bam9pbktleV1cbiAgICAgIGNvbnN0IHJlbGF0aW9uc2hpcCA9IG1vZGVsQ2xhc3MuZ2V0UmVsYXRpb25zaGlwQnlOYW1lKGpvaW5LZXkpXG4gICAgICBjb25zdCByYXdUYXJnZXRNb2RlbENsYXNzID0gcmVsYXRpb25zaGlwLmdldFRhcmdldE1vZGVsQ2xhc3MoKVxuXG4gICAgICBpZiAoIXJhd1RhcmdldE1vZGVsQ2xhc3MpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBSZWxhdGlvbnNoaXAgJHttb2RlbENsYXNzLm5hbWV9IyR7am9pbktleX0gaGFzIG5vIHRhcmdldCBtb2RlbCBjbGFzc2ApXG4gICAgICB9XG5cbiAgICAgIGNvbnN0IHRhcmdldE1vZGVsQ2xhc3MgPSBxdWVyeS5iaW5kTW9kZWxDbGFzcyhyYXdUYXJnZXRNb2RlbENsYXNzKVxuICAgICAgY29uc3QgZm9yZWlnbktleSA9IHJlbGF0aW9uc2hpcC5nZXRGb3JlaWduS2V5Rm9yTW9kZWxDbGFzc2VzKHttb2RlbENsYXNzLCB0YXJnZXRNb2RlbENsYXNzfSlcblxuICAgICAgY29uc3Qgam9pblBhdGggPSBwYXRoLmNvbmNhdChbam9pbktleV0pXG4gICAgICBjb25zdCBwYXJlbnRUYWJsZVJlZiA9IHF1ZXJ5LmdldEpvaW5UYWJsZVJlZmVyZW5jZShwYXRoKVxuICAgICAgY29uc3QgdGFyZ2V0RW50cnkgPSBxdWVyeS5fcmVnaXN0ZXJKb2luUGF0aChqb2luUGF0aClcbiAgICAgIGNvbnN0IHRhcmdldFRhYmxlUmVmID0gdGFyZ2V0RW50cnkuYWxpYXMgfHwgdGFyZ2V0RW50cnkudGFibGVOYW1lXG4gICAgICBjb25zdCBqb2luVGFibGVTcWwgPSB0YXJnZXRFbnRyeS5hbGlhc1xuICAgICAgICA/IGAke2Nvbm4ucXVvdGVUYWJsZSh0YXJnZXRFbnRyeS50YWJsZU5hbWUpfSBBUyAke2Nvbm4ucXVvdGVUYWJsZSh0YXJnZXRFbnRyeS5hbGlhcyl9YFxuICAgICAgICA6IGNvbm4ucXVvdGVUYWJsZSh0YXJnZXRFbnRyeS50YWJsZU5hbWUpXG5cbiAgICAgIGlmIChqb2luc0NvdW50ID4gMCkge1xuICAgICAgICBpZiAocHJldHR5KSB7XG4gICAgICAgICAgc3FsICs9IFwiXFxuXFxuXCJcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBzcWwgKz0gXCIgXCJcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICBzcWwgKz0gYExFRlQgSk9JTiAke2pvaW5UYWJsZVNxbH0gT04gYFxuXG4gICAgICBpZiAocmVsYXRpb25zaGlwLmdldFR5cGUoKSA9PSBcImJlbG9uZ3NUb1wiKSB7XG4gICAgICAgIHNxbCArPSBgJHtjb25uLnF1b3RlVGFibGUodGFyZ2V0VGFibGVSZWYpfS4ke2Nvbm4ucXVvdGVDb2x1bW4ocmVsYXRpb25zaGlwLmdldFByaW1hcnlLZXkoKSl9ID0gYFxuICAgICAgICBzcWwgKz0gYCR7Y29ubi5xdW90ZVRhYmxlKHBhcmVudFRhYmxlUmVmKX0uJHtjb25uLnF1b3RlQ29sdW1uKGZvcmVpZ25LZXkpfWBcbiAgICAgIH0gZWxzZSBpZiAocmVsYXRpb25zaGlwLmdldFR5cGUoKSA9PSBcImhhc01hbnlcIiB8fCByZWxhdGlvbnNoaXAuZ2V0VHlwZSgpID09IFwiaGFzT25lXCIpIHtcbiAgICAgICAgc3FsICs9IGAke2Nvbm4ucXVvdGVUYWJsZSh0YXJnZXRUYWJsZVJlZil9LiR7Y29ubi5xdW90ZUNvbHVtbihmb3JlaWduS2V5KX0gPSBgXG4gICAgICAgIHNxbCArPSBgJHtjb25uLnF1b3RlVGFibGUocGFyZW50VGFibGVSZWYpfS4ke2Nvbm4ucXVvdGVDb2x1bW4ocmVsYXRpb25zaGlwLmdldFByaW1hcnlLZXkoKSl9YFxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBVbmtub3duIHJlbGF0aW9uc2hpcCB0eXBlOiAke3JlbGF0aW9uc2hpcC5nZXRUeXBlKCl9YClcbiAgICAgIH1cblxuICAgICAgY29uc3Qgc2NvcGVTcWwgPSB0aGlzLl9zY29wZVNxbCh7cmVsYXRpb25zaGlwLCBxdWVyeSwgdGFyZ2V0TW9kZWxDbGFzcywgam9pblBhdGgsIHRhcmdldFRhYmxlUmVmfSlcblxuICAgICAgaWYgKHNjb3BlU3FsKSB7XG4gICAgICAgIHNxbCArPSBgIEFORCAke3Njb3BlU3FsfWBcbiAgICAgIH1cblxuICAgICAgaWYgKHR5cGVvZiBqb2luVmFsdWUgPT0gXCJvYmplY3RcIikge1xuICAgICAgICBzcWwgPSB0aGlzLmpvaW5PYmplY3Qoam9pblZhbHVlLCB0YXJnZXRNb2RlbENsYXNzLCBzcWwsIGpvaW5zQ291bnQgKyAxLCBqb2luUGF0aClcbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gc3FsXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzY29wZSBzcWwuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vcmVjb3JkL3JlbGF0aW9uc2hpcHMvYmFzZS5qc1wiKS5kZWZhdWx0fSBhcmdzLnJlbGF0aW9uc2hpcCAtIFJlbGF0aW9uc2hpcCBkZWZpbml0aW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vbW9kZWwtY2xhc3MtcXVlcnkuanNcIikuZGVmYXVsdH0gYXJncy5xdWVyeSAtIE1vZGVsIGNsYXNzIHF1ZXJ5LlxuICAgKiBAcGFyYW0ge3R5cGVvZiBpbXBvcnQoXCIuLi9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gYXJncy50YXJnZXRNb2RlbENsYXNzIC0gVGFyZ2V0IG1vZGVsIGNsYXNzLlxuICAgKiBAcGFyYW0ge3N0cmluZ1tdfSBhcmdzLmpvaW5QYXRoIC0gSm9pbiBwYXRoLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy50YXJnZXRUYWJsZVJlZiAtIFRhcmdldCB0YWJsZSByZWZlcmVuY2UuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gU2NvcGUgU1FMLlxuICAgKi9cbiAgX3Njb3BlU3FsKHtyZWxhdGlvbnNoaXAsIHF1ZXJ5LCB0YXJnZXRNb2RlbENsYXNzLCBqb2luUGF0aCwgdGFyZ2V0VGFibGVSZWZ9KSB7XG4gICAgaWYgKCFyZWxhdGlvbnNoaXAuZ2V0U2NvcGUoKSkgcmV0dXJuIFwiXCJcblxuICAgIGNvbnN0IHNjb3BlZFF1ZXJ5ID0gcXVlcnkuYnVpbGRKb2luU2NvcGVRdWVyeSh0YXJnZXRNb2RlbENsYXNzLCBqb2luUGF0aClcbiAgICBjb25zdCBhcHBsaWVkUXVlcnkgPSByZWxhdGlvbnNoaXAuYXBwbHlTY29wZShzY29wZWRRdWVyeSkgfHwgc2NvcGVkUXVlcnlcbiAgICBjb25zdCB3aGVyZXMgPSBhcHBsaWVkUXVlcnkuX3doZXJlc1xuXG4gICAgaWYgKCF3aGVyZXMgfHwgd2hlcmVzLmxlbmd0aCA9PT0gMCkgcmV0dXJuIFwiXCJcblxuICAgIGNvbnN0IHBhcnRzID0gW11cblxuICAgIGZvciAoY29uc3Qgd2hlcmUgb2Ygd2hlcmVzKSB7XG4gICAgICBwYXJ0cy5wdXNoKHRoaXMuX3Njb3BlU3FsRm9yV2hlcmUod2hlcmUsIHRhcmdldFRhYmxlUmVmKSlcbiAgICB9XG5cbiAgICByZXR1cm4gcGFydHMuam9pbihcIiBBTkQgXCIpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzY29wZSBzcWwgZm9yIHdoZXJlLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vd2hlcmUtYmFzZS5qc1wiKS5kZWZhdWx0fSB3aGVyZSAtIFdoZXJlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gdGFyZ2V0VGFibGVSZWYgLSBUYXJnZXQgdGFibGUgcmVmZXJlbmNlLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFNjb3BlIHdoZXJlIFNRTC5cbiAgICovXG4gIF9zY29wZVNxbEZvcldoZXJlKHdoZXJlLCB0YXJnZXRUYWJsZVJlZikge1xuICAgIGlmICh3aGVyZSBpbnN0YW5jZW9mIFdoZXJlSGFzaCkge1xuICAgICAgY29uc3QgaGFzaCA9IHdoZXJlLmhhc2hcbiAgICAgIGNvbnN0IGhhc05lc3RlZCA9IE9iamVjdC52YWx1ZXMoaGFzaCkuc29tZSgodmFsdWUpID0+IHZhbHVlICE9PSBudWxsICYmIHR5cGVvZiB2YWx1ZSA9PT0gXCJvYmplY3RcIiAmJiAhQXJyYXkuaXNBcnJheSh2YWx1ZSkpXG5cbiAgICAgIHJldHVybiBoYXNOZXN0ZWRcbiAgICAgICAgPyB3aGVyZS50b1NxbCgpXG4gICAgICAgIDogYCgke3doZXJlLl93aGVyZVNRTEZyb21IYXNoKGhhc2gsIHRhcmdldFRhYmxlUmVmKX0pYFxuICAgIH1cblxuICAgIGlmICh3aGVyZSBpbnN0YW5jZW9mIFdoZXJlTm90ICYmIHdoZXJlLndoZXJlIGluc3RhbmNlb2YgV2hlcmVIYXNoKSB7XG4gICAgICBjb25zdCBoYXNoID0gd2hlcmUud2hlcmUuaGFzaFxuICAgICAgY29uc3QgaGFzTmVzdGVkID0gT2JqZWN0LnZhbHVlcyhoYXNoKS5zb21lKCh2YWx1ZSkgPT4gdmFsdWUgIT09IG51bGwgJiYgdHlwZW9mIHZhbHVlID09PSBcIm9iamVjdFwiICYmICFBcnJheS5pc0FycmF5KHZhbHVlKSlcbiAgICAgIGNvbnN0IGlubmVyU3FsID0gaGFzTmVzdGVkXG4gICAgICAgID8gd2hlcmUud2hlcmUudG9TcWwoKVxuICAgICAgICA6IGAoJHt3aGVyZS53aGVyZS5fd2hlcmVTUUxGcm9tSGFzaChoYXNoLCB0YXJnZXRUYWJsZVJlZil9KWBcblxuICAgICAgcmV0dXJuIGBOT1QgKCR7aW5uZXJTcWx9KWBcbiAgICB9XG5cbiAgICByZXR1cm4gd2hlcmUudG9TcWwoKVxuICB9XG59XG4iXX0=