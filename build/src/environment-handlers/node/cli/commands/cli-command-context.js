/**
 * CliCommandContext type.
 * @typedef {object} CliCommandContext
 * @property {import("../../../../configuration.js").default} configuration - Configuration instance.
 * @property {import("../../../../database/drivers/base.js").default | undefined} db - Default database connection.
 * @property {Record<string, import("../../../../database/drivers/base.js").default>} dbs - Database connections keyed by identifier.
 * @property {string[]} args - CLI args after command-specific leading arguments.
 */
/**
 * Runs build cli command context.
 * @param {import("../../../../cli/base-command.js").default} command - Command building the context.
 * @param {number} argsOffset - Number of process args to omit.
 * @returns {CliCommandContext} - Runtime context passed to CLI command scripts.
 */
export default function buildCliCommandContext(command, argsOffset) {
    const configuration = command.getConfiguration();
    const dbs = configuration.getCurrentConnections();
    const identifiers = Object.keys(dbs);
    /**
     * Process args.
     * @type {string[]} */
    const processArgs = command.processArgs || [];
    return {
        configuration,
        db: dbs.default || (identifiers.length > 0 ? dbs[identifiers[0]] : undefined),
        dbs,
        args: processArgs.slice(argsOffset)
    };
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY2xpLWNvbW1hbmQtY29udGV4dC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uLy4uLy4uL3NyYy9lbnZpcm9ubWVudC1oYW5kbGVycy9ub2RlL2NsaS9jb21tYW5kcy9jbGktY29tbWFuZC1jb250ZXh0LmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBOzs7Ozs7O0dBT0c7QUFFSDs7Ozs7R0FLRztBQUNILE1BQU0sQ0FBQyxPQUFPLFVBQVUsc0JBQXNCLENBQUMsT0FBTyxFQUFFLFVBQVU7SUFDaEUsTUFBTSxhQUFhLEdBQUcsT0FBTyxDQUFDLGdCQUFnQixFQUFFLENBQUE7SUFDaEQsTUFBTSxHQUFHLEdBQUcsYUFBYSxDQUFDLHFCQUFxQixFQUFFLENBQUE7SUFDakQsTUFBTSxXQUFXLEdBQUcsTUFBTSxDQUFDLElBQUksQ0FBQyxHQUFHLENBQUMsQ0FBQTtJQUNwQzs7MEJBRXNCO0lBQ3RCLE1BQU0sV0FBVyxHQUFHLE9BQU8sQ0FBQyxXQUFXLElBQUksRUFBRSxDQUFBO0lBRTdDLE9BQU87UUFDTCxhQUFhO1FBQ2IsRUFBRSxFQUFFLEdBQUcsQ0FBQyxPQUFPLElBQUksQ0FBQyxXQUFXLENBQUMsTUFBTSxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUMsR0FBRyxDQUFDLFdBQVcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxTQUFTLENBQUM7UUFDN0UsR0FBRztRQUNILElBQUksRUFBRSxXQUFXLENBQUMsS0FBSyxDQUFDLFVBQVUsQ0FBQztLQUNwQyxDQUFBO0FBQ0gsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbIi8qKlxuICogQ2xpQ29tbWFuZENvbnRleHQgdHlwZS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IENsaUNvbW1hbmRDb250ZXh0XG4gKiBAcHJvcGVydHkge2ltcG9ydChcIi4uLy4uLy4uLy4uL2NvbmZpZ3VyYXRpb24uanNcIikuZGVmYXVsdH0gY29uZmlndXJhdGlvbiAtIENvbmZpZ3VyYXRpb24gaW5zdGFuY2UuXG4gKiBAcHJvcGVydHkge2ltcG9ydChcIi4uLy4uLy4uLy4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkfSBkYiAtIERlZmF1bHQgZGF0YWJhc2UgY29ubmVjdGlvbi5cbiAqIEBwcm9wZXJ0eSB7UmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi4vLi4vLi4vLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHQ+fSBkYnMgLSBEYXRhYmFzZSBjb25uZWN0aW9ucyBrZXllZCBieSBpZGVudGlmaWVyLlxuICogQHByb3BlcnR5IHtzdHJpbmdbXX0gYXJncyAtIENMSSBhcmdzIGFmdGVyIGNvbW1hbmQtc3BlY2lmaWMgbGVhZGluZyBhcmd1bWVudHMuXG4gKi9cblxuLyoqXG4gKiBSdW5zIGJ1aWxkIGNsaSBjb21tYW5kIGNvbnRleHQuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4uLy4uLy4uLy4uL2NsaS9iYXNlLWNvbW1hbmQuanNcIikuZGVmYXVsdH0gY29tbWFuZCAtIENvbW1hbmQgYnVpbGRpbmcgdGhlIGNvbnRleHQuXG4gKiBAcGFyYW0ge251bWJlcn0gYXJnc09mZnNldCAtIE51bWJlciBvZiBwcm9jZXNzIGFyZ3MgdG8gb21pdC5cbiAqIEByZXR1cm5zIHtDbGlDb21tYW5kQ29udGV4dH0gLSBSdW50aW1lIGNvbnRleHQgcGFzc2VkIHRvIENMSSBjb21tYW5kIHNjcmlwdHMuXG4gKi9cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uIGJ1aWxkQ2xpQ29tbWFuZENvbnRleHQoY29tbWFuZCwgYXJnc09mZnNldCkge1xuICBjb25zdCBjb25maWd1cmF0aW9uID0gY29tbWFuZC5nZXRDb25maWd1cmF0aW9uKClcbiAgY29uc3QgZGJzID0gY29uZmlndXJhdGlvbi5nZXRDdXJyZW50Q29ubmVjdGlvbnMoKVxuICBjb25zdCBpZGVudGlmaWVycyA9IE9iamVjdC5rZXlzKGRicylcbiAgLyoqXG4gICAqIFByb2Nlc3MgYXJncy5cbiAgICogQHR5cGUge3N0cmluZ1tdfSAqL1xuICBjb25zdCBwcm9jZXNzQXJncyA9IGNvbW1hbmQucHJvY2Vzc0FyZ3MgfHwgW11cblxuICByZXR1cm4ge1xuICAgIGNvbmZpZ3VyYXRpb24sXG4gICAgZGI6IGRicy5kZWZhdWx0IHx8IChpZGVudGlmaWVycy5sZW5ndGggPiAwID8gZGJzW2lkZW50aWZpZXJzWzBdXSA6IHVuZGVmaW5lZCksXG4gICAgZGJzLFxuICAgIGFyZ3M6IHByb2Nlc3NBcmdzLnNsaWNlKGFyZ3NPZmZzZXQpXG4gIH1cbn1cbiJdfQ==