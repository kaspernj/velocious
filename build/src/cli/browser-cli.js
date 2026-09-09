import Cli from "./index.js";
import restArgsError from "../utils/rest-args-error.js";
export default class VelociousBrowserCli {
    /**
     * Runs constructor.
     * @param {object} args - Options object.
     * @param {import("../configuration.js").default} args.configuration - Configuration instance.
     */
    constructor({ configuration, ...restArgs }) {
        restArgsError(restArgs);
        this.configuration = configuration;
    }
    /**
     * Runs enable.
     * @description Enable the CLI in the global scope. This is useful for debugging and testing.
     * @returns {void} - No return value.
     */
    enable() {
        /**
         * Global scope.
         * @type {typeof globalThis & {velociousCLI?: VelociousBrowserCli}} */
        const globalScope = globalThis;
        globalScope.velociousCLI = this;
    }
    /**
     * Runs run.
     * @description Run a command. This is useful for debugging and testing. This is a wrapper around the Cli class.
     * @param {string} command - Command.
     * @returns {Promise<void>} - Resolves when complete.
     */
    async run(command) {
        const processArgs = command.split(/\s+/);
        const cli = new Cli({
            configuration: this.configuration,
            processArgs
        });
        await cli.execute();
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYnJvd3Nlci1jbGkuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvY2xpL2Jyb3dzZXItY2xpLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLE9BQU8sR0FBRyxNQUFNLFlBQVksQ0FBQTtBQUM1QixPQUFPLGFBQWEsTUFBTSw2QkFBNkIsQ0FBQTtBQUV2RCxNQUFNLENBQUMsT0FBTyxPQUFPLG1CQUFtQjtJQUN0Qzs7OztPQUlHO0lBQ0gsWUFBWSxFQUFDLGFBQWEsRUFBRSxHQUFHLFFBQVEsRUFBQztRQUN0QyxhQUFhLENBQUMsUUFBUSxDQUFDLENBQUE7UUFFdkIsSUFBSSxDQUFDLGFBQWEsR0FBRyxhQUFhLENBQUE7SUFDcEMsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCxNQUFNO1FBQ0o7OzhFQUVzRTtRQUN0RSxNQUFNLFdBQVcsR0FBRyxVQUFVLENBQUE7UUFFOUIsV0FBVyxDQUFDLFlBQVksR0FBRyxJQUFJLENBQUE7SUFDakMsQ0FBQztJQUVEOzs7OztPQUtHO0lBQ0gsS0FBSyxDQUFDLEdBQUcsQ0FBQyxPQUFPO1FBQ2YsTUFBTSxXQUFXLEdBQUcsT0FBTyxDQUFDLEtBQUssQ0FBQyxLQUFLLENBQUMsQ0FBQTtRQUN4QyxNQUFNLEdBQUcsR0FBRyxJQUFJLEdBQUcsQ0FBQztZQUNsQixhQUFhLEVBQUUsSUFBSSxDQUFDLGFBQWE7WUFDakMsV0FBVztTQUNaLENBQUMsQ0FBQTtRQUVGLE1BQU0sR0FBRyxDQUFDLE9BQU8sRUFBRSxDQUFBO0lBQ3JCLENBQUM7Q0FDRiIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCBDbGkgZnJvbSBcIi4vaW5kZXguanNcIlxuaW1wb3J0IHJlc3RBcmdzRXJyb3IgZnJvbSBcIi4uL3V0aWxzL3Jlc3QtYXJncy1lcnJvci5qc1wiXG5cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIFZlbG9jaW91c0Jyb3dzZXJDbGkge1xuICAvKipcbiAgICogUnVucyBjb25zdHJ1Y3Rvci5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLmpzXCIpLmRlZmF1bHR9IGFyZ3MuY29uZmlndXJhdGlvbiAtIENvbmZpZ3VyYXRpb24gaW5zdGFuY2UuXG4gICAqL1xuICBjb25zdHJ1Y3Rvcih7Y29uZmlndXJhdGlvbiwgLi4ucmVzdEFyZ3N9KSB7XG4gICAgcmVzdEFyZ3NFcnJvcihyZXN0QXJncylcblxuICAgIHRoaXMuY29uZmlndXJhdGlvbiA9IGNvbmZpZ3VyYXRpb25cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGVuYWJsZS5cbiAgICogQGRlc2NyaXB0aW9uIEVuYWJsZSB0aGUgQ0xJIGluIHRoZSBnbG9iYWwgc2NvcGUuIFRoaXMgaXMgdXNlZnVsIGZvciBkZWJ1Z2dpbmcgYW5kIHRlc3RpbmcuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIGVuYWJsZSgpIHtcbiAgICAvKipcbiAgICAgKiBHbG9iYWwgc2NvcGUuXG4gICAgICogQHR5cGUge3R5cGVvZiBnbG9iYWxUaGlzICYge3ZlbG9jaW91c0NMST86IFZlbG9jaW91c0Jyb3dzZXJDbGl9fSAqL1xuICAgIGNvbnN0IGdsb2JhbFNjb3BlID0gZ2xvYmFsVGhpc1xuXG4gICAgZ2xvYmFsU2NvcGUudmVsb2Npb3VzQ0xJID0gdGhpc1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcnVuLlxuICAgKiBAZGVzY3JpcHRpb24gUnVuIGEgY29tbWFuZC4gVGhpcyBpcyB1c2VmdWwgZm9yIGRlYnVnZ2luZyBhbmQgdGVzdGluZy4gVGhpcyBpcyBhIHdyYXBwZXIgYXJvdW5kIHRoZSBDbGkgY2xhc3MuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBjb21tYW5kIC0gQ29tbWFuZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIHJ1bihjb21tYW5kKSB7XG4gICAgY29uc3QgcHJvY2Vzc0FyZ3MgPSBjb21tYW5kLnNwbGl0KC9cXHMrLylcbiAgICBjb25zdCBjbGkgPSBuZXcgQ2xpKHtcbiAgICAgIGNvbmZpZ3VyYXRpb246IHRoaXMuY29uZmlndXJhdGlvbixcbiAgICAgIHByb2Nlc3NBcmdzXG4gICAgfSlcblxuICAgIGF3YWl0IGNsaS5leGVjdXRlKClcbiAgfVxufVxuIl19