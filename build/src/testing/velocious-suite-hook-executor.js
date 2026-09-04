// @ts-check
import restArgsError from "../utils/rest-args-error.js";
export default class VelociousSuiteHookExecutor {
    /**
     * Creates an executor for Velocious suite hooks.
     * @param {object} args - Constructor arguments.
     * @param {import("./test-runner.js").default} args.testRunner - Owning Velocious runner.
     */
    constructor({ testRunner, ...restArgs }) {
        restArgsError(restArgs);
        this.testRunner = testRunner;
    }
    /**
     * Runs suite setup hooks in declaration order.
     * @param {object} args - Hook execution arguments.
     * @param {import("./test-runner.js").BeforeAfterAllCallbackObjectType[]} args.hooks - Profiled setup hooks.
     * @returns {Promise<void>} - Resolves after every setup hook completes.
     */
    async runBeforeAlls({ hooks, ...restArgs }) {
        restArgsError(restArgs);
        for (const hook of hooks) {
            await this.runHook(hook, "beforeAll");
        }
    }
    /**
     * Runs every suite teardown hook in reverse declaration order.
     * @param {object} args - Hook execution arguments.
     * @param {import("./test-runner.js").BeforeAfterAllCallbackObjectType[]} args.hooks - Profiled teardown hooks.
     * @returns {Promise<void>} - Resolves after every teardown hook settles.
     */
    async runAfterAlls({ hooks, ...restArgs }) {
        restArgsError(restArgs);
        /** @type {ReturnType<typeof JSON.parse>[]} */
        const errors = [];
        for (const hook of [...hooks].reverse()) {
            try {
                await this.runHook(hook, "afterAll");
            }
            catch (error) {
                errors.push(error);
            }
        }
        if (errors.length == 1)
            throw errors[0];
        if (errors.length > 1) {
            throw new AggregateError(errors, "Multiple afterAll hooks failed", { cause: errors[0] });
        }
    }
    /**
     * Runs one suite hook with its Velocious profiler attribution.
     * @param {import("./test-runner.js").BeforeAfterAllCallbackObjectType} hook - Hook registration.
     * @param {"beforeAll" | "afterAll"} phase - Profiler phase.
     * @returns {Promise<void>} - Resolves when the hook completes.
     */
    async runHook(hook, phase) {
        await this.testRunner.runProfileSpan({
            phase,
            declarationIndex: hook.declarationIndex,
            declarationScopeId: hook.declarationScopeId,
            filePath: hook.ownerFilePath
        }, async () => {
            await hook.callback({ configuration: this.testRunner.getConfiguration() });
        });
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidmVsb2Npb3VzLXN1aXRlLWhvb2stZXhlY3V0b3IuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvdGVzdGluZy92ZWxvY2lvdXMtc3VpdGUtaG9vay1leGVjdXRvci5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxZQUFZO0FBRVosT0FBTyxhQUFhLE1BQU0sNkJBQTZCLENBQUE7QUFFdkQsTUFBTSxDQUFDLE9BQU8sT0FBTywwQkFBMEI7SUFDN0M7Ozs7T0FJRztJQUNILFlBQVksRUFBQyxVQUFVLEVBQUUsR0FBRyxRQUFRLEVBQUM7UUFDbkMsYUFBYSxDQUFDLFFBQVEsQ0FBQyxDQUFBO1FBQ3ZCLElBQUksQ0FBQyxVQUFVLEdBQUcsVUFBVSxDQUFBO0lBQzlCLENBQUM7SUFFRDs7Ozs7T0FLRztJQUNILEtBQUssQ0FBQyxhQUFhLENBQUMsRUFBQyxLQUFLLEVBQUUsR0FBRyxRQUFRLEVBQUM7UUFDdEMsYUFBYSxDQUFDLFFBQVEsQ0FBQyxDQUFBO1FBRXZCLEtBQUssTUFBTSxJQUFJLElBQUksS0FBSyxFQUFFLENBQUM7WUFDekIsTUFBTSxJQUFJLENBQUMsT0FBTyxDQUFDLElBQUksRUFBRSxXQUFXLENBQUMsQ0FBQTtRQUN2QyxDQUFDO0lBQ0gsQ0FBQztJQUVEOzs7OztPQUtHO0lBQ0gsS0FBSyxDQUFDLFlBQVksQ0FBQyxFQUFDLEtBQUssRUFBRSxHQUFHLFFBQVEsRUFBQztRQUNyQyxhQUFhLENBQUMsUUFBUSxDQUFDLENBQUE7UUFDdkIsOENBQThDO1FBQzlDLE1BQU0sTUFBTSxHQUFHLEVBQUUsQ0FBQTtRQUVqQixLQUFLLE1BQU0sSUFBSSxJQUFJLENBQUMsR0FBRyxLQUFLLENBQUMsQ0FBQyxPQUFPLEVBQUUsRUFBRSxDQUFDO1lBQ3hDLElBQUksQ0FBQztnQkFDSCxNQUFNLElBQUksQ0FBQyxPQUFPLENBQUMsSUFBSSxFQUFFLFVBQVUsQ0FBQyxDQUFBO1lBQ3RDLENBQUM7WUFBQyxPQUFPLEtBQUssRUFBRSxDQUFDO2dCQUNmLE1BQU0sQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFDLENBQUE7WUFDcEIsQ0FBQztRQUNILENBQUM7UUFFRCxJQUFJLE1BQU0sQ0FBQyxNQUFNLElBQUksQ0FBQztZQUFFLE1BQU0sTUFBTSxDQUFDLENBQUMsQ0FBQyxDQUFBO1FBQ3ZDLElBQUksTUFBTSxDQUFDLE1BQU0sR0FBRyxDQUFDLEVBQUUsQ0FBQztZQUN0QixNQUFNLElBQUksY0FBYyxDQUFDLE1BQU0sRUFBRSxnQ0FBZ0MsRUFBRSxFQUFDLEtBQUssRUFBRSxNQUFNLENBQUMsQ0FBQyxDQUFDLEVBQUMsQ0FBQyxDQUFBO1FBQ3hGLENBQUM7SUFDSCxDQUFDO0lBRUQ7Ozs7O09BS0c7SUFDSCxLQUFLLENBQUMsT0FBTyxDQUFDLElBQUksRUFBRSxLQUFLO1FBQ3ZCLE1BQU0sSUFBSSxDQUFDLFVBQVUsQ0FBQyxjQUFjLENBQUM7WUFDbkMsS0FBSztZQUNMLGdCQUFnQixFQUFFLElBQUksQ0FBQyxnQkFBZ0I7WUFDdkMsa0JBQWtCLEVBQUUsSUFBSSxDQUFDLGtCQUFrQjtZQUMzQyxRQUFRLEVBQUUsSUFBSSxDQUFDLGFBQWE7U0FDN0IsRUFBRSxLQUFLLElBQUksRUFBRTtZQUNaLE1BQU0sSUFBSSxDQUFDLFFBQVEsQ0FBQyxFQUFDLGFBQWEsRUFBRSxJQUFJLENBQUMsVUFBVSxDQUFDLGdCQUFnQixFQUFFLEVBQUMsQ0FBQyxDQUFBO1FBQzFFLENBQUMsQ0FBQyxDQUFBO0lBQ0osQ0FBQztDQUNGIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbmltcG9ydCByZXN0QXJnc0Vycm9yIGZyb20gXCIuLi91dGlscy9yZXN0LWFyZ3MtZXJyb3IuanNcIlxuXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBWZWxvY2lvdXNTdWl0ZUhvb2tFeGVjdXRvciB7XG4gIC8qKlxuICAgKiBDcmVhdGVzIGFuIGV4ZWN1dG9yIGZvciBWZWxvY2lvdXMgc3VpdGUgaG9va3MuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gQ29uc3RydWN0b3IgYXJndW1lbnRzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdGVzdC1ydW5uZXIuanNcIikuZGVmYXVsdH0gYXJncy50ZXN0UnVubmVyIC0gT3duaW5nIFZlbG9jaW91cyBydW5uZXIuXG4gICAqL1xuICBjb25zdHJ1Y3Rvcih7dGVzdFJ1bm5lciwgLi4ucmVzdEFyZ3N9KSB7XG4gICAgcmVzdEFyZ3NFcnJvcihyZXN0QXJncylcbiAgICB0aGlzLnRlc3RSdW5uZXIgPSB0ZXN0UnVubmVyXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzdWl0ZSBzZXR1cCBob29rcyBpbiBkZWNsYXJhdGlvbiBvcmRlci5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBIb29rIGV4ZWN1dGlvbiBhcmd1bWVudHMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90ZXN0LXJ1bm5lci5qc1wiKS5CZWZvcmVBZnRlckFsbENhbGxiYWNrT2JqZWN0VHlwZVtdfSBhcmdzLmhvb2tzIC0gUHJvZmlsZWQgc2V0dXAgaG9va3MuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIGV2ZXJ5IHNldHVwIGhvb2sgY29tcGxldGVzLlxuICAgKi9cbiAgYXN5bmMgcnVuQmVmb3JlQWxscyh7aG9va3MsIC4uLnJlc3RBcmdzfSkge1xuICAgIHJlc3RBcmdzRXJyb3IocmVzdEFyZ3MpXG5cbiAgICBmb3IgKGNvbnN0IGhvb2sgb2YgaG9va3MpIHtcbiAgICAgIGF3YWl0IHRoaXMucnVuSG9vayhob29rLCBcImJlZm9yZUFsbFwiKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGV2ZXJ5IHN1aXRlIHRlYXJkb3duIGhvb2sgaW4gcmV2ZXJzZSBkZWNsYXJhdGlvbiBvcmRlci5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBIb29rIGV4ZWN1dGlvbiBhcmd1bWVudHMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90ZXN0LXJ1bm5lci5qc1wiKS5CZWZvcmVBZnRlckFsbENhbGxiYWNrT2JqZWN0VHlwZVtdfSBhcmdzLmhvb2tzIC0gUHJvZmlsZWQgdGVhcmRvd24gaG9va3MuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIGV2ZXJ5IHRlYXJkb3duIGhvb2sgc2V0dGxlcy5cbiAgICovXG4gIGFzeW5jIHJ1bkFmdGVyQWxscyh7aG9va3MsIC4uLnJlc3RBcmdzfSkge1xuICAgIHJlc3RBcmdzRXJyb3IocmVzdEFyZ3MpXG4gICAgLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPltdfSAqL1xuICAgIGNvbnN0IGVycm9ycyA9IFtdXG5cbiAgICBmb3IgKGNvbnN0IGhvb2sgb2YgWy4uLmhvb2tzXS5yZXZlcnNlKCkpIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGF3YWl0IHRoaXMucnVuSG9vayhob29rLCBcImFmdGVyQWxsXCIpXG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBlcnJvcnMucHVzaChlcnJvcilcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAoZXJyb3JzLmxlbmd0aCA9PSAxKSB0aHJvdyBlcnJvcnNbMF1cbiAgICBpZiAoZXJyb3JzLmxlbmd0aCA+IDEpIHtcbiAgICAgIHRocm93IG5ldyBBZ2dyZWdhdGVFcnJvcihlcnJvcnMsIFwiTXVsdGlwbGUgYWZ0ZXJBbGwgaG9va3MgZmFpbGVkXCIsIHtjYXVzZTogZXJyb3JzWzBdfSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBvbmUgc3VpdGUgaG9vayB3aXRoIGl0cyBWZWxvY2lvdXMgcHJvZmlsZXIgYXR0cmlidXRpb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90ZXN0LXJ1bm5lci5qc1wiKS5CZWZvcmVBZnRlckFsbENhbGxiYWNrT2JqZWN0VHlwZX0gaG9vayAtIEhvb2sgcmVnaXN0cmF0aW9uLlxuICAgKiBAcGFyYW0ge1wiYmVmb3JlQWxsXCIgfCBcImFmdGVyQWxsXCJ9IHBoYXNlIC0gUHJvZmlsZXIgcGhhc2UuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gdGhlIGhvb2sgY29tcGxldGVzLlxuICAgKi9cbiAgYXN5bmMgcnVuSG9vayhob29rLCBwaGFzZSkge1xuICAgIGF3YWl0IHRoaXMudGVzdFJ1bm5lci5ydW5Qcm9maWxlU3Bhbih7XG4gICAgICBwaGFzZSxcbiAgICAgIGRlY2xhcmF0aW9uSW5kZXg6IGhvb2suZGVjbGFyYXRpb25JbmRleCxcbiAgICAgIGRlY2xhcmF0aW9uU2NvcGVJZDogaG9vay5kZWNsYXJhdGlvblNjb3BlSWQsXG4gICAgICBmaWxlUGF0aDogaG9vay5vd25lckZpbGVQYXRoXG4gICAgfSwgYXN5bmMgKCkgPT4ge1xuICAgICAgYXdhaXQgaG9vay5jYWxsYmFjayh7Y29uZmlndXJhdGlvbjogdGhpcy50ZXN0UnVubmVyLmdldENvbmZpZ3VyYXRpb24oKX0pXG4gICAgfSlcbiAgfVxufVxuIl19