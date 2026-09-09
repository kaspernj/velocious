import Base from "./base.js";
import Logger from "../logger.js";
import LocalBackgroundJobsAdapter from "../background-jobs/local-adapter.js";
export type MigrationsRequireContextIDFunctionType = (id: string) => {
    default: typeof import("../database/migration/index.js").default;
};
export type MigrationsRequireContextType = MigrationsRequireContextIDFunctionType & {
    keys: () => string[];
    id: string;
};
export type CommandsRequireContextIDFunctionType = (id: string) => {
    default: typeof import("../cli/base-command.js").default;
};
export type CommandsRequireContextType = CommandsRequireContextIDFunctionType & {
    keys: () => string[];
    id: string;
};
export type TestFilesRequireContextIDFunctionType = (id: string) => ReturnType<typeof JSON.parse>;
export type TestFilesRequireContextType = TestFilesRequireContextIDFunctionType & {
    keys: () => string[];
    id: string;
};
export default class VelociousEnvironmentsHandlerBrowser extends Base {
    migrationsRequireContextCallback: (() => Promise<MigrationsRequireContextType>) | undefined;
    testFilesRequireContextCallback: (() => Promise<TestFilesRequireContextType>) | undefined;
    logger: Logger;
    _findCommandsResult: {
        name: string;
        file: string;
    }[] | undefined;
    /**
     * Creates the Browser/Expo local SQLite adapter and in-process dispatcher.
     * @param {{configuration: import("../configuration.js").default}} args - Adapter options.
     * @returns {LocalBackgroundJobsAdapter} - Local background-jobs adapter.
     */
    createBackgroundJobsAdapter({ configuration }: {
        configuration: import("../configuration.js").default;
    }): LocalBackgroundJobsAdapter;
    /**
     * Find commands require context result.
     * @type {CommandsRequireContextType | undefined} */
    findCommandsRequireContextResult: CommandsRequireContextType | undefined;
    /**
     * Migrations require context result.
     * @type {MigrationsRequireContextType | undefined} */
    _migrationsRequireContextResult: MigrationsRequireContextType | undefined;
    /**
     * Test files require context result.
     * @type {TestFilesRequireContextType | undefined} */
    _testFilesRequireContextResult: TestFilesRequireContextType | undefined;
    /**
     * Runs constructor.
     * @param {object} args - Options object.
     * @param {() => Promise<MigrationsRequireContextType>} [args.migrationsRequireContextCallback] - Migrations require context callback.
     * @param {() => Promise<TestFilesRequireContextType>} [args.testFilesRequireContextCallback] - Test files require context callback.
     */
    constructor({ migrationsRequireContextCallback, testFilesRequireContextCallback, ...restArgs }?: {
        migrationsRequireContextCallback?: () => Promise<MigrationsRequireContextType>;
        testFilesRequireContextCallback?: () => Promise<TestFilesRequireContextType>;
    });
    /**
     * Runs migrations require context.
     * @returns {Promise<MigrationsRequireContextType>} - Resolves with the migrations require context.
     */
    migrationsRequireContext(): Promise<MigrationsRequireContextType>;
    /**
     * Runs test files require context.
     * @returns {Promise<TestFilesRequireContextType>} - Resolves with the test files require context.
     */
    testFilesRequireContext(): Promise<TestFilesRequireContextType>;
    /**
     * Runs find commands.
     * @returns {Promise<Array<import("./base.js").CommandFileObjectType>>} - Resolves with the commands.
     */
    findCommands(): Promise<Array<import("./base.js").CommandFileObjectType>>;
    /**
     * Runs find commands require context.
     * @returns {CommandsRequireContextType} - The commands require context.
     */
    _findCommandsRequireContext(): CommandsRequireContextType;
    _actualFindCommands(): {
        name: string;
        file: string;
    }[];
    /**
     * Runs require command.
     * @param {object} args - Options object.
     * @param {Array<string>} args.commandParts - Command parts.
     * @returns {Promise<typeof import("../cli/base-command.js").default>} - Resolves with the require command.
     */
    requireCommand({ commandParts }: {
        commandParts: Array<string>;
    }): Promise<typeof import("../cli/base-command.js").default>;
    /**
     * Runs find migrations.
     * @returns {Promise<Array<import("./base.js").MigrationObjectType>>} - Resolves with the migrations.
     */
    findMigrations(): Promise<Array<import("./base.js").MigrationObjectType>>;
    /**
     * Runs import test files.
     * @param {string[]} testFiles - Test files.
     * @returns {Promise<void>} - Resolves when complete.
     */
    importTestFiles(testFiles: string[]): Promise<void>;
    /**
     * Require migration.
     * @param {string} filePath - File path.
     * @returns {Promise<typeof import("../database/migration/index.js").default>} - Resolves with the require migration.
     */
    requireMigration: (filePath: string) => Promise<typeof import("../database/migration/index.js").default>;
    /**
     * Runs after migrations.
     * @param {object} args - Options object.
     * @param {Record<string, import("../database/drivers/base.js").default>} args.dbs - Dbs.
     * @returns {Promise<void>} - Resolves when complete.
     */
    afterMigrations({ dbs }: {
        dbs: Record<string, import("../database/drivers/base.js").default>;
    }): Promise<void>;
    /**
     * Runs sqlite structure sql.
     * @param {object} args - Options object.
     * @param {Record<string, import("../database/drivers/base.js").default>} args.dbs - Dbs.
     * @returns {Promise<string | null>} - Resolves with SQL string.
     */
    _sqliteStructureSql({ dbs }: {
        dbs: Record<string, import("../database/drivers/base.js").default>;
    }): Promise<string | null>;
}
//# sourceMappingURL=browser.d.ts.map