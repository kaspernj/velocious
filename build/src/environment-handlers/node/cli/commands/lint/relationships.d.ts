import BaseCommand from "../../../../../cli/base-command.js";
export type ModelFileRequireContextIdFunctionType = (id: string) => {
    default: typeof import("../../../../../database/record/index.js").default;
};
export type ModelFileRequireContextType = ModelFileRequireContextIdFunctionType & {
    keys: () => string[];
};
/**
 * @typedef {(id: string) => {default: typeof import("../../../../../database/record/index.js").default}} ModelFileRequireContextIdFunctionType
 * @typedef {ModelFileRequireContextIdFunctionType & {keys: () => string[]}} ModelFileRequireContextType
 */
/**
 * Lints model relationships: every non-polymorphic belongs-to relationship should have an inverse
 * has-many or has-one relationship declared on its target model class. A missing inverse usually
 * means the target model was never told about the association (e.g. an Event model missing
 * `hasMany("priceCategorySettings")` while PriceCategorySetting declares `belongsTo("event")`).
 *
 * Specific relationships can be ignored through a JSON config file (default:
 * `relationship-lint.json` in the project directory, overridable with `--config <path>`):
 *
 *   {"ignore": ["PriceCategorySetting#event"]}
 *
 * where each entry is `<model class name>#<belongs-to relationship name>`.
 */
export default class VelociousCliCommandsLintRelationships extends BaseCommand {
    /**
     * Runs execute.
     * @returns {Promise<{offences: Array<{ignoreKey: string, message: string}>}>} - Resolves with the found offences (empty when the lint passes).
     */
    execute(): Promise<{
        offences: Array<{
            ignoreKey: string;
            message: string;
        }>;
    }>;
    /**
     * Registers model classes from the conventional src/models directory without
     * running the application's full database/server initialization.
     * @returns {Promise<boolean>} Whether static model files were registered.
     */
    _registerStaticModelFiles(): Promise<boolean>;
    /**
     * Finds JavaScript files below a directory.
     * @param {string} directory - Directory to scan.
     * @returns {Promise<string[]>} JavaScript file paths.
     */
    _javascriptFilesInDirectory(directory: string): Promise<string[]>;
    /**
     * Checks whether two model class objects describe the same registered model.
     * @param {typeof import("../../../../../database/record/index.js").default} leftModelClass - Candidate target model class.
     * @param {typeof import("../../../../../database/record/index.js").default} rightModelClass - Belongs-to source model class.
     * @returns {boolean} Whether both model classes represent the same model identity.
     */
    _modelClassesMatch(leftModelClass: typeof import("../../../../../database/record/index.js").default, rightModelClass: typeof import("../../../../../database/record/index.js").default): boolean;
    /**
     * Loads the ignored relationship keys from the lint config file. The file is optional; when the
     * default path doesn't exist, no relationships are ignored. An explicitly passed `--config` path
     * must exist.
     * @returns {Promise<Set<string>>} - Ignored `<model>#<relationship>` keys.
     */
    _loadIgnoredRelationships(): Promise<Set<string>>;
}
//# sourceMappingURL=relationships.d.ts.map