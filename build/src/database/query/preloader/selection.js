// @ts-check
const IDENTIFIER_REGEX = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
/**
 * Encapsulates the column selection and idempotency rules for preloading.
 *
 * Two per-target-model-name maps drive the behaviour, both keyed by the target
 * model name (e.g. `"Account"`):
 *
 * - `preloadSelects` (from `.select({Account: ["id"]})`) narrows the columns
 *   loaded for that target to the listed attributes (plus the primary/foreign
 *   keys needed to map results back to their parents).
 * - `preloadSelectsExtra` (from `.selectsExtra({Account: ["..."]})`) keeps the
 *   default `SELECT *` columns and loads the listed extra selects in addition.
 *
 * `force` re-loads relationships even when they are already preloaded.
 */
export default class VelociousDatabaseQueryPreloaderSelection {
    /**
     * Runs constructor.
     * @param {object} [args] - Options object.
     * @param {Record<string, string[]>} [args.preloadSelects] - Narrowing selects keyed by target model name.
     * @param {Record<string, string[]>} [args.preloadSelectsExtra] - Extra selects keyed by target model name.
     * @param {boolean} [args.force] - Whether to re-load already-preloaded relationships.
     */
    constructor({ preloadSelects = {}, preloadSelectsExtra = {}, force = false } = {}) {
        this.preloadSelects = preloadSelects;
        this.preloadSelectsExtra = preloadSelectsExtra;
        this.force = force;
    }
    /**
     * Runs get force.
     * @returns {boolean} - Whether already-preloaded relationships should still be re-loaded.
     */
    getForce() { return this.force; }
    /**
     * Runs narrowing for.
     * @param {typeof import("../../record/index.js").default} targetModelClass - Target model class.
     * @returns {string[] | undefined} - Narrowing select attributes for the class, if any.
     */
    _narrowingFor(targetModelClass) {
        return this.preloadSelects[targetModelClass.getModelName()];
    }
    /**
     * Runs extra for.
     * @param {typeof import("../../record/index.js").default} targetModelClass - Target model class.
     * @returns {string[] | undefined} - Extra select attributes/expressions for the class, if any.
     */
    _extraFor(targetModelClass) {
        return this.preloadSelectsExtra[targetModelClass.getModelName()];
    }
    /**
     * Apply the configured select clauses to a target query.
     * @template {import("../model-class-query.js").default} T
     * @param {object} args - Options object.
     * @param {T} args.query - Target query to apply selects to.
     * @param {typeof import("../../record/index.js").default} args.targetModelClass - Target model class.
     * @param {string[]} args.mappingColumns - Columns that must always be loaded so results can be mapped back to parents (primary/foreign keys).
     * @returns {T} - The query, with selects applied when a selection is configured.
     */
    applyToQuery({ query, targetModelClass, mappingColumns }) {
        const narrowing = this._narrowingFor(targetModelClass);
        const extra = this._extraFor(targetModelClass);
        if (narrowing) {
            const selects = [...new Set([...narrowing, ...mappingColumns, ...(extra || [])])];
            return /** @type {T} */ (query.select(selects));
        }
        if (extra) {
            const allColumns = `${query.driver.quoteTable(targetModelClass.tableName())}.*`;
            return /** @type {T} */ (query.select([allColumns, ...extra]));
        }
        return query;
    }
    /**
     * Whether an already-preloaded relationship's loaded target(s) satisfy the
     * configured selection, so the relationship can be skipped. Returns false
     * when `force` is set, when the relationship hasn't been preloaded, or when a
     * required column is missing from a loaded target.
     * @param {object} args - Options object.
     * @param {import("../../record/instance-relationships/base.js").default} args.instanceRelationship - The source model's instance relationship.
     * @param {typeof import("../../record/index.js").default} args.targetModelClass - Target model class.
     * @param {string[]} args.mappingColumns - Primary/foreign key columns required for mapping.
     * @returns {boolean} - Whether the relationship is already satisfied.
     */
    isSatisfied({ instanceRelationship, targetModelClass, mappingColumns }) {
        if (this.force)
            return false;
        if (!instanceRelationship.getPreloaded())
            return false;
        const required = this._requiredColumnsFor({ targetModelClass, mappingColumns });
        if (!required)
            return false;
        const loaded = instanceRelationship.getLoadedOrUndefined();
        const targets = loaded === undefined ? [] : (Array.isArray(loaded) ? loaded : [loaded]);
        for (const target of targets) {
            for (const column of required) {
                if (!target.hasLoadedColumn(column))
                    return false;
            }
        }
        return true;
    }
    /**
     * The set of columns that must be present on a loaded target for it to count
     * as satisfied. Returns null when satisfaction can't be verified (an extra
     * select is a raw SQL expression whose resulting column can't be derived), in
     * which case the relationship is always re-loaded.
     * @param {object} args - Options object.
     * @param {typeof import("../../record/index.js").default} args.targetModelClass - Target model class.
     * @param {string[]} args.mappingColumns - Primary/foreign key columns required for mapping.
     * @returns {string[] | null} - Required column names, or null when unverifiable.
     */
    _requiredColumnsFor({ targetModelClass, mappingColumns }) {
        const attributeMap = targetModelClass.getAttributeNameToColumnNameMap();
        const narrowing = this._narrowingFor(targetModelClass);
        const extra = this._extraFor(targetModelClass);
        /**
         * Columns.
         * @type {string[]} */
        const columns = [];
        if (narrowing) {
            for (const attribute of narrowing)
                columns.push(attributeMap[attribute] || attribute);
            for (const column of mappingColumns)
                columns.push(column);
        }
        else {
            for (const column of targetModelClass.getColumnNames())
                columns.push(column);
        }
        if (extra) {
            for (const entry of extra) {
                if (!IDENTIFIER_REGEX.test(entry))
                    return null;
                columns.push(attributeMap[entry] || entry);
            }
        }
        return columns;
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic2VsZWN0aW9uLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vLi4vc3JjL2RhdGFiYXNlL3F1ZXJ5L3ByZWxvYWRlci9zZWxlY3Rpb24uanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLE1BQU0sZ0JBQWdCLEdBQUcsMEJBQTBCLENBQUE7QUFFbkQ7Ozs7Ozs7Ozs7Ozs7R0FhRztBQUNILE1BQU0sQ0FBQyxPQUFPLE9BQU8sd0NBQXdDO0lBQzNEOzs7Ozs7T0FNRztJQUNILFlBQVksRUFBQyxjQUFjLEdBQUcsRUFBRSxFQUFFLG1CQUFtQixHQUFHLEVBQUUsRUFBRSxLQUFLLEdBQUcsS0FBSyxFQUFDLEdBQUcsRUFBRTtRQUM3RSxJQUFJLENBQUMsY0FBYyxHQUFHLGNBQWMsQ0FBQTtRQUNwQyxJQUFJLENBQUMsbUJBQW1CLEdBQUcsbUJBQW1CLENBQUE7UUFDOUMsSUFBSSxDQUFDLEtBQUssR0FBRyxLQUFLLENBQUE7SUFDcEIsQ0FBQztJQUVEOzs7T0FHRztJQUNILFFBQVEsS0FBSyxPQUFPLElBQUksQ0FBQyxLQUFLLENBQUEsQ0FBQyxDQUFDO0lBRWhDOzs7O09BSUc7SUFDSCxhQUFhLENBQUMsZ0JBQWdCO1FBQzVCLE9BQU8sSUFBSSxDQUFDLGNBQWMsQ0FBQyxnQkFBZ0IsQ0FBQyxZQUFZLEVBQUUsQ0FBQyxDQUFBO0lBQzdELENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsU0FBUyxDQUFDLGdCQUFnQjtRQUN4QixPQUFPLElBQUksQ0FBQyxtQkFBbUIsQ0FBQyxnQkFBZ0IsQ0FBQyxZQUFZLEVBQUUsQ0FBQyxDQUFBO0lBQ2xFLENBQUM7SUFFRDs7Ozs7Ozs7T0FRRztJQUNILFlBQVksQ0FBQyxFQUFDLEtBQUssRUFBRSxnQkFBZ0IsRUFBRSxjQUFjLEVBQUM7UUFDcEQsTUFBTSxTQUFTLEdBQUcsSUFBSSxDQUFDLGFBQWEsQ0FBQyxnQkFBZ0IsQ0FBQyxDQUFBO1FBQ3RELE1BQU0sS0FBSyxHQUFH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TUFBTSxDQUFDLENBQUE7UUFDOUUsQ0FBQztRQUVELElBQUksS0FBSyxFQUFFLENBQUM7WUFDVixLQUFLLE1BQU0sS0FBSyxJQUFJLEtBQUssRUFBRSxDQUFDO2dCQUMxQixJQUFJLENBQUMsZ0JBQWdCLENBQUMsSUFBSSxDQUFDLEtBQUssQ0FBQztvQkFBRSxPQUFPLElBQUksQ0FBQTtnQkFFOUMsT0FBTyxDQUFDLElBQUksQ0FBQyxZQUFZLENBQUMsS0FBSyxDQUFDLElBQUksS0FBSyxDQUFDLENBQUE7WUFDNUMsQ0FBQztRQUNILENBQUM7UUFFRCxPQUFPLE9BQU8sQ0FBQTtJQUNoQixDQUFDO0NBQ0YiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuY29uc3QgSURFTlRJRklFUl9SRUdFWCA9IC9eW2EtekEtWl9dW2EtekEtWjAtOV9dKiQvXG5cbi8qKlxuICogRW5jYXBzdWxhdGVzIHRoZSBjb2x1bW4gc2VsZWN0aW9uIGFuZCBpZGVtcG90ZW5jeSBydWxlcyBmb3IgcHJlbG9hZGluZy5cbiAqXG4gKiBUd28gcGVyLXRhcmdldC1tb2RlbC1uYW1lIG1hcHMgZHJpdmUgdGhlIGJlaGF2aW91ciwgYm90aCBrZXllZCBieSB0aGUgdGFyZ2V0XG4gKiBtb2RlbCBuYW1lIChlLmcuIGBcIkFjY291bnRcImApOlxuICpcbiAqIC0gYHByZWxvYWRTZWxlY3RzYCAoZnJvbSBgLnNlbGVjdCh7QWNjb3VudDogW1wiaWRcIl19KWApIG5hcnJvd3MgdGhlIGNvbHVtbnNcbiAqICAgbG9hZGVkIGZvciB0aGF0IHRhcmdldCB0byB0aGUgbGlzdGVkIGF0dHJpYnV0ZXMgKHBsdXMgdGhlIHByaW1hcnkvZm9yZWlnblxuICogICBrZXlzIG5lZWRlZCB0byBtYXAgcmVzdWx0cyBiYWNrIHRvIHRoZWlyIHBhcmVudHMpLlxuICogLSBgcHJlbG9hZFNlbGVjdHNFeHRyYWAgKGZyb20gYC5zZWxlY3RzRXh0cmEoe0FjY291bnQ6IFtcIi4uLlwiXX0pYCkga2VlcHMgdGhlXG4gKiAgIGRlZmF1bHQgYFNFTEVDVCAqYCBjb2x1bW5zIGFuZCBsb2FkcyB0aGUgbGlzdGVkIGV4dHJhIHNlbGVjdHMgaW4gYWRkaXRpb24uXG4gKlxuICogYGZvcmNlYCByZS1sb2FkcyByZWxhdGlvbnNoaXBzIGV2ZW4gd2hlbiB0aGV5IGFyZSBhbHJlYWR5IHByZWxvYWRlZC5cbiAqL1xuZXhwb3J0IGRlZmF1bHQgY2xhc3MgVmVsb2Npb3VzRGF0YWJhc2VRdWVyeVByZWxvYWRlclNlbGVjdGlvbiB7XG4gIC8qKlxuICAgKiBSdW5zIGNvbnN0cnVjdG9yLlxuICAgKiBAcGFyYW0ge29iamVjdH0gW2FyZ3NdIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgc3RyaW5nW10+fSBbYXJncy5wcmVsb2FkU2VsZWN0c10gLSBOYXJyb3dpbmcgc2VsZWN0cyBrZXllZCBieSB0YXJnZXQgbW9kZWwgbmFtZS5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBzdHJpbmdbXT59IFthcmdzLnByZWxvYWRTZWxlY3RzRXh0cmFdIC0gRXh0cmEgc2VsZWN0cyBrZXllZCBieSB0YXJnZXQgbW9kZWwgbmFtZS5cbiAgICogQHBhcmFtIHtib29sZWFufSBbYXJncy5mb3JjZV0gLSBXaGV0aGVyIHRvIHJlLWxvYWQgYWxyZWFkeS1wcmVsb2FkZWQgcmVsYXRpb25zaGlwcy5cbiAgICovXG4gIGNvbnN0cnVjdG9yKHtwcmVsb2FkU2VsZWN0cyA9IHt9LCBwcmVsb2FkU2VsZWN0c0V4dHJhID0ge30sIGZvcmNlID0gZmFsc2V9ID0ge30pIHtcbiAgICB0aGlzLnByZWxvYWRTZWxlY3RzID0gcHJlbG9hZFNlbGVjdHNcbiAgICB0aGlzLnByZWxvYWRTZWxlY3RzRXh0cmEgPSBwcmVsb2FkU2VsZWN0c0V4dHJhXG4gICAgdGhpcy5mb3JjZSA9IGZvcmNlXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgZm9yY2UuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgYWxyZWFkeS1wcmVsb2FkZWQgcmVsYXRpb25zaGlwcyBzaG91bGQgc3RpbGwgYmUgcmUtbG9hZGVkLlxuICAgKi9cbiAgZ2V0Rm9yY2UoKSB7IHJldHVybiB0aGlzLmZvcmNlIH1cblxuICAvKipcbiAgICogUnVucyBuYXJyb3dpbmcgZm9yLlxuICAgKiBAcGFyYW0ge3R5cGVvZiBpbXBvcnQoXCIuLi8uLi9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gdGFyZ2V0TW9kZWxDbGFzcyAtIFRhcmdldCBtb2RlbCBjbGFzcy5cbiAgICogQHJldHVybnMge3N0cmluZ1tdIHwgdW5kZWZpbmVkfSAtIE5hcnJvd2luZyBzZWxlY3QgYXR0cmlidXRlcyBmb3IgdGhlIGNsYXNzLCBpZiBhbnkuXG4gICAqL1xuICBfbmFycm93aW5nRm9yKHRhcmdldE1vZGVsQ2xhc3MpIHtcbiAgICByZXR1cm4gdGhpcy5wcmVsb2FkU2VsZWN0c1t0YXJnZXRNb2RlbENsYXNzLmdldE1vZGVsTmFtZSgpXVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZXh0cmEgZm9yLlxuICAgKiBAcGFyYW0ge3R5cGVvZiBpbXBvcnQoXCIuLi8uLi9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gdGFyZ2V0TW9kZWxDbGFzcyAtIFRhcmdldCBtb2RlbCBjbGFzcy5cbiAgICogQHJldHVybnMge3N0cmluZ1tdIHwgdW5kZWZpbmVkfSAtIEV4dHJhIHNlbGVjdCBhdHRyaWJ1dGVzL2V4cHJlc3Npb25zIGZvciB0aGUgY2xhc3MsIGlmIGFueS5cbiAgICovXG4gIF9leHRyYUZvcih0YXJnZXRNb2RlbENsYXNzKSB7XG4gICAgcmV0dXJuIHRoaXMucHJlbG9hZFNlbGVjdHNFeHRyYVt0YXJnZXRNb2RlbENsYXNzLmdldE1vZGVsTmFtZSgpXVxuICB9XG5cbiAgLyoqXG4gICAqIEFwcGx5IHRoZSBjb25maWd1cmVkIHNlbGVjdCBjbGF1c2VzIHRvIGEgdGFyZ2V0IHF1ZXJ5LlxuICAgKiBAdGVtcGxhdGUge2ltcG9ydChcIi4uL21vZGVsLWNsYXNzLXF1ZXJ5LmpzXCIpLmRlZmF1bHR9IFRcbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHBhcmFtIHtUfSBhcmdzLnF1ZXJ5IC0gVGFyZ2V0IHF1ZXJ5IHRvIGFwcGx5IHNlbGVjdHMgdG8uXG4gICAqIEBwYXJhbSB7dHlwZW9mIGltcG9ydChcIi4uLy4uL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBhcmdzLnRhcmdldE1vZGVsQ2xhc3MgLSBUYXJnZXQgbW9kZWwgY2xhc3MuXG4gICAqIEBwYXJhbSB7c3RyaW5nW119IGFyZ3MubWFwcGluZ0NvbHVtbnMgLSBDb2x1bW5zIHRoYXQgbXVzdCBhbHdheXMgYmUgbG9hZGVkIHNvIHJlc3VsdHMgY2FuIGJlIG1hcHBlZCBiYWNrIHRvIHBhcmVudHMgKHByaW1hcnkvZm9yZWlnbiBrZXlzKS5cbiAgICogQHJldHVybnMge1R9IC0gVGhlIHF1ZXJ5LCB3aXRoIHNlbGVjdHMgYXBwbGllZCB3aGVuIGEgc2VsZWN0aW9uIGlzIGNvbmZpZ3VyZWQuXG4gICAqL1xuICBhcHBseVRvUXVlcnkoe3F1ZXJ5LCB0YXJnZXRNb2RlbENsYXNzLCBtYXBwaW5nQ29sdW1uc30pIHtcbiAgICBjb25zdCBuYXJyb3dpbmcgPSB0aGlzLl9uYXJyb3dpbmdGb3IodGFyZ2V0TW9kZWxDbGFzcylcbiAgICBjb25zdCBleHRyYSA9IHRoaXMuX2V4dHJhRm9yKHRhcmdldE1vZGVsQ2xhc3MpXG5cbiAgICBpZiAobmFycm93aW5nKSB7XG4gICAgICBjb25zdCBzZWxlY3RzID0gWy4uLm5ldyBTZXQoWy4uLm5hcnJvd2luZywgLi4ubWFwcGluZ0NvbHVtbnMsIC4uLihleHRyYSB8fCBbXSldKV1cblxuICAgICAgcmV0dXJuIC8qKiBAdHlwZSB7VH0gKi8gKHF1ZXJ5LnNlbGVjdChzZWxlY3RzKSlcbiAgICB9XG5cbiAgICBpZiAoZXh0cmEpIHtcbiAgICAgIGNvbnN0IGFsbENvbHVtbnMgPSBgJHtxdWVyeS5kcml2ZXIucXVvdGVUYWJsZSh0YXJnZXRNb2RlbENsYXNzLnRhYmxlTmFtZSgpKX0uKmBcblxuICAgICAgcmV0dXJuIC8qKiBAdHlwZSB7VH0gKi8gKHF1ZXJ5LnNlbGVjdChbYWxsQ29sdW1ucywgLi4uZXh0cmFdKSlcbiAgICB9XG5cbiAgICByZXR1cm4gcXVlcnlcbiAgfVxuXG4gIC8qKlxuICAgKiBXaGV0aGVyIGFuIGFscmVhZHktcHJlbG9hZGVkIHJlbGF0aW9uc2hpcCdzIGxvYWRlZCB0YXJnZXQocykgc2F0aXNmeSB0aGVcbiAgICogY29uZmlndXJlZCBzZWxlY3Rpb24sIHNvIHRoZSByZWxhdGlvbnNoaXAgY2FuIGJlIHNraXBwZWQuIFJldHVybnMgZmFsc2VcbiAgICogd2hlbiBgZm9yY2VgIGlzIHNldCwgd2hlbiB0aGUgcmVsYXRpb25zaGlwIGhhc24ndCBiZWVuIHByZWxvYWRlZCwgb3Igd2hlbiBhXG4gICAqIHJlcXVpcmVkIGNvbHVtbiBpcyBtaXNzaW5nIGZyb20gYSBsb2FkZWQgdGFyZ2V0LlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uLy4uL3JlY29yZC9pbnN0YW5jZS1yZWxhdGlvbnNoaXBzL2Jhc2UuanNcIikuZGVmYXVsdH0gYXJncy5pbnN0YW5jZVJlbGF0aW9uc2hpcCAtIFRoZSBzb3VyY2UgbW9kZWwncyBpbnN0YW5jZSByZWxhdGlvbnNoaXAuXG4gICAqIEBwYXJhbSB7dHlwZW9mIGltcG9ydChcIi4uLy4uL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBhcmdzLnRhcmdldE1vZGVsQ2xhc3MgLSBUYXJnZXQgbW9kZWwgY2xhc3MuXG4gICAqIEBwYXJhbSB7c3RyaW5nW119IGFyZ3MubWFwcGluZ0NvbHVtbnMgLSBQcmltYXJ5L2ZvcmVpZ24ga2V5IGNvbHVtbnMgcmVxdWlyZWQgZm9yIG1hcHBpbmcuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgdGhlIHJlbGF0aW9uc2hpcCBpcyBhbHJlYWR5IHNhdGlzZmllZC5cbiAgICovXG4gIGlzU2F0aXNmaWVkKHtpbnN0YW5jZVJlbGF0aW9uc2hpcCwgdGFyZ2V0TW9kZWxDbGFzcywgbWFwcGluZ0NvbHVtbnN9KSB7XG4gICAgaWYgKHRoaXMuZm9yY2UpIHJldHVybiBmYWxzZVxuICAgIGlmICghaW5zdGFuY2VSZWxhdGlvbnNoaXAuZ2V0UHJlbG9hZGVkKCkpIHJldHVybiBmYWxzZVxuXG4gICAgY29uc3QgcmVxdWlyZWQgPSB0aGlzLl9yZXF1aXJlZENvbHVtbnNGb3Ioe3RhcmdldE1vZGVsQ2xhc3MsIG1hcHBpbmdDb2x1bW5zfSlcblxuICAgIGlmICghcmVxdWlyZWQpIHJldHVybiBmYWxzZVxuXG4gICAgY29uc3QgbG9hZGVkID0gaW5zdGFuY2VSZWxhdGlvbnNoaXAuZ2V0TG9hZGVkT3JVbmRlZmluZWQoKVxuICAgIGNvbnN0IHRhcmdldHMgPSBsb2FkZWQgPT09IHVuZGVmaW5lZCA/IFtdIDogKEFycmF5LmlzQXJyYXkobG9hZGVkKSA/IGxvYWRlZCA6IFtsb2FkZWRdKVxuXG4gICAgZm9yIChjb25zdCB0YXJnZXQgb2YgdGFyZ2V0cykge1xuICAgICAgZm9yIChjb25zdCBjb2x1bW4gb2YgcmVxdWlyZWQpIHtcbiAgICAgICAgaWYgKCF0YXJnZXQuaGFzTG9hZGVkQ29sdW1uKGNvbHVtbikpIHJldHVybiBmYWxzZVxuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiB0cnVlXG4gIH1cblxuICAvKipcbiAgICogVGhlIHNldCBvZiBjb2x1bW5zIHRoYXQgbXVzdCBiZSBwcmVzZW50IG9uIGEgbG9hZGVkIHRhcmdldCBmb3IgaXQgdG8gY291bnRcbiAgICogYXMgc2F0aXNmaWVkLiBSZXR1cm5zIG51bGwgd2hlbiBzYXRpc2ZhY3Rpb24gY2FuJ3QgYmUgdmVyaWZpZWQgKGFuIGV4dHJhXG4gICAqIHNlbGVjdCBpcyBhIHJhdyBTUUwgZXhwcmVzc2lvbiB3aG9zZSByZXN1bHRpbmcgY29sdW1uIGNhbid0IGJlIGRlcml2ZWQpLCBpblxuICAgKiB3aGljaCBjYXNlIHRoZSByZWxhdGlvbnNoaXAgaXMgYWx3YXlzIHJlLWxvYWRlZC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHBhcmFtIHt0eXBlb2YgaW1wb3J0KFwiLi4vLi4vcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IGFyZ3MudGFyZ2V0TW9kZWxDbGFzcyAtIFRhcmdldCBtb2RlbCBjbGFzcy5cbiAgICogQHBhcmFtIHtzdHJpbmdbXX0gYXJncy5tYXBwaW5nQ29sdW1ucyAtIFByaW1hcnkvZm9yZWlnbiBrZXkgY29sdW1ucyByZXF1aXJlZCBmb3IgbWFwcGluZy5cbiAgICogQHJldHVybnMge3N0cmluZ1tdIHwgbnVsbH0gLSBSZXF1aXJlZCBjb2x1bW4gbmFtZXMsIG9yIG51bGwgd2hlbiB1bnZlcmlmaWFibGUuXG4gICAqL1xuICBfcmVxdWlyZWRDb2x1bW5zRm9yKHt0YXJnZXRNb2RlbENsYXNzLCBtYXBwaW5nQ29sdW1uc30pIHtcbiAgICBjb25zdCBhdHRyaWJ1dGVNYXAgPSB0YXJnZXRNb2RlbENsYXNzLmdldEF0dHJpYnV0ZU5hbWVUb0NvbHVtbk5hbWVNYXAoKVxuICAgIGNvbnN0IG5hcnJvd2luZyA9IHRoaXMuX25hcnJvd2luZ0Zvcih0YXJnZXRNb2RlbENsYXNzKVxuICAgIGNvbnN0IGV4dHJhID0gdGhpcy5fZXh0cmFGb3IodGFyZ2V0TW9kZWxDbGFzcylcbiAgICAvKipcbiAgICAgKiBDb2x1bW5zLlxuICAgICAqIEB0eXBlIHtzdHJpbmdbXX0gKi9cbiAgICBjb25zdCBjb2x1bW5zID0gW11cblxuICAgIGlmIChuYXJyb3dpbmcpIHtcbiAgICAgIGZvciAoY29uc3QgYXR0cmlidXRlIG9mIG5hcnJvd2luZykgY29sdW1ucy5wdXNoKGF0dHJpYnV0ZU1hcFthdHRyaWJ1dGVdIHx8IGF0dHJpYnV0ZSlcbiAgICAgIGZvciAoY29uc3QgY29sdW1uIG9mIG1hcHBpbmdDb2x1bW5zKSBjb2x1bW5zLnB1c2goY29sdW1uKVxuICAgIH0gZWxzZSB7XG4gICAgICBmb3IgKGNvbnN0IGNvbHVtbiBvZiB0YXJnZXRNb2RlbENsYXNzLmdldENvbHVtbk5hbWVzKCkpIGNvbHVtbnMucHVzaChjb2x1bW4pXG4gICAgfVxuXG4gICAgaWYgKGV4dHJhKSB7XG4gICAgICBmb3IgKGNvbnN0IGVudHJ5IG9mIGV4dHJhKSB7XG4gICAgICAgIGlmICghSURFTlRJRklFUl9SRUdFWC50ZXN0KGVudHJ5KSkgcmV0dXJuIG51bGxcblxuICAgICAgICBjb2x1bW5zLnB1c2goYXR0cmlidXRlTWFwW2VudHJ5XSB8fCBlbnRyeSlcbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gY29sdW1uc1xuICB9XG59XG4iXX0=