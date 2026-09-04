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
     * Supplies the framework configuration while package traversal owns ordering,
     * timeout enforcement, aggregation, and active-scope cleanup.
     * @param {import("@velocious/testing/runner").SuiteHookExecutorInput} input - Package hook input.
     * @returns {Promise<void>} - Resolves after the hook completes.
     */
    async execute({ context, defaultExecute, fullName, hook, phase, suite, timeoutMs, ...restArgs }) {
        restArgsError(restArgs);
        void context;
        void fullName;
        void timeoutMs;
        const metadata = this.testRunner.hookMetadata(hook);
        try {
            await this.testRunner.runProfileSpan({
                phase,
                declarationIndex: metadata.declarationIndex,
                declarationScopeId: metadata.declarationScopeId,
                filePath: metadata.ownerFilePath
            }, async () => {
                await defaultExecute([{ configuration: this.testRunner.getConfiguration() }]);
            });
        }
        catch (error) {
            this.testRunner.recordSuiteHookFailure({ suite, phase, error });
            throw error;
        }
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidmVsb2Npb3VzLXN1aXRlLWhvb2stZXhlY3V0b3IuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvdGVzdGluZy92ZWxvY2lvdXMtc3VpdGUtaG9vay1leGVjdXRvci5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxZQUFZO0FBRVosT0FBTyxhQUFhLE1BQU0sNkJBQTZCLENBQUE7QUFFdkQsTUFBTSxDQUFDLE9BQU8sT0FBTywwQkFBMEI7SUFDN0M7Ozs7T0FJRztJQUNILFlBQVksRUFBQyxVQUFVLEVBQUUsR0FBRyxRQUFRLEVBQUM7UUFDbkMsYUFBYSxDQUFDLFFBQVEsQ0FBQyxDQUFBO1FBQ3ZCLElBQUksQ0FBQyxVQUFVLEdBQUcsVUFBVSxDQUFBO0lBQzlCLENBQUM7SUFFRDs7Ozs7T0FLRztJQUNILEtBQUssQ0FBQyxPQUFPLENBQUMsRUFBQyxPQUFPLEVBQUUsY0FBYyxFQUFFLFFBQVEsRUFBRSxJQUFJLEVBQUUsS0FBSyxFQUFFLEtBQUssRUFBRSxTQUFTLEVBQUUsR0FBRyxRQUFRLEVBQUM7UUFDM0YsYUFBYSxDQUFDLFFBQVEsQ0FBQyxDQUFBO1FBQ3ZCLEtBQUssT0FBTyxDQUFBO1FBQ1osS0FBSyxRQUFRLENBQUE7UUFDYixLQUFLLFNBQVMsQ0FBQTtRQUNkLE1BQU0sUUFBUSxHQUFHLElBQUksQ0FBQyxVQUFVLENBQUMsWUFBWSxDQUFDLElBQUksQ0FBQyxDQUFBO1FBRW5ELElBQUksQ0FBQztZQUNILE1BQU0sSUFBSSxDQUFDLFVBQVUsQ0FBQyxjQUFjLENBQUM7Z0JBQ25DLEtBQUs7Z0JBQ0wsZ0JBQWdCLEVBQUUsUUFBUSxDQUFDLGdCQUFnQjtnQkFDM0Msa0JBQWtCLEVBQUUsUUFBUSxDQUFDLGtCQUFrQjtnQkFDL0MsUUFBUSxFQUFFLFFBQVEsQ0FBQyxhQUFhO2FBQ2pDLEVBQUUsS0FBSyxJQUFJLEVBQUU7Z0JBQ1osTUFBTSxjQUFjLENBQUMsQ0FBQyxFQUFDLGFBQWEsRUFBRSxJQUFJLENBQUMsVUFBVSxDQUFDLGdCQUFnQixFQUFFLEVBQUMsQ0FBQyxDQUFDLENBQUE7WUFDN0UsQ0FBQyxDQUFDLENBQUE7UUFDSixDQUFDO1FBQUMsT0FBTyxLQUFLLEVBQUUsQ0FBQztZQUNmLElBQUksQ0FBQyxVQUFVLENBQUMsc0JBQXNCLENBQUMsRUFBQyxLQUFLLEVBQUUsS0FBSyxFQUFFLEtBQUssRUFBQyxDQUFDLENBQUE7WUFDN0QsTUFBTSxLQUFLLENBQUE7UUFDYixDQUFDO0lBQ0gsQ0FBQztDQUNGIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbmltcG9ydCByZXN0QXJnc0Vycm9yIGZyb20gXCIuLi91dGlscy9yZXN0LWFyZ3MtZXJyb3IuanNcIlxuXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBWZWxvY2lvdXNTdWl0ZUhvb2tFeGVjdXRvciB7XG4gIC8qKlxuICAgKiBDcmVhdGVzIGFuIGV4ZWN1dG9yIGZvciBWZWxvY2lvdXMgc3VpdGUgaG9va3MuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gQ29uc3RydWN0b3IgYXJndW1lbnRzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdGVzdC1ydW5uZXIuanNcIikuZGVmYXVsdH0gYXJncy50ZXN0UnVubmVyIC0gT3duaW5nIFZlbG9jaW91cyBydW5uZXIuXG4gICAqL1xuICBjb25zdHJ1Y3Rvcih7dGVzdFJ1bm5lciwgLi4ucmVzdEFyZ3N9KSB7XG4gICAgcmVzdEFyZ3NFcnJvcihyZXN0QXJncylcbiAgICB0aGlzLnRlc3RSdW5uZXIgPSB0ZXN0UnVubmVyXG4gIH1cblxuICAvKipcbiAgICogU3VwcGxpZXMgdGhlIGZyYW1ld29yayBjb25maWd1cmF0aW9uIHdoaWxlIHBhY2thZ2UgdHJhdmVyc2FsIG93bnMgb3JkZXJpbmcsXG4gICAqIHRpbWVvdXQgZW5mb3JjZW1lbnQsIGFnZ3JlZ2F0aW9uLCBhbmQgYWN0aXZlLXNjb3BlIGNsZWFudXAuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiQHZlbG9jaW91cy90ZXN0aW5nL3J1bm5lclwiKS5TdWl0ZUhvb2tFeGVjdXRvcklucHV0fSBpbnB1dCAtIFBhY2thZ2UgaG9vayBpbnB1dC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgdGhlIGhvb2sgY29tcGxldGVzLlxuICAgKi9cbiAgYXN5bmMgZXhlY3V0ZSh7Y29udGV4dCwgZGVmYXVsdEV4ZWN1dGUsIGZ1bGxOYW1lLCBob29rLCBwaGFzZSwgc3VpdGUsIHRpbWVvdXRNcywgLi4ucmVzdEFyZ3N9KSB7XG4gICAgcmVzdEFyZ3NFcnJvcihyZXN0QXJncylcbiAgICB2b2lkIGNvbnRleHRcbiAgICB2b2lkIGZ1bGxOYW1lXG4gICAgdm9pZCB0aW1lb3V0TXNcbiAgICBjb25zdCBtZXRhZGF0YSA9IHRoaXMudGVzdFJ1bm5lci5ob29rTWV0YWRhdGEoaG9vaylcblxuICAgIHRyeSB7XG4gICAgICBhd2FpdCB0aGlzLnRlc3RSdW5uZXIucnVuUHJvZmlsZVNwYW4oe1xuICAgICAgICBwaGFzZSxcbiAgICAgICAgZGVjbGFyYXRpb25JbmRleDogbWV0YWRhdGEuZGVjbGFyYXRpb25JbmRleCxcbiAgICAgICAgZGVjbGFyYXRpb25TY29wZUlkOiBtZXRhZGF0YS5kZWNsYXJhdGlvblNjb3BlSWQsXG4gICAgICAgIGZpbGVQYXRoOiBtZXRhZGF0YS5vd25lckZpbGVQYXRoXG4gICAgICB9LCBhc3luYyAoKSA9PiB7XG4gICAgICAgIGF3YWl0IGRlZmF1bHRFeGVjdXRlKFt7Y29uZmlndXJhdGlvbjogdGhpcy50ZXN0UnVubmVyLmdldENvbmZpZ3VyYXRpb24oKX1dKVxuICAgICAgfSlcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgdGhpcy50ZXN0UnVubmVyLnJlY29yZFN1aXRlSG9va0ZhaWx1cmUoe3N1aXRlLCBwaGFzZSwgZXJyb3J9KVxuICAgICAgdGhyb3cgZXJyb3JcbiAgICB9XG4gIH1cbn1cbiJdfQ==