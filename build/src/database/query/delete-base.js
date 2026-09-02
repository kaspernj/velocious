// @ts-check
import QueryBase from "./base.js";
export default class VelociousDatabaseQueryDeleteBase extends QueryBase {
    /**
     * Runs constructor.
     * @param {object} args - Options object.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} args.conditions - Conditions.
     * @param {import("../drivers/base.js").default} args.driver - Database driver instance.
     * @param {string} args.tableName - Table name.
     */
    constructor({ conditions, driver, tableName }) {
        super({ driver });
        this.conditions = conditions;
        this.tableName = tableName;
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZGVsZXRlLWJhc2UuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvZGF0YWJhc2UvcXVlcnkvZGVsZXRlLWJhc2UuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLE9BQU8sU0FBUyxNQUFNLFdBQVcsQ0FBQTtBQUVqQyxNQUFNLENBQUMsT0FBTyxPQUFPLGdDQUFpQyxTQUFRLFNBQVM7SUFDckU7Ozs7OztPQU1HO0lBQ0gsWUFBWSxFQUFDLFVBQVUsRUFBRSxNQUFNLEVBQUUsU0FBUyxFQUFDO1FBQ3pDLEtBQUssQ0FBQyxFQUFDLE1BQU0sRUFBQyxDQUFDLENBQUE7UUFDZixJQUFJLENBQUMsVUFBVSxHQUFHLFVBQVUsQ0FBQTtRQUM1QixJQUFJLENBQUMsU0FBUyxHQUFHLFNBQVMsQ0FBQTtJQUM1QixDQUFDO0NBQ0YiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuaW1wb3J0IFF1ZXJ5QmFzZSBmcm9tIFwiLi9iYXNlLmpzXCJcblxuZXhwb3J0IGRlZmF1bHQgY2xhc3MgVmVsb2Npb3VzRGF0YWJhc2VRdWVyeURlbGV0ZUJhc2UgZXh0ZW5kcyBRdWVyeUJhc2Uge1xuICAvKipcbiAgICogUnVucyBjb25zdHJ1Y3Rvci5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGFyZ3MuY29uZGl0aW9ucyAtIENvbmRpdGlvbnMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGFyZ3MuZHJpdmVyIC0gRGF0YWJhc2UgZHJpdmVyIGluc3RhbmNlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy50YWJsZU5hbWUgLSBUYWJsZSBuYW1lLlxuICAgKi9cbiAgY29uc3RydWN0b3Ioe2NvbmRpdGlvbnMsIGRyaXZlciwgdGFibGVOYW1lfSkge1xuICAgIHN1cGVyKHtkcml2ZXJ9KVxuICAgIHRoaXMuY29uZGl0aW9ucyA9IGNvbmRpdGlvbnNcbiAgICB0aGlzLnRhYmxlTmFtZSA9IHRhYmxlTmFtZVxuICB9XG59XG5cbiJdfQ==