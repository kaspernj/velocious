// @ts-check
import SelectBase from "./select-base.js";
export default class VelociousDatabaseQuerySelectPlain extends SelectBase {
    /**
     * Runs constructor.
     * @param {string} plain - Plain.
     */
    constructor(plain) {
        super();
        this.plain = plain;
        const aliasMatch = plain.match(/\sAS\s+([^\s]+)\s*$/iu);
        const aliasSql = aliasMatch ? aliasMatch[1] : undefined;
        this.alias = aliasSql
            ? aliasSql.replace(/^["[`]|["`\]]$/gu, "")
            : undefined;
        this.aliasQuoted = Boolean(aliasSql && ((aliasSql.startsWith('"') && aliasSql.endsWith('"'))
            || (aliasSql.startsWith("`") && aliasSql.endsWith("`"))
            || (aliasSql.startsWith("[") && aliasSql.endsWith("]"))));
    }
    /**
     * Returns the explicit terminal AS alias parsed at the raw-select boundary.
     * @param {{getType: () => string}} driver - Driver that determines returned identifier spelling.
     * @returns {string | undefined} - Driver-returned terminal AS alias, or undefined when absent.
     */
    getAlias(driver) {
        if (!this.alias)
            return undefined;
        if (!this.aliasQuoted && driver.getType() == "pgsql")
            return this.alias.toLowerCase();
        return this.alias;
    }
    toSql() {
        return this.plain;
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic2VsZWN0LXBsYWluLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vc3JjL2RhdGFiYXNlL3F1ZXJ5L3NlbGVjdC1wbGFpbi5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxZQUFZO0FBRVosT0FBTyxVQUFVLE1BQU0sa0JBQWtCLENBQUE7QUFFekMsTUFBTSxDQUFDLE9BQU8sT0FBTyxpQ0FBa0MsU0FBUSxVQUFVO0lBQ3ZFOzs7T0FHRztJQUNILFlBQVksS0FBSztRQUNmLEtBQUssRUFBRSxDQUFBO1FBQ1AsSUFBSSxDQUFDLEtBQUssR0FBRyxLQUFLLENBQUE7UUFFbEIsTUFBTSxVQUFVLEdBQUcsS0FBSyxDQUFDLEtBQUssQ0FBQyx1QkFBdUIsQ0FBQyxDQUFBO1FBQ3ZELE1BQU0sUUFBUSxHQUFHLFVBQVUsQ0FBQyxDQUFDLENBQUMsVUFBVSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxTQUFTLENBQUE7UUFFdkQsSUFBSSxDQUFDLEtBQUssR0FBRyxRQUFRO1lBQ25CLENBQUMsQ0FBQyxRQUFRLENBQUMsT0FBTyxDQUFDLGtCQUFrQixFQUFFLEVBQUUsQ0FBQztZQUMxQyxDQUFDLENBQUMsU0FBUyxDQUFBO1FBQ2IsSUFBSSxDQUFDLFdBQVcsR0FBRyxPQUFPLENBQUMsUUFBUSxJQUFJLENBQ3JDLENBQUMsUUFBUSxDQUFDLFVBQVUsQ0FBQyxHQUFHLENBQUMsSUFBSSxRQUFRLENBQUMsUUFBUSxDQUFDLEdBQUcsQ0FBQyxDQUFDO2VBQ2pELENBQUMsUUFBUSxDQUFDLFVBQVUsQ0FBQyxHQUFHLENBQUMsSUFBSSxRQUFRLENBQUMsUUFBUSxDQUFDLEdBQUcsQ0FBQyxDQUFDO2VBQ3BELENBQUMsUUFBUSxDQUFDLFVBQVUsQ0FBQyxHQUFHLENBQUMsSUFBSSxRQUFRLENBQUMsUUFBUSxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQ3hELENBQUMsQ0FBQTtJQUNKLENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsUUFBUSxDQUFDLE1BQU07UUFDYixJQUFJLENBQUMsSUFBSSxDQUFDLEtBQUs7WUFBRSxPQUFPLFNBQVMsQ0FBQTtRQUNqQyxJQUFJLENBQUMsSUFBSSxDQUFDLFdBQVcsSUFBSSxNQUFNLENBQUMsT0FBTyxFQUFFLElBQUksT0FBTztZQUFFLE9BQU8sSUFBSSxDQUFDLEtBQUssQ0FBQyxXQUFXLEVBQUUsQ0FBQTtRQUVyRixPQUFPLElBQUksQ0FBQyxLQUFLLENBQUE7SUFDbkIsQ0FBQztJQUVELEtBQUs7UUFDSCxPQUFPLElBQUksQ0FBQyxLQUFLLENBQUE7SUFDbkIsQ0FBQztDQUNGIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbmltcG9ydCBTZWxlY3RCYXNlIGZyb20gXCIuL3NlbGVjdC1iYXNlLmpzXCJcblxuZXhwb3J0IGRlZmF1bHQgY2xhc3MgVmVsb2Npb3VzRGF0YWJhc2VRdWVyeVNlbGVjdFBsYWluIGV4dGVuZHMgU2VsZWN0QmFzZSB7XG4gIC8qKlxuICAgKiBSdW5zIGNvbnN0cnVjdG9yLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gcGxhaW4gLSBQbGFpbi5cbiAgICovXG4gIGNvbnN0cnVjdG9yKHBsYWluKSB7XG4gICAgc3VwZXIoKVxuICAgIHRoaXMucGxhaW4gPSBwbGFpblxuXG4gICAgY29uc3QgYWxpYXNNYXRjaCA9IHBsYWluLm1hdGNoKC9cXHNBU1xccysoW15cXHNdKylcXHMqJC9pdSlcbiAgICBjb25zdCBhbGlhc1NxbCA9IGFsaWFzTWF0Y2ggPyBhbGlhc01hdGNoWzFdIDogdW5kZWZpbmVkXG5cbiAgICB0aGlzLmFsaWFzID0gYWxpYXNTcWxcbiAgICAgID8gYWxpYXNTcWwucmVwbGFjZSgvXltcIltgXXxbXCJgXFxdXSQvZ3UsIFwiXCIpXG4gICAgICA6IHVuZGVmaW5lZFxuICAgIHRoaXMuYWxpYXNRdW90ZWQgPSBCb29sZWFuKGFsaWFzU3FsICYmIChcbiAgICAgIChhbGlhc1NxbC5zdGFydHNXaXRoKCdcIicpICYmIGFsaWFzU3FsLmVuZHNXaXRoKCdcIicpKVxuICAgICAgfHwgKGFsaWFzU3FsLnN0YXJ0c1dpdGgoXCJgXCIpICYmIGFsaWFzU3FsLmVuZHNXaXRoKFwiYFwiKSlcbiAgICAgIHx8IChhbGlhc1NxbC5zdGFydHNXaXRoKFwiW1wiKSAmJiBhbGlhc1NxbC5lbmRzV2l0aChcIl1cIikpXG4gICAgKSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHRoZSBleHBsaWNpdCB0ZXJtaW5hbCBBUyBhbGlhcyBwYXJzZWQgYXQgdGhlIHJhdy1zZWxlY3QgYm91bmRhcnkuXG4gICAqIEBwYXJhbSB7e2dldFR5cGU6ICgpID0+IHN0cmluZ319IGRyaXZlciAtIERyaXZlciB0aGF0IGRldGVybWluZXMgcmV0dXJuZWQgaWRlbnRpZmllciBzcGVsbGluZy5cbiAgICogQHJldHVybnMge3N0cmluZyB8IHVuZGVmaW5lZH0gLSBEcml2ZXItcmV0dXJuZWQgdGVybWluYWwgQVMgYWxpYXMsIG9yIHVuZGVmaW5lZCB3aGVuIGFic2VudC5cbiAgICovXG4gIGdldEFsaWFzKGRyaXZlcikge1xuICAgIGlmICghdGhpcy5hbGlhcykgcmV0dXJuIHVuZGVmaW5lZFxuICAgIGlmICghdGhpcy5hbGlhc1F1b3RlZCAmJiBkcml2ZXIuZ2V0VHlwZSgpID09IFwicGdzcWxcIikgcmV0dXJuIHRoaXMuYWxpYXMudG9Mb3dlckNhc2UoKVxuXG4gICAgcmV0dXJuIHRoaXMuYWxpYXNcbiAgfVxuXG4gIHRvU3FsKCkge1xuICAgIHJldHVybiB0aGlzLnBsYWluXG4gIH1cbn1cbiJdfQ==