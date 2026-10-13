// @ts-check
const COMMAND_VALUE_OPTIONS = new Set(["--generation", "--initial-generation-state", "--lifecycle-socket", "--phase", "--request-context", "--socket", "--tenant"]);
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvY2xpL2luZGV4LmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixNQUFNLHFCQUFxQixHQUFHLElBQUksR0FBRyxDQUFDLENBQUMsY0FBYyxFQUFFLDRCQUE0QixFQUFFLG9CQUFvQixFQUFFLFNBQVMsRUFBRSxtQkFBbUIsRUFBRSxVQUFVLEVBQUUsVUFBVSxDQUFDLENBQUMsQ0FBQTtBQUVuSyxNQUFNLENBQUMsT0FBTyxPQUFPLFlBQVk7SUFDL0I7Ozs7Ozs7OztPQVNHO0lBQ0gsWUFBWSxJQUFJLEdBQUcsRUFBRTtRQUNuQixJQUFJLENBQUMsSUFBSSxDQUFDLGFBQWE7WUFBRSxNQUFNLElBQUksS0FBSyxDQUFDLG9DQUFvQyxDQUFDLENBQUE7UUFFOUUsSUFBSSxDQUFDLElBQUksR0FBRyxJQUFJLENBQUE7UUFDaEIsSUFBSSxDQUFDLGFBQWEsR0FBRyxJQUFJLENBQUMsYUFBYSxDQUFBO1FBRXZDLElBQUksQ0FBQyxrQkFBa0IsR0FBRyxJQUFJLENBQUMsYUFBYSxDQUFDLHFCQUFxQixFQUFFLENBQUE7UUFDcEUsSUFBSSxDQUFDLGtCQUFrQixDQUFDLE9BQU8sQ0FBQyxJQUFJLENBQUMsQ0FBQTtRQUNyQyxJQUFJLENBQUMsa0JBQWtCLENBQUMsZ0JBQWdCLENBQUMsSUFBSSxDQUFDLGFBQWEsQ0FBQyxDQUFBO0lBQzlELENBQUM7SUFFRDs7O09BR0c7SUFDSCxLQUFLLENBQUMsT0FBTztRQUNYLE1BQU0sYUFBYSxHQUFHLE1BQU0sSUFBSSxDQUFDLGFBQWEsRUFBRSxDQUFBO1FBQ2hELElBQUksTUFBTSxDQUFBO1FBRVYsS0FBSyxNQUFNLGtCQUFrQixJQUFJLGFBQWEsRUFBRSxDQUFDO1lBQy9DLE1BQU0sOEJBQThCLEdBQUcsQ0FBQyxJQUFJLENBQUMsNkJBQTZCLEVBQUUsQ0FBQTtZQUU1RSxJQUFJLENBQUM7Z0JBQ0gsTUFBTSxH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UUFDYixDQUFDO0lBQ0gsQ0FBQztJQUVEOzs7T0FHRztJQUNILFVBQVU7UUFDUixPQUFPLElBQUksQ0FBQyxJQUFJLENBQUMsT0FBTyxJQUFJLEtBQUssQ0FBQTtJQUNuQyxDQUFDO0NBQ0YiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuY29uc3QgQ09NTUFORF9WQUxVRV9PUFRJT05TID0gbmV3IFNldChbXCItLWdlbmVyYXRpb25cIiwgXCItLWluaXRpYWwtZ2VuZXJhdGlvbi1zdGF0ZVwiLCBcIi0tbGlmZWN5Y2xlLXNvY2tldFwiLCBcIi0tcGhhc2VcIiwgXCItLXJlcXVlc3QtY29udGV4dFwiLCBcIi0tc29ja2V0XCIsIFwiLS10ZW5hbnRcIl0pXG5cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIFZlbG9jaW91c0NsaSB7XG4gIC8qKlxuICAgKiBSdW5zIGNvbnN0cnVjdG9yLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24uanNcIikuZGVmYXVsdH0gW2FyZ3MuY29uZmlndXJhdGlvbl0gLSBDb25maWd1cmF0aW9uIGluc3RhbmNlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW2FyZ3MuZGlyZWN0b3J5XSAtIERpcmVjdG9yeSBwYXRoLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2Vudmlyb25tZW50LWhhbmRsZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gW2FyZ3MuZW52aXJvbm1lbnRIYW5kbGVyXSAtIEVudmlyb25tZW50IGhhbmRsZXIuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgc3RyaW5nIHwgbnVtYmVyIHwgYm9vbGVhbiB8IHVuZGVmaW5lZD59IFthcmdzLnBhcnNlZFByb2Nlc3NBcmdzXSAtIFBhcnNlZCBwcm9jZXNzIGFyZ3MuXG4gICAqIEBwYXJhbSB7c3RyaW5nW119IFthcmdzLnByb2Nlc3NBcmdzXSAtIFByb2Nlc3MgYXJncy5cbiAgICogQHBhcmFtIHtib29sZWFufSBbYXJncy50ZXN0aW5nXSAtIFdoZXRoZXIgdGVzdGluZy5cbiAgICovXG4gIGNvbnN0cnVjdG9yKGFyZ3MgPSB7fSkge1xuICAgIGlmICghYXJncy5jb25maWd1cmF0aW9uKSB0aHJvdyBuZXcgRXJyb3IoXCJjb25maWd1cmF0aW9uIGFyZ3VtZW50IGlzIHJlcXVpcmVkXCIpXG5cbiAgICB0aGlzLmFyZ3MgPSBhcmdzXG4gICAgdGhpcy5jb25maWd1cmF0aW9uID0gYXJncy5jb25maWd1cmF0aW9uXG5cbiAgICB0aGlzLmVudmlyb25tZW50SGFuZGxlciA9IGFyZ3MuY29uZmlndXJhdGlvbi5nZXRFbnZpcm9ubWVudEhhbmRsZXIoKVxuICAgIHRoaXMuZW52aXJvbm1lbnRIYW5kbGVyLnNldEFyZ3MoYXJncylcbiAgICB0aGlzLmVudmlyb25tZW50SGFuZGxlci5zZXRDb25maWd1cmF0aW9uKGFyZ3MuY29uZmlndXJhdGlvbilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGV4ZWN1dGUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBSZXNvbHZlcyB3aXRoIHRoZSBmaW5hbCBjb21tYW5kIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIGV4ZWN1dGUoKSB7XG4gICAgY29uc3QgY29tbWFuZEdyb3VwcyA9IGF3YWl0IHRoaXMuY29tbWFuZEdyb3VwcygpXG4gICAgbGV0IHJlc3VsdFxuXG4gICAgZm9yIChjb25zdCBjb21tYW5kUHJvY2Vzc0FyZ3Mgb2YgY29tbWFuZEdyb3Vwcykge1xuICAgICAgY29uc3Qgc2hvdWxkQ2xvc2VEYXRhYmFzZUNvbm5lY3Rpb25zID0gIXRoaXMuaGFzQ3VycmVudERhdGFiYXNlQ29ubmVjdGlvbnMoKVxuXG4gICAgICB0cnkge1xuICAgICAgICByZXN1bHQgPSBhd2FpdCB0aGlzLmV4ZWN1dGVDb21tYW5kKGNvbW1hbmRQcm9jZXNzQXJncylcbiAgICAgIH0gZmluYWxseSB7XG4gICAgICAgIGlmIChzaG91bGRDbG9zZURhdGFiYXNlQ29ubmVjdGlvbnMpIHtcbiAgICAgICAgICBhd2FpdCB0aGlzLmdldENvbmZpZ3VyYXRpb24oKS5jbG9zZURhdGFiYXNlQ29ubmVjdGlvbnMoKVxuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIHJlc3VsdFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZXhlY3V0ZSBjb21tYW5kLlxuICAgKiBAcGFyYW0ge3N0cmluZ1tdfSBwcm9jZXNzQXJncyAtIFByb2Nlc3MgYXJncyBmb3IgYSBzaW5nbGUgY29tbWFuZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIFJlc29sdmVzIHdpdGggdGhlIGNvbW1hbmQgcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgZXhlY3V0ZUNvbW1hbmQocHJvY2Vzc0FyZ3MpIHtcbiAgICBpZiAoIXByb2Nlc3NBcmdzWzBdKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJNaXNzaW5nIGNvbW1hbmQgYXJndW1lbnRcIilcbiAgICB9XG5cbiAgICBjb25zdCBjb21tYW5kUGFydHMgPSBwcm9jZXNzQXJnc1swXS5zcGxpdChcIjpcIilcbiAgICBjb25zdCBwYXJzZWRDb21tYW5kUGFydHMgPSBbXVxuXG4gICAgZm9yIChsZXQgY29tbWFuZFBhcnQgb2YgY29tbWFuZFBhcnRzKSB7XG4gICAgICBpZiAoY29tbWFuZFBhcnQgPT0gXCJjXCIpIGNvbW1hbmRQYXJ0ID0gXCJjb25zb2xlXCJcbiAgICAgIGlmIChjb21tYW5kUGFydCA9PSBcImRcIikgY29tbWFuZFBhcnQgPSBcImRlc3Ryb3lcIlxuICAgICAgaWYgKGNvbW1hbmRQYXJ0ID09IFwiZ1wiKSBjb21tYW5kUGFydCA9IFwiZ2VuZXJhdGVcIlxuICAgICAgaWYgKGNvbW1hbmRQYXJ0ID09IFwic1wiKSBjb21tYW5kUGFydCA9IFwic2VydmVyXCJcblxuICAgICAgcGFyc2VkQ29tbWFuZFBhcnRzLnB1c2goY29tbWFuZFBhcnQpXG4gICAgfVxuXG4gICAgY29uc3QgQ29tbWFuZENsYXNzID0gYXdhaXQgdGhpcy5lbnZpcm9ubWVudEhhbmRsZXIucmVxdWlyZUNvbW1hbmQoe2NvbW1hbmRQYXJ0czogcGFyc2VkQ29tbWFuZFBhcnRzfSlcbiAgICBjb25zdCBjb21tYW5kSW5zdGFuY2UgPSBuZXcgQ29tbWFuZENsYXNzKHtcbiAgICAgIGFyZ3M6IE9iamVjdC5hc3NpZ24oe30sIHRoaXMuYXJncywge3Byb2Nlc3NBcmdzfSksXG4gICAgICBjbGk6IHRoaXNcbiAgICB9KVxuXG4gICAgYXdhaXQgY29tbWFuZEluc3RhbmNlLmluaXRpYWxpemUoKVxuXG4gICAgcmV0dXJuIGF3YWl0IGNvbW1hbmRJbnN0YW5jZS5leGVjdXRlKClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNvbW1hbmQgZ3JvdXBzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxzdHJpbmdbXVtdPn0gLSBDb21tYW5kIGdyb3VwcyB3aXRoIHByb2Nlc3MgYXJncyBmb3IgZWFjaCBjb21tYW5kLlxuICAgKi9cbiAgYXN5bmMgY29tbWFuZEdyb3VwcygpIHtcbiAgICBjb25zdCBwcm9jZXNzQXJncyA9IHRoaXMuYXJncy5wcm9jZXNzQXJncyB8fCBbXVxuICAgIGNvbnN0IGNvbW1hbmRzID0gYXdhaXQgdGhpcy5lbnZpcm9ubWVudEhhbmRsZXIuZmluZENvbW1hbmRzKClcbiAgICBjb25zdCBjb21tYW5kTmFtZXMgPSBuZXcgU2V0KGNvbW1hbmRzLm1hcCgoY29tbWFuZCkgPT4gY29tbWFuZC5uYW1lKSlcbiAgICAvKipcbiAgICAgKiBHcm91cHMuXG4gICAgICogQHR5cGUge3N0cmluZ1tdW119ICovXG4gICAgY29uc3QgZ3JvdXBzID0gW11cbiAgICAvKipcbiAgICAgKiBDdXJyZW50IGdyb3VwLlxuICAgICAqIEB0eXBlIHtzdHJpbmdbXX0gKi9cbiAgICBsZXQgY3VycmVudEdyb3VwID0gW11cbiAgICBsZXQgZXhwZWN0c09wdGlvblZhbHVlID0gZmFsc2VcblxuICAgIGZvciAoY29uc3QgcHJvY2Vzc0FyZyBvZiBwcm9jZXNzQXJncykge1xuICAgICAgaWYgKGN1cnJlbnRHcm91cC5sZW5ndGggPT0gMCkge1xuICAgICAgICBpZiAocHJvY2Vzc0FyZy5zdGFydHNXaXRoKFwiLVwiKSkgY29udGludWVcblxuICAgICAgICBjdXJyZW50R3JvdXAgPSBbcHJvY2Vzc0FyZ11cbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgaWYgKGV4cGVjdHNPcHRpb25WYWx1ZSkge1xuICAgICAgICBjdXJyZW50R3JvdXAucHVzaChwcm9jZXNzQXJnKVxuICAgICAgICBleHBlY3RzT3B0aW9uVmFsdWUgPSBmYWxzZVxuICAgICAgICBjb250aW51ZVxuICAgICAgfVxuXG4gICAgICBpZiAoIXByb2Nlc3NBcmcuc3RhcnRzV2l0aChcIi1cIikgJiYgY29tbWFuZE5hbWVzLmhhcyhwcm9jZXNzQXJnKSkge1xuICAgICAgICBncm91cHMucHVzaChjdXJyZW50R3JvdXApXG4gICAgICAgIGN1cnJlbnRHcm91cCA9IFtwcm9jZXNzQXJnXVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgY3VycmVudEdyb3VwLnB1c2gocHJvY2Vzc0FyZylcbiAgICAgICAgZXhwZWN0c09wdGlvblZhbHVlID0gQ09NTUFORF9WQUxVRV9PUFRJT05TLmhhcyhwcm9jZXNzQXJnKVxuICAgICAgfVxuICAgIH1cblxuICAgIGlmIChjdXJyZW50R3JvdXAubGVuZ3RoID4gMCkge1xuICAgICAgZ3JvdXBzLnB1c2goY3VycmVudEdyb3VwKVxuICAgIH1cblxuICAgIGlmIChncm91cHMubGVuZ3RoID09IDApIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIk1pc3NpbmcgY29tbWFuZCBhcmd1bWVudFwiKVxuICAgIH1cblxuICAgIHJldHVybiBncm91cHNcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBjb25maWd1cmF0aW9uLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi5qc1wiKS5kZWZhdWx0fSBjb25maWd1cmF0aW9uXG4gICAqL1xuICBnZXRDb25maWd1cmF0aW9uKCkgeyByZXR1cm4gdGhpcy5jb25maWd1cmF0aW9uIH1cblxuICAvKipcbiAgICogUnVucyBoYXMgY3VycmVudCBkYXRhYmFzZSBjb25uZWN0aW9ucy5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciB0aGUgY3VycmVudCBhc3luYyBjb250ZXh0IGFscmVhZHkgaGFzIGRhdGFiYXNlIGNvbm5lY3Rpb25zLlxuICAgKi9cbiAgaGFzQ3VycmVudERhdGFiYXNlQ29ubmVjdGlvbnMoKSB7XG4gICAgdHJ5IHtcbiAgICAgIHJldHVybiBPYmplY3Qua2V5cyh0aGlzLmdldENvbmZpZ3VyYXRpb24oKS5nZXRDdXJyZW50Q29ubmVjdGlvbnMoKSkubGVuZ3RoID4gMFxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBpZiAoZXJyb3IgaW5zdGFuY2VvZiBFcnJvciAmJiBlcnJvci5tZXNzYWdlLnN0YXJ0c1dpdGgoXCJObyBkYXRhYmFzZSBjb25maWd1cmF0aW9uIGZvciBlbnZpcm9ubWVudDpcIikpIHJldHVybiBmYWxzZVxuXG4gICAgICB0aHJvdyBlcnJvclxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCB0ZXN0aW5nLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHRlc3RpbmcuXG4gICAqL1xuICBnZXRUZXN0aW5nKCkge1xuICAgIHJldHVybiB0aGlzLmFyZ3MudGVzdGluZyB8fCBmYWxzZVxuICB9XG59XG4iXX0=