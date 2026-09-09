// @ts-check
import BaseStrategy from "./base.js";
/**
 * The `build` strategy. It recursively builds associated models (using the parent
 * strategy) and constructs the root record without persisting anything. Runs the
 * beforeAll/beforeBuild/afterBuild callbacks and guarantees afterAll cleanup.
 */
export default class BuildStrategy extends BaseStrategy {
    /**
     * Runs the strategy.
     * @param {object} args - Options.
     * @param {import("../factory-registry.js").default} args.registry - Owning registry.
     * @param {import("../factory-runner.js").CompiledPlan} args.plan - Compiled plan.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - The built (unsaved) record.
     */
    async run({ registry, plan }) {
        const context = this._newContext(registry, plan, "build");
        /** @type {{record: ReturnType<typeof JSON.parse>, transients: Record<string, ReturnType<typeof JSON.parse>>}} */
        const runState = { record: undefined, transients: {} };
        const state = () => ({ record: runState.record, transients: runState.transients, strategy: "build" });
        return await this._runWithAfterAll(context, plan, state, async () => {
            runState.transients = await context.resolveTransients();
            await this._runCallbacks(context, plan, "beforeAll", state());
            await this._runCallbacks(context, plan, "beforeBuild", state());
            const { publicAttributes, transients, associations } = await context.resolveForConstruction();
            const record = await this._constructRecord(plan, publicAttributes, context, transients);
            this._assignAssociations(record, associations);
            runState.record = record;
            await this._runCallbacks(context, plan, "afterBuild", state());
            return record;
        });
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYnVpbGQuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi8uLi9zcmMvdGVzdGluZy9mYWN0b3J5L3N0cmF0ZWdpZXMvYnVpbGQuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLE9BQU8sWUFBWSxNQUFNLFdBQVcsQ0FBQTtBQUVwQzs7OztHQUlHO0FBQ0gsTUFBTSxDQUFDLE9BQU8sT0FBTyxhQUFjLFNBQVEsWUFBWTtJQUNyRDs7Ozs7O09BTUc7SUFDSCxLQUFLLENBQUMsR0FBRyxDQUFDLEVBQUMsUUFBUSxFQUFFLElBQUksRUFBQztRQUN4QixNQUFNLE9BQU8sR0FBRyxJQUFJLENBQUMsV0FBVyxDQUFDLFFBQVEsRUFBRSxJQUFJLEVBQUUsT0FBTyxDQUFDLENBQUE7UUFDekQsaUhBQWlIO1FBQ2pILE1BQU0sUUFBUSxHQUFHLEVBQUMsTUFBTSxFQUFFLFNBQVMsRUFBRSxVQUFVLEVBQUUsRUFBRSxFQUFDLENBQUE7UUFDcEQsTUFBTSxLQUFLLEdBQUcsR0FBRyxFQUFFLENBQUMsQ0FBQyxFQUFDLE1BQU0sRUFBRSxRQUFRLENBQUMsTUFBTSxFQUFFLFVBQVUsRUFBRSxRQUFRLENBQUMsVUFBVSxFQUFFLFFBQVEsRUFBRSxPQUFPLEVBQUMsQ0FBQyxDQUFBO1FBRW5HLE9BQU8sTUFBTSxJQUFJLENBQUMsZ0JBQWdCLENBQUMsT0FBTyxFQUFFLElBQUksRUFBRSxLQUFLLEVBQUUsS0FBSyxJQUFJLEVBQUU7WUFDbEUsUUFBUSxDQUFDLFVBQVUsR0FBRyxNQUFNLE9BQU8sQ0FBQyxpQkFBaUIsRUFBRSxDQUFBO1lBRXZELE1BQU0sSUFBSSxDQUFDLGFBQWEsQ0FBQyxPQUFPLEVBQUUsSUFBSSxFQUFFLFdBQVcsRUFBRSxLQUFLLEVBQUUsQ0FBQyxDQUFBO1lBQzdELE1BQU0sSUFBSSxDQUFDLGFBQWEsQ0FBQyxPQUFPLEVBQUUsSUFBSSxFQUFFLGFBQWEsRUFBRSxLQUFLLEVBQUUsQ0FBQyxDQUFBO1lBRS9ELE1BQU0sRUFBQyxnQkFBZ0IsRUFBRSxVQUFVLEVBQUUsWUFBWSxFQUFDLEdBQUcsTUFBTSxPQUFPLENBQUMsc0JBQXNCLEVBQUUsQ0FBQTtZQUUzRixNQUFNLE1BQU0sR0FBRyxNQUFNLElBQUksQ0FBQyxnQkFBZ0IsQ0FBQyxJQUFJLEVBQUUsZ0JBQWdCLEVBQUUsT0FBTyxFQUFFLFVBQVUsQ0FBQyxDQUFBO1lBRXZGLElBQUksQ0FBQyxtQkFBbUIsQ0FBQyxNQUFNLEVBQUUsWUFBWSxDQUFDLENBQUE7WUFDOUMsUUFBUSxDQUFDLE1BQU0sR0FBRyxNQUFNLENBQUE7WUFFeEIsTUFBTSxJQUFJLENBQUMsYUFBYSxDQUFDLE9BQU8sRUFBRSxJQUFJLEVBQUUsWUFBWSxFQUFFLEtBQUssRUFBRSxDQUFDLENBQUE7WUFFOUQsT0FBTyxNQUFNLENBQUE7UUFDZixDQUFDLENBQUMsQ0FBQTtJQUNKLENBQUM7Q0FDRiIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG5pbXBvcnQgQmFzZVN0cmF0ZWd5IGZyb20gXCIuL2Jhc2UuanNcIlxuXG4vKipcbiAqIFRoZSBgYnVpbGRgIHN0cmF0ZWd5LiBJdCByZWN1cnNpdmVseSBidWlsZHMgYXNzb2NpYXRlZCBtb2RlbHMgKHVzaW5nIHRoZSBwYXJlbnRcbiAqIHN0cmF0ZWd5KSBhbmQgY29uc3RydWN0cyB0aGUgcm9vdCByZWNvcmQgd2l0aG91dCBwZXJzaXN0aW5nIGFueXRoaW5nLiBSdW5zIHRoZVxuICogYmVmb3JlQWxsL2JlZm9yZUJ1aWxkL2FmdGVyQnVpbGQgY2FsbGJhY2tzIGFuZCBndWFyYW50ZWVzIGFmdGVyQWxsIGNsZWFudXAuXG4gKi9cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIEJ1aWxkU3RyYXRlZ3kgZXh0ZW5kcyBCYXNlU3RyYXRlZ3kge1xuICAvKipcbiAgICogUnVucyB0aGUgc3RyYXRlZ3kuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9mYWN0b3J5LXJlZ2lzdHJ5LmpzXCIpLmRlZmF1bHR9IGFyZ3MucmVnaXN0cnkgLSBPd25pbmcgcmVnaXN0cnkuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZmFjdG9yeS1ydW5uZXIuanNcIikuQ29tcGlsZWRQbGFufSBhcmdzLnBsYW4gLSBDb21waWxlZCBwbGFuLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gVGhlIGJ1aWx0ICh1bnNhdmVkKSByZWNvcmQuXG4gICAqL1xuICBhc3luYyBydW4oe3JlZ2lzdHJ5LCBwbGFufSkge1xuICAgIGNvbnN0IGNvbnRleHQgPSB0aGlzLl9uZXdDb250ZXh0KHJlZ2lzdHJ5LCBwbGFuLCBcImJ1aWxkXCIpXG4gICAgLyoqIEB0eXBlIHt7cmVjb3JkOiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPiwgdHJhbnNpZW50czogUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fX0gKi9cbiAgICBjb25zdCBydW5TdGF0ZSA9IHtyZWNvcmQ6IHVuZGVmaW5lZCwgdHJhbnNpZW50czoge319XG4gICAgY29uc3Qgc3RhdGUgPSAoKSA9PiAoe3JlY29yZDogcnVuU3RhdGUucmVjb3JkLCB0cmFuc2llbnRzOiBydW5TdGF0ZS50cmFuc2llbnRzLCBzdHJhdGVneTogXCJidWlsZFwifSlcblxuICAgIHJldHVybiBhd2FpdCB0aGlzLl9ydW5XaXRoQWZ0ZXJBbGwoY29udGV4dCwgcGxhbiwgc3RhdGUsIGFzeW5jICgpID0+IHtcbiAgICAgIHJ1blN0YXRlLnRyYW5zaWVudHMgPSBhd2FpdCBjb250ZXh0LnJlc29sdmVUcmFuc2llbnRzKClcblxuICAgICAgYXdhaXQgdGhpcy5fcnVuQ2FsbGJhY2tzKGNvbnRleHQsIHBsYW4sIFwiYmVmb3JlQWxsXCIsIHN0YXRlKCkpXG4gICAgICBhd2FpdCB0aGlzLl9ydW5DYWxsYmFja3MoY29udGV4dCwgcGxhbiwgXCJiZWZvcmVCdWlsZFwiLCBzdGF0ZSgpKVxuXG4gICAgICBjb25zdCB7cHVibGljQXR0cmlidXRlcywgdHJhbnNpZW50cywgYXNzb2NpYXRpb25zfSA9IGF3YWl0IGNvbnRleHQucmVzb2x2ZUZvckNvbnN0cnVjdGlvbigpXG5cbiAgICAgIGNvbnN0IHJlY29yZCA9IGF3YWl0IHRoaXMuX2NvbnN0cnVjdFJlY29yZChwbGFuLCBwdWJsaWNBdHRyaWJ1dGVzLCBjb250ZXh0LCB0cmFuc2llbnRzKVxuXG4gICAgICB0aGlzLl9hc3NpZ25Bc3NvY2lhdGlvbnMocmVjb3JkLCBhc3NvY2lhdGlvbnMpXG4gICAgICBydW5TdGF0ZS5yZWNvcmQgPSByZWNvcmRcblxuICAgICAgYXdhaXQgdGhpcy5fcnVuQ2FsbGJhY2tzKGNvbnRleHQsIHBsYW4sIFwiYWZ0ZXJCdWlsZFwiLCBzdGF0ZSgpKVxuXG4gICAgICByZXR1cm4gcmVjb3JkXG4gICAgfSlcbiAgfVxufVxuIl19