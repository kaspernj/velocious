// @ts-check
import { normalizeSqlStatement } from "../structure-sql/utils.js";
export default class VelociousDatabaseDriversSqliteStructureSql {
    /**
     * Runs constructor.
     * @param {object} args - Options object.
     * @param {import("../base.js").default} args.driver - Database driver instance.
     */
    constructor({ driver }) {
        this.driver = driver;
    }
    /**
     * Runs to sql.
     * @returns {Promise<string | null>} - Resolves with SQL string.
     */
    async toSql() {
        const { driver } = this;
        const rows = await driver.query("SELECT type, sql, name FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY name");
        const tables = [];
        const views = [];
        const indexes = [];
        const triggers = [];
        const others = [];
        for (const row of rows) {
            const rawSql = row.sql || row.SQL;
            const rawType = row.type || row.TYPE;
            const statement = rawSql ? normalizeSqlStatement(String(rawSql)) : "";
            if (!statement)
                continue;
            const normalizedType = rawType ? String(rawType).toLowerCase() : "";
            if (normalizedType === "table") {
                tables.push(statement);
            }
            else if (normalizedType === "view") {
                views.push(statement);
            }
            else if (normalizedType === "index") {
                indexes.push(statement);
            }
            else if (normalizedType === "trigger") {
                triggers.push(statement);
            }
            else {
                others.push(statement);
            }
        }
        const statements = [...tables, ...views, ...indexes, ...triggers, ...others];
        if (statements.length == 0)
            return null;
        return `${statements.join("\n\n")}\n`;
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic3RydWN0dXJlLXNxbC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uLy4uL3NyYy9kYXRhYmFzZS9kcml2ZXJzL3NxbGl0ZS9zdHJ1Y3R1cmUtc3FsLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLEVBQUMscUJBQXFCLEVBQUMsTUFBTSwyQkFBMkIsQ0FBQTtBQUUvRCxNQUFNLENBQUMsT0FBTyxPQUFPLDBDQUEwQztJQUM3RDs7OztPQUlHO0lBQ0gsWUFBWSxFQUFDLE1BQU0sRUFBQztRQUNsQixJQUFJLENBQUMsTUFBTSxHQUFHLE1BQU0sQ0FBQTtJQUN0QixDQUFDO0lBRUQ7OztPQUdHO0lBQ0gsS0FBSyxDQUFDLEtBQUs7UUFDVCxNQUFNLEVBQUMsTUFBTSxFQUFDLEdBQUcsSUFBSSxDQUFBO1FBQ3JCLE1BQU0sSUFBSSxHQUFHLE1BQU0sTUFBTSxDQUFDLEtBQUssQ0FBQyw0R0FBNEcsQ0FBQyxDQUFBO1FBQzdJLE1BQU0sTUFBTSxHQUFHLEVBQUUsQ0FBQTtRQUNqQixNQUFNLEtBQUssR0FBRyxFQUFFLENBQUE7UUFDaEIsTUFBTSxPQUFPLEdBQUcsRUFBRSxDQUFBO1FBQ2xCLE1BQU0sUUFBUSxHQUFHLEVBQUUsQ0FBQTtRQUNuQixNQUFNLE1BQU0sR0FBRyxFQUFFLENBQUE7UUFFakIsS0FBSyxNQUFNLEdBQUcsSUFBSSxJQUFJLEVBQUUsQ0FBQztZQUN2QixNQUFNLE1BQU0sR0FBRyxHQUFHLENBQUMsR0FBRyxJQUFJLEdBQUcsQ0FBQyxHQUFHLENBQUE7WUFDakMsTUFBTSxPQUFPLEdBQUcsR0FBRyxDQUFDLElBQUksSUFBSSxHQUFHLENBQUMsSUFBSSxDQUFBO1lBQ3BDLE1BQU0sU0FBUyxHQUFHLE1BQU0sQ0FBQyxDQUFDLENBQUMscUJBQXFCLENBQUMsTUFBTSxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQTtZQUVyRSxJQUFJLENBQUMsU0FBUztnQkFBRSxTQUFRO1lBRXhCLE1BQU0sY0FBYyxHQUFHLE9BQU8sQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFDLE9BQU8sQ0FBQyxDQUFDLFdBQVcsRUFBRSxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUE7WUFFbkUsSUFBSSxjQUFjLEtBQUssT0FBTyxFQUFFLENBQUM7Z0JBQy9CLE1BQU0sQ0FBQyxJQUFJLENBQUMsU0FBUyxDQUFDLENBQUE7WUFDeEIsQ0FBQztpQkFBTSxJQUFJLGNBQWMsS0FBSyxNQUFNLEVBQUUsQ0FBQztnQkFDckMsS0FBSyxDQUFDLElBQUksQ0FBQyxTQUFTLENBQUMsQ0FBQTtZQUN2QixDQUFDO2lCQUFNLElBQUksY0FBYyxLQUFLLE9BQU8sRUFBRSxDQUFDO2dCQUN0QyxPQUFPLENBQUMsSUFBSSxDQUFDLFNBQVMsQ0FBQyxDQUFBO1lBQ3pCLENBQUM7aUJBQU0sSUFBSSxjQUFjLEtBQUssU0FBUyxFQUFFLENBQUM7Z0JBQ3hDLFFBQVEsQ0FBQyxJQUFJLENBQUMsU0FBUyxDQUFDLENBQUE7WUFDMUIsQ0FBQztpQkFBTSxDQUFDO2dCQUNOLE1BQU0sQ0FBQyxJQUFJLENBQUMsU0FBUyxDQUFDLENBQUE7WUFDeEIsQ0FBQztRQUNILENBQUM7UUFFRCxNQUFNLFVBQVUsR0FBRyxDQUFDLEdBQUcsTUFBTSxFQUFFLEdBQUcsS0FBSyxFQUFFLEdBQUcsT0FBTyxFQUFFLEdBQUcsUUFBUSxFQUFFLEdBQUcsTUFBTSxDQUFDLENBQUE7UUFFNUUsSUFBSSxVQUFVLENBQUMsTUFBTSxJQUFJLENBQUM7WUFBRSxPQUFPLElBQUksQ0FBQTtRQUV2QyxPQUFPLEdBQUcsVUFBVSxDQUFDLElBQUksQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFBO0lBQ3ZDLENBQUM7Q0FDRiIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG5pbXBvcnQge25vcm1hbGl6ZVNxbFN0YXRlbWVudH0gZnJvbSBcIi4uL3N0cnVjdHVyZS1zcWwvdXRpbHMuanNcIlxuXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBWZWxvY2lvdXNEYXRhYmFzZURyaXZlcnNTcWxpdGVTdHJ1Y3R1cmVTcWwge1xuICAvKipcbiAgICogUnVucyBjb25zdHJ1Y3Rvci5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9iYXNlLmpzXCIpLmRlZmF1bHR9IGFyZ3MuZHJpdmVyIC0gRGF0YWJhc2UgZHJpdmVyIGluc3RhbmNlLlxuICAgKi9cbiAgY29uc3RydWN0b3Ioe2RyaXZlcn0pIHtcbiAgICB0aGlzLmRyaXZlciA9IGRyaXZlclxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgdG8gc3FsLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxzdHJpbmcgfCBudWxsPn0gLSBSZXNvbHZlcyB3aXRoIFNRTCBzdHJpbmcuXG4gICAqL1xuICBhc3luYyB0b1NxbCgpIHtcbiAgICBjb25zdCB7ZHJpdmVyfSA9IHRoaXNcbiAgICBjb25zdCByb3dzID0gYXdhaXQgZHJpdmVyLnF1ZXJ5KFwiU0VMRUNUIHR5cGUsIHNxbCwgbmFtZSBGUk9NIHNxbGl0ZV9tYXN0ZXIgV0hFUkUgc3FsIElTIE5PVCBOVUxMIEFORCBuYW1lIE5PVCBMSUtFICdzcWxpdGVfJScgT1JERVIgQlkgbmFtZVwiKVxuICAgIGNvbnN0IHRhYmxlcyA9IFtdXG4gICAgY29uc3Qgdmlld3MgPSBbXVxuICAgIGNvbnN0IGluZGV4ZXMgPSBbXVxuICAgIGNvbnN0IHRyaWdnZXJzID0gW11cbiAgICBjb25zdCBvdGhlcnMgPSBbXVxuXG4gICAgZm9yIChjb25zdCByb3cgb2Ygcm93cykge1xuICAgICAgY29uc3QgcmF3U3FsID0gcm93LnNxbCB8fCByb3cuU1FMXG4gICAgICBjb25zdCByYXdUeXBlID0gcm93LnR5cGUgfHwgcm93LlRZUEVcbiAgICAgIGNvbnN0IHN0YXRlbWVudCA9IHJhd1NxbCA/IG5vcm1hbGl6ZVNxbFN0YXRlbWVudChTdHJpbmcocmF3U3FsKSkgOiBcIlwiXG5cbiAgICAgIGlmICghc3RhdGVtZW50KSBjb250aW51ZVxuXG4gICAgICBjb25zdCBub3JtYWxpemVkVHlwZSA9IHJhd1R5cGUgPyBTdHJpbmcocmF3VHlwZSkudG9Mb3dlckNhc2UoKSA6IFwiXCJcblxuICAgICAgaWYgKG5vcm1hbGl6ZWRUeXBlID09PSBcInRhYmxlXCIpIHtcbiAgICAgICAgdGFibGVzLnB1c2goc3RhdGVtZW50KVxuICAgICAgfSBlbHNlIGlmIChub3JtYWxpemVkVHlwZSA9PT0gXCJ2aWV3XCIpIHtcbiAgICAgICAgdmlld3MucHVzaChzdGF0ZW1lbnQpXG4gICAgICB9IGVsc2UgaWYgKG5vcm1hbGl6ZWRUeXBlID09PSBcImluZGV4XCIpIHtcbiAgICAgICAgaW5kZXhlcy5wdXNoKHN0YXRlbWVudClcbiAgICAgIH0gZWxzZSBpZiAobm9ybWFsaXplZFR5cGUgPT09IFwidHJpZ2dlclwiKSB7XG4gICAgICAgIHRyaWdnZXJzLnB1c2goc3RhdGVtZW50KVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgb3RoZXJzLnB1c2goc3RhdGVtZW50KVxuICAgICAgfVxuICAgIH1cblxuICAgIGNvbnN0IHN0YXRlbWVudHMgPSBbLi4udGFibGVzLCAuLi52aWV3cywgLi4uaW5kZXhlcywgLi4udHJpZ2dlcnMsIC4uLm90aGVyc11cblxuICAgIGlmIChzdGF0ZW1lbnRzLmxlbmd0aCA9PSAwKSByZXR1cm4gbnVsbFxuXG4gICAgcmV0dXJuIGAke3N0YXRlbWVudHMuam9pbihcIlxcblxcblwiKX1cXG5gXG4gIH1cbn1cbiJdfQ==