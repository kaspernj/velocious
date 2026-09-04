// @ts-check
import restArgsError from "../utils/rest-args-error.js";
/** @typedef {import("./test-runner.js").TestArgs} TestArgs */
/** @typedef {import("./test-runner.js").TestData} TestData */
export default class VelociousTestArguments {
    /**
     * Creates the framework-owned test argument adapter.
     * @param {object} args - Constructor arguments.
     * @param {import("./test-runner.js").default} args.testRunner - Owning Velocious runner.
     */
    constructor({ testRunner, ...restArgs }) {
        restArgsError(restArgs);
        this.testRunner = testRunner;
    }
    /**
     * Builds the stable framework-owned argument object for one selected test.
     * @param {TestData} testData - Selected test registration.
     * @returns {Promise<TestArgs>} - Attempt-shared callback arguments.
     */
    async build(testData) {
        const testArgs = this.copy(testData);
        await this.inject(testArgs);
        return testArgs;
    }
    /**
     * Copies declaration metadata before selection can inspect it.
     * @param {TestData} testData - Test registration.
     * @returns {TestArgs} - Independent test arguments.
     */
    copy(testData) {
        return /** @type {TestArgs} */ (Object.assign({}, testData.args));
    }
    /**
     * Injects type-specific framework collaborators after selection.
     * @param {TestArgs} testArgs - Selected test arguments.
     * @returns {Promise<void>} - Resolves after required collaborators are ready.
     */
    async inject(testArgs) {
        if (testArgs.type == "model" || testArgs.type == "request") {
            testArgs.application = await this.testRunner.application();
        }
        if (testArgs.type == "request") {
            testArgs.client = await this.testRunner.requestClient();
        }
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidmVsb2Npb3VzLXRlc3QtYXJndW1lbnRzLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL3Rlc3RpbmcvdmVsb2Npb3VzLXRlc3QtYXJndW1lbnRzLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLGFBQWEsTUFBTSw2QkFBNkIsQ0FBQTtBQUV2RCw4REFBOEQ7QUFDOUQsOERBQThEO0FBRTlELE1BQU0sQ0FBQyxPQUFPLE9BQU8sc0JBQXNCO0lBQ3pDOzs7O09BSUc7SUFDSCxZQUFZLEVBQUMsVUFBVSxFQUFFLEdBQUcsUUFBUSxFQUFDO1FBQ25DLGFBQWEsQ0FBQyxRQUFRLENBQUMsQ0FBQTtRQUN2QixJQUFJLENBQUMsVUFBVSxHQUFHLFVBQVUsQ0FBQTtJQUM5QixDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILEtBQUssQ0FBQyxLQUFLLENBQUMsUUFBUTtRQUNsQixNQUFNLFFBQVEsR0FBRyxJQUFJLENBQUMsSUFBSSxDQUFDLFFBQVEsQ0FBQyxDQUFBO1FBRXBDLE1BQU0sSUFBSSxDQUFDLE1BQU0sQ0FBQyxRQUFRLENBQUMsQ0FBQTtRQUUzQixPQUFPLFFBQVEsQ0FBQTtJQUNqQixDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILElBQUksQ0FBQyxRQUFRO1FBQ1gsT0FBTyx1QkFBdUIsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxNQUFNLENBQUMsRUFBRSxFQUFFLFFBQVEsQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFBO0lBQ25FLENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsS0FBSyxDQUFDLE1BQU0sQ0FBQyxRQUFRO1FBQ25CLElBQUksUUFBUSxDQUFDLElBQUksSUFBSSxPQUFPLElBQUksUUFBUSxDQUFDLElBQUksSUFBSSxTQUFTLEVBQUUsQ0FBQztZQUMzRCxRQUFRLENBQUMsV0FBVyxHQUFHLE1BQU0sSUFBSSxDQUFDLFVBQVUsQ0FBQyxXQUFXLEVBQUUsQ0FBQTtRQUM1RCxDQUFDO1FBRUQsSUFBSSxRQUFRLENBQUMsSUFBSSxJQUFJLFNBQVMsRUFBRSxDQUFDO1lBQy9CLFFBQVEsQ0FBQyxNQUFNLEdBQUcsTUFBTSxJQUFJLENBQUMsVUFBVSxDQUFDLGFBQWEsRUFBRSxDQUFBO1FBQ3pELENBQUM7SUFDSCxDQUFDO0NBQ0YiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuaW1wb3J0IHJlc3RBcmdzRXJyb3IgZnJvbSBcIi4uL3V0aWxzL3Jlc3QtYXJncy1lcnJvci5qc1wiXG5cbi8qKiBAdHlwZWRlZiB7aW1wb3J0KFwiLi90ZXN0LXJ1bm5lci5qc1wiKS5UZXN0QXJnc30gVGVzdEFyZ3MgKi9cbi8qKiBAdHlwZWRlZiB7aW1wb3J0KFwiLi90ZXN0LXJ1bm5lci5qc1wiKS5UZXN0RGF0YX0gVGVzdERhdGEgKi9cblxuZXhwb3J0IGRlZmF1bHQgY2xhc3MgVmVsb2Npb3VzVGVzdEFyZ3VtZW50cyB7XG4gIC8qKlxuICAgKiBDcmVhdGVzIHRoZSBmcmFtZXdvcmstb3duZWQgdGVzdCBhcmd1bWVudCBhZGFwdGVyLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIENvbnN0cnVjdG9yIGFyZ3VtZW50cy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3Rlc3QtcnVubmVyLmpzXCIpLmRlZmF1bHR9IGFyZ3MudGVzdFJ1bm5lciAtIE93bmluZyBWZWxvY2lvdXMgcnVubmVyLlxuICAgKi9cbiAgY29uc3RydWN0b3Ioe3Rlc3RSdW5uZXIsIC4uLnJlc3RBcmdzfSkge1xuICAgIHJlc3RBcmdzRXJyb3IocmVzdEFyZ3MpXG4gICAgdGhpcy50ZXN0UnVubmVyID0gdGVzdFJ1bm5lclxuICB9XG5cbiAgLyoqXG4gICAqIEJ1aWxkcyB0aGUgc3RhYmxlIGZyYW1ld29yay1vd25lZCBhcmd1bWVudCBvYmplY3QgZm9yIG9uZSBzZWxlY3RlZCB0ZXN0LlxuICAgKiBAcGFyYW0ge1Rlc3REYXRhfSB0ZXN0RGF0YSAtIFNlbGVjdGVkIHRlc3QgcmVnaXN0cmF0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxUZXN0QXJncz59IC0gQXR0ZW1wdC1zaGFyZWQgY2FsbGJhY2sgYXJndW1lbnRzLlxuICAgKi9cbiAgYXN5bmMgYnVpbGQodGVzdERhdGEpIHtcbiAgICBjb25zdCB0ZXN0QXJncyA9IHRoaXMuY29weSh0ZXN0RGF0YSlcblxuICAgIGF3YWl0IHRoaXMuaW5qZWN0KHRlc3RBcmdzKVxuXG4gICAgcmV0dXJuIHRlc3RBcmdzXG4gIH1cblxuICAvKipcbiAgICogQ29waWVzIGRlY2xhcmF0aW9uIG1ldGFkYXRhIGJlZm9yZSBzZWxlY3Rpb24gY2FuIGluc3BlY3QgaXQuXG4gICAqIEBwYXJhbSB7VGVzdERhdGF9IHRlc3REYXRhIC0gVGVzdCByZWdpc3RyYXRpb24uXG4gICAqIEByZXR1cm5zIHtUZXN0QXJnc30gLSBJbmRlcGVuZGVudCB0ZXN0IGFyZ3VtZW50cy5cbiAgICovXG4gIGNvcHkodGVzdERhdGEpIHtcbiAgICByZXR1cm4gLyoqIEB0eXBlIHtUZXN0QXJnc30gKi8gKE9iamVjdC5hc3NpZ24oe30sIHRlc3REYXRhLmFyZ3MpKVxuICB9XG5cbiAgLyoqXG4gICAqIEluamVjdHMgdHlwZS1zcGVjaWZpYyBmcmFtZXdvcmsgY29sbGFib3JhdG9ycyBhZnRlciBzZWxlY3Rpb24uXG4gICAqIEBwYXJhbSB7VGVzdEFyZ3N9IHRlc3RBcmdzIC0gU2VsZWN0ZWQgdGVzdCBhcmd1bWVudHMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIHJlcXVpcmVkIGNvbGxhYm9yYXRvcnMgYXJlIHJlYWR5LlxuICAgKi9cbiAgYXN5bmMgaW5qZWN0KHRlc3RBcmdzKSB7XG4gICAgaWYgKHRlc3RBcmdzLnR5cGUgPT0gXCJtb2RlbFwiIHx8IHRlc3RBcmdzLnR5cGUgPT0gXCJyZXF1ZXN0XCIpIHtcbiAgICAgIHRlc3RBcmdzLmFwcGxpY2F0aW9uID0gYXdhaXQgdGhpcy50ZXN0UnVubmVyLmFwcGxpY2F0aW9uKClcbiAgICB9XG5cbiAgICBpZiAodGVzdEFyZ3MudHlwZSA9PSBcInJlcXVlc3RcIikge1xuICAgICAgdGVzdEFyZ3MuY2xpZW50ID0gYXdhaXQgdGhpcy50ZXN0UnVubmVyLnJlcXVlc3RDbGllbnQoKVxuICAgIH1cbiAgfVxufVxuIl19