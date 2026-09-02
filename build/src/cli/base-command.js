import restArgsError from "../utils/rest-args-error.js";
/**
 * VelociousCliCommandArgs type.
 * @typedef {object} VelociousCliCommandArgs
 * @property {import("../configuration.js").default} [configuration] - Configuration instance for the CLI.
 * @property {Record<string, string | number | boolean | undefined>} [parsedProcessArgs] - Parsed CLI arguments.
 * @property {string[]} [processArgs] - Raw CLI arguments array.
 * @property {boolean} [testing] - Whether the CLI is running in test mode.
 */
export default class VelociousCliBaseCommand {
    /**
     * Runs constructor.
     * @param {object} args - Options object.
     * @param {VelociousCliCommandArgs} args.args - Options object.
     * @param {import("./index.js").default} args.cli - Cli.
     */
    constructor({ args = {}, cli, ...restArgs }) {
        restArgsError(restArgs);
        if (!args.configuration)
            throw new Error("configuration argument is required");
        this.args = args;
        this.cli = cli;
        this._configuration = args.configuration;
        this._environmentHandler = args.configuration.getEnvironmentHandler();
        this.processArgs = args.processArgs;
    }
    /**
     * Runs directory.
     * @returns {string} - The directory.
     */
    directory() { return this.getConfiguration().getDirectory(); }
    /**
     * Runs execute.
     * @abstract
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - Resolves with the execute.
     */
    execute() {
        throw new Error("execute not implemented");
    }
    /**
     * Runs get configuration.
     * @returns {import("../configuration.js").default} - The configuration.
     */
    getConfiguration() { return this._configuration; }
    /**
     * Runs get environment handler.
     * @returns {import("../environment-handlers/base.js").default} - The environment handler.
     */
    getEnvironmentHandler() { return this._environmentHandler; }
    /**
     * Runs initialize.
     * @abstract
     * @returns {Promise<void>} - Resolves when complete.
     */
    async initialize() {
        // Do nothing
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYmFzZS1jb21tYW5kLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL2NsaS9iYXNlLWNvbW1hbmQuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsT0FBTyxhQUFhLE1BQU0sNkJBQTZCLENBQUE7QUFFdkQ7Ozs7Ozs7R0FPRztBQUVILE1BQU0sQ0FBQyxPQUFPLE9BQU8sdUJBQXVCO0lBQzFDOzs7OztPQUtHO0lBQ0gsWUFBWSxFQUFDLElBQUksR0FBRyxFQUFFLEVBQUUsR0FBRyxFQUFFLEdBQUcsUUFBUSxFQUFDO1FBQ3ZDLGFBQWEsQ0FBQyxRQUFRLENBQUMsQ0FBQTtRQUV2QixJQUFJLENBQUMsSUFBSSxDQUFDLGFBQWE7WUFBRSxNQUFNLElBQUksS0FBSyxDQUFDLG9DQUFvQyxDQUFDLENBQUE7UUFFOUUsSUFBSSxDQUFDLElBQUksR0FBRyxJQUFJLENBQUE7UUFDaEIsSUFBSSxDQUFDLEdBQUcsR0FBRyxHQUFHLENBQUE7UUFDZCxJQUFJLENBQUMsY0FBYyxHQUFHLElBQUksQ0FBQyxhQUFhLENBQUE7UUFDeEMsSUFBSSxDQUFDLG1CQUFtQixHQUFHLElBQUksQ0FBQyxhQUFhLENBQUMscUJBQXFCLEVBQUUsQ0FBQTtRQUNyRSxJQUFJLENBQUMsV0FBVyxHQUFHLElBQUksQ0FBQyxXQUFXLENBQUE7SUFDckMsQ0FBQztJQUVEOzs7T0FHRztJQUNILFNBQVMsS0FBSyxPQUFPLElBQUksQ0FBQyxnQkFBZ0IsRUFBRSxDQUFDLFlBQVksRUFBRSxDQUFBLENBQUMsQ0FBQztJQUU3RDs7OztPQUlHO0lBQ0gsT0FBTztRQUNMLE1BQU0sSUFBSSxLQUFLLENBQUMseUJBQXlCLENBQUMsQ0FBQTtJQUM1QyxDQUFDO0lBRUQ7OztPQUdHO0lBQ0gsZ0JBQWdCLEtBQUssT0FBTyxJQUFJLENBQUMsY0FBYyxDQUFBLENBQUMsQ0FBQztJQUVqRDs7O09BR0c7SUFDSCxxQkFBcUIsS0FBSyxPQUFPLElBQUksQ0FBQyxtQkFBbUIsQ0FBQSxDQUFDLENBQUM7SUFFM0Q7Ozs7T0FJRztJQUNILEtBQUssQ0FBQyxVQUFVO1FBQ2QsYUFBYTtJQUNmLENBQUM7Q0FDRiIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCByZXN0QXJnc0Vycm9yIGZyb20gXCIuLi91dGlscy9yZXN0LWFyZ3MtZXJyb3IuanNcIlxuXG4vKipcbiAqIFZlbG9jaW91c0NsaUNvbW1hbmRBcmdzIHR5cGUuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBWZWxvY2lvdXNDbGlDb21tYW5kQXJnc1xuICogQHByb3BlcnR5IHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLmpzXCIpLmRlZmF1bHR9IFtjb25maWd1cmF0aW9uXSAtIENvbmZpZ3VyYXRpb24gaW5zdGFuY2UgZm9yIHRoZSBDTEkuXG4gKiBAcHJvcGVydHkge1JlY29yZDxzdHJpbmcsIHN0cmluZyB8IG51bWJlciB8IGJvb2xlYW4gfCB1bmRlZmluZWQ+fSBbcGFyc2VkUHJvY2Vzc0FyZ3NdIC0gUGFyc2VkIENMSSBhcmd1bWVudHMuXG4gKiBAcHJvcGVydHkge3N0cmluZ1tdfSBbcHJvY2Vzc0FyZ3NdIC0gUmF3IENMSSBhcmd1bWVudHMgYXJyYXkuXG4gKiBAcHJvcGVydHkge2Jvb2xlYW59IFt0ZXN0aW5nXSAtIFdoZXRoZXIgdGhlIENMSSBpcyBydW5uaW5nIGluIHRlc3QgbW9kZS5cbiAqL1xuXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBWZWxvY2lvdXNDbGlCYXNlQ29tbWFuZCB7XG4gIC8qKlxuICAgKiBSdW5zIGNvbnN0cnVjdG9yLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcGFyYW0ge1ZlbG9jaW91c0NsaUNvbW1hbmRBcmdzfSBhcmdzLmFyZ3MgLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2luZGV4LmpzXCIpLmRlZmF1bHR9IGFyZ3MuY2xpIC0gQ2xpLlxuICAgKi9cbiAgY29uc3RydWN0b3Ioe2FyZ3MgPSB7fSwgY2xpLCAuLi5yZXN0QXJnc30pIHtcbiAgICByZXN0QXJnc0Vycm9yKHJlc3RBcmdzKVxuXG4gICAgaWYgKCFhcmdzLmNvbmZpZ3VyYXRpb24pIHRocm93IG5ldyBFcnJvcihcImNvbmZpZ3VyYXRpb24gYXJndW1lbnQgaXMgcmVxdWlyZWRcIilcblxuICAgIHRoaXMuYXJncyA9IGFyZ3NcbiAgICB0aGlzLmNsaSA9IGNsaVxuICAgIHRoaXMuX2NvbmZpZ3VyYXRpb24gPSBhcmdzLmNvbmZpZ3VyYXRpb25cbiAgICB0aGlzLl9lbnZpcm9ubWVudEhhbmRsZXIgPSBhcmdzLmNvbmZpZ3VyYXRpb24uZ2V0RW52aXJvbm1lbnRIYW5kbGVyKClcbiAgICB0aGlzLnByb2Nlc3NBcmdzID0gYXJncy5wcm9jZXNzQXJnc1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZGlyZWN0b3J5LlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFRoZSBkaXJlY3RvcnkuXG4gICAqL1xuICBkaXJlY3RvcnkoKSB7IHJldHVybiB0aGlzLmdldENvbmZpZ3VyYXRpb24oKS5nZXREaXJlY3RvcnkoKSB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZXhlY3V0ZS5cbiAgICogQGFic3RyYWN0XG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBSZXNvbHZlcyB3aXRoIHRoZSBleGVjdXRlLlxuICAgKi9cbiAgZXhlY3V0ZSgpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXCJleGVjdXRlIG5vdCBpbXBsZW1lbnRlZFwiKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGNvbmZpZ3VyYXRpb24uXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLmpzXCIpLmRlZmF1bHR9IC0gVGhlIGNvbmZpZ3VyYXRpb24uXG4gICAqL1xuICBnZXRDb25maWd1cmF0aW9uKCkgeyByZXR1cm4gdGhpcy5fY29uZmlndXJhdGlvbiB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGVudmlyb25tZW50IGhhbmRsZXIuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuLi9lbnZpcm9ubWVudC1oYW5kbGVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IC0gVGhlIGVudmlyb25tZW50IGhhbmRsZXIuXG4gICAqL1xuICBnZXRFbnZpcm9ubWVudEhhbmRsZXIoKSB7IHJldHVybiB0aGlzLl9lbnZpcm9ubWVudEhhbmRsZXIgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGluaXRpYWxpemUuXG4gICAqIEBhYnN0cmFjdFxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgaW5pdGlhbGl6ZSgpIHtcbiAgICAvLyBEbyBub3RoaW5nXG4gIH1cbn1cblxuIl19