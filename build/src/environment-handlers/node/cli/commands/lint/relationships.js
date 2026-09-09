// @ts-check
import BaseCommand from "../../../../../cli/base-command.js";
import fs from "node:fs/promises";
import path from "node:path";
import requireContext from "require-context";
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
    async execute() {
        // Relationship target resolution (getTargetModelClass) looks model classes up through the
        // current configuration, so make this command's configuration the current one.
        this.getConfiguration().setCurrent();
        if (!await this._registerStaticModelFiles()) {
            await this.getConfiguration().initializeModels();
        }
        const ignoredRelationships = await this._loadIgnoredRelationships();
        const offences = [];
        const modelClasses = Object.values(this.getConfiguration().getModelClasses());
        for (const modelClass of modelClasses) {
            for (const relationship of modelClass.getRelationships()) {
                if (relationship.getType() != "belongsTo")
                    continue;
                if (relationship.getPolymorphic())
                    continue;
                const ignoreKey = `${modelClass.name}#${relationship.getRelationshipName()}`;
                if (ignoredRelationships.has(ignoreKey))
                    continue;
                let targetModelClass;
                try {
                    targetModelClass = relationship.getTargetModelClass();
                }
                catch (error) {
                    offences.push({
                        ignoreKey,
                        message: `${ignoreKey}: couldn't resolve the target model class: ${error instanceof Error ? error.message : error}`
                    });
                    continue;
                }
                if (!targetModelClass) {
                    offences.push({ ignoreKey, message: `${ignoreKey}: couldn't resolve the target model class` });
                    continue;
                }
                const inverseRelationship = targetModelClass.getRelationships().find((candidate) => {
                    if (candidate.getType() != "hasMany" && candidate.getType() != "hasOne")
                        return false;
                    if (candidate.through)
                        return false;
                    try {
                        const candidateTargetModelClass = candidate.getTargetModelClass();
                        if (!candidateTargetModelClass)
                            return false;
                        return this._modelClassesMatch(candidateTargetModelClass, modelClass);
                    }
                    catch {
                        // A has-many/has-one with an unresolvable target can't be the inverse of this belongs-to.
                        // It is reported separately when its own model's belongs-to relationships are linted.
                        return false;
                    }
                });
                if (inverseRelationship)
                    continue;
                offences.push({
                    ignoreKey,
                    message: `${targetModelClass.name} is missing an inverse hasMany/hasOne relationship for ${ignoreKey} (belongsTo). ` +
                        `Declare the inverse on ${targetModelClass.name} or add "${ignoreKey}" to the ignore config.`
                });
            }
        }
        for (const offence of offences) {
            console.error(offence.message);
        }
        if (offences.length > 0) {
            throw new Error(`Relationship lint failed with ${offences.length} offence(s):\n${offences.map((offence) => offence.message).join("\n")}`);
        }
        console.log(`Relationship lint passed for ${modelClasses.length} model(s).`);
        return { offences };
    }
    /**
     * Registers model classes from the conventional src/models directory without
     * running the application's full database/server initialization.
     * @returns {Promise<boolean>} Whether static model files were registered.
     */
    async _registerStaticModelFiles() {
        if (this.args.testing)
            return false;
        const modelsDirectory = path.join(this.directory(), "src/models");
        try {
            const stats = await fs.stat(modelsDirectory);
            if (!stats.isDirectory())
                return false;
        }
        catch (error) {
            if ( /** @type {Error & {code?: string}} */(error).code == "ENOENT")
                return false;
            throw error;
        }
        if ((await this._javascriptFilesInDirectory(modelsDirectory)).length === 0)
            return false;
        /** @type {ModelFileRequireContextType} */
        const requireContextModels = requireContext(modelsDirectory, true, /^(.+)\.js$/);
        const modelFileNames = requireContextModels.keys();
        for (const fileName of modelFileNames) {
            const modelClassImport = requireContextModels(fileName);
            const modelClass = modelClassImport.default;
            if (!modelClass) {
                throw new Error(`Model wasn't exported from: ${fileName}`);
            }
            modelClass.registerRecordClass({ configuration: this.getConfiguration() });
        }
        return true;
    }
    /**
     * Finds JavaScript files below a directory.
     * @param {string} directory - Directory to scan.
     * @returns {Promise<string[]>} JavaScript file paths.
     */
    async _javascriptFilesInDirectory(directory) {
        const filePaths = [];
        const entries = await fs.readdir(directory, { withFileTypes: true });
        for (const entry of entries) {
            const entryPath = path.join(directory, entry.name);
            if (entry.isDirectory()) {
                filePaths.push(...await this._javascriptFilesInDirectory(entryPath));
                continue;
            }
            if (entry.isFile() && entry.name.endsWith(".js")) {
                filePaths.push(entryPath);
            }
        }
        return filePaths;
    }
    /**
     * Checks whether two model class objects describe the same registered model.
     * @param {typeof import("../../../../../database/record/index.js").default} leftModelClass - Candidate target model class.
     * @param {typeof import("../../../../../database/record/index.js").default} rightModelClass - Belongs-to source model class.
     * @returns {boolean} Whether both model classes represent the same model identity.
     */
    _modelClassesMatch(leftModelClass, rightModelClass) {
        if (leftModelClass === rightModelClass)
            return true;
        // `translates()` creates an internal translation class; apps may also define
        // a concrete class for the same model/table so generated code has a stable
        // file and type name.
        if (leftModelClass.getModelName() != rightModelClass.getModelName())
            return false;
        return leftModelClass.tableName() == rightModelClass.tableName();
    }
    /**
     * Loads the ignored relationship keys from the lint config file. The file is optional; when the
     * default path doesn't exist, no relationships are ignored. An explicitly passed `--config` path
     * must exist.
     * @returns {Promise<Set<string>>} - Ignored `<model>#<relationship>` keys.
     */
    async _loadIgnoredRelationships() {
        const configArgIndex = this.processArgs?.indexOf("--config") ?? -1;
        const explicitConfigPath = configArgIndex >= 0 ? this.processArgs?.[configArgIndex + 1] : undefined;
        if (configArgIndex >= 0 && !explicitConfigPath) {
            throw new Error("--config was given without a path argument");
        }
        const configPath = explicitConfigPath
            ? path.resolve(this.directory(), explicitConfigPath)
            : path.join(this.directory(), "relationship-lint.json");
        let configContent;
        try {
            configContent = await fs.readFile(configPath, "utf8");
        }
        catch (error) {
            if (!explicitConfigPath && /** @type {Error & {code?: string}} */ (error).code == "ENOENT") {
                return new Set();
            }
            throw error;
        }
        const config = JSON.parse(configContent);
        if (config === null || typeof config != "object" || Array.isArray(config)) {
            throw new Error(`Relationship lint config must be a JSON object: ${configPath}`);
        }
        const ignore = config.ignore ?? [];
        if (!Array.isArray(ignore) || ignore.some((entry) => typeof entry != "string")) {
            throw new Error(`Relationship lint config "ignore" must be an array of "<model>#<relationship>" strings: ${configPath}`);
        }
        return new Set(ignore);
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicmVsYXRpb25zaGlwcy5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uLy4uLy4uLy4uL3NyYy9lbnZpcm9ubWVudC1oYW5kbGVycy9ub2RlL2NsaS9jb21tYW5kcy9saW50L3JlbGF0aW9uc2hpcHMuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLE9BQU8sV0FBVyxNQUFNLG9DQUFvQyxDQUFBO0FBQzVELE9BQU8sRUFBRSxNQUFNLGtCQUFrQixDQUFBO0FBQ2pDLE9BQU8sSUFBSSxNQUFNLFdBQVcsQ0FBQTtBQUM1QixPQUFPLGNBQWMsTUFBTSxpQkFBaUIsQ0FBQTtBQUU1Qzs7O0dBR0c7QUFFSDs7Ozs7Ozs7Ozs7O0dBWUc7QUFDSCxNQUFNLENBQUMsT0FBTyxPQUFPLHFDQUFzQyxTQUFRLFdBQVc7SUFDNUU7OztPQUdHO0lBQ0gsS0FBSyxDQUFDLE9BQU87UUFDWCwwRkFBMEY7UUFDMUYsK0VBQStFO1FBQy9FLElBQUksQ0FBQyxnQkFBZ0IsRUFBRSxDQUFDLFVBQVUsRUFBRSxDQUFBO1FBRXBDLElBQUksQ0FBQyxNQUFNLElBQUksQ0FBQyx5QkFBeUIsRUFBRSxFQUFFLENBQUM7WUFDNUMsTUFBTSxJQUFJLENBQUMsZ0JBQWdCLEVBQUUsQ0FBQyxnQkFBZ0IsRUFBRSxDQUFBO1FBQ2xELENBQUM7UUFFRCxNQUFNLG9CQUFvQixHQUFHLE1BQU0sSUFBSSxDQUFDLHlCQUF5QixFQUFFLENBQUE7UUFDbkUsTUFBTSxRQUFRLEdBQUcsRUFBRSxDQUFBO1FBQ25CLE1BQU0sWUFBWSxHQUFHLE1BQU0sQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLGdCQUFnQixFQUFFLENBQUMsZUFBZSxFQUFFLENBQUMsQ0FBQTtRQUU3RSxLQUFLLE1BQU0sVUFBVSxJQUFJLFlBQVksRUFBRSxDQUFDO1lBQ3RDLEtBQUssTUFBTSxZQUFZLElBQUksVUFBVSxDQUFDLGdCQUFnQixFQUFFLEVBQUUsQ0FBQztnQkFDekQsSUFB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QUVELE1BQU0sS0FBSyxDQUFBO1FBQ2IsQ0FBQztRQUVELE1BQU0sTUFBTSxHQUFHLElBQUksQ0FBQyxLQUFLLENBQUMsYUFBYSxDQUFDLENBQUE7UUFFeEMsSUFBSSxNQUFNLEtBQUssSUFBSSxJQUFJLE9BQU8sTUFBTSxJQUFJLFFBQVEsSUFBSSxLQUFLLENBQUMsT0FBTyxDQUFDLE1BQU0sQ0FBQyxFQUFFLENBQUM7WUFDMUUsTUFBTSxJQUFJLEtBQUssQ0FBQyxtREFBbUQsVUFBVSxFQUFFLENBQUMsQ0FBQTtRQUNsRixDQUFDO1FBRUQsTUFBTSxNQUFNLEdBQUcsTUFBTSxDQUFDLE1BQU0sSUFBSSxFQUFFLENBQUE7UUFFbEMsSUFBSSxDQUFDLEtBQUssQ0FBQyxPQUFPLENBQUMsTUFBTSxDQUFDLElBQUksTUFBTSxDQUFDLElBQUksQ0FBQyxDQUFDLEtBQUssRUFBRSxFQUFFLENBQUMsT0FBTyxLQUFLLElBQUksUUFBUSxDQUFDLEVBQUUsQ0FBQztZQUMvRSxNQUFNLElBQUksS0FBSyxDQUFDLDJGQUEyRixVQUFVLEVBQUUsQ0FBQyxDQUFBO1FBQzFILENBQUM7UUFFRCxPQUFPLElBQUksR0FBRyxDQUFDLE1BQU0sQ0FBQyxDQUFBO0lBQ3hCLENBQUM7Q0FDRiIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG5pbXBvcnQgQmFzZUNvbW1hbmQgZnJvbSBcIi4uLy4uLy4uLy4uLy4uL2NsaS9iYXNlLWNvbW1hbmQuanNcIlxuaW1wb3J0IGZzIGZyb20gXCJub2RlOmZzL3Byb21pc2VzXCJcbmltcG9ydCBwYXRoIGZyb20gXCJub2RlOnBhdGhcIlxuaW1wb3J0IHJlcXVpcmVDb250ZXh0IGZyb20gXCJyZXF1aXJlLWNvbnRleHRcIlxuXG4vKipcbiAqIEB0eXBlZGVmIHsoaWQ6IHN0cmluZykgPT4ge2RlZmF1bHQ6IHR5cGVvZiBpbXBvcnQoXCIuLi8uLi8uLi8uLi8uLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH19IE1vZGVsRmlsZVJlcXVpcmVDb250ZXh0SWRGdW5jdGlvblR5cGVcbiAqIEB0eXBlZGVmIHtNb2RlbEZpbGVSZXF1aXJlQ29udGV4dElkRnVuY3Rpb25UeXBlICYge2tleXM6ICgpID0+IHN0cmluZ1tdfX0gTW9kZWxGaWxlUmVxdWlyZUNvbnRleHRUeXBlXG4gKi9cblxuLyoqXG4gKiBMaW50cyBtb2RlbCByZWxhdGlvbnNoaXBzOiBldmVyeSBub24tcG9seW1vcnBoaWMgYmVsb25ncy10byByZWxhdGlvbnNoaXAgc2hvdWxkIGhhdmUgYW4gaW52ZXJzZVxuICogaGFzLW1hbnkgb3IgaGFzLW9uZSByZWxhdGlvbnNoaXAgZGVjbGFyZWQgb24gaXRzIHRhcmdldCBtb2RlbCBjbGFzcy4gQSBtaXNzaW5nIGludmVyc2UgdXN1YWxseVxuICogbWVhbnMgdGhlIHRhcmdldCBtb2RlbCB3YXMgbmV2ZXIgdG9sZCBhYm91dCB0aGUgYXNzb2NpYXRpb24gKGUuZy4gYW4gRXZlbnQgbW9kZWwgbWlzc2luZ1xuICogYGhhc01hbnkoXCJwcmljZUNhdGVnb3J5U2V0dGluZ3NcIilgIHdoaWxlIFByaWNlQ2F0ZWdvcnlTZXR0aW5nIGRlY2xhcmVzIGBiZWxvbmdzVG8oXCJldmVudFwiKWApLlxuICpcbiAqIFNwZWNpZmljIHJlbGF0aW9uc2hpcHMgY2FuIGJlIGlnbm9yZWQgdGhyb3VnaCBhIEpTT04gY29uZmlnIGZpbGUgKGRlZmF1bHQ6XG4gKiBgcmVsYXRpb25zaGlwLWxpbnQuanNvbmAgaW4gdGhlIHByb2plY3QgZGlyZWN0b3J5LCBvdmVycmlkYWJsZSB3aXRoIGAtLWNvbmZpZyA8cGF0aD5gKTpcbiAqXG4gKiAgIHtcImlnbm9yZVwiOiBbXCJQcmljZUNhdGVnb3J5U2V0dGluZyNldmVudFwiXX1cbiAqXG4gKiB3aGVyZSBlYWNoIGVudHJ5IGlzIGA8bW9kZWwgY2xhc3MgbmFtZT4jPGJlbG9uZ3MtdG8gcmVsYXRpb25zaGlwIG5hbWU+YC5cbiAqL1xuZXhwb3J0IGRlZmF1bHQgY2xhc3MgVmVsb2Npb3VzQ2xpQ29tbWFuZHNMaW50UmVsYXRpb25zaGlwcyBleHRlbmRzIEJhc2VDb21tYW5kIHtcbiAgLyoqXG4gICAqIFJ1bnMgZXhlY3V0ZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8e29mZmVuY2VzOiBBcnJheTx7aWdub3JlS2V5OiBzdHJpbmcsIG1lc3NhZ2U6IHN0cmluZ30+fT59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgZm91bmQgb2ZmZW5jZXMgKGVtcHR5IHdoZW4gdGhlIGxpbnQgcGFzc2VzKS5cbiAgICovXG4gIGFzeW5jIGV4ZWN1dGUoKSB7XG4gICAgLy8gUmVsYXRpb25zaGlwIHRhcmdldCByZXNvbHV0aW9uIChnZXRUYXJnZXRNb2RlbENsYXNzKSBsb29rcyBtb2RlbCBjbGFzc2VzIHVwIHRocm91Z2ggdGhlXG4gICAgLy8gY3VycmVudCBjb25maWd1cmF0aW9uLCBzbyBtYWtlIHRoaXMgY29tbWFuZCdzIGNvbmZpZ3VyYXRpb24gdGhlIGN1cnJlbnQgb25lLlxuICAgIHRoaXMuZ2V0Q29uZmlndXJhdGlvbigpLnNldEN1cnJlbnQoKVxuXG4gICAgaWYgKCFhd2FpdCB0aGlzLl9yZWdpc3RlclN0YXRpY01vZGVsRmlsZXMoKSkge1xuICAgICAgYXdhaXQgdGhpcy5nZXRDb25maWd1cmF0aW9uKCkuaW5pdGlhbGl6ZU1vZGVscygpXG4gICAgfVxuXG4gICAgY29uc3QgaWdub3JlZFJlbGF0aW9uc2hpcHMgPSBhd2FpdCB0aGlzLl9sb2FkSWdub3JlZFJlbGF0aW9uc2hpcHMoKVxuICAgIGNvbnN0IG9mZmVuY2VzID0gW11cbiAgICBjb25zdCBtb2RlbENsYXNzZXMgPSBPYmplY3QudmFsdWVzKHRoaXMuZ2V0Q29uZmlndXJhdGlvbigpLmdldE1vZGVsQ2xhc3NlcygpKVxuXG4gICAgZm9yIChjb25zdCBtb2RlbENsYXNzIG9mIG1vZGVsQ2xhc3Nlcykge1xuICAgICAgZm9yIChjb25zdCByZWxhdGlvbnNoaXAgb2YgbW9kZWxDbGFzcy5nZXRSZWxhdGlvbnNoaXBzKCkpIHtcbiAgICAgICAgaWYgKHJlbGF0aW9uc2hpcC5nZXRUeXBlKCkgIT0gXCJiZWxvbmdzVG9cIikgY29udGludWVcbiAgICAgICAgaWYgKHJlbGF0aW9uc2hpcC5nZXRQb2x5bW9ycGhpYygpKSBjb250aW51ZVxuXG4gICAgICAgIGNvbnN0IGlnbm9yZUtleSA9IGAke21vZGVsQ2xhc3MubmFtZX0jJHtyZWxhdGlvbnNoaXAuZ2V0UmVsYXRpb25zaGlwTmFtZSgpfWBcblxuICAgICAgICBpZiAoaWdub3JlZFJlbGF0aW9uc2hpcHMuaGFzKGlnbm9yZUtleSkpIGNvbnRpbnVlXG5cbiAgICAgICAgbGV0IHRhcmdldE1vZGVsQ2xhc3NcblxuICAgICAgICB0cnkge1xuICAgICAgICAgIHRhcmdldE1vZGVsQ2xhc3MgPSByZWxhdGlvbnNoaXAuZ2V0VGFyZ2V0TW9kZWxDbGFzcygpXG4gICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgICAgb2ZmZW5jZXMucHVzaCh7XG4gICAgICAgICAgICBpZ25vcmVLZXksXG4gICAgICAgICAgICBtZXNzYWdlOiBgJHtpZ25vcmVLZXl9OiBjb3VsZG4ndCByZXNvbHZlIHRoZSB0YXJnZXQgbW9kZWwgY2xhc3M6ICR7ZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiBlcnJvcn1gXG4gICAgICAgICAgfSlcblxuICAgICAgICAgIGNvbnRpbnVlXG4gICAgICAgIH1cblxuICAgICAgICBpZiAoIXRhcmdldE1vZGVsQ2xhc3MpIHtcbiAgICAgICAgICBvZmZlbmNlcy5wdXNoKHtpZ25vcmVLZXksIG1lc3NhZ2U6IGAke2lnbm9yZUtleX06IGNvdWxkbid0IHJlc29sdmUgdGhlIHRhcmdldCBtb2RlbCBjbGFzc2B9KVxuXG4gICAgICAgICAgY29udGludWVcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IGludmVyc2VSZWxhdGlvbnNoaXAgPSB0YXJnZXRNb2RlbENsYXNzLmdldFJlbGF0aW9uc2hpcHMoKS5maW5kKChjYW5kaWRhdGUpID0+IHtcbiAgICAgICAgICBpZiAoY2FuZGlkYXRlLmdldFR5cGUoKSAhPSBcImhhc01hbnlcIiAmJiBjYW5kaWRhdGUuZ2V0VHlwZSgpICE9IFwiaGFzT25lXCIpIHJldHVybiBmYWxzZVxuICAgICAgICAgIGlmIChjYW5kaWRhdGUudGhyb3VnaCkgcmV0dXJuIGZhbHNlXG5cbiAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgY29uc3QgY2FuZGlkYXRlVGFyZ2V0TW9kZWxDbGFzcyA9IGNhbmRpZGF0ZS5nZXRUYXJnZXRNb2RlbENsYXNzKClcblxuICAgICAgICAgICAgaWYgKCFjYW5kaWRhdGVUYXJnZXRNb2RlbENsYXNzKSByZXR1cm4gZmFsc2VcblxuICAgICAgICAgICAgcmV0dXJuIHRoaXMuX21vZGVsQ2xhc3Nlc01hdGNoKGNhbmRpZGF0ZVRhcmdldE1vZGVsQ2xhc3MsIG1vZGVsQ2xhc3MpXG4gICAgICAgICAgfSBjYXRjaCB7XG4gICAgICAgICAgICAvLyBBIGhhcy1tYW55L2hhcy1vbmUgd2l0aCBhbiB1bnJlc29sdmFibGUgdGFyZ2V0IGNhbid0IGJlIHRoZSBpbnZlcnNlIG9mIHRoaXMgYmVsb25ncy10by5cbiAgICAgICAgICAgIC8vIEl0IGlzIHJlcG9ydGVkIHNlcGFyYXRlbHkgd2hlbiBpdHMgb3duIG1vZGVsJ3MgYmVsb25ncy10byByZWxhdGlvbnNoaXBzIGFyZSBsaW50ZWQuXG4gICAgICAgICAgICByZXR1cm4gZmFsc2VcbiAgICAgICAgICB9XG4gICAgICAgIH0pXG5cbiAgICAgICAgaWYgKGludmVyc2VSZWxhdGlvbnNoaXApIGNvbnRpbnVlXG5cbiAgICAgICAgb2ZmZW5jZXMucHVzaCh7XG4gICAgICAgICAgaWdub3JlS2V5LFxuICAgICAgICAgIG1lc3NhZ2U6IGAke3RhcmdldE1vZGVsQ2xhc3MubmFtZX0gaXMgbWlzc2luZyBhbiBpbnZlcnNlIGhhc01hbnkvaGFzT25lIHJlbGF0aW9uc2hpcCBmb3IgJHtpZ25vcmVLZXl9IChiZWxvbmdzVG8pLiBgICtcbiAgICAgICAgICAgIGBEZWNsYXJlIHRoZSBpbnZlcnNlIG9uICR7dGFyZ2V0TW9kZWxDbGFzcy5uYW1lfSBvciBhZGQgXCIke2lnbm9yZUtleX1cIiB0byB0aGUgaWdub3JlIGNvbmZpZy5gXG4gICAgICAgIH0pXG4gICAgICB9XG4gICAgfVxuXG4gICAgZm9yIChjb25zdCBvZmZlbmNlIG9mIG9mZmVuY2VzKSB7XG4gICAgICBjb25zb2xlLmVycm9yKG9mZmVuY2UubWVzc2FnZSlcbiAgICB9XG5cbiAgICBpZiAob2ZmZW5jZXMubGVuZ3RoID4gMCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBSZWxhdGlvbnNoaXAgbGludCBmYWlsZWQgd2l0aCAke29mZmVuY2VzLmxlbmd0aH0gb2ZmZW5jZShzKTpcXG4ke29mZmVuY2VzLm1hcCgob2ZmZW5jZSkgPT4gb2ZmZW5jZS5tZXNzYWdlKS5qb2luKFwiXFxuXCIpfWApXG4gICAgfVxuXG4gICAgY29uc29sZS5sb2coYFJlbGF0aW9uc2hpcCBsaW50IHBhc3NlZCBmb3IgJHttb2RlbENsYXNzZXMubGVuZ3RofSBtb2RlbChzKS5gKVxuXG4gICAgcmV0dXJuIHtvZmZlbmNlc31cbiAgfVxuXG4gIC8qKlxuICAgKiBSZWdpc3RlcnMgbW9kZWwgY2xhc3NlcyBmcm9tIHRoZSBjb252ZW50aW9uYWwgc3JjL21vZGVscyBkaXJlY3Rvcnkgd2l0aG91dFxuICAgKiBydW5uaW5nIHRoZSBhcHBsaWNhdGlvbidzIGZ1bGwgZGF0YWJhc2Uvc2VydmVyIGluaXRpYWxpemF0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxib29sZWFuPn0gV2hldGhlciBzdGF0aWMgbW9kZWwgZmlsZXMgd2VyZSByZWdpc3RlcmVkLlxuICAgKi9cbiAgYXN5bmMgX3JlZ2lzdGVyU3RhdGljTW9kZWxGaWxlcygpIHtcbiAgICBpZiAodGhpcy5hcmdzLnRlc3RpbmcpIHJldHVybiBmYWxzZVxuXG4gICAgY29uc3QgbW9kZWxzRGlyZWN0b3J5ID0gcGF0aC5qb2luKHRoaXMuZGlyZWN0b3J5KCksIFwic3JjL21vZGVsc1wiKVxuXG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHN0YXRzID0gYXdhaXQgZnMuc3RhdChtb2RlbHNEaXJlY3RvcnkpXG5cbiAgICAgIGlmICghc3RhdHMuaXNEaXJlY3RvcnkoKSkgcmV0dXJuIGZhbHNlXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGlmICgvKiogQHR5cGUge0Vycm9yICYge2NvZGU/OiBzdHJpbmd9fSAqLyAoZXJyb3IpLmNvZGUgPT0gXCJFTk9FTlRcIikgcmV0dXJuIGZhbHNlXG5cbiAgICAgIHRocm93IGVycm9yXG4gICAgfVxuXG4gICAgaWYgKChhd2FpdCB0aGlzLl9qYXZhc2NyaXB0RmlsZXNJbkRpcmVjdG9yeShtb2RlbHNEaXJlY3RvcnkpKS5sZW5ndGggPT09IDApIHJldHVybiBmYWxzZVxuXG4gICAgLyoqIEB0eXBlIHtNb2RlbEZpbGVSZXF1aXJlQ29udGV4dFR5cGV9ICovXG4gICAgY29uc3QgcmVxdWlyZUNvbnRleHRNb2RlbHMgPSByZXF1aXJlQ29udGV4dChtb2RlbHNEaXJlY3RvcnksIHRydWUsIC9eKC4rKVxcLmpzJC8pXG5cbiAgICBjb25zdCBtb2RlbEZpbGVOYW1lcyA9IHJlcXVpcmVDb250ZXh0TW9kZWxzLmtleXMoKVxuICAgIGZvciAoY29uc3QgZmlsZU5hbWUgb2YgbW9kZWxGaWxlTmFtZXMpIHtcbiAgICAgIGNvbnN0IG1vZGVsQ2xhc3NJbXBvcnQgPSByZXF1aXJlQ29udGV4dE1vZGVscyhmaWxlTmFtZSlcbiAgICAgIGNvbnN0IG1vZGVsQ2xhc3MgPSBtb2RlbENsYXNzSW1wb3J0LmRlZmF1bHRcblxuICAgICAgaWYgKCFtb2RlbENsYXNzKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgTW9kZWwgd2Fzbid0IGV4cG9ydGVkIGZyb206ICR7ZmlsZU5hbWV9YClcbiAgICAgIH1cblxuICAgICAgbW9kZWxDbGFzcy5yZWdpc3RlclJlY29yZENsYXNzKHtjb25maWd1cmF0aW9uOiB0aGlzLmdldENvbmZpZ3VyYXRpb24oKX0pXG4gICAgfVxuXG4gICAgcmV0dXJuIHRydWVcbiAgfVxuXG4gIC8qKlxuICAgKiBGaW5kcyBKYXZhU2NyaXB0IGZpbGVzIGJlbG93IGEgZGlyZWN0b3J5LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gZGlyZWN0b3J5IC0gRGlyZWN0b3J5IHRvIHNjYW4uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHN0cmluZ1tdPn0gSmF2YVNjcmlwdCBmaWxlIHBhdGhzLlxuICAgKi9cbiAgYXN5bmMgX2phdmFzY3JpcHRGaWxlc0luRGlyZWN0b3J5KGRpcmVjdG9yeSkge1xuICAgIGNvbnN0IGZpbGVQYXRocyA9IFtdXG4gICAgY29uc3QgZW50cmllcyA9IGF3YWl0IGZzLnJlYWRkaXIoZGlyZWN0b3J5LCB7d2l0aEZpbGVUeXBlczogdHJ1ZX0pXG5cbiAgICBmb3IgKGNvbnN0IGVudHJ5IG9mIGVudHJpZXMpIHtcbiAgICAgIGNvbnN0IGVudHJ5UGF0aCA9IHBhdGguam9pbihkaXJlY3RvcnksIGVudHJ5Lm5hbWUpXG5cbiAgICAgIGlmIChlbnRyeS5pc0RpcmVjdG9yeSgpKSB7XG4gICAgICAgIGZpbGVQYXRocy5wdXNoKC4uLmF3YWl0IHRoaXMuX2phdmFzY3JpcHRGaWxlc0luRGlyZWN0b3J5KGVudHJ5UGF0aCkpXG4gICAgICAgIGNvbnRpbnVlXG4gICAgICB9XG5cbiAgICAgIGlmIChlbnRyeS5pc0ZpbGUoKSAmJiBlbnRyeS5uYW1lLmVuZHNXaXRoKFwiLmpzXCIpKSB7XG4gICAgICAgIGZpbGVQYXRocy5wdXNoKGVudHJ5UGF0aClcbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gZmlsZVBhdGhzXG4gIH1cblxuICAvKipcbiAgICogQ2hlY2tzIHdoZXRoZXIgdHdvIG1vZGVsIGNsYXNzIG9iamVjdHMgZGVzY3JpYmUgdGhlIHNhbWUgcmVnaXN0ZXJlZCBtb2RlbC5cbiAgICogQHBhcmFtIHt0eXBlb2YgaW1wb3J0KFwiLi4vLi4vLi4vLi4vLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IGxlZnRNb2RlbENsYXNzIC0gQ2FuZGlkYXRlIHRhcmdldCBtb2RlbCBjbGFzcy5cbiAgICogQHBhcmFtIHt0eXBlb2YgaW1wb3J0KFwiLi4vLi4vLi4vLi4vLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IHJpZ2h0TW9kZWxDbGFzcyAtIEJlbG9uZ3MtdG8gc291cmNlIG1vZGVsIGNsYXNzLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gV2hldGhlciBib3RoIG1vZGVsIGNsYXNzZXMgcmVwcmVzZW50IHRoZSBzYW1lIG1vZGVsIGlkZW50aXR5LlxuICAgKi9cbiAgX21vZGVsQ2xhc3Nlc01hdGNoKGxlZnRNb2RlbENsYXNzLCByaWdodE1vZGVsQ2xhc3MpIHtcbiAgICBpZiAobGVmdE1vZGVsQ2xhc3MgPT09IHJpZ2h0TW9kZWxDbGFzcykgcmV0dXJuIHRydWVcbiAgICAvLyBgdHJhbnNsYXRlcygpYCBjcmVhdGVzIGFuIGludGVybmFsIHRyYW5zbGF0aW9uIGNsYXNzOyBhcHBzIG1heSBhbHNvIGRlZmluZVxuICAgIC8vIGEgY29uY3JldGUgY2xhc3MgZm9yIHRoZSBzYW1lIG1vZGVsL3RhYmxlIHNvIGdlbmVyYXRlZCBjb2RlIGhhcyBhIHN0YWJsZVxuICAgIC8vIGZpbGUgYW5kIHR5cGUgbmFtZS5cbiAgICBpZiAobGVmdE1vZGVsQ2xhc3MuZ2V0TW9kZWxOYW1lKCkgIT0gcmlnaHRNb2RlbENsYXNzLmdldE1vZGVsTmFtZSgpKSByZXR1cm4gZmFsc2VcblxuICAgIHJldHVybiBsZWZ0TW9kZWxDbGFzcy50YWJsZU5hbWUoKSA9PSByaWdodE1vZGVsQ2xhc3MudGFibGVOYW1lKClcbiAgfVxuXG4gIC8qKlxuICAgKiBMb2FkcyB0aGUgaWdub3JlZCByZWxhdGlvbnNoaXAga2V5cyBmcm9tIHRoZSBsaW50IGNvbmZpZyBmaWxlLiBUaGUgZmlsZSBpcyBvcHRpb25hbDsgd2hlbiB0aGVcbiAgICogZGVmYXVsdCBwYXRoIGRvZXNuJ3QgZXhpc3QsIG5vIHJlbGF0aW9uc2hpcHMgYXJlIGlnbm9yZWQuIEFuIGV4cGxpY2l0bHkgcGFzc2VkIGAtLWNvbmZpZ2AgcGF0aFxuICAgKiBtdXN0IGV4aXN0LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxTZXQ8c3RyaW5nPj59IC0gSWdub3JlZCBgPG1vZGVsPiM8cmVsYXRpb25zaGlwPmAga2V5cy5cbiAgICovXG4gIGFzeW5jIF9sb2FkSWdub3JlZFJlbGF0aW9uc2hpcHMoKSB7XG4gICAgY29uc3QgY29uZmlnQXJnSW5kZXggPSB0aGlzLnByb2Nlc3NBcmdzPy5pbmRleE9mKFwiLS1jb25maWdcIikgPz8gLTFcbiAgICBjb25zdCBleHBsaWNpdENvbmZpZ1BhdGggPSBjb25maWdBcmdJbmRleCA+PSAwID8gdGhpcy5wcm9jZXNzQXJncz8uW2NvbmZpZ0FyZ0luZGV4ICsgMV0gOiB1bmRlZmluZWRcblxuICAgIGlmIChjb25maWdBcmdJbmRleCA+PSAwICYmICFleHBsaWNpdENvbmZpZ1BhdGgpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIi0tY29uZmlnIHdhcyBnaXZlbiB3aXRob3V0IGEgcGF0aCBhcmd1bWVudFwiKVxuICAgIH1cblxuICAgIGNvbnN0IGNvbmZpZ1BhdGggPSBleHBsaWNpdENvbmZpZ1BhdGhcbiAgICAgID8gcGF0aC5yZXNvbHZlKHRoaXMuZGlyZWN0b3J5KCksIGV4cGxpY2l0Q29uZmlnUGF0aClcbiAgICAgIDogcGF0aC5qb2luKHRoaXMuZGlyZWN0b3J5KCksIFwicmVsYXRpb25zaGlwLWxpbnQuanNvblwiKVxuXG4gICAgbGV0IGNvbmZpZ0NvbnRlbnRcblxuICAgIHRyeSB7XG4gICAgICBjb25maWdDb250ZW50ID0gYXdhaXQgZnMucmVhZEZpbGUoY29uZmlnUGF0aCwgXCJ1dGY4XCIpXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGlmICghZXhwbGljaXRDb25maWdQYXRoICYmIC8qKiBAdHlwZSB7RXJyb3IgJiB7Y29kZT86IHN0cmluZ319ICovIChlcnJvcikuY29kZSA9PSBcIkVOT0VOVFwiKSB7XG4gICAgICAgIHJldHVybiBuZXcgU2V0KClcbiAgICAgIH1cblxuICAgICAgdGhyb3cgZXJyb3JcbiAgICB9XG5cbiAgICBjb25zdCBjb25maWcgPSBKU09OLnBhcnNlKGNvbmZpZ0NvbnRlbnQpXG5cbiAgICBpZiAoY29uZmlnID09PSBudWxsIHx8IHR5cGVvZiBjb25maWcgIT0gXCJvYmplY3RcIiB8fCBBcnJheS5pc0FycmF5KGNvbmZpZykpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgUmVsYXRpb25zaGlwIGxpbnQgY29uZmlnIG11c3QgYmUgYSBKU09OIG9iamVjdDogJHtjb25maWdQYXRofWApXG4gICAgfVxuXG4gICAgY29uc3QgaWdub3JlID0gY29uZmlnLmlnbm9yZSA/PyBbXVxuXG4gICAgaWYgKCFBcnJheS5pc0FycmF5KGlnbm9yZSkgfHwgaWdub3JlLnNvbWUoKGVudHJ5KSA9PiB0eXBlb2YgZW50cnkgIT0gXCJzdHJpbmdcIikpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgUmVsYXRpb25zaGlwIGxpbnQgY29uZmlnIFwiaWdub3JlXCIgbXVzdCBiZSBhbiBhcnJheSBvZiBcIjxtb2RlbD4jPHJlbGF0aW9uc2hpcD5cIiBzdHJpbmdzOiAke2NvbmZpZ1BhdGh9YClcbiAgICB9XG5cbiAgICByZXR1cm4gbmV3IFNldChpZ25vcmUpXG4gIH1cbn1cbiJdfQ==