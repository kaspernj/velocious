// @ts-check
import BaseStrategy from "./base.js";
/**
 * The `create` strategy. It builds the object graph (associations use the parent
 * create strategy by default), runs beforeAll/beforeBuild/afterBuild, persists the
 * root record through its native `save()` (letting Velocious own association
 * autosave order and validation) or a custom `toCreate`, then runs
 * beforeCreate/afterCreate and guarantees afterAll cleanup.
 */
export default class CreateStrategy extends BaseStrategy {
    /**
     * Runs the strategy.
     * @param {object} args - Options.
     * @param {import("../factory-registry.js").default} args.registry - Owning registry.
     * @param {import("../factory-runner.js").CompiledPlan} args.plan - Compiled plan.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - The persisted record.
     */
    async run({ registry, plan }) {
        const context = this._newContext(registry, plan, "create");
        /** @type {{record: ReturnType<typeof JSON.parse>, transients: Record<string, ReturnType<typeof JSON.parse>>}} */
        const runState = { record: undefined, transients: {} };
        const state = () => ({ record: runState.record, transients: runState.transients, strategy: "create" });
        return await this._runWithAfterAll(context, plan, state, async () => {
            runState.transients = await context.resolveTransients();
            await this._runCallbacks(context, plan, "beforeAll", state());
            await this._runCallbacks(context, plan, "beforeBuild", state());
            const { publicAttributes, transients, associations } = await context.resolveForConstruction();
            const record = await this._constructRecord(plan, publicAttributes, context, transients);
            this._assignAssociations(record, associations);
            runState.record = record;
            await this._runCallbacks(context, plan, "afterBuild", state());
            await this._runCallbacks(context, plan, "beforeCreate", state());
            await this._persist(plan, record, context, transients);
            await this._runCallbacks(context, plan, "afterCreate", state());
            return record;
        });
    }
    /**
     * Persists the record via a custom `toCreate`, native `save()`, or not at all
     * when `skipCreate` is declared.
     * @param {import("../factory-runner.js").CompiledPlan} plan - Compiled plan.
     * @param {ReturnType<typeof JSON.parse>} record - The record to persist.
     * @param {import("../evaluation-context.js").default} context - Evaluation context.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} transients - Evaluated transients.
     * @returns {Promise<void>} - Resolves when persistence completes.
     */
    async _persist(plan, record, context, transients) {
        if (plan.skipCreate)
            return;
        if (plan.toCreate) {
            await plan.toCreate({ record, context: this._callbackContext(context, transients) });
            return;
        }
        await record.save();
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY3JlYXRlLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vLi4vc3JjL3Rlc3RpbmcvZmFjdG9yeS9zdHJhdGVnaWVzL2NyZWF0ZS5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxZQUFZO0FBRVosT0FBTyxZQUFZLE1BQU0sV0FBVyxDQUFBO0FBRXBDOzs7Ozs7R0FNRztBQUNILE1BQU0sQ0FBQyxPQUFPLE9BQU8sY0FBZSxTQUFRLFlBQVk7SUFDdEQ7Ozs7OztPQU1HO0lBQ0gsS0FBSyxDQUFDLEdBQUcsQ0FBQyxFQUFDLFFBQVEsRUFBRSxJQUFJLEVBQUM7UUFDeEIsTUFBTSxPQUFPLEdBQUcsSUFBSSxDQUFDLFdBQVcsQ0FBQyxRQUFRLEVBQUUsSUFBSSxFQUFFLFFBQVEsQ0FBQyxDQUFBO1FBQzFELGlIQUFpSDtRQUNqSCxNQUFNLFFBQVEsR0FBRyxFQUFDLE1BQU0sRUFBRSxTQUFTLEVBQUUsVUFBVSxFQUFFLEVBQUUsRUFBQyxDQUFBO1FBQ3BELE1BQU0sS0FBSyxHQUFHLEdBQUcsRUFBRSxDQUFDLENBQUMsRUFBQyxNQUFNLEVBQUUsUUFBUSxDQUFDLE1BQU0sRUFBRSxVQUFVLEVBQUUsUUFBUSxDQUFDLFVBQVUsRUFBRSxRQUFRLEVBQUUsUUFBUSxFQUFDLENBQUMsQ0FBQTtRQUVwRyxPQUFPLE1BQU0sSUFBSSxDQUFDLGdCQUFnQixDQUFDLE9BQU8sRUFBRSxJQUFJLEVBQUUsS0FBSyxFQUFFLEtBQUssSUFBSSxFQUFFO1lBQ2xFLFFBQVEsQ0FBQyxVQUFVLEdBQUcsTUFBTSxPQUFPLENBQUMsaUJBQWlCLEVBQUUsQ0FBQTtZQUV2RCxNQUFNLElBQUksQ0FBQyxhQUFhLENBQUMsT0FBTyxFQUFFLElBQUksRUFBRSxXQUFXLEVBQUUsS0FBSyxFQUFFLENBQUMsQ0FBQTtZQUM3RCxNQUFNLElBQUksQ0FBQyxhQUFhLENBQUMsT0FBTyxFQUFFLElBQUksRUFBRSxhQUFhLEVBQUUsS0FBSyxFQUFFLENBQUMsQ0FBQTtZQUUvRCxNQUFNLEVBQUMsZ0JBQWdCLEVBQUUsVUFBVSxFQUFFLFlBQVksRUFBQyxHQUFHLE1BQU0sT0FBTyxDQUFDLHNCQUFzQixFQUFFLENBQUE7WUFFM0YsTUFBTSxNQUFNLEdBQUcsTUFBTSxJQUFJLENBQUMsZ0JBQWdCLENBQUMsSUFBSSxFQUFFLGdCQUFnQixFQUFFLE9BQU8sRUFBRSxVQUFVLENBQUMsQ0FBQTtZQUV2RixJQUFJLENBQUMsbUJBQW1CLENBQUMsTUFBTSxFQUFFLFlBQVksQ0FBQyxDQUFBO1lBQzlDLFFBQVEsQ0FBQyxNQUFNLEdBQUcsTUFBTSxDQUFBO1lBRXhCLE1BQU0sSUFBSSxDQUFDLGFBQWEsQ0FBQyxPQUFPLEVBQUUsSUFBSSxFQUFFLFlBQVksRUFBRSxLQUFLLEVBQUUsQ0FBQyxDQUFBO1lBQzlELE1BQU0sSUFBSSxDQUFDLGFBQWEsQ0FBQyxPQUFPLEVBQUUsSUFBSSxFQUFFLGNBQWMsRUFBRSxLQUFLLEVBQUUsQ0FBQyxDQUFBO1lBQ2hFLE1BQU0sSUFBSSxDQUFDLFFBQVEsQ0FBQyxJQUFJLEVBQUUsTUFBTSxFQUFFLE9BQU8sRUFBRSxVQUFVLENBQUMsQ0FBQTtZQUN0RCxNQUFNLElBQUksQ0FBQyxhQUFhLENBQUMsT0FBTyxFQUFFLElBQUksRUFBRSxhQUFhLEVBQUUsS0FBSyxFQUFFLENBQUMsQ0FBQTtZQUUvRCxPQUFPLE1BQU0sQ0FBQTtRQUNmLENBQUMsQ0FBQyxDQUFBO0lBQ0osQ0FBQztJQUVEOzs7Ozs7OztPQVFHO0lBQ0gsS0FBSyxDQUFDLFFBQVEsQ0FBQyxJQUFJLEVBQUUsTUFBTSxFQUFFLE9BQU8sRUFBRSxVQUFVO1FBQzlDLElBQUksSUFBSSxDQUFDLFVBQVU7WUFBRSxPQUFNO1FBRTNCLElBQUksSUFBSSxDQUFDLFFBQVEsRUFBRSxDQUFDO1lBQ2xCLE1BQU0sSUFBSSxDQUFDLFFBQVEsQ0FBQyxFQUFDLE1BQU0sRUFBRSxPQUFPLEVBQUUsSUFBSSxDQUFDLGdCQUFnQixDQUFDLE9BQU8sRUFBRSxVQUFVLENBQUMsRUFBQyxDQUFDLENBQUE7WUFFbEYsT0FBTTtRQUNSLENBQUM7UUFFRCxNQUFNLE1BQU0sQ0FBQyxJQUFJLEVBQUUsQ0FBQTtJQUNyQixDQUFDO0NBQ0YiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuaW1wb3J0IEJhc2VTdHJhdGVneSBmcm9tIFwiLi9iYXNlLmpzXCJcblxuLyoqXG4gKiBUaGUgYGNyZWF0ZWAgc3RyYXRlZ3kuIEl0IGJ1aWxkcyB0aGUgb2JqZWN0IGdyYXBoIChhc3NvY2lhdGlvbnMgdXNlIHRoZSBwYXJlbnRcbiAqIGNyZWF0ZSBzdHJhdGVneSBieSBkZWZhdWx0KSwgcnVucyBiZWZvcmVBbGwvYmVmb3JlQnVpbGQvYWZ0ZXJCdWlsZCwgcGVyc2lzdHMgdGhlXG4gKiByb290IHJlY29yZCB0aHJvdWdoIGl0cyBuYXRpdmUgYHNhdmUoKWAgKGxldHRpbmcgVmVsb2Npb3VzIG93biBhc3NvY2lhdGlvblxuICogYXV0b3NhdmUgb3JkZXIgYW5kIHZhbGlkYXRpb24pIG9yIGEgY3VzdG9tIGB0b0NyZWF0ZWAsIHRoZW4gcnVuc1xuICogYmVmb3JlQ3JlYXRlL2FmdGVyQ3JlYXRlIGFuZCBndWFyYW50ZWVzIGFmdGVyQWxsIGNsZWFudXAuXG4gKi9cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIENyZWF0ZVN0cmF0ZWd5IGV4dGVuZHMgQmFzZVN0cmF0ZWd5IHtcbiAgLyoqXG4gICAqIFJ1bnMgdGhlIHN0cmF0ZWd5LlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZmFjdG9yeS1yZWdpc3RyeS5qc1wiKS5kZWZhdWx0fSBhcmdzLnJlZ2lzdHJ5IC0gT3duaW5nIHJlZ2lzdHJ5LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2ZhY3RvcnktcnVubmVyLmpzXCIpLkNvbXBpbGVkUGxhbn0gYXJncy5wbGFuIC0gQ29tcGlsZWQgcGxhbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIFRoZSBwZXJzaXN0ZWQgcmVjb3JkLlxuICAgKi9cbiAgYXN5bmMgcnVuKHtyZWdpc3RyeSwgcGxhbn0pIHtcbiAgICBjb25zdCBjb250ZXh0ID0gdGhpcy5fbmV3Q29udGV4dChyZWdpc3RyeSwgcGxhbiwgXCJjcmVhdGVcIilcbiAgICAvKiogQHR5cGUge3tyZWNvcmQ6IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+LCB0cmFuc2llbnRzOiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59fSAqL1xuICAgIGNvbnN0IHJ1blN0YXRlID0ge3JlY29yZDogdW5kZWZpbmVkLCB0cmFuc2llbnRzOiB7fX1cbiAgICBjb25zdCBzdGF0ZSA9ICgpID0+ICh7cmVjb3JkOiBydW5TdGF0ZS5yZWNvcmQsIHRyYW5zaWVudHM6IHJ1blN0YXRlLnRyYW5zaWVudHMsIHN0cmF0ZWd5OiBcImNyZWF0ZVwifSlcblxuICAgIHJldHVybiBhd2FpdCB0aGlzLl9ydW5XaXRoQWZ0ZXJBbGwoY29udGV4dCwgcGxhbiwgc3RhdGUsIGFzeW5jICgpID0+IHtcbiAgICAgIHJ1blN0YXRlLnRyYW5zaWVudHMgPSBhd2FpdCBjb250ZXh0LnJlc29sdmVUcmFuc2llbnRzKClcblxuICAgICAgYXdhaXQgdGhpcy5fcnVuQ2FsbGJhY2tzKGNvbnRleHQsIHBsYW4sIFwiYmVmb3JlQWxsXCIsIHN0YXRlKCkpXG4gICAgICBhd2FpdCB0aGlzLl9ydW5DYWxsYmFja3MoY29udGV4dCwgcGxhbiwgXCJiZWZvcmVCdWlsZFwiLCBzdGF0ZSgpKVxuXG4gICAgICBjb25zdCB7cHVibGljQXR0cmlidXRlcywgdHJhbnNpZW50cywgYXNzb2NpYXRpb25zfSA9IGF3YWl0IGNvbnRleHQucmVzb2x2ZUZvckNvbnN0cnVjdGlvbigpXG5cbiAgICAgIGNvbnN0IHJlY29yZCA9IGF3YWl0IHRoaXMuX2NvbnN0cnVjdFJlY29yZChwbGFuLCBwdWJsaWNBdHRyaWJ1dGVzLCBjb250ZXh0LCB0cmFuc2llbnRzKVxuXG4gICAgICB0aGlzLl9hc3NpZ25Bc3NvY2lhdGlvbnMocmVjb3JkLCBhc3NvY2lhdGlvbnMpXG4gICAgICBydW5TdGF0ZS5yZWNvcmQgPSByZWNvcmRcblxuICAgICAgYXdhaXQgdGhpcy5fcnVuQ2FsbGJhY2tzKGNvbnRleHQsIHBsYW4sIFwiYWZ0ZXJCdWlsZFwiLCBzdGF0ZSgpKVxuICAgICAgYXdhaXQgdGhpcy5fcnVuQ2FsbGJhY2tzKGNvbnRleHQsIHBsYW4sIFwiYmVmb3JlQ3JlYXRlXCIsIHN0YXRlKCkpXG4gICAgICBhd2FpdCB0aGlzLl9wZXJzaXN0KHBsYW4sIHJlY29yZCwgY29udGV4dCwgdHJhbnNpZW50cylcbiAgICAgIGF3YWl0IHRoaXMuX3J1bkNhbGxiYWNrcyhjb250ZXh0LCBwbGFuLCBcImFmdGVyQ3JlYXRlXCIsIHN0YXRlKCkpXG5cbiAgICAgIHJldHVybiByZWNvcmRcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFBlcnNpc3RzIHRoZSByZWNvcmQgdmlhIGEgY3VzdG9tIGB0b0NyZWF0ZWAsIG5hdGl2ZSBgc2F2ZSgpYCwgb3Igbm90IGF0IGFsbFxuICAgKiB3aGVuIGBza2lwQ3JlYXRlYCBpcyBkZWNsYXJlZC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9mYWN0b3J5LXJ1bm5lci5qc1wiKS5Db21waWxlZFBsYW59IHBsYW4gLSBDb21waWxlZCBwbGFuLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSByZWNvcmQgLSBUaGUgcmVjb3JkIHRvIHBlcnNpc3QuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZXZhbHVhdGlvbi1jb250ZXh0LmpzXCIpLmRlZmF1bHR9IGNvbnRleHQgLSBFdmFsdWF0aW9uIGNvbnRleHQuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSB0cmFuc2llbnRzIC0gRXZhbHVhdGVkIHRyYW5zaWVudHMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gcGVyc2lzdGVuY2UgY29tcGxldGVzLlxuICAgKi9cbiAgYXN5bmMgX3BlcnNpc3QocGxhbiwgcmVjb3JkLCBjb250ZXh0LCB0cmFuc2llbnRzKSB7XG4gICAgaWYgKHBsYW4uc2tpcENyZWF0ZSkgcmV0dXJuXG5cbiAgICBpZiAocGxhbi50b0NyZWF0ZSkge1xuICAgICAgYXdhaXQgcGxhbi50b0NyZWF0ZSh7cmVjb3JkLCBjb250ZXh0OiB0aGlzLl9jYWxsYmFja0NvbnRleHQoY29udGV4dCwgdHJhbnNpZW50cyl9KVxuXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBhd2FpdCByZWNvcmQuc2F2ZSgpXG4gIH1cbn1cbiJdfQ==