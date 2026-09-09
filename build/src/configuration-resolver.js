// @ts-check
import Configuration, { CurrentConfigurationNotSetError } from "./configuration.js";
import envSense from "env-sense/build/use-env-sense.js";
import fileExists from "./utils/file-exists.js";
import toImportSpecifier from "./utils/to-import-specifier.js";
/**
 * Runs configuration resolver.
 * @param {import("./configuration-types.js").ConfigurationArgsType} [args] - Options object.
 * @returns {Promise<Configuration>} - Resolves with value.
 */
export default async function configurationResolver(args) {
    let configuration;
    try {
        configuration = Configuration.current();
    }
    catch (error) {
        if (error instanceof CurrentConfigurationNotSetError) {
            // Ignore
        }
        else {
            throw error;
        }
    }
    if (configuration) {
        return Configuration.current();
    }
    const directory = args?.directory || process.cwd();
    let configurationPrePath = `${directory}/src/config/configuration`;
    const configurationPathForNode = `${configurationPrePath}.node.js`;
    const configurationPathDefault = `${configurationPrePath}.js`;
    const { isServer } = envSense();
    let configurationPath;
    if (isServer && await fileExists(configurationPathForNode)) {
        configurationPath = configurationPathForNode;
    }
    else {
        configurationPath = configurationPathDefault;
    }
    try {
        const configurationImport = await import(toImportSpecifier(configurationPath));
        configuration = configurationImport.default;
    }
    catch (error) {
        console.log(`Couldn't load configuration from ${configurationPath} because of: ${error instanceof Error ? error.message : error}`);
        if (error instanceof Error) {
            // This might happen during an "init" CLI command where we copy a sample configuration file.
            if (!error.message.match(/^Cannot find module '(.+)\/configuration\.js'/)) {
                throw error;
            }
        }
        if (!args) {
            throw new Error("Can't spawn a new configuration because no configuration-arguments was given", { cause: error });
        }
        configuration = new Configuration(args);
    }
    return configuration;
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY29uZmlndXJhdGlvbi1yZXNvbHZlci5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uL3NyYy9jb25maWd1cmF0aW9uLXJlc29sdmVyLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLGFBQWEsRUFBRSxFQUFDLCtCQUErQixFQUFDLE1BQU0sb0JBQW9CLENBQUE7QUFDakYsT0FBTyxRQUFRLE1BQU0sa0NBQWtDLENBQUE7QUFDdkQsT0FBTyxVQUFVLE1BQU0sd0JBQXdCLENBQUE7QUFDL0MsT0FBTyxpQkFBaUIsTUFBTSxnQ0FBZ0MsQ0FBQTtBQUU5RDs7OztHQUlHO0FBQ0gsTUFBTSxDQUFDLE9BQU8sQ0FBQyxLQUFLLFVBQVUscUJBQXFCLENBQUMsSUFBSTtJQUN0RCxJQUFJLGFBQWEsQ0FBQTtJQUVqQixJQUFJLENBQUM7UUFDSCxhQUFhLEdBQUcsYUFBYSxDQUFDLE9BQU8sRUFBRSxDQUFBO0lBQ3pDLENBQUM7SUFBQyxPQUFPLEtBQUssRUFBRSxDQUFDO1FBQ2YsSUFBSSxLQUFLLFlBQVksK0JBQStCLEVBQUUsQ0FBQztZQUNyRCxTQUFTO1FBQ1gsQ0FBQzthQUFNLENBQUM7WUFDTixNQUFNLEtBQUssQ0FBQTtRQUNiLENBQUM7SUFDSCxDQUFDO0lBRUQsSUFBSSxhQUFhLEVBQUUsQ0FBQztRQUNsQixPQUFPLGFBQWEsQ0FBQyxPQUFPLEVBQUUsQ0FBQTtJQUNoQyxDQUFDO0lBRUQsTUFBTSxTQUFTLEdBQUcsSUFBSSxFQUFFLFNBQVMsSUFBSSxPQUFPLENBQUMsR0FBRyxFQUFFLENBQUE7SUFDbEQsSUFBSSxvQkFBb0IsR0FBRyxHQUFHLFNBQVMsMkJBQTJCLENBQUE7SUFDbEUsTUFBTSx3QkFBd0IsR0FBRyxHQUFHLG9CQUFvQixVQUFVLENBQUE7SUFDbEUsTUFBTSx3QkFBd0IsR0FBRyxHQUFHLG9CQUFvQixLQUFLLENBQUE7SUFDN0QsTUFBTSxFQUFDLFFBQVEsRUFBQyxHQUFHLFFBQVEsRUFBRSxDQUFBO0lBQzdCLElBQUksaUJBQWlCLENBQUE7SUFFckIsSUFBSSxRQUFRLElBQUksTUFBTSxVQUFVLENBQUMsd0JBQXdCLENBQUMsRUFBRSxDQUFDO1FBQzNELGlCQUFpQixHQUFHLHdCQUF3QixDQUFBO0lBQzlDLENBQUM7U0FBTSxDQUFDO1FBQ04saUJBQWlCLEdBQUcsd0JBQXdCLENBQUE7SUFDOUMsQ0FBQztJQUVELElBQUksQ0FBQztRQUNILE1BQU0sbUJBQW1CLEdBQUcsTUFBTSxNQUFNLENBQUMsaUJBQWlCLENBQUMsaUJBQWlCLENBQUMsQ0FBQyxDQUFBO1FBRTlFLGFBQWEsR0FBRyxtQkFBbUIsQ0FBQyxPQUFPLENBQUE7SUFDN0MsQ0FBQztJQUFDLE9BQU8sS0FBSyxFQUFFLENBQUM7UUFDZixPQUFPLENBQUMsR0FBRyxDQUFDLG9DQUFvQyxpQkFBaUIsZ0JBQWdCLEtBQUssWUFBWSxLQUFLLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDLEtBQUssRUFBRSxDQUFDLENBQUE7UUFFbEksSUFBSSxLQUFLLFlBQVksS0FBSyxFQUFFLENBQUM7WUFDM0IsNEZBQTRGO1lBQzVGLElBQUksQ0FBQyxLQUFLLENBQUMsT0FBTyxDQUFDLEtBQUssQ0FBQywrQ0FBK0MsQ0FBQyxFQUFFLENBQUM7Z0JBQzFFLE1BQU0sS0FBSyxDQUFBO1lBQ2IsQ0FBQztRQUNILENBQUM7UUFFRCxJQUFJLENBQUMsSUFBSSxFQUFFLENBQUM7WUFDVixNQUFNLElBQUksS0FBSyxDQUFDLDhFQUE4RSxFQUFFLEVBQUMsS0FBSyxFQUFFLEtBQUssRUFBQyxDQUFDLENBQUE7UUFDakgsQ0FBQztRQUVELGFBQWEsR0FBRyxJQUFJLGFBQWEsQ0FBQyxJQUFJLENBQUMsQ0FBQTtJQUN6QyxDQUFDO0lBRUQsT0FBTyxhQUFhLENBQUE7QUFDdEIsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG5pbXBvcnQgQ29uZmlndXJhdGlvbiwge0N1cnJlbnRDb25maWd1cmF0aW9uTm90U2V0RXJyb3J9IGZyb20gXCIuL2NvbmZpZ3VyYXRpb24uanNcIlxuaW1wb3J0IGVudlNlbnNlIGZyb20gXCJlbnYtc2Vuc2UvYnVpbGQvdXNlLWVudi1zZW5zZS5qc1wiXG5pbXBvcnQgZmlsZUV4aXN0cyBmcm9tIFwiLi91dGlscy9maWxlLWV4aXN0cy5qc1wiXG5pbXBvcnQgdG9JbXBvcnRTcGVjaWZpZXIgZnJvbSBcIi4vdXRpbHMvdG8taW1wb3J0LXNwZWNpZmllci5qc1wiXG5cbi8qKlxuICogUnVucyBjb25maWd1cmF0aW9uIHJlc29sdmVyLlxuICogQHBhcmFtIHtpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuQ29uZmlndXJhdGlvbkFyZ3NUeXBlfSBbYXJnc10gLSBPcHRpb25zIG9iamVjdC5cbiAqIEByZXR1cm5zIHtQcm9taXNlPENvbmZpZ3VyYXRpb24+fSAtIFJlc29sdmVzIHdpdGggdmFsdWUuXG4gKi9cbmV4cG9ydCBkZWZhdWx0IGFzeW5jIGZ1bmN0aW9uIGNvbmZpZ3VyYXRpb25SZXNvbHZlcihhcmdzKSB7XG4gIGxldCBjb25maWd1cmF0aW9uXG5cbiAgdHJ5IHtcbiAgICBjb25maWd1cmF0aW9uID0gQ29uZmlndXJhdGlvbi5jdXJyZW50KClcbiAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICBpZiAoZXJyb3IgaW5zdGFuY2VvZiBDdXJyZW50Q29uZmlndXJhdGlvbk5vdFNldEVycm9yKSB7XG4gICAgICAvLyBJZ25vcmVcbiAgICB9IGVsc2Uge1xuICAgICAgdGhyb3cgZXJyb3JcbiAgICB9XG4gIH1cblxuICBpZiAoY29uZmlndXJhdGlvbikge1xuICAgIHJldHVybiBDb25maWd1cmF0aW9uLmN1cnJlbnQoKVxuICB9XG5cbiAgY29uc3QgZGlyZWN0b3J5ID0gYXJncz8uZGlyZWN0b3J5IHx8IHByb2Nlc3MuY3dkKClcbiAgbGV0IGNvbmZpZ3VyYXRpb25QcmVQYXRoID0gYCR7ZGlyZWN0b3J5fS9zcmMvY29uZmlnL2NvbmZpZ3VyYXRpb25gXG4gIGNvbnN0IGNvbmZpZ3VyYXRpb25QYXRoRm9yTm9kZSA9IGAke2NvbmZpZ3VyYXRpb25QcmVQYXRofS5ub2RlLmpzYFxuICBjb25zdCBjb25maWd1cmF0aW9uUGF0aERlZmF1bHQgPSBgJHtjb25maWd1cmF0aW9uUHJlUGF0aH0uanNgXG4gIGNvbnN0IHtpc1NlcnZlcn0gPSBlbnZTZW5zZSgpXG4gIGxldCBjb25maWd1cmF0aW9uUGF0aFxuXG4gIGlmIChpc1NlcnZlciAmJiBhd2FpdCBmaWxlRXhpc3RzKGNvbmZpZ3VyYXRpb25QYXRoRm9yTm9kZSkpIHtcbiAgICBjb25maWd1cmF0aW9uUGF0aCA9IGNvbmZpZ3VyYXRpb25QYXRoRm9yTm9kZVxuICB9IGVsc2Uge1xuICAgIGNvbmZpZ3VyYXRpb25QYXRoID0gY29uZmlndXJhdGlvblBhdGhEZWZhdWx0XG4gIH1cblxuICB0cnkge1xuICAgIGNvbnN0IGNvbmZpZ3VyYXRpb25JbXBvcnQgPSBhd2FpdCBpbXBvcnQodG9JbXBvcnRTcGVjaWZpZXIoY29uZmlndXJhdGlvblBhdGgpKVxuXG4gICAgY29uZmlndXJhdGlvbiA9IGNvbmZpZ3VyYXRpb25JbXBvcnQuZGVmYXVsdFxuICB9IGNhdGNoIChlcnJvcikge1xuICAgIGNvbnNvbGUubG9nKGBDb3VsZG4ndCBsb2FkIGNvbmZpZ3VyYXRpb24gZnJvbSAke2NvbmZpZ3VyYXRpb25QYXRofSBiZWNhdXNlIG9mOiAke2Vycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogZXJyb3J9YClcblxuICAgIGlmIChlcnJvciBpbnN0YW5jZW9mIEVycm9yKSB7XG4gICAgICAvLyBUaGlzIG1pZ2h0IGhhcHBlbiBkdXJpbmcgYW4gXCJpbml0XCIgQ0xJIGNvbW1hbmQgd2hlcmUgd2UgY29weSBhIHNhbXBsZSBjb25maWd1cmF0aW9uIGZpbGUuXG4gICAgICBpZiAoIWVycm9yLm1lc3NhZ2UubWF0Y2goL15DYW5ub3QgZmluZCBtb2R1bGUgJyguKylcXC9jb25maWd1cmF0aW9uXFwuanMnLykpIHtcbiAgICAgICAgdGhyb3cgZXJyb3JcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAoIWFyZ3MpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIkNhbid0IHNwYXduIGEgbmV3IGNvbmZpZ3VyYXRpb24gYmVjYXVzZSBubyBjb25maWd1cmF0aW9uLWFyZ3VtZW50cyB3YXMgZ2l2ZW5cIiwge2NhdXNlOiBlcnJvcn0pXG4gICAgfVxuXG4gICAgY29uZmlndXJhdGlvbiA9IG5ldyBDb25maWd1cmF0aW9uKGFyZ3MpXG4gIH1cblxuICByZXR1cm4gY29uZmlndXJhdGlvblxufVxuIl19