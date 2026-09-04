// @ts-check
import restArgsError from "../utils/rest-args-error.js";
/** @typedef {import("./test-runner.js").TestArgs} TestArgs */
/** @typedef {import("./test-runner.js").TestData} TestData */
/** @typedef {import("@velocious/testing/runner").TestDeclaration} PackageTestDeclaration */
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
     * Resolves stable Velocious arguments after package-owned table arguments.
     * @param {object} input - Package resolver input.
     * @param {PackageTestDeclaration} input.test - Selected declaration.
     * @returns {Promise<ReturnType<typeof JSON.parse>[]>} - Callback arguments.
     */
    async resolve({ test }) {
        const compatibility = await this.testRunner.testCompatibility(test);
        return [...test.rowArguments, compatibility.testArgs];
    }
    /**
     * Copies declaration metadata before selection can inspect it.
     * @param {PackageTestDeclaration} testData - Test registration.
     * @returns {TestArgs} - Independent test arguments.
     */
    copy(testData) {
        const testArgs = /** @type {TestArgs} */ (Object.assign({}, testData.options));
        if (testArgs.retry === undefined && typeof testData.options.retries === "number") {
            testArgs.retry = testData.options.retries;
        }
        if (testArgs.timeoutSeconds === undefined && typeof testData.options.timeoutMs === "number") {
            testArgs.timeoutSeconds = testData.options.timeoutMs / 1000;
        }
        return testArgs;
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidmVsb2Npb3VzLXRlc3QtYXJndW1lbnRzLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL3Rlc3RpbmcvdmVsb2Npb3VzLXRlc3QtYXJndW1lbnRzLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLGFBQWEsTUFBTSw2QkFBNkIsQ0FBQTtBQUV2RCw4REFBOEQ7QUFDOUQsOERBQThEO0FBQzlELDRGQUE0RjtBQUU1RixNQUFNLENBQUMsT0FBTyxPQUFPLHNCQUFzQjtJQUN6Qzs7OztPQUlHO0lBQ0gsWUFBWSxFQUFDLFVBQVUsRUFBRSxHQUFHLFFBQVEsRUFBQztRQUNuQyxhQUFhLENBQUMsUUFBUSxDQUFDLENBQUE7UUFDdkIsSUFBSSxDQUFDLFVBQVUsR0FBRyxVQUFVLENBQUE7SUFDOUIsQ0FBQztJQUVEOzs7OztPQUtHO0lBQ0gsS0FBSyxDQUFDLE9BQU8sQ0FBQyxFQUFDLElBQUksRUFBQztRQUNsQixNQUFNLGFBQWEsR0FBRyxNQUFNLElBQUksQ0FBQyxVQUFVLENBQUMsaUJBQWlCLENBQUMsSUFBSSxDQUFDLENBQUE7UUFFbkUsT0FBTyxDQUFDLEdBQUcsSUFBSSxDQUFDLFlBQVksRUFBRSxhQUFhLENBQUMsUUFBUSxDQUFDLENBQUE7SUFDdkQsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCxJQUFJLENBQUMsUUFBUTtRQUNYLE1BQU0sUUFBUSxHQUFHLHVCQUF1QixDQUFDLENBQUMsTUFBTSxDQUFDLE1BQU0sQ0FBQyxFQUFFLEVBQUUsUUFBUSxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUE7UUFFOUUsSUFBSSxRQUFRLENBQUMsS0FBSyxLQUFLLFNBQVMsSUFBSSxPQUFPLFFBQVEsQ0FBQyxPQUFPLENBQUMsT0FBTyxLQUFLLFFBQVEsRUFBRSxDQUFDO1lBQ2pGLFFBQVEsQ0FBQyxLQUFLLEdBQUcsUUFBUSxDQUFDLE9BQU8sQ0FBQyxPQUFPLENBQUE7UUFDM0MsQ0FBQztRQUNELElBQUksUUFBUSxDQUFDLGNBQWMsS0FBSyxTQUFTLElBQUksT0FBTyxRQUFRLENBQUMsT0FBTyxDQUFDLFNBQVMsS0FBSyxRQUFRLEVBQUUsQ0FBQztZQUM1RixRQUFRLENBQUMsY0FBYyxHQUFHLFFBQVEsQ0FBQyxPQUFPLENBQUMsU0FBUyxHQUFHLElBQUksQ0FBQTtRQUM3RCxDQUFDO1FBRUQsT0FBTyxRQUFRLENBQUE7SUFDakIsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCxLQUFLLENBQUMsTUFBTSxDQUFDLFFBQVE7UUFDbkIsSUFBSSxRQUFRLENBQUMsSUFBSSxJQUFJLE9BQU8sSUFBSSxRQUFRLENBQUMsSUFBSSxJQUFJLFNBQVMsRUFBRSxDQUFDO1lBQzNELFFBQVEsQ0FBQyxXQUFXLEdBQUcsTUFBTSxJQUFJLENBQUMsVUFBVSxDQUFDLFdBQVcsRUFBRSxDQUFBO1FBQzVELENBQUM7UUFFRCxJQUFJLFFBQVEsQ0FBQyxJQUFJLElBQUksU0FBUyxFQUFFLENBQUM7WUFDL0IsUUFBUSxDQUFDLE1BQU0sR0FBRyxNQUFNLElBQUksQ0FBQyxVQUFVLENBQUMsYUFBYSxFQUFFLENBQUE7UUFDekQsQ0FBQztJQUNILENBQUM7Q0FDRiIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG5pbXBvcnQgcmVzdEFyZ3NFcnJvciBmcm9tIFwiLi4vdXRpbHMvcmVzdC1hcmdzLWVycm9yLmpzXCJcblxuLyoqIEB0eXBlZGVmIHtpbXBvcnQoXCIuL3Rlc3QtcnVubmVyLmpzXCIpLlRlc3RBcmdzfSBUZXN0QXJncyAqL1xuLyoqIEB0eXBlZGVmIHtpbXBvcnQoXCIuL3Rlc3QtcnVubmVyLmpzXCIpLlRlc3REYXRhfSBUZXN0RGF0YSAqL1xuLyoqIEB0eXBlZGVmIHtpbXBvcnQoXCJAdmVsb2Npb3VzL3Rlc3RpbmcvcnVubmVyXCIpLlRlc3REZWNsYXJhdGlvbn0gUGFja2FnZVRlc3REZWNsYXJhdGlvbiAqL1xuXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBWZWxvY2lvdXNUZXN0QXJndW1lbnRzIHtcbiAgLyoqXG4gICAqIENyZWF0ZXMgdGhlIGZyYW1ld29yay1vd25lZCB0ZXN0IGFyZ3VtZW50IGFkYXB0ZXIuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gQ29uc3RydWN0b3IgYXJndW1lbnRzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdGVzdC1ydW5uZXIuanNcIikuZGVmYXVsdH0gYXJncy50ZXN0UnVubmVyIC0gT3duaW5nIFZlbG9jaW91cyBydW5uZXIuXG4gICAqL1xuICBjb25zdHJ1Y3Rvcih7dGVzdFJ1bm5lciwgLi4ucmVzdEFyZ3N9KSB7XG4gICAgcmVzdEFyZ3NFcnJvcihyZXN0QXJncylcbiAgICB0aGlzLnRlc3RSdW5uZXIgPSB0ZXN0UnVubmVyXG4gIH1cblxuICAvKipcbiAgICogUmVzb2x2ZXMgc3RhYmxlIFZlbG9jaW91cyBhcmd1bWVudHMgYWZ0ZXIgcGFja2FnZS1vd25lZCB0YWJsZSBhcmd1bWVudHMuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBpbnB1dCAtIFBhY2thZ2UgcmVzb2x2ZXIgaW5wdXQuXG4gICAqIEBwYXJhbSB7UGFja2FnZVRlc3REZWNsYXJhdGlvbn0gaW5wdXQudGVzdCAtIFNlbGVjdGVkIGRlY2xhcmF0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPltdPn0gLSBDYWxsYmFjayBhcmd1bWVudHMuXG4gICAqL1xuICBhc3luYyByZXNvbHZlKHt0ZXN0fSkge1xuICAgIGNvbnN0IGNvbXBhdGliaWxpdHkgPSBhd2FpdCB0aGlzLnRlc3RSdW5uZXIudGVzdENvbXBhdGliaWxpdHkodGVzdClcblxuICAgIHJldHVybiBbLi4udGVzdC5yb3dBcmd1bWVudHMsIGNvbXBhdGliaWxpdHkudGVzdEFyZ3NdXG4gIH1cblxuICAvKipcbiAgICogQ29waWVzIGRlY2xhcmF0aW9uIG1ldGFkYXRhIGJlZm9yZSBzZWxlY3Rpb24gY2FuIGluc3BlY3QgaXQuXG4gICAqIEBwYXJhbSB7UGFja2FnZVRlc3REZWNsYXJhdGlvbn0gdGVzdERhdGEgLSBUZXN0IHJlZ2lzdHJhdGlvbi5cbiAgICogQHJldHVybnMge1Rlc3RBcmdzfSAtIEluZGVwZW5kZW50IHRlc3QgYXJndW1lbnRzLlxuICAgKi9cbiAgY29weSh0ZXN0RGF0YSkge1xuICAgIGNvbnN0IHRlc3RBcmdzID0gLyoqIEB0eXBlIHtUZXN0QXJnc30gKi8gKE9iamVjdC5hc3NpZ24oe30sIHRlc3REYXRhLm9wdGlvbnMpKVxuXG4gICAgaWYgKHRlc3RBcmdzLnJldHJ5ID09PSB1bmRlZmluZWQgJiYgdHlwZW9mIHRlc3REYXRhLm9wdGlvbnMucmV0cmllcyA9PT0gXCJudW1iZXJcIikge1xuICAgICAgdGVzdEFyZ3MucmV0cnkgPSB0ZXN0RGF0YS5vcHRpb25zLnJldHJpZXNcbiAgICB9XG4gICAgaWYgKHRlc3RBcmdzLnRpbWVvdXRTZWNvbmRzID09PSB1bmRlZmluZWQgJiYgdHlwZW9mIHRlc3REYXRhLm9wdGlvbnMudGltZW91dE1zID09PSBcIm51bWJlclwiKSB7XG4gICAgICB0ZXN0QXJncy50aW1lb3V0U2Vjb25kcyA9IHRlc3REYXRhLm9wdGlvbnMudGltZW91dE1zIC8gMTAwMFxuICAgIH1cblxuICAgIHJldHVybiB0ZXN0QXJnc1xuICB9XG5cbiAgLyoqXG4gICAqIEluamVjdHMgdHlwZS1zcGVjaWZpYyBmcmFtZXdvcmsgY29sbGFib3JhdG9ycyBhZnRlciBzZWxlY3Rpb24uXG4gICAqIEBwYXJhbSB7VGVzdEFyZ3N9IHRlc3RBcmdzIC0gU2VsZWN0ZWQgdGVzdCBhcmd1bWVudHMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIHJlcXVpcmVkIGNvbGxhYm9yYXRvcnMgYXJlIHJlYWR5LlxuICAgKi9cbiAgYXN5bmMgaW5qZWN0KHRlc3RBcmdzKSB7XG4gICAgaWYgKHRlc3RBcmdzLnR5cGUgPT0gXCJtb2RlbFwiIHx8IHRlc3RBcmdzLnR5cGUgPT0gXCJyZXF1ZXN0XCIpIHtcbiAgICAgIHRlc3RBcmdzLmFwcGxpY2F0aW9uID0gYXdhaXQgdGhpcy50ZXN0UnVubmVyLmFwcGxpY2F0aW9uKClcbiAgICB9XG5cbiAgICBpZiAodGVzdEFyZ3MudHlwZSA9PSBcInJlcXVlc3RcIikge1xuICAgICAgdGVzdEFyZ3MuY2xpZW50ID0gYXdhaXQgdGhpcy50ZXN0UnVubmVyLnJlcXVlc3RDbGllbnQoKVxuICAgIH1cbiAgfVxufVxuIl19