import Base from "./base.js";
import * as inflection from "inflection";
import restArgsError from "../utils/rest-args-error.js";
import Logger from "../logger.js";
import LocalBackgroundJobsAdapter from "../background-jobs/local-adapter.js";
/**
 * Defines this typedef.
 * @typedef {(id: string) => {default: typeof import("../database/migration/index.js").default}} MigrationsRequireContextIDFunctionType
 * @typedef {MigrationsRequireContextIDFunctionType & {
 *   keys: () => string[],
 *   id: string
 * }} MigrationsRequireContextType
 */
/**
 * Defines this typedef.
 * @typedef {(id: string) => {default: typeof import("../cli/base-command.js").default}} CommandsRequireContextIDFunctionType
 * @typedef {CommandsRequireContextIDFunctionType & {
 *   keys: () => string[],
 *   id: string
 * }} CommandsRequireContextType
 */
/**
 * TestFilesRequireContextIDFunctionType type.
 * @typedef {(id: string) => ReturnType<typeof JSON.parse>} TestFilesRequireContextIDFunctionType
 * @typedef {TestFilesRequireContextIDFunctionType & {
 *   keys: () => string[],
 *   id: string
 * }} TestFilesRequireContextType
 */
/**
 * Runs is migration object.
 * @param {import("./base.js").MigrationObjectType | null} migration - Candidate migration object.
 * @returns {migration is import("./base.js").MigrationObjectType} - Whether migration exists.
 */
function isMigrationObject(migration) {
    return Boolean(migration);
}
export default class VelociousEnvironmentsHandlerBrowser extends Base {
    /**
     * Creates the Browser/Expo local SQLite adapter and in-process dispatcher.
     * @param {{configuration: import("../configuration.js").default}} args - Adapter options.
     * @returns {LocalBackgroundJobsAdapter} - Local background-jobs adapter.
     */
    createBackgroundJobsAdapter({ configuration }) {
        return new LocalBackgroundJobsAdapter({ configuration });
    }
    /**
     * Find commands require context result.
     * @type {CommandsRequireContextType | undefined} */
    findCommandsRequireContextResult = undefined;
    /**
     * Migrations require context result.
     * @type {MigrationsRequireContextType | undefined} */
    _migrationsRequireContextResult = undefined;
    /**
     * Test files require context result.
     * @type {TestFilesRequireContextType | undefined} */
    _testFilesRequireContextResult = undefined;
    /**
     * Runs constructor.
     * @param {object} args - Options object.
     * @param {() => Promise<MigrationsRequireContextType>} [args.migrationsRequireContextCallback] - Migrations require context callback.
     * @param {() => Promise<TestFilesRequireContextType>} [args.testFilesRequireContextCallback] - Test files require context callback.
     */
    constructor({ migrationsRequireContextCallback, testFilesRequireContextCallback, ...restArgs } = {}) {
        super();
        restArgsError(restArgs);
        this.migrationsRequireContextCallback = migrationsRequireContextCallback;
        this.testFilesRequireContextCallback = testFilesRequireContextCallback;
        this.logger = new Logger(this);
    }
    /**
     * Runs migrations require context.
     * @returns {Promise<MigrationsRequireContextType>} - Resolves with the migrations require context.
     */
    async migrationsRequireContext() {
        const { migrationsRequireContextCallback } = this;
        if (!migrationsRequireContextCallback)
            throw new Error("migrationsRequireContextCallback is required");
        this._migrationsRequireContextResult ||= await migrationsRequireContextCallback();
        return this._migrationsRequireContextResult;
    }
    /**
     * Runs test files require context.
     * @returns {Promise<TestFilesRequireContextType>} - Resolves with the test files require context.
     */
    async testFilesRequireContext() {
        const { testFilesRequireContextCallback } = this;
        if (!testFilesRequireContextCallback) {
            throw new Error("testFilesRequireContextCallback is required when running browser tests");
        }
        this._testFilesRequireContextResult ||= await testFilesRequireContextCallback();
        return this._testFilesRequireContextResult;
    }
    /**
     * Runs find commands.
     * @returns {Promise<Array<import("./base.js").CommandFileObjectType>>} - Resolves with the commands.
     */
    async findCommands() {
        this._findCommandsResult = this._actualFindCommands();
        return this._findCommandsResult;
    }
    /**
     * Runs find commands require context.
     * @returns {CommandsRequireContextType} - The commands require context.
     */
    _findCommandsRequireContext() {
        // @ts-expect-error
        this.findCommandsRequireContextResult ||= /** @type {CommandsRequireContextType} */ (require.context("../cli/commands", true, /\.js$/));
        return this.findCommandsRequireContextResult;
    }
    _actualFindCommands() {
        const commandFiles = this._findCommandsRequireContext();
        const commands = [];
        for (const aFilePath of commandFiles.keys()) {
            const aFilePathParts = aFilePath.split("/");
            const lastPart = aFilePathParts[aFilePathParts.length - 1];
            let name;
            if (lastPart == "index.js") {
                name = aFilePathParts[aFilePathParts.length - 2];
            }
            else {
                name = lastPart.replace(".js", "");
            }
            commands.push({ name, file: aFilePath });
        }
        return commands;
    }
    /**
     * Runs require command.
     * @param {object} args - Options object.
     * @param {Array<string>} args.commandParts - Command parts.
     * @returns {Promise<typeof import("../cli/base-command.js").default>} - Resolves with the require command.
     */
    async requireCommand({ commandParts }) {
        let filePath = ".";
        for (let commandPart of commandParts) {
            if (commandPart == "c")
                commandPart = "console";
            if (commandPart == "d")
                commandPart = "destroy";
            if (commandPart == "g")
                commandPart = "generate";
            if (commandPart == "s")
                commandPart = "server";
            filePath += `/${commandPart}`;
        }
        const filePaths = [];
        filePaths.push(`${filePath}/index.js`);
        filePath += ".js";
        filePaths.push(filePath);
        const commandsRequireContext = await this._findCommandsRequireContext();
        let commandClassImport;
        for (const aFilePath of filePaths) {
            commandClassImport = commandsRequireContext(aFilePath);
            if (commandClassImport) {
                break;
            }
        }
        if (!commandClassImport) {
            throw new Error(`Unknown command: ${commandParts.join(":")}. Possible commands: ${commandsRequireContext.keys()}`);
        }
        const CommandClass = commandClassImport.default;
        return CommandClass;
    }
    /**
     * Runs find migrations.
     * @returns {Promise<Array<import("./base.js").MigrationObjectType>>} - Resolves with the migrations.
     */
    async findMigrations() {
        const migrationsRequireContext = await this.migrationsRequireContext();
        /**
         * Migrations.
         * @type {Array<import("./base.js").MigrationObjectType | null>} */
        const migrations = migrationsRequireContext
            .keys()
            .map((file) => {
            // "13,14" because somes "require-context"-npm-module deletes first character!?
            const match = file.match(/(\d{13,14})-(.+)\.js$/);
            if (!match)
                return null;
            // Fix require-context-npm-module deletes first character
            let fileName = file;
            let dateNumber = match[1];
            if (dateNumber.length == 13) {
                dateNumber = `2${dateNumber}`;
                fileName = `2${fileName}`;
            }
            // Parse regex
            const date = parseInt(dateNumber);
            const migrationName = match[2];
            const migrationClassName = inflection.camelize(migrationName.replaceAll("-", "_"));
            return {
                file: fileName,
                fullPath: file,
                date,
                migrationClassName
            };
        })
            .filter(isMigrationObject);
        /**
         * Files.
         * @type {import("./base.js").MigrationObjectType[]} */
        const files = /** @type {import("./base.js").MigrationObjectType[]} */ (migrations);
        files.sort((migration1, migration2) => migration1.date - migration2.date);
        return files;
    }
    /**
     * Runs import test files.
     * @param {string[]} testFiles - Test files.
     * @returns {Promise<void>} - Resolves when complete.
     */
    async importTestFiles(testFiles) {
        const testFilesRequireContext = await this.testFilesRequireContext();
        const requireKeys = testFilesRequireContext.keys();
        const normalizedKeys = requireKeys.map((key) => ({
            key,
            normalized: key.replace(/\\/g, "/").replace(/^\.\//, "")
        }));
        for (const testFile of testFiles) {
            const normalizedFile = testFile.replace(/\\/g, "/");
            const matchedKey = normalizedKeys.find((entry) => normalizedFile.endsWith(entry.normalized))?.key;
            if (!matchedKey) {
                throw new Error(`Test file ${testFile} was not found in the provided require context`);
            }
            const imported = testFilesRequireContext(matchedKey);
            if (imported && typeof imported == "object" && "then" in imported && typeof imported.then == "function") {
                await imported;
            }
        }
    }
    /**
     * Require migration.
     * @param {string} filePath - File path.
     * @returns {Promise<typeof import("../database/migration/index.js").default>} - Resolves with the require migration.
     */
    requireMigration = async (filePath) => {
        if (!filePath)
            throw new Error("filePath is required");
        const migrationsRequireContext = await this.migrationsRequireContext();
        const migrationImport = migrationsRequireContext(filePath);
        if (!migrationImport)
            throw new Error(`Migration file ${filePath} not found`);
        const migrationImportDefault = migrationImport.default;
        if (!migrationImportDefault)
            throw new Error("Migration file must export a default migration class");
        if (typeof migrationImportDefault !== "function")
            throw new Error("Migration default export isn't a function (should be a class which is a function in JS)");
        return migrationImportDefault;
    };
    /**
     * Runs after migrations.
     * @param {object} args - Options object.
     * @param {Record<string, import("../database/drivers/base.js").default>} args.dbs - Dbs.
     * @returns {Promise<void>} - Resolves when complete.
     */
    async afterMigrations({ dbs }) {
        const structureSql = await this._sqliteStructureSql({ dbs });
        if (!structureSql)
            return;
        await this.logger.debug(() => ["structure.sql:", structureSql]);
    }
    /**
     * Runs sqlite structure sql.
     * @param {object} args - Options object.
     * @param {Record<string, import("../database/drivers/base.js").default>} args.dbs - Dbs.
     * @returns {Promise<string | null>} - Resolves with SQL string.
     */
    async _sqliteStructureSql({ dbs }) {
        const sqliteIdentifiers = Object.keys(dbs)
            .filter((identifier) => this.getConfiguration().getDatabaseType(identifier) == "sqlite");
        if (sqliteIdentifiers.length == 0)
            return null;
        const sections = [];
        for (const identifier of sqliteIdentifiers) {
            const db = dbs[identifier];
            const structureSql = typeof db.structureSql === "function" ? await db.structureSql() : null;
            const trimmedSql = structureSql?.trimEnd();
            if (!trimmedSql)
                continue;
            if (sqliteIdentifiers.length > 1) {
                sections.push(`-- ${identifier}`);
            }
            sections.push(trimmedSql);
        }
        if (sections.length == 0)
            return null;
        return `${sections.join("\n\n")}\n`;
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYnJvd3Nlci5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9lbnZpcm9ubWVudC1oYW5kbGVycy9icm93c2VyLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLE9BQU8sSUFBSSxNQUFNLFdBQVcsQ0FBQTtBQUM1QixPQUFPLEtBQUssVUFBVSxNQUFNLFlBQVksQ0FBQTtBQUN4QyxPQUFPLGFBQWEsTUFBTSw2QkFBNkIsQ0FBQTtBQUN2RCxPQUFPLE1BQU0sTUFBTSxjQUFjLENBQUE7QUFDakMsT0FBTywwQkFBMEIsTUFBTSxxQ0FBcUMsQ0FBQTtBQUU1RTs7Ozs7OztHQU9HO0FBRUg7Ozs7Ozs7R0FPRztBQUVIOzs7Ozs7O0dBT0c7QUFFSDs7OztHQUlHO0FBQ0gsU0FBUyxpQkFBaUIsQ0FBQyxTQUFTO0lBQ2xDLE9BQU8sT0FBTyxDQUFDLFNBQVMsQ0FBQyxDQUFBO0FBQzNCLENBQUM7QUFFRCxNQUFNLENBQUMsT0FBTyxPQUFPLG1DQUFvQyxTQUFRLElBQUk7SUFDbkU7Ozs7T0FJRztJQUNILDJCQUEyQixDQUFDLEVBQUMsYUFBYSxFQUFDO1FBQ3pDLE9BQU8sSUFBSSwwQkFBMEIsQ0FBQyxFQUFDLGFBQWEsRUFBQyxDQUFDLENBQUE7SUFDeEQsQ0FBQztJQUVEOzt3REFFb0Q7SUFDcEQsZ0NBQWdDLEdBQUcsU0FBUyxDQUFBO0lBRTVDOzswREFFc0Q7SUFDdEQsK0JBQStCLEdBQUcsU0FBUyxDQUFBO0lBRTNDOzt5REFFcUQ7SUFDckQsOEJBQThCLEdBQUcsU0FBUyxDQUFBO0lBRTFDOzs7OztPQUtHO0lBQ0gsWUFBWSxFQUFDLGdDQUFnQyxFQUFFLCtCQUErQixFQUFFLEdBQUcsUUFBUSxFQUFDLEdBQUcsRUFBRTtRQUMvRixLQUFLLEVBQUUsQ0FBQTtRQUNQLGFBQWEsQ0FBQyxRQUFRLENBQUMsQ0FBQTtRQUV2QixJQUFJLENBQUMsZ0NBQWdDLEdBQUcsZ0NBQWdDLENBQUE7UUFDeEUsSUFBSSxDQUFDLCtCQUEr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Q0FBQyxNQUFNLElBQUksQ0FBQztZQUFFLE9BQU8sSUFBSSxDQUFBO1FBRTlDLE1BQU0sUUFBUSxHQUFHLEVBQUUsQ0FBQTtRQUVuQixLQUFLLE1BQU0sVUFBVSxJQUFJLGlCQUFpQixFQUFFLENBQUM7WUFDM0MsTUFBTSxFQUFFLEdBQUcsR0FBRyxDQUFDLFVBQVUsQ0FBQyxDQUFBO1lBQzFCLE1BQU0sWUFBWSxHQUFHLE9BQU8sRUFBRSxDQUFDLFlBQVksS0FBSyxVQUFVLENBQUMsQ0FBQyxDQUFDLE1BQU0sRUFBRSxDQUFDLFlBQVksRUFBRSxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUE7WUFDM0YsTUFBTSxVQUFVLEdBQUcsWUFBWSxFQUFFLE9BQU8sRUFBRSxDQUFBO1lBRTFDLElBQUksQ0FBQyxVQUFVO2dCQUFFLFNBQVE7WUFFekIsSUFBSSxpQkFBaUIsQ0FBQyxNQUFNLEdBQUcsQ0FBQyxFQUFFLENBQUM7Z0JBQ2pDLFFBQVEsQ0FBQyxJQUFJLENBQUMsTUFBTSxVQUFVLEVBQUUsQ0FBQyxDQUFBO1lBQ25DLENBQUM7WUFFRCxRQUFRLENBQUMsSUFBSSxDQUFDLFVBQVUsQ0FBQyxDQUFBO1FBQzNCLENBQUM7UUFFRCxJQUFJLFFBQVEsQ0FBQyxNQUFNLElBQUksQ0FBQztZQUFFLE9BQU8sSUFBSSxDQUFBO1FBRXJDLE9BQU8sR0FBRyxRQUFRLENBQUMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUE7SUFDckMsQ0FBQztDQUNGIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IEJhc2UgZnJvbSBcIi4vYmFzZS5qc1wiXG5pbXBvcnQgKiBhcyBpbmZsZWN0aW9uIGZyb20gXCJpbmZsZWN0aW9uXCJcbmltcG9ydCByZXN0QXJnc0Vycm9yIGZyb20gXCIuLi91dGlscy9yZXN0LWFyZ3MtZXJyb3IuanNcIlxuaW1wb3J0IExvZ2dlciBmcm9tIFwiLi4vbG9nZ2VyLmpzXCJcbmltcG9ydCBMb2NhbEJhY2tncm91bmRKb2JzQWRhcHRlciBmcm9tIFwiLi4vYmFja2dyb3VuZC1qb2JzL2xvY2FsLWFkYXB0ZXIuanNcIlxuXG4vKipcbiAqIERlZmluZXMgdGhpcyB0eXBlZGVmLlxuICogQHR5cGVkZWYgeyhpZDogc3RyaW5nKSA9PiB7ZGVmYXVsdDogdHlwZW9mIGltcG9ydChcIi4uL2RhdGFiYXNlL21pZ3JhdGlvbi9pbmRleC5qc1wiKS5kZWZhdWx0fX0gTWlncmF0aW9uc1JlcXVpcmVDb250ZXh0SURGdW5jdGlvblR5cGVcbiAqIEB0eXBlZGVmIHtNaWdyYXRpb25zUmVxdWlyZUNvbnRleHRJREZ1bmN0aW9uVHlwZSAmIHtcbiAqICAga2V5czogKCkgPT4gc3RyaW5nW10sXG4gKiAgIGlkOiBzdHJpbmdcbiAqIH19IE1pZ3JhdGlvbnNSZXF1aXJlQ29udGV4dFR5cGVcbiAqL1xuXG4vKipcbiAqIERlZmluZXMgdGhpcyB0eXBlZGVmLlxuICogQHR5cGVkZWYgeyhpZDogc3RyaW5nKSA9PiB7ZGVmYXVsdDogdHlwZW9mIGltcG9ydChcIi4uL2NsaS9iYXNlLWNvbW1hbmQuanNcIikuZGVmYXVsdH19IENvbW1hbmRzUmVxdWlyZUNvbnRleHRJREZ1bmN0aW9uVHlwZVxuICogQHR5cGVkZWYge0NvbW1hbmRzUmVxdWlyZUNvbnRleHRJREZ1bmN0aW9uVHlwZSAmIHtcbiAqICAga2V5czogKCkgPT4gc3RyaW5nW10sXG4gKiAgIGlkOiBzdHJpbmdcbiAqIH19IENvbW1hbmRzUmVxdWlyZUNvbnRleHRUeXBlXG4gKi9cblxuLyoqXG4gKiBUZXN0RmlsZXNSZXF1aXJlQ29udGV4dElERnVuY3Rpb25UeXBlIHR5cGUuXG4gKiBAdHlwZWRlZiB7KGlkOiBzdHJpbmcpID0+IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBUZXN0RmlsZXNSZXF1aXJlQ29udGV4dElERnVuY3Rpb25UeXBlXG4gKiBAdHlwZWRlZiB7VGVzdEZpbGVzUmVxdWlyZUNvbnRleHRJREZ1bmN0aW9uVHlwZSAmIHtcbiAqICAga2V5czogKCkgPT4gc3RyaW5nW10sXG4gKiAgIGlkOiBzdHJpbmdcbiAqIH19IFRlc3RGaWxlc1JlcXVpcmVDb250ZXh0VHlwZVxuICovXG5cbi8qKlxuICogUnVucyBpcyBtaWdyYXRpb24gb2JqZWN0LlxuICogQHBhcmFtIHtpbXBvcnQoXCIuL2Jhc2UuanNcIikuTWlncmF0aW9uT2JqZWN0VHlwZSB8IG51bGx9IG1pZ3JhdGlvbiAtIENhbmRpZGF0ZSBtaWdyYXRpb24gb2JqZWN0LlxuICogQHJldHVybnMge21pZ3JhdGlvbiBpcyBpbXBvcnQoXCIuL2Jhc2UuanNcIikuTWlncmF0aW9uT2JqZWN0VHlwZX0gLSBXaGV0aGVyIG1pZ3JhdGlvbiBleGlzdHMuXG4gKi9cbmZ1bmN0aW9uIGlzTWlncmF0aW9uT2JqZWN0KG1pZ3JhdGlvbikge1xuICByZXR1cm4gQm9vbGVhbihtaWdyYXRpb24pXG59XG5cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIFZlbG9jaW91c0Vudmlyb25tZW50c0hhbmRsZXJCcm93c2VyIGV4dGVuZHMgQmFzZSB7XG4gIC8qKlxuICAgKiBDcmVhdGVzIHRoZSBCcm93c2VyL0V4cG8gbG9jYWwgU1FMaXRlIGFkYXB0ZXIgYW5kIGluLXByb2Nlc3MgZGlzcGF0Y2hlci5cbiAgICogQHBhcmFtIHt7Y29uZmlndXJhdGlvbjogaW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi5qc1wiKS5kZWZhdWx0fX0gYXJncyAtIEFkYXB0ZXIgb3B0aW9ucy5cbiAgICogQHJldHVybnMge0xvY2FsQmFja2dyb3VuZEpvYnNBZGFwdGVyfSAtIExvY2FsIGJhY2tncm91bmQtam9icyBhZGFwdGVyLlxuICAgKi9cbiAgY3JlYXRlQmFja2dyb3VuZEpvYnNBZGFwdGVyKHtjb25maWd1cmF0aW9ufSkge1xuICAgIHJldHVybiBuZXcgTG9jYWxCYWNrZ3JvdW5kSm9ic0FkYXB0ZXIoe2NvbmZpZ3VyYXRpb259KVxuICB9XG5cbiAgLyoqXG4gICAqIEZpbmQgY29tbWFuZHMgcmVxdWlyZSBjb250ZXh0IHJlc3VsdC5cbiAgICogQHR5cGUge0NvbW1hbmRzUmVxdWlyZUNvbnRleHRUeXBlIHwgdW5kZWZpbmVkfSAqL1xuICBmaW5kQ29tbWFuZHNSZXF1aXJlQ29udGV4dFJlc3VsdCA9IHVuZGVmaW5lZFxuXG4gIC8qKlxuICAgKiBNaWdyYXRpb25zIHJlcXVpcmUgY29udGV4dCByZXN1bHQuXG4gICAqIEB0eXBlIHtNaWdyYXRpb25zUmVxdWlyZUNvbnRleHRUeXBlIHwgdW5kZWZpbmVkfSAqL1xuICBfbWlncmF0aW9uc1JlcXVpcmVDb250ZXh0UmVzdWx0ID0gdW5kZWZpbmVkXG5cbiAgLyoqXG4gICAqIFRlc3QgZmlsZXMgcmVxdWlyZSBjb250ZXh0IHJlc3VsdC5cbiAgICogQHR5cGUge1Rlc3RGaWxlc1JlcXVpcmVDb250ZXh0VHlwZSB8IHVuZGVmaW5lZH0gKi9cbiAgX3Rlc3RGaWxlc1JlcXVpcmVDb250ZXh0UmVzdWx0ID0gdW5kZWZpbmVkXG5cbiAgLyoqXG4gICAqIFJ1bnMgY29uc3RydWN0b3IuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEBwYXJhbSB7KCkgPT4gUHJvbWlzZTxNaWdyYXRpb25zUmVxdWlyZUNvbnRleHRUeXBlPn0gW2FyZ3MubWlncmF0aW9uc1JlcXVpcmVDb250ZXh0Q2FsbGJhY2tdIC0gTWlncmF0aW9ucyByZXF1aXJlIGNvbnRleHQgY2FsbGJhY2suXG4gICAqIEBwYXJhbSB7KCkgPT4gUHJvbWlzZTxUZXN0RmlsZXNSZXF1aXJlQ29udGV4dFR5cGU+fSBbYXJncy50ZXN0RmlsZXNSZXF1aXJlQ29udGV4dENhbGxiYWNrXSAtIFRlc3QgZmlsZXMgcmVxdWlyZSBjb250ZXh0IGNhbGxiYWNrLlxuICAgKi9cbiAgY29uc3RydWN0b3Ioe21pZ3JhdGlvbnNSZXF1aXJlQ29udGV4dENhbGxiYWNrLCB0ZXN0RmlsZXNSZXF1aXJlQ29udGV4dENhbGxiYWNrLCAuLi5yZXN0QXJnc30gPSB7fSkge1xuICAgIHN1cGVyKClcbiAgICByZXN0QXJnc0Vycm9yKHJlc3RBcmdzKVxuXG4gICAgdGhpcy5taWdyYXRpb25zUmVxdWlyZUNvbnRleHRDYWxsYmFjayA9IG1pZ3JhdGlvbnNSZXF1aXJlQ29udGV4dENhbGxiYWNrXG4gICAgdGhpcy50ZXN0RmlsZXNSZXF1aXJlQ29udGV4dENhbGxiYWNrID0gdGVzdEZpbGVzUmVxdWlyZUNvbnRleHRDYWxsYmFja1xuICAgIHRoaXMubG9nZ2VyID0gbmV3IExvZ2dlcih0aGlzKVxuICB9XG5cblxuICAvKipcbiAgICogUnVucyBtaWdyYXRpb25zIHJlcXVpcmUgY29udGV4dC5cbiAgICogQHJldHVybnMge1Byb21pc2U8TWlncmF0aW9uc1JlcXVpcmVDb250ZXh0VHlwZT59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgbWlncmF0aW9ucyByZXF1aXJlIGNvbnRleHQuXG4gICAqL1xuICBhc3luYyBtaWdyYXRpb25zUmVxdWlyZUNvbnRleHQoKSB7XG4gICAgY29uc3Qge21pZ3JhdGlvbnNSZXF1aXJlQ29udGV4dENhbGxiYWNrfSA9IHRoaXNcblxuICAgIGlmICghbWlncmF0aW9uc1JlcXVpcmVDb250ZXh0Q2FsbGJhY2spIHRocm93IG5ldyBFcnJvcihcIm1pZ3JhdGlvbnNSZXF1aXJlQ29udGV4dENhbGxiYWNrIGlzIHJlcXVpcmVkXCIpXG5cbiAgICB0aGlzLl9taWdyYXRpb25zUmVxdWlyZUNvbnRleHRSZXN1bHQgfHw9IGF3YWl0IG1pZ3JhdGlvbnNSZXF1aXJlQ29udGV4dENhbGxiYWNrKClcblxuICAgIHJldHVybiB0aGlzLl9taWdyYXRpb25zUmVxdWlyZUNvbnRleHRSZXN1bHRcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHRlc3QgZmlsZXMgcmVxdWlyZSBjb250ZXh0LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxUZXN0RmlsZXNSZXF1aXJlQ29udGV4dFR5cGU+fSAtIFJlc29sdmVzIHdpdGggdGhlIHRlc3QgZmlsZXMgcmVxdWlyZSBjb250ZXh0LlxuICAgKi9cbiAgYXN5bmMgdGVzdEZpbGVzUmVxdWlyZUNvbnRleHQoKSB7XG4gICAgY29uc3Qge3Rlc3RGaWxlc1JlcXVpcmVDb250ZXh0Q2FsbGJhY2t9ID0gdGhpc1xuXG4gICAgaWYgKCF0ZXN0RmlsZXNSZXF1aXJlQ29udGV4dENhbGxiYWNrKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJ0ZXN0RmlsZXNSZXF1aXJlQ29udGV4dENhbGxiYWNrIGlzIHJlcXVpcmVkIHdoZW4gcnVubmluZyBicm93c2VyIHRlc3RzXCIpXG4gICAgfVxuXG4gICAgdGhpcy5fdGVzdEZpbGVzUmVxdWlyZUNvbnRleHRSZXN1bHQgfHw9IGF3YWl0IHRlc3RGaWxlc1JlcXVpcmVDb250ZXh0Q2FsbGJhY2soKVxuXG4gICAgcmV0dXJuIHRoaXMuX3Rlc3RGaWxlc1JlcXVpcmVDb250ZXh0UmVzdWx0XG4gIH1cblxuICAvKipcbiAgICogUnVucyBmaW5kIGNvbW1hbmRzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxBcnJheTxpbXBvcnQoXCIuL2Jhc2UuanNcIikuQ29tbWFuZEZpbGVPYmplY3RUeXBlPj59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgY29tbWFuZHMuXG4gICAqL1xuICBhc3luYyBmaW5kQ29tbWFuZHMoKSB7XG4gICAgdGhpcy5fZmluZENvbW1hbmRzUmVzdWx0ID0gdGhpcy5fYWN0dWFsRmluZENvbW1hbmRzKClcblxuICAgIHJldHVybiB0aGlzLl9maW5kQ29tbWFuZHNSZXN1bHRcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZpbmQgY29tbWFuZHMgcmVxdWlyZSBjb250ZXh0LlxuICAgKiBAcmV0dXJucyB7Q29tbWFuZHNSZXF1aXJlQ29udGV4dFR5cGV9IC0gVGhlIGNvbW1hbmRzIHJlcXVpcmUgY29udGV4dC5cbiAgICovXG4gIF9maW5kQ29tbWFuZHNSZXF1aXJlQ29udGV4dCgpIHtcbiAgICAvLyBAdHMtZXhwZWN0LWVycm9yXG4gICAgdGhpcy5maW5kQ29tbWFuZHNSZXF1aXJlQ29udGV4dFJlc3VsdCB8fD0gLyoqIEB0eXBlIHtDb21tYW5kc1JlcXVpcmVDb250ZXh0VHlwZX0gKi8gKHJlcXVpcmUuY29udGV4dChcIi4uL2NsaS9jb21tYW5kc1wiLCB0cnVlLCAvXFwuanMkLykpXG5cbiAgICByZXR1cm4gdGhpcy5maW5kQ29tbWFuZHNSZXF1aXJlQ29udGV4dFJlc3VsdFxuICB9XG5cbiAgX2FjdHVhbEZpbmRDb21tYW5kcygpIHtcbiAgICBjb25zdCBjb21tYW5kRmlsZXMgPSB0aGlzLl9maW5kQ29tbWFuZHNSZXF1aXJlQ29udGV4dCgpXG4gICAgY29uc3QgY29tbWFuZHMgPSBbXVxuXG4gICAgZm9yIChjb25zdCBhRmlsZVBhdGggb2YgY29tbWFuZEZpbGVzLmtleXMoKSkge1xuICAgICAgY29uc3QgYUZpbGVQYXRoUGFydHMgPSBhRmlsZVBhdGguc3BsaXQoXCIvXCIpXG4gICAgICBjb25zdCBsYXN0UGFydCA9IGFGaWxlUGF0aFBhcnRzW2FGaWxlUGF0aFBhcnRzLmxlbmd0aCAtIDFdXG4gICAgICBsZXQgbmFtZVxuXG4gICAgICBpZiAobGFzdFBhcnQgPT0gXCJpbmRleC5qc1wiKSB7XG4gICAgICAgIG5hbWUgPSBhRmlsZVBhdGhQYXJ0c1thRmlsZVBhdGhQYXJ0cy5sZW5ndGggLSAyXVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgbmFtZSA9IGxhc3RQYXJ0LnJlcGxhY2UoXCIuanNcIiwgXCJcIilcbiAgICAgIH1cblxuICAgICAgY29tbWFuZHMucHVzaCh7bmFtZSwgZmlsZTogYUZpbGVQYXRofSlcbiAgICB9XG5cbiAgICByZXR1cm4gY29tbWFuZHNcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJlcXVpcmUgY29tbWFuZC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHBhcmFtIHtBcnJheTxzdHJpbmc+fSBhcmdzLmNvbW1hbmRQYXJ0cyAtIENvbW1hbmQgcGFydHMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHR5cGVvZiBpbXBvcnQoXCIuLi9jbGkvYmFzZS1jb21tYW5kLmpzXCIpLmRlZmF1bHQ+fSAtIFJlc29sdmVzIHdpdGggdGhlIHJlcXVpcmUgY29tbWFuZC5cbiAgICovXG4gIGFzeW5jIHJlcXVpcmVDb21tYW5kKHtjb21tYW5kUGFydHN9KSB7XG4gICAgbGV0IGZpbGVQYXRoID0gXCIuXCJcblxuICAgIGZvciAobGV0IGNvbW1hbmRQYXJ0IG9mIGNvbW1hbmRQYXJ0cykge1xuICAgICAgaWYgKGNvbW1hbmRQYXJ0ID09IFwiY1wiKSBjb21tYW5kUGFydCA9IFwiY29uc29sZVwiXG4gICAgICBpZiAoY29tbWFuZFBhcnQgPT0gXCJkXCIpIGNvbW1hbmRQYXJ0ID0gXCJkZXN0cm95XCJcbiAgICAgIGlmIChjb21tYW5kUGFydCA9PSBcImdcIikgY29tbWFuZFBhcnQgPSBcImdlbmVyYXRlXCJcbiAgICAgIGlmIChjb21tYW5kUGFydCA9PSBcInNcIikgY29tbWFuZFBhcnQgPSBcInNlcnZlclwiXG5cbiAgICAgIGZpbGVQYXRoICs9IGAvJHtjb21tYW5kUGFydH1gXG4gICAgfVxuXG4gICAgY29uc3QgZmlsZVBhdGhzID0gW11cblxuICAgIGZpbGVQYXRocy5wdXNoKGAke2ZpbGVQYXRofS9pbmRleC5qc2ApXG4gICAgZmlsZVBhdGggKz0gXCIuanNcIlxuICAgIGZpbGVQYXRocy5wdXNoKGZpbGVQYXRoKVxuXG4gICAgY29uc3QgY29tbWFuZHNSZXF1aXJlQ29udGV4dCA9IGF3YWl0IHRoaXMuX2ZpbmRDb21tYW5kc1JlcXVpcmVDb250ZXh0KClcbiAgICBsZXQgY29tbWFuZENsYXNzSW1wb3J0XG5cbiAgICBmb3IgKGNvbnN0IGFGaWxlUGF0aCBvZiBmaWxlUGF0aHMpIHtcbiAgICAgIGNvbW1hbmRDbGFzc0ltcG9ydCA9IGNvbW1hbmRzUmVxdWlyZUNvbnRleHQoYUZpbGVQYXRoKVxuXG4gICAgICBpZiAoY29tbWFuZENsYXNzSW1wb3J0KSB7XG4gICAgICAgIGJyZWFrXG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKCFjb21tYW5kQ2xhc3NJbXBvcnQpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgVW5rbm93biBjb21tYW5kOiAke2NvbW1hbmRQYXJ0cy5qb2luKFwiOlwiKX0uIFBvc3NpYmxlIGNvbW1hbmRzOiAke2NvbW1hbmRzUmVxdWlyZUNvbnRleHQua2V5cygpfWApXG4gICAgfVxuXG4gICAgY29uc3QgQ29tbWFuZENsYXNzID0gY29tbWFuZENsYXNzSW1wb3J0LmRlZmF1bHRcblxuICAgIHJldHVybiBDb21tYW5kQ2xhc3NcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZpbmQgbWlncmF0aW9ucy5cbiAgICogQHJldHVybnMge1Byb21pc2U8QXJyYXk8aW1wb3J0KFwiLi9iYXNlLmpzXCIpLk1pZ3JhdGlvbk9iamVjdFR5cGU+Pn0gLSBSZXNvbHZlcyB3aXRoIHRoZSBtaWdyYXRpb25zLlxuICAgKi9cbiAgYXN5bmMgZmluZE1pZ3JhdGlvbnMoKSB7XG4gICAgY29uc3QgbWlncmF0aW9uc1JlcXVpcmVDb250ZXh0ID0gYXdhaXQgdGhpcy5taWdyYXRpb25zUmVxdWlyZUNvbnRleHQoKVxuICAgIC8qKlxuICAgICAqIE1pZ3JhdGlvbnMuXG4gICAgICogQHR5cGUge0FycmF5PGltcG9ydChcIi4vYmFzZS5qc1wiKS5NaWdyYXRpb25PYmplY3RUeXBlIHwgbnVsbD59ICovXG4gICAgY29uc3QgbWlncmF0aW9ucyA9IG1pZ3JhdGlvbnNSZXF1aXJlQ29udGV4dFxuICAgICAgLmtleXMoKVxuICAgICAgLm1hcCgoZmlsZSkgPT4ge1xuICAgICAgICAvLyBcIjEzLDE0XCIgYmVjYXVzZSBzb21lcyBcInJlcXVpcmUtY29udGV4dFwiLW5wbS1tb2R1bGUgZGVsZXRlcyBmaXJzdCBjaGFyYWN0ZXIhP1xuICAgICAgICBjb25zdCBtYXRjaCA9IGZpbGUubWF0Y2goLyhcXGR7MTMsMTR9KS0oLispXFwuanMkLylcblxuICAgICAgICBpZiAoIW1hdGNoKSByZXR1cm4gbnVsbFxuXG4gICAgICAgIC8vIEZpeCByZXF1aXJlLWNvbnRleHQtbnBtLW1vZHVsZSBkZWxldGVzIGZpcnN0IGNoYXJhY3RlclxuICAgICAgICBsZXQgZmlsZU5hbWUgPSBmaWxlXG4gICAgICAgIGxldCBkYXRlTnVtYmVyID0gbWF0Y2hbMV1cblxuICAgICAgICBpZiAoZGF0ZU51bWJlci5sZW5ndGggPT0gMTMpIHtcbiAgICAgICAgICBkYXRlTnVtYmVyID0gYDIke2RhdGVOdW1iZXJ9YFxuICAgICAgICAgIGZpbGVOYW1lID0gYDIke2ZpbGVOYW1lfWBcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIFBhcnNlIHJlZ2V4XG4gICAgICAgIGNvbnN0IGRhdGUgPSBwYXJzZUludChkYXRlTnVtYmVyKVxuICAgICAgICBjb25zdCBtaWdyYXRpb25OYW1lID0gbWF0Y2hbMl1cbiAgICAgICAgY29uc3QgbWlncmF0aW9uQ2xhc3NOYW1lID0gaW5mbGVjdGlvbi5jYW1lbGl6ZShtaWdyYXRpb25OYW1lLnJlcGxhY2VBbGwoXCItXCIsIFwiX1wiKSlcblxuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgIGZpbGU6IGZpbGVOYW1lLFxuICAgICAgICAgIGZ1bGxQYXRoOiBmaWxlLFxuICAgICAgICAgIGRhdGUsXG4gICAgICAgICAgbWlncmF0aW9uQ2xhc3NOYW1lXG4gICAgICAgIH1cbiAgICAgIH0pXG4gICAgICAuZmlsdGVyKGlzTWlncmF0aW9uT2JqZWN0KVxuICAgIC8qKlxuICAgICAqIEZpbGVzLlxuICAgICAqIEB0eXBlIHtpbXBvcnQoXCIuL2Jhc2UuanNcIikuTWlncmF0aW9uT2JqZWN0VHlwZVtdfSAqL1xuICAgIGNvbnN0IGZpbGVzID0gLyoqIEB0eXBlIHtpbXBvcnQoXCIuL2Jhc2UuanNcIikuTWlncmF0aW9uT2JqZWN0VHlwZVtdfSAqLyAobWlncmF0aW9ucylcblxuICAgIGZpbGVzLnNvcnQoKG1pZ3JhdGlvbjEsIG1pZ3JhdGlvbjIpID0+IG1pZ3JhdGlvbjEuZGF0ZSAtIG1pZ3JhdGlvbjIuZGF0ZSlcblxuICAgIHJldHVybiBmaWxlc1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaW1wb3J0IHRlc3QgZmlsZXMuXG4gICAqIEBwYXJhbSB7c3RyaW5nW119IHRlc3RGaWxlcyAtIFRlc3QgZmlsZXMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyBpbXBvcnRUZXN0RmlsZXModGVzdEZpbGVzKSB7XG4gICAgY29uc3QgdGVzdEZpbGVzUmVxdWlyZUNvbnRleHQgPSBhd2FpdCB0aGlzLnRlc3RGaWxlc1JlcXVpcmVDb250ZXh0KClcbiAgICBjb25zdCByZXF1aXJlS2V5cyA9IHRlc3RGaWxlc1JlcXVpcmVDb250ZXh0LmtleXMoKVxuICAgIGNvbnN0IG5vcm1hbGl6ZWRLZXlzID0gcmVxdWlyZUtleXMubWFwKChrZXkpID0+ICh7XG4gICAgICBrZXksXG4gICAgICBub3JtYWxpemVkOiBrZXkucmVwbGFjZSgvXFxcXC9nLCBcIi9cIikucmVwbGFjZSgvXlxcLlxcLy8sIFwiXCIpXG4gICAgfSkpXG5cbiAgICBmb3IgKGNvbnN0IHRlc3RGaWxlIG9mIHRlc3RGaWxlcykge1xuICAgICAgY29uc3Qgbm9ybWFsaXplZEZpbGUgPSB0ZXN0RmlsZS5yZXBsYWNlKC9cXFxcL2csIFwiL1wiKVxuICAgICAgY29uc3QgbWF0Y2hlZEtleSA9IG5vcm1hbGl6ZWRLZXlzLmZpbmQoKGVudHJ5KSA9PiBub3JtYWxpemVkRmlsZS5lbmRzV2l0aChlbnRyeS5ub3JtYWxpemVkKSk/LmtleVxuXG4gICAgICBpZiAoIW1hdGNoZWRLZXkpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBUZXN0IGZpbGUgJHt0ZXN0RmlsZX0gd2FzIG5vdCBmb3VuZCBpbiB0aGUgcHJvdmlkZWQgcmVxdWlyZSBjb250ZXh0YClcbiAgICAgIH1cblxuICAgICAgY29uc3QgaW1wb3J0ZWQgPSB0ZXN0RmlsZXNSZXF1aXJlQ29udGV4dChtYXRjaGVkS2V5KVxuXG4gICAgICBpZiAoaW1wb3J0ZWQgJiYgdHlwZW9mIGltcG9ydGVkID09IFwib2JqZWN0XCIgJiYgXCJ0aGVuXCIgaW4gaW1wb3J0ZWQgJiYgdHlwZW9mIGltcG9ydGVkLnRoZW4gPT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICAgIGF3YWl0IGltcG9ydGVkXG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJlcXVpcmUgbWlncmF0aW9uLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gZmlsZVBhdGggLSBGaWxlIHBhdGguXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHR5cGVvZiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9taWdyYXRpb24vaW5kZXguanNcIikuZGVmYXVsdD59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgcmVxdWlyZSBtaWdyYXRpb24uXG4gICAqL1xuICByZXF1aXJlTWlncmF0aW9uID0gYXN5bmMgKGZpbGVQYXRoKSA9PiB7XG4gICAgaWYgKCFmaWxlUGF0aCkgdGhyb3cgbmV3IEVycm9yKFwiZmlsZVBhdGggaXMgcmVxdWlyZWRcIilcblxuICAgIGNvbnN0IG1pZ3JhdGlvbnNSZXF1aXJlQ29udGV4dCA9IGF3YWl0IHRoaXMubWlncmF0aW9uc1JlcXVpcmVDb250ZXh0KClcbiAgICBjb25zdCBtaWdyYXRpb25JbXBvcnQgPSBtaWdyYXRpb25zUmVxdWlyZUNvbnRleHQoZmlsZVBhdGgpXG5cbiAgICBpZiAoIW1pZ3JhdGlvbkltcG9ydCkgdGhyb3cgbmV3IEVycm9yKGBNaWdyYXRpb24gZmlsZSAke2ZpbGVQYXRofSBub3QgZm91bmRgKVxuXG4gICAgY29uc3QgbWlncmF0aW9uSW1wb3J0RGVmYXVsdCA9IG1pZ3JhdGlvbkltcG9ydC5kZWZhdWx0XG5cbiAgICBpZiAoIW1pZ3JhdGlvbkltcG9ydERlZmF1bHQpIHRocm93IG5ldyBFcnJvcihcIk1pZ3JhdGlvbiBmaWxlIG11c3QgZXhwb3J0IGEgZGVmYXVsdCBtaWdyYXRpb24gY2xhc3NcIilcbiAgICBpZiAodHlwZW9mIG1pZ3JhdGlvbkltcG9ydERlZmF1bHQgIT09IFwiZnVuY3Rpb25cIikgdGhyb3cgbmV3IEVycm9yKFwiTWlncmF0aW9uIGRlZmF1bHQgZXhwb3J0IGlzbid0IGEgZnVuY3Rpb24gKHNob3VsZCBiZSBhIGNsYXNzIHdoaWNoIGlzIGEgZnVuY3Rpb24gaW4gSlMpXCIpXG5cbiAgICByZXR1cm4gbWlncmF0aW9uSW1wb3J0RGVmYXVsdFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYWZ0ZXIgbWlncmF0aW9ucy5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdD59IGFyZ3MuZGJzIC0gRGJzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgYWZ0ZXJNaWdyYXRpb25zKHtkYnN9KSB7XG4gICAgY29uc3Qgc3RydWN0dXJlU3FsID0gYXdhaXQgdGhpcy5fc3FsaXRlU3RydWN0dXJlU3FsKHtkYnN9KVxuXG4gICAgaWYgKCFzdHJ1Y3R1cmVTcWwpIHJldHVyblxuXG4gICAgYXdhaXQgdGhpcy5sb2dnZXIuZGVidWcoKCkgPT4gW1wic3RydWN0dXJlLnNxbDpcIiwgc3RydWN0dXJlU3FsXSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNxbGl0ZSBzdHJ1Y3R1cmUgc3FsLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIGltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0Pn0gYXJncy5kYnMgLSBEYnMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHN0cmluZyB8IG51bGw+fSAtIFJlc29sdmVzIHdpdGggU1FMIHN0cmluZy5cbiAgICovXG4gIGFzeW5jIF9zcWxpdGVTdHJ1Y3R1cmVTcWwoe2Ric30pIHtcbiAgICBjb25zdCBzcWxpdGVJZGVudGlmaWVycyA9IE9iamVjdC5rZXlzKGRicylcbiAgICAgIC5maWx0ZXIoKGlkZW50aWZpZXIpID0+IHRoaXMuZ2V0Q29uZmlndXJhdGlvbigpLmdldERhdGFiYXNlVHlwZShpZGVudGlmaWVyKSA9PSBcInNxbGl0ZVwiKVxuXG4gICAgaWYgKHNxbGl0ZUlkZW50aWZpZXJzLmxlbmd0aCA9PSAwKSByZXR1cm4gbnVsbFxuXG4gICAgY29uc3Qgc2VjdGlvbnMgPSBbXVxuXG4gICAgZm9yIChjb25zdCBpZGVudGlmaWVyIG9mIHNxbGl0ZUlkZW50aWZpZXJzKSB7XG4gICAgICBjb25zdCBkYiA9IGRic1tpZGVudGlmaWVyXVxuICAgICAgY29uc3Qgc3RydWN0dXJlU3FsID0gdHlwZW9mIGRiLnN0cnVjdHVyZVNxbCA9PT0gXCJmdW5jdGlvblwiID8gYXdhaXQgZGIuc3RydWN0dXJlU3FsKCkgOiBudWxsXG4gICAgICBjb25zdCB0cmltbWVkU3FsID0gc3RydWN0dXJlU3FsPy50cmltRW5kKClcblxuICAgICAgaWYgKCF0cmltbWVkU3FsKSBjb250aW51ZVxuXG4gICAgICBpZiAoc3FsaXRlSWRlbnRpZmllcnMubGVuZ3RoID4gMSkge1xuICAgICAgICBzZWN0aW9ucy5wdXNoKGAtLSAke2lkZW50aWZpZXJ9YClcbiAgICAgIH1cblxuICAgICAgc2VjdGlvbnMucHVzaCh0cmltbWVkU3FsKVxuICAgIH1cblxuICAgIGlmIChzZWN0aW9ucy5sZW5ndGggPT0gMCkgcmV0dXJuIG51bGxcblxuICAgIHJldHVybiBgJHtzZWN0aW9ucy5qb2luKFwiXFxuXFxuXCIpfVxcbmBcbiAgfVxufVxuIl19