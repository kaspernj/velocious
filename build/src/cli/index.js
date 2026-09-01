// @ts-check
const COMMAND_VALUE_OPTIONS = new Set(["--generation", "--initial-generation-state", "--lifecycle-socket", "--socket", "--tenant"]);
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvY2xpL2luZGV4LmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixNQUFNLHFCQUFxQixHQUFHLElBQUksR0FBRyxDQUFDLENBQUMsY0FBYyxFQUFFLDRCQUE0QixFQUFFLG9CQUFvQixFQUFFLFVBQVUsRUFBRSxVQUFVLENBQUMsQ0FBQyxDQUFBO0FBRW5JLE1BQU0sQ0FBQyxPQUFPLE9BQU8sWUFBWTtJQUMvQjs7Ozs7Ozs7O09BU0c7SUFDSCxZQUFZLElBQUksR0FBRyxFQUFFO1FBQ25CLElBQUksQ0FBQyxJQUFJLENBQUMsYUFBYTtZQUFFLE1BQU0sSUFBSSxLQUFLLENBQUMsb0NBQW9DLENBQUMsQ0FBQTtRQUU5RSxJQUFJLENBQUMsSUFBSSxHQUFHLElBQUksQ0FBQTtRQUNoQixJQUFJLENBQUMsYUFBYSxHQUFHLElBQUksQ0FBQyxhQUFhLENBQUE7UUFFdkMsSUFBSSxDQUFDLGtCQUFrQixHQUFHLElBQUksQ0FBQyxhQUFhLENBQUMscUJBQXFCLEVBQUUsQ0FBQTtRQUNwRSxJQUFJLENBQUMsa0JBQWtCLENBQUMsT0FBTyxDQUFDLElBQUksQ0FBQyxDQUFBO1FBQ3JDLElBQUksQ0FBQyxrQkFBa0IsQ0FBQyxnQkFBZ0IsQ0FBQyxJQUFJLENBQUMsYUFBYSxDQUFDLENBQUE7SUFDOUQsQ0FBQztJQUVEOzs7T0FHRztJQUNILEtBQUssQ0FBQyxPQUFPO1FBQ1gsTUFBTSxhQUFhLEdBQUcsTUFBTSxJQUFJLENBQUMsYUFBYSxFQUFFLENBQUE7UUFDaEQsSUFBSSxNQUFNLENBQUE7UUFFVixLQUFLLE1BQU0sa0JBQWtCLElBQUksYUFBYSxFQUFFLENBQUM7WUFDL0MsTUFBTSw4QkFBOEIsR0FBRyxDQUFDLElBQUksQ0FBQyw2QkFBNkIsRUFBRSxDQUFBO1lBRTVFLElBQUksQ0FBQztnQkFDSCxNQUFNLEdBQUcsTUFBTSxJQUFJLENBQUMsY0FB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RUQ7OztPQUdHO0lBQ0gsVUFBVTtRQUNSLE9BQU8sSUFBSSxDQUFDLElBQUksQ0FBQyxPQUFPLElBQUksS0FBSyxDQUFBO0lBQ25DLENBQUM7Q0FDRiIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG5jb25zdCBDT01NQU5EX1ZBTFVFX09QVElPTlMgPSBuZXcgU2V0KFtcIi0tZ2VuZXJhdGlvblwiLCBcIi0taW5pdGlhbC1nZW5lcmF0aW9uLXN0YXRlXCIsIFwiLS1saWZlY3ljbGUtc29ja2V0XCIsIFwiLS1zb2NrZXRcIiwgXCItLXRlbmFudFwiXSlcblxuZXhwb3J0IGRlZmF1bHQgY2xhc3MgVmVsb2Npb3VzQ2xpIHtcbiAgLyoqXG4gICAqIFJ1bnMgY29uc3RydWN0b3IuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi5qc1wiKS5kZWZhdWx0fSBbYXJncy5jb25maWd1cmF0aW9uXSAtIENvbmZpZ3VyYXRpb24gaW5zdGFuY2UuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbYXJncy5kaXJlY3RvcnldIC0gRGlyZWN0b3J5IHBhdGguXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZW52aXJvbm1lbnQtaGFuZGxlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBbYXJncy5lbnZpcm9ubWVudEhhbmRsZXJdIC0gRW52aXJvbm1lbnQgaGFuZGxlci5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBzdHJpbmcgfCBudW1iZXIgfCBib29sZWFuIHwgdW5kZWZpbmVkPn0gW2FyZ3MucGFyc2VkUHJvY2Vzc0FyZ3NdIC0gUGFyc2VkIHByb2Nlc3MgYXJncy5cbiAgICogQHBhcmFtIHtzdHJpbmdbXX0gW2FyZ3MucHJvY2Vzc0FyZ3NdIC0gUHJvY2VzcyBhcmdzLlxuICAgKiBAcGFyYW0ge2Jvb2xlYW59IFthcmdzLnRlc3RpbmddIC0gV2hldGhlciB0ZXN0aW5nLlxuICAgKi9cbiAgY29uc3RydWN0b3IoYXJncyA9IHt9KSB7XG4gICAgaWYgKCFhcmdzLmNvbmZpZ3VyYXRpb24pIHRocm93IG5ldyBFcnJvcihcImNvbmZpZ3VyYXRpb24gYXJndW1lbnQgaXMgcmVxdWlyZWRcIilcblxuICAgIHRoaXMuYXJncyA9IGFyZ3NcbiAgICB0aGlzLmNvbmZpZ3VyYXRpb24gPSBhcmdzLmNvbmZpZ3VyYXRpb25cblxuICAgIHRoaXMuZW52aXJvbm1lbnRIYW5kbGVyID0gYXJncy5jb25maWd1cmF0aW9uLmdldEVudmlyb25tZW50SGFuZGxlcigpXG4gICAgdGhpcy5lbnZpcm9ubWVudEhhbmRsZXIuc2V0QXJncyhhcmdzKVxuICAgIHRoaXMuZW52aXJvbm1lbnRIYW5kbGVyLnNldENvbmZpZ3VyYXRpb24oYXJncy5jb25maWd1cmF0aW9uKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZXhlY3V0ZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIFJlc29sdmVzIHdpdGggdGhlIGZpbmFsIGNvbW1hbmQgcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgZXhlY3V0ZSgpIHtcbiAgICBjb25zdCBjb21tYW5kR3JvdXBzID0gYXdhaXQgdGhpcy5jb21tYW5kR3JvdXBzKClcbiAgICBsZXQgcmVzdWx0XG5cbiAgICBmb3IgKGNvbnN0IGNvbW1hbmRQcm9jZXNzQXJncyBvZiBjb21tYW5kR3JvdXBzKSB7XG4gICAgICBjb25zdCBzaG91bGRDbG9zZURhdGFiYXNlQ29ubmVjdGlvbnMgPSAhdGhpcy5oYXNDdXJyZW50RGF0YWJhc2VDb25uZWN0aW9ucygpXG5cbiAgICAgIHRyeSB7XG4gICAgICAgIHJlc3VsdCA9IGF3YWl0IHRoaXMuZXhlY3V0ZUNvbW1hbmQoY29tbWFuZFByb2Nlc3NBcmdzKVxuICAgICAgfSBmaW5hbGx5IHtcbiAgICAgICAgaWYgKHNob3VsZENsb3NlRGF0YWJhc2VDb25uZWN0aW9ucykge1xuICAgICAgICAgIGF3YWl0IHRoaXMuZ2V0Q29uZmlndXJhdGlvbigpLmNsb3NlRGF0YWJhc2VDb25uZWN0aW9ucygpXG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gcmVzdWx0XG4gIH1cblxuICAvKipcbiAgICogUnVucyBleGVjdXRlIGNvbW1hbmQuXG4gICAqIEBwYXJhbSB7c3RyaW5nW119IHByb2Nlc3NBcmdzIC0gUHJvY2VzcyBhcmdzIGZvciBhIHNpbmdsZSBjb21tYW5kLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgY29tbWFuZCByZXN1bHQuXG4gICAqL1xuICBhc3luYyBleGVjdXRlQ29tbWFuZChwcm9jZXNzQXJncykge1xuICAgIGlmICghcHJvY2Vzc0FyZ3NbMF0pIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIk1pc3NpbmcgY29tbWFuZCBhcmd1bWVudFwiKVxuICAgIH1cblxuICAgIGNvbnN0IGNvbW1hbmRQYXJ0cyA9IHByb2Nlc3NBcmdzWzBdLnNwbGl0KFwiOlwiKVxuICAgIGNvbnN0IHBhcnNlZENvbW1hbmRQYXJ0cyA9IFtdXG5cbiAgICBmb3IgKGxldCBjb21tYW5kUGFydCBvZiBjb21tYW5kUGFydHMpIHtcbiAgICAgIGlmIChjb21tYW5kUGFydCA9PSBcImNcIikgY29tbWFuZFBhcnQgPSBcImNvbnNvbGVcIlxuICAgICAgaWYgKGNvbW1hbmRQYXJ0ID09IFwiZFwiKSBjb21tYW5kUGFydCA9IFwiZGVzdHJveVwiXG4gICAgICBpZiAoY29tbWFuZFBhcnQgPT0gXCJnXCIpIGNvbW1hbmRQYXJ0ID0gXCJnZW5lcmF0ZVwiXG4gICAgICBpZiAoY29tbWFuZFBhcnQgPT0gXCJzXCIpIGNvbW1hbmRQYXJ0ID0gXCJzZXJ2ZXJcIlxuXG4gICAgICBwYXJzZWRDb21tYW5kUGFydHMucHVzaChjb21tYW5kUGFydClcbiAgICB9XG5cbiAgICBjb25zdCBDb21tYW5kQ2xhc3MgPSBhd2FpdCB0aGlzLmVudmlyb25tZW50SGFuZGxlci5yZXF1aXJlQ29tbWFuZCh7Y29tbWFuZFBhcnRzOiBwYXJzZWRDb21tYW5kUGFydHN9KVxuICAgIGNvbnN0IGNvbW1hbmRJbnN0YW5jZSA9IG5ldyBDb21tYW5kQ2xhc3Moe1xuICAgICAgYXJnczogT2JqZWN0LmFzc2lnbih7fSwgdGhpcy5hcmdzLCB7cHJvY2Vzc0FyZ3N9KSxcbiAgICAgIGNsaTogdGhpc1xuICAgIH0pXG5cbiAgICBhd2FpdCBjb21tYW5kSW5zdGFuY2UuaW5pdGlhbGl6ZSgpXG5cbiAgICByZXR1cm4gYXdhaXQgY29tbWFuZEluc3RhbmNlLmV4ZWN1dGUoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY29tbWFuZCBncm91cHMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHN0cmluZ1tdW10+fSAtIENvbW1hbmQgZ3JvdXBzIHdpdGggcHJvY2VzcyBhcmdzIGZvciBlYWNoIGNvbW1hbmQuXG4gICAqL1xuICBhc3luYyBjb21tYW5kR3JvdXBzKCkge1xuICAgIGNvbnN0IHByb2Nlc3NBcmdzID0gdGhpcy5hcmdzLnByb2Nlc3NBcmdzIHx8IFtdXG4gICAgY29uc3QgY29tbWFuZHMgPSBhd2FpdCB0aGlzLmVudmlyb25tZW50SGFuZGxlci5maW5kQ29tbWFuZHMoKVxuICAgIGNvbnN0IGNvbW1hbmROYW1lcyA9IG5ldyBTZXQoY29tbWFuZHMubWFwKChjb21tYW5kKSA9PiBjb21tYW5kLm5hbWUpKVxuICAgIC8qKlxuICAgICAqIEdyb3Vwcy5cbiAgICAgKiBAdHlwZSB7c3RyaW5nW11bXX0gKi9cbiAgICBjb25zdCBncm91cHMgPSBbXVxuICAgIC8qKlxuICAgICAqIEN1cnJlbnQgZ3JvdXAuXG4gICAgICogQHR5cGUge3N0cmluZ1tdfSAqL1xuICAgIGxldCBjdXJyZW50R3JvdXAgPSBbXVxuICAgIGxldCBleHBlY3RzT3B0aW9uVmFsdWUgPSBmYWxzZVxuXG4gICAgZm9yIChjb25zdCBwcm9jZXNzQXJnIG9mIHByb2Nlc3NBcmdzKSB7XG4gICAgICBpZiAoY3VycmVudEdyb3VwLmxlbmd0aCA9PSAwKSB7XG4gICAgICAgIGlmIChwcm9jZXNzQXJnLnN0YXJ0c1dpdGgoXCItXCIpKSBjb250aW51ZVxuXG4gICAgICAgIGN1cnJlbnRHcm91cCA9IFtwcm9jZXNzQXJnXVxuICAgICAgICBjb250aW51ZVxuICAgICAgfVxuXG4gICAgICBpZiAoZXhwZWN0c09wdGlvblZhbHVlKSB7XG4gICAgICAgIGN1cnJlbnRHcm91cC5wdXNoKHByb2Nlc3NBcmcpXG4gICAgICAgIGV4cGVjdHNPcHRpb25WYWx1ZSA9IGZhbHNlXG4gICAgICAgIGNvbnRpbnVlXG4gICAgICB9XG5cbiAgICAgIGlmICghcHJvY2Vzc0FyZy5zdGFydHNXaXRoKFwiLVwiKSAmJiBjb21tYW5kTmFtZXMuaGFzKHByb2Nlc3NBcmcpKSB7XG4gICAgICAgIGdyb3Vwcy5wdXNoKGN1cnJlbnRHcm91cClcbiAgICAgICAgY3VycmVudEdyb3VwID0gW3Byb2Nlc3NBcmddXG4gICAgICB9IGVsc2Uge1xuICAgICAgICBjdXJyZW50R3JvdXAucHVzaChwcm9jZXNzQXJnKVxuICAgICAgICBleHBlY3RzT3B0aW9uVmFsdWUgPSBDT01NQU5EX1ZBTFVFX09QVElPTlMuaGFzKHByb2Nlc3NBcmcpXG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKGN1cnJlbnRHcm91cC5sZW5ndGggPiAwKSB7XG4gICAgICBncm91cHMucHVzaChjdXJyZW50R3JvdXApXG4gICAgfVxuXG4gICAgaWYgKGdyb3Vwcy5sZW5ndGggPT0gMCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiTWlzc2luZyBjb21tYW5kIGFyZ3VtZW50XCIpXG4gICAgfVxuXG4gICAgcmV0dXJuIGdyb3Vwc1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGNvbmZpZ3VyYXRpb24uXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLmpzXCIpLmRlZmF1bHR9IGNvbmZpZ3VyYXRpb25cbiAgICovXG4gIGdldENvbmZpZ3VyYXRpb24oKSB7IHJldHVybiB0aGlzLmNvbmZpZ3VyYXRpb24gfVxuXG4gIC8qKlxuICAgKiBSdW5zIGhhcyBjdXJyZW50IGRhdGFiYXNlIGNvbm5lY3Rpb25zLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHRoZSBjdXJyZW50IGFzeW5jIGNvbnRleHQgYWxyZWFkeSBoYXMgZGF0YWJhc2UgY29ubmVjdGlvbnMuXG4gICAqL1xuICBoYXNDdXJyZW50RGF0YWJhc2VDb25uZWN0aW9ucygpIHtcbiAgICB0cnkge1xuICAgICAgcmV0dXJuIE9iamVjdC5rZXlzKHRoaXMuZ2V0Q29uZmlndXJhdGlvbigpLmdldEN1cnJlbnRDb25uZWN0aW9ucygpKS5sZW5ndGggPiAwXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGlmIChlcnJvciBpbnN0YW5jZW9mIEVycm9yICYmIGVycm9yLm1lc3NhZ2Uuc3RhcnRzV2l0aChcIk5vIGRhdGFiYXNlIGNvbmZpZ3VyYXRpb24gZm9yIGVudmlyb25tZW50OlwiKSkgcmV0dXJuIGZhbHNlXG5cbiAgICAgIHRocm93IGVycm9yXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHRlc3RpbmcuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgdGVzdGluZy5cbiAgICovXG4gIGdldFRlc3RpbmcoKSB7XG4gICAgcmV0dXJuIHRoaXMuYXJncy50ZXN0aW5nIHx8IGZhbHNlXG4gIH1cbn1cbiJdfQ==