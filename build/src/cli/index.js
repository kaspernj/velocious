// @ts-check
const COMMAND_VALUE_OPTIONS = new Set(["--generation", "--initial-generation-state", "--lifecycle-socket", "--phase", "--socket", "--tenant"]);
export default class VelociousCli {
    /**
     * Runs constructor.
     * @param {object} args - Options object.
     * @param {import("../configuration.js").default} [args.configuration] - Configuration instance.
     * @param {string} [args.directory] - Directory path.
     * @param {import("../environment-handlers/base.js").default} [args.environmentHandler] - Environment handler.
     * @param {Record<string, string | number | boolean | undefined>} [args.parsedProcessArgs] - Parsed process args.
     * @param {string[]} [args.processArgs] - Process args.
     * @param {boolean} [args.testing] - Whether testing.
     */
    constructor(args = {}) {
        if (!args.configuration)
            throw new Error("configuration argument is required");
        this.args = args;
        this.configuration = args.configuration;
        this.environmentHandler = args.configuration.getEnvironmentHandler();
        this.environmentHandler.setArgs(args);
        this.environmentHandler.setConfiguration(args.configuration);
    }
    /**
     * Runs execute.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - Resolves with the final command result.
     */
    async execute() {
        const commandGroups = await this.commandGroups();
        let result;
        for (const commandProcessArgs of commandGroups) {
            const shouldCloseDatabaseConnections = !this.hasCurrentDatabaseConnections();
            try {
                result = await this.executeCommand(commandProcessArgs);
            }
            finally {
                if (shouldCloseDatabaseConnections) {
                    await this.getConfiguration().closeDatabaseConnections();
                }
            }
        }
        return result;
    }
    /**
     * Runs execute command.
     * @param {string[]} processArgs - Process args for a single command.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - Resolves with the command result.
     */
    async executeCommand(processArgs) {
        if (!processArgs[0]) {
            throw new Error("Missing command argument");
        }
        const commandParts = processArgs[0].split(":");
        const parsedCommandParts = [];
        for (let commandPart of commandParts) {
            if (commandPart == "c")
                commandPart = "console";
            if (commandPart == "d")
                commandPart = "destroy";
            if (commandPart == "g")
                commandPart = "generate";
            if (commandPart == "s")
                commandPart = "server";
            parsedCommandParts.push(commandPart);
        }
        const CommandClass = await this.environmentHandler.requireCommand({ commandParts: parsedCommandParts });
        const commandInstance = new CommandClass({
            args: Object.assign({}, this.args, { processArgs }),
            cli: this
        });
        await commandInstance.initialize();
        return await commandInstance.execute();
    }
    /**
     * Runs command groups.
     * @returns {Promise<string[][]>} - Command groups with process args for each command.
     */
    async commandGroups() {
        const processArgs = this.args.processArgs || [];
        const commands = await this.environmentHandler.findCommands();
        const commandNames = new Set(commands.map((command) => command.name));
        /**
         * Groups.
         * @type {string[][]} */
        const groups = [];
        /**
         * Current group.
         * @type {string[]} */
        let currentGroup = [];
        let expectsOptionValue = false;
        for (const processArg of processArgs) {
            if (currentGroup.length == 0) {
                if (processArg.startsWith("-"))
                    continue;
                currentGroup = [processArg];
                continue;
            }
            if (expectsOptionValue) {
                currentGroup.push(processArg);
                expectsOptionValue = false;
                continue;
            }
            if (!processArg.startsWith("-") && commandNames.has(processArg)) {
                groups.push(currentGroup);
                currentGroup = [processArg];
            }
            else {
                currentGroup.push(processArg);
                expectsOptionValue = COMMAND_VALUE_OPTIONS.has(processArg);
            }
        }
        if (currentGroup.length > 0) {
            groups.push(currentGroup);
        }
        if (groups.length == 0) {
            throw new Error("Missing command argument");
        }
        return groups;
    }
    /**
     * Runs get configuration.
     * @returns {import("../configuration.js").default} configuration
     */
    getConfiguration() { return this.configuration; }
    /**
     * Runs has current database connections.
     * @returns {boolean} - Whether the current async context already has database connections.
     */
    hasCurrentDatabaseConnections() {
        try {
            return Object.keys(this.getConfiguration().getCurrentConnections()).length > 0;
        }
        catch (error) {
            if (error instanceof Error && error.message.startsWith("No database configuration for environment:"))
                return false;
            throw error;
        }
    }
    /**
     * Runs get testing.
     * @returns {boolean} - Whether testing.
     */
    getTesting() {
        return this.args.testing || false;
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvY2xpL2luZGV4LmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixNQUFNLHFCQUFxQixHQUFHLElBQUksR0FBRyxDQUFDLENBQUMsY0FBYyxFQUFFLDRCQUE0QixFQUFFLG9CQUFvQixFQUFFLFNBQVMsRUFBRSxVQUFVLEVBQUUsVUFBVSxDQUFDLENBQUMsQ0FBQTtBQUU5SSxNQUFNLENBQUMsT0FBTyxPQUFPLFlBQVk7SUFDL0I7Ozs7Ozs7OztPQVNHO0lBQ0gsWUFBWSxJQUFJLEdBQUcsRUFBRTtRQUNuQixJQUFJLENBQUMsSUFBSSxDQUFDLGFBQWE7WUFBRSxNQUFNLElBQUksS0FBSyxDQUFDLG9DQUFvQyxDQUFDLENBQUE7UUFFOUUsSUFBSSxDQUFDLElBQUksR0FBRyxJQUFJLENBQUE7UUFDaEIsSUFBSSxDQUFDLGFBQWEsR0FBRyxJQUFJLENBQUMsYUFBYSxDQUFBO1FBRXZDLElBQUksQ0FBQyxrQkFBa0IsR0FBRyxJQUFJLENBQUMsYUFBYSxDQUFDLHFCQUFxQixFQUFFLENBQUE7UUFDcEUsSUFBSSxDQUFDLGtCQUFrQixDQUFDLE9BQU8sQ0FBQyxJQUFJLENBQUMsQ0FBQTtRQUNyQyxJQUFJLENBQUMsa0JBQWtCLENBQUMsZ0JBQWdCLENBQUMsSUFBSSxDQUFDLGFBQWEsQ0FBQyxDQUFBO0lBQzlELENBQUM7SUFFRDs7O09BR0c7SUFDSCxLQUFLLENBQUMsT0FBTztRQUNYLE1BQU0sYUFBYSxHQUFHLE1BQU0sSUFBSSxDQUFDLGFBQWEsRUFBRSxDQUFBO1FBQ2hELElBQUksTUFBTSxDQUFBO1FBRVYsS0FBSyxNQUFNLGtCQUFrQixJQUFJLGFBQWEsRUFBRSxDQUFDO1lBQy9DLE1BQU0sOEJBQThCLEdBQUcsQ0FBQyxJQUFJLENBQUMsNkJBQTZCLEVBQUUsQ0FBQTtZQUU1RSxJQUFJLENBQUM7Z0JBQ0gsTUFBTSxHQUFHLE1BQU0sSUFB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Q0gsQ0FBQztJQUVEOzs7T0FHRztJQUNILFVBQVU7UUFDUixPQUFPLElBQUksQ0FBQyxJQUFJLENBQUMsT0FBTyxJQUFJLEtBQUssQ0FBQTtJQUNuQyxDQUFDO0NBQ0YiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuY29uc3QgQ09NTUFORF9WQUxVRV9PUFRJT05TID0gbmV3IFNldChbXCItLWdlbmVyYXRpb25cIiwgXCItLWluaXRpYWwtZ2VuZXJhdGlvbi1zdGF0ZVwiLCBcIi0tbGlmZWN5Y2xlLXNvY2tldFwiLCBcIi0tcGhhc2VcIiwgXCItLXNvY2tldFwiLCBcIi0tdGVuYW50XCJdKVxuXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBWZWxvY2lvdXNDbGkge1xuICAvKipcbiAgICogUnVucyBjb25zdHJ1Y3Rvci5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLmpzXCIpLmRlZmF1bHR9IFthcmdzLmNvbmZpZ3VyYXRpb25dIC0gQ29uZmlndXJhdGlvbiBpbnN0YW5jZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFthcmdzLmRpcmVjdG9yeV0gLSBEaXJlY3RvcnkgcGF0aC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9lbnZpcm9ubWVudC1oYW5kbGVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IFthcmdzLmVudmlyb25tZW50SGFuZGxlcl0gLSBFbnZpcm9ubWVudCBoYW5kbGVyLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIHN0cmluZyB8IG51bWJlciB8IGJvb2xlYW4gfCB1bmRlZmluZWQ+fSBbYXJncy5wYXJzZWRQcm9jZXNzQXJnc10gLSBQYXJzZWQgcHJvY2VzcyBhcmdzLlxuICAgKiBAcGFyYW0ge3N0cmluZ1tdfSBbYXJncy5wcm9jZXNzQXJnc10gLSBQcm9jZXNzIGFyZ3MuXG4gICAqIEBwYXJhbSB7Ym9vbGVhbn0gW2FyZ3MudGVzdGluZ10gLSBXaGV0aGVyIHRlc3RpbmcuXG4gICAqL1xuICBjb25zdHJ1Y3RvcihhcmdzID0ge30pIHtcbiAgICBpZiAoIWFyZ3MuY29uZmlndXJhdGlvbikgdGhyb3cgbmV3IEVycm9yKFwiY29uZmlndXJhdGlvbiBhcmd1bWVudCBpcyByZXF1aXJlZFwiKVxuXG4gICAgdGhpcy5hcmdzID0gYXJnc1xuICAgIHRoaXMuY29uZmlndXJhdGlvbiA9IGFyZ3MuY29uZmlndXJhdGlvblxuXG4gICAgdGhpcy5lbnZpcm9ubWVudEhhbmRsZXIgPSBhcmdzLmNvbmZpZ3VyYXRpb24uZ2V0RW52aXJvbm1lbnRIYW5kbGVyKClcbiAgICB0aGlzLmVudmlyb25tZW50SGFuZGxlci5zZXRBcmdzKGFyZ3MpXG4gICAgdGhpcy5lbnZpcm9ubWVudEhhbmRsZXIuc2V0Q29uZmlndXJhdGlvbihhcmdzLmNvbmZpZ3VyYXRpb24pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBleGVjdXRlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgZmluYWwgY29tbWFuZCByZXN1bHQuXG4gICAqL1xuICBhc3luYyBleGVjdXRlKCkge1xuICAgIGNvbnN0IGNvbW1hbmRHcm91cHMgPSBhd2FpdCB0aGlzLmNvbW1hbmRHcm91cHMoKVxuICAgIGxldCByZXN1bHRcblxuICAgIGZvciAoY29uc3QgY29tbWFuZFByb2Nlc3NBcmdzIG9mIGNvbW1hbmRHcm91cHMpIHtcbiAgICAgIGNvbnN0IHNob3VsZENsb3NlRGF0YWJhc2VDb25uZWN0aW9ucyA9ICF0aGlzLmhhc0N1cnJlbnREYXRhYmFzZUNvbm5lY3Rpb25zKClcblxuICAgICAgdHJ5IHtcbiAgICAgICAgcmVzdWx0ID0gYXdhaXQgdGhpcy5leGVjdXRlQ29tbWFuZChjb21tYW5kUHJvY2Vzc0FyZ3MpXG4gICAgICB9IGZpbmFsbHkge1xuICAgICAgICBpZiAoc2hvdWxkQ2xvc2VEYXRhYmFzZUNvbm5lY3Rpb25zKSB7XG4gICAgICAgICAgYXdhaXQgdGhpcy5nZXRDb25maWd1cmF0aW9uKCkuY2xvc2VEYXRhYmFzZUNvbm5lY3Rpb25zKClcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiByZXN1bHRcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGV4ZWN1dGUgY29tbWFuZC5cbiAgICogQHBhcmFtIHtzdHJpbmdbXX0gcHJvY2Vzc0FyZ3MgLSBQcm9jZXNzIGFyZ3MgZm9yIGEgc2luZ2xlIGNvbW1hbmQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBSZXNvbHZlcyB3aXRoIHRoZSBjb21tYW5kIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIGV4ZWN1dGVDb21tYW5kKHByb2Nlc3NBcmdzKSB7XG4gICAgaWYgKCFwcm9jZXNzQXJnc1swXSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiTWlzc2luZyBjb21tYW5kIGFyZ3VtZW50XCIpXG4gICAgfVxuXG4gICAgY29uc3QgY29tbWFuZFBhcnRzID0gcHJvY2Vzc0FyZ3NbMF0uc3BsaXQoXCI6XCIpXG4gICAgY29uc3QgcGFyc2VkQ29tbWFuZFBhcnRzID0gW11cblxuICAgIGZvciAobGV0IGNvbW1hbmRQYXJ0IG9mIGNvbW1hbmRQYXJ0cykge1xuICAgICAgaWYgKGNvbW1hbmRQYXJ0ID09IFwiY1wiKSBjb21tYW5kUGFydCA9IFwiY29uc29sZVwiXG4gICAgICBpZiAoY29tbWFuZFBhcnQgPT0gXCJkXCIpIGNvbW1hbmRQYXJ0ID0gXCJkZXN0cm95XCJcbiAgICAgIGlmIChjb21tYW5kUGFydCA9PSBcImdcIikgY29tbWFuZFBhcnQgPSBcImdlbmVyYXRlXCJcbiAgICAgIGlmIChjb21tYW5kUGFydCA9PSBcInNcIikgY29tbWFuZFBhcnQgPSBcInNlcnZlclwiXG5cbiAgICAgIHBhcnNlZENvbW1hbmRQYXJ0cy5wdXNoKGNvbW1hbmRQYXJ0KVxuICAgIH1cblxuICAgIGNvbnN0IENvbW1hbmRDbGFzcyA9IGF3YWl0IHRoaXMuZW52aXJvbm1lbnRIYW5kbGVyLnJlcXVpcmVDb21tYW5kKHtjb21tYW5kUGFydHM6IHBhcnNlZENvbW1hbmRQYXJ0c30pXG4gICAgY29uc3QgY29tbWFuZEluc3RhbmNlID0gbmV3IENvbW1hbmRDbGFzcyh7XG4gICAgICBhcmdzOiBPYmplY3QuYXNzaWduKHt9LCB0aGlzLmFyZ3MsIHtwcm9jZXNzQXJnc30pLFxuICAgICAgY2xpOiB0aGlzXG4gICAgfSlcblxuICAgIGF3YWl0IGNvbW1hbmRJbnN0YW5jZS5pbml0aWFsaXplKClcblxuICAgIHJldHVybiBhd2FpdCBjb21tYW5kSW5zdGFuY2UuZXhlY3V0ZSgpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBjb21tYW5kIGdyb3Vwcy5cbiAgICogQHJldHVybnMge1Byb21pc2U8c3RyaW5nW11bXT59IC0gQ29tbWFuZCBncm91cHMgd2l0aCBwcm9jZXNzIGFyZ3MgZm9yIGVhY2ggY29tbWFuZC5cbiAgICovXG4gIGFzeW5jIGNvbW1hbmRHcm91cHMoKSB7XG4gICAgY29uc3QgcHJvY2Vzc0FyZ3MgPSB0aGlzLmFyZ3MucHJvY2Vzc0FyZ3MgfHwgW11cbiAgICBjb25zdCBjb21tYW5kcyA9IGF3YWl0IHRoaXMuZW52aXJvbm1lbnRIYW5kbGVyLmZpbmRDb21tYW5kcygpXG4gICAgY29uc3QgY29tbWFuZE5hbWVzID0gbmV3IFNldChjb21tYW5kcy5tYXAoKGNvbW1hbmQpID0+IGNvbW1hbmQubmFtZSkpXG4gICAgLyoqXG4gICAgICogR3JvdXBzLlxuICAgICAqIEB0eXBlIHtzdHJpbmdbXVtdfSAqL1xuICAgIGNvbnN0IGdyb3VwcyA9IFtdXG4gICAgLyoqXG4gICAgICogQ3VycmVudCBncm91cC5cbiAgICAgKiBAdHlwZSB7c3RyaW5nW119ICovXG4gICAgbGV0IGN1cnJlbnRHcm91cCA9IFtdXG4gICAgbGV0IGV4cGVjdHNPcHRpb25WYWx1ZSA9IGZhbHNlXG5cbiAgICBmb3IgKGNvbnN0IHByb2Nlc3NBcmcgb2YgcHJvY2Vzc0FyZ3MpIHtcbiAgICAgIGlmIChjdXJyZW50R3JvdXAubGVuZ3RoID09IDApIHtcbiAgICAgICAgaWYgKHByb2Nlc3NBcmcuc3RhcnRzV2l0aChcIi1cIikpIGNvbnRpbnVlXG5cbiAgICAgICAgY3VycmVudEdyb3VwID0gW3Byb2Nlc3NBcmddXG4gICAgICAgIGNvbnRpbnVlXG4gICAgICB9XG5cbiAgICAgIGlmIChleHBlY3RzT3B0aW9uVmFsdWUpIHtcbiAgICAgICAgY3VycmVudEdyb3VwLnB1c2gocHJvY2Vzc0FyZylcbiAgICAgICAgZXhwZWN0c09wdGlvblZhbHVlID0gZmFsc2VcbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgaWYgKCFwcm9jZXNzQXJnLnN0YXJ0c1dpdGgoXCItXCIpICYmIGNvbW1hbmROYW1lcy5oYXMocHJvY2Vzc0FyZykpIHtcbiAgICAgICAgZ3JvdXBzLnB1c2goY3VycmVudEdyb3VwKVxuICAgICAgICBjdXJyZW50R3JvdXAgPSBbcHJvY2Vzc0FyZ11cbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGN1cnJlbnRHcm91cC5wdXNoKHByb2Nlc3NBcmcpXG4gICAgICAgIGV4cGVjdHNPcHRpb25WYWx1ZSA9IENPTU1BTkRfVkFMVUVfT1BUSU9OUy5oYXMocHJvY2Vzc0FyZylcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAoY3VycmVudEdyb3VwLmxlbmd0aCA+IDApIHtcbiAgICAgIGdyb3Vwcy5wdXNoKGN1cnJlbnRHcm91cClcbiAgICB9XG5cbiAgICBpZiAoZ3JvdXBzLmxlbmd0aCA9PSAwKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJNaXNzaW5nIGNvbW1hbmQgYXJndW1lbnRcIilcbiAgICB9XG5cbiAgICByZXR1cm4gZ3JvdXBzXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgY29uZmlndXJhdGlvbi5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24uanNcIikuZGVmYXVsdH0gY29uZmlndXJhdGlvblxuICAgKi9cbiAgZ2V0Q29uZmlndXJhdGlvbigpIHsgcmV0dXJuIHRoaXMuY29uZmlndXJhdGlvbiB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaGFzIGN1cnJlbnQgZGF0YWJhc2UgY29ubmVjdGlvbnMuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgdGhlIGN1cnJlbnQgYXN5bmMgY29udGV4dCBhbHJlYWR5IGhhcyBkYXRhYmFzZSBjb25uZWN0aW9ucy5cbiAgICovXG4gIGhhc0N1cnJlbnREYXRhYmFzZUNvbm5lY3Rpb25zKCkge1xuICAgIHRyeSB7XG4gICAgICByZXR1cm4gT2JqZWN0LmtleXModGhpcy5nZXRDb25maWd1cmF0aW9uKCkuZ2V0Q3VycmVudENvbm5lY3Rpb25zKCkpLmxlbmd0aCA+IDBcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgaWYgKGVycm9yIGluc3RhbmNlb2YgRXJyb3IgJiYgZXJyb3IubWVzc2FnZS5zdGFydHNXaXRoKFwiTm8gZGF0YWJhc2UgY29uZmlndXJhdGlvbiBmb3IgZW52aXJvbm1lbnQ6XCIpKSByZXR1cm4gZmFsc2VcblxuICAgICAgdGhyb3cgZXJyb3JcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgdGVzdGluZy5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciB0ZXN0aW5nLlxuICAgKi9cbiAgZ2V0VGVzdGluZygpIHtcbiAgICByZXR1cm4gdGhpcy5hcmdzLnRlc3RpbmcgfHwgZmFsc2VcbiAgfVxufVxuIl19