// @ts-check
import { FactoryError } from "./errors.js";
/** Internal sentinel thrown to force a per-case transaction rollback. */
class LintRollbackSignal extends Error {
}
/**
 * Aggregated lint failure raised when one or more linted factories/traits error.
 */
class FactoryLintError extends FactoryError {
}
/**
 * Executes registered factories (and optionally their traits) to prove they build
 * and persist, aggregating every failure by case. For the create strategy each
 * case runs inside the model's ambient transaction and is rolled back, so no rows
 * remain in the supported single-connection case. External callback side effects
 * are not reversible and cross-database writes are not globally atomic.
 */
export default class FactoryLinter {
    /**
     * Builds a linter.
     * @param {import("./factory-registry.js").default} registry - Registry to lint.
     */
    constructor(registry) {
        /** @type {import("./factory-registry.js").default} - Registry to lint. */
        this.registry = registry;
    }
    /**
     * Lints selected factories and reports every failure together.
     * @param {object} [options] - Options.
     * @param {string[]} [options.factories] - Factory names to lint. Defaults to all.
     * @param {boolean} [options.traits] - Whether to also lint each factory's local traits.
     * @param {"attributesFor" | "build" | "create"} [options.strategy] - Strategy to lint with. Defaults to create.
     * @returns {Promise<void>} - Resolves when every case passed; rejects with an aggregate otherwise.
     */
    async lint({ factories, traits = false, strategy = "create" } = {}) {
        const definitions = this._selectDefinitions(factories);
        /** @type {Array<{label: string, error: ReturnType<typeof JSON.parse>}>} */
        const failures = [];
        for (const definition of definitions) {
            await this._lintCase(definition, [], strategy, failures);
            if (traits) {
                for (const traitName of definition.localTraits.keys()) {
                    await this._lintCase(definition, [traitName], strategy, failures);
                }
            }
        }
        if (failures.length > 0) {
            const details = failures.map((failure) => `  ${failure.label}: ${failure.error && failure.error.message}`).join("\n");
            throw new FactoryLintError(`Factory lint found ${failures.length} error(s):\n${details}`);
        }
    }
    /**
     * Resolves the unique set of factory definitions to lint.
     * @param {string[] | undefined} factories - Explicit names, or undefined for all.
     * @returns {import("./factory-definition.js").default[]} - Unique definitions.
     */
    _selectDefinitions(factories) {
        if (factories) {
            return factories.map((name) => this.registry._runner._resolveFactory(name));
        }
        return [...new Set(this.registry._factories.values())];
    }
    /**
     * Lints one factory/trait case, rolling back create-strategy persistence.
     * @param {import("./factory-definition.js").default} definition - Factory definition.
     * @param {string[]} traits - Traits to apply for this case.
     * @param {"attributesFor" | "build" | "create"} strategy - Strategy to run.
     * @param {Array<{label: string, error: ReturnType<typeof JSON.parse>}>} failures - Failure sink.
     * @returns {Promise<void>} - Resolves when the case has been evaluated.
     */
    async _lintCase(definition, traits, strategy, failures) {
        const label = traits.length > 0 ? `${definition.name} + ${traits.join(", ")}` : definition.name;
        try {
            if (strategy === "create") {
                await this._lintCreateCase(definition, traits);
            }
            else {
                await this.registry[strategy](definition.name, ...traits);
            }
        }
        catch (error) {
            if (error instanceof LintRollbackSignal)
                return;
            failures.push({ label, error });
        }
    }
    /**
     * Runs a create-strategy case inside a transaction and forces a rollback.
     * @param {import("./factory-definition.js").default} definition - Factory definition.
     * @param {string[]} traits - Traits to apply.
     * @returns {Promise<void>} - Resolves (or rejects) once the rollback completes.
     */
    async _lintCreateCase(definition, traits) {
        const chain = this.registry._runner._resolveChain(definition.name);
        const modelClass = this.registry._runner._resolveModelClass(chain);
        if (!modelClass) {
            await this.registry.create(definition.name, ...traits);
            return;
        }
        await /** @type {typeof import("../../database/record/index.js").default} */ (modelClass).transaction(async () => {
            await this.registry.create(definition.name, ...traits);
            throw new LintRollbackSignal();
        });
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibGludGVyLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vc3JjL3Rlc3RpbmcvZmFjdG9yeS9saW50ZXIuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLE9BQU8sRUFBQyxZQUFZLEVBQUMsTUFBTSxhQUFhLENBQUE7QUFFeEMseUVBQXlFO0FBQ3pFLE1BQU0sa0JBQW1CLFNBQVEsS0FBSztDQUFHO0FBRXpDOztHQUVHO0FBQ0gsTUFBTSxnQkFBaUIsU0FBUSxZQUFZO0NBQUc7QUFFOUM7Ozs7OztHQU1HO0FBQ0gsTUFBTSxDQUFDLE9BQU8sT0FBTyxhQUFhO0lBQ2hDOzs7T0FHRztJQUNILFlBQVksUUFBUTtRQUNsQiwwRUFBMEU7UUFDMUUsSUFBSSxDQUFDLFFBQVEsR0FBRyxRQUFRLENBQUE7SUFDMUIsQ0FBQztJQUVEOzs7Ozs7O09BT0c7SUFDSCxLQUFLLENBQUMsSUFBSSxDQUFDLEVBQUMsU0FBUyxFQUFFLE1BQU0sR0FBRyxLQUFLLEVBQUUsUUFBUSxHQUFHLFFBQVEsRUFBQyxHQUFHLEVBQUU7UUFDOUQsTUFBTSxXQUFXLEdBQUcsSUFBSSxDQUFDLGtCQUFrQixDQUFDLFNBQVMsQ0FBQyxDQUFBO1FBQ3RELDJFQUEyRTtRQUMzRSxNQUFNLFFBQVEsR0FBRyxFQUFFLENBQUE7UUFFbkIsS0FBSyxNQUFNLFVBQVUsSUFBSSxXQUFXLEVBQUUsQ0FBQztZQUNyQyxNQUFNLElBQUksQ0FBQyxTQUFTLENBQUMsVUFBVSxFQUFFLEVBQUUsRUFBRSxRQUFRLEVBQUUsUUFBUSxDQUFDLENBQUE7WUFFeEQsSUFBSSxNQUFNLEVBQUUsQ0FBQztnQkFDWCxLQUFLLE1BQU0sU0FBUyxJQUFJLFVBQVUsQ0FBQyxXQUFXLENBQUMsSUFBSSxFQUFFLEVBQUUsQ0FBQztvQkFDdEQsTUFBTSxJQUFJLENBQUMsU0FBUyxDQUFDLFVBQVUsRUFBRSxDQUFDLFNBQVMsQ0FBQyxFQUFFLFFBQVEsRUFBRSxRQUFRLENBQUMs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QUFDLENBQUE7SUFDSixDQUFDO0NBQ0YiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuaW1wb3J0IHtGYWN0b3J5RXJyb3J9IGZyb20gXCIuL2Vycm9ycy5qc1wiXG5cbi8qKiBJbnRlcm5hbCBzZW50aW5lbCB0aHJvd24gdG8gZm9yY2UgYSBwZXItY2FzZSB0cmFuc2FjdGlvbiByb2xsYmFjay4gKi9cbmNsYXNzIExpbnRSb2xsYmFja1NpZ25hbCBleHRlbmRzIEVycm9yIHt9XG5cbi8qKlxuICogQWdncmVnYXRlZCBsaW50IGZhaWx1cmUgcmFpc2VkIHdoZW4gb25lIG9yIG1vcmUgbGludGVkIGZhY3Rvcmllcy90cmFpdHMgZXJyb3IuXG4gKi9cbmNsYXNzIEZhY3RvcnlMaW50RXJyb3IgZXh0ZW5kcyBGYWN0b3J5RXJyb3Ige31cblxuLyoqXG4gKiBFeGVjdXRlcyByZWdpc3RlcmVkIGZhY3RvcmllcyAoYW5kIG9wdGlvbmFsbHkgdGhlaXIgdHJhaXRzKSB0byBwcm92ZSB0aGV5IGJ1aWxkXG4gKiBhbmQgcGVyc2lzdCwgYWdncmVnYXRpbmcgZXZlcnkgZmFpbHVyZSBieSBjYXNlLiBGb3IgdGhlIGNyZWF0ZSBzdHJhdGVneSBlYWNoXG4gKiBjYXNlIHJ1bnMgaW5zaWRlIHRoZSBtb2RlbCdzIGFtYmllbnQgdHJhbnNhY3Rpb24gYW5kIGlzIHJvbGxlZCBiYWNrLCBzbyBubyByb3dzXG4gKiByZW1haW4gaW4gdGhlIHN1cHBvcnRlZCBzaW5nbGUtY29ubmVjdGlvbiBjYXNlLiBFeHRlcm5hbCBjYWxsYmFjayBzaWRlIGVmZmVjdHNcbiAqIGFyZSBub3QgcmV2ZXJzaWJsZSBhbmQgY3Jvc3MtZGF0YWJhc2Ugd3JpdGVzIGFyZSBub3QgZ2xvYmFsbHkgYXRvbWljLlxuICovXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBGYWN0b3J5TGludGVyIHtcbiAgLyoqXG4gICAqIEJ1aWxkcyBhIGxpbnRlci5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2ZhY3RvcnktcmVnaXN0cnkuanNcIikuZGVmYXVsdH0gcmVnaXN0cnkgLSBSZWdpc3RyeSB0byBsaW50LlxuICAgKi9cbiAgY29uc3RydWN0b3IocmVnaXN0cnkpIHtcbiAgICAvKiogQHR5cGUge2ltcG9ydChcIi4vZmFjdG9yeS1yZWdpc3RyeS5qc1wiKS5kZWZhdWx0fSAtIFJlZ2lzdHJ5IHRvIGxpbnQuICovXG4gICAgdGhpcy5yZWdpc3RyeSA9IHJlZ2lzdHJ5XG4gIH1cblxuICAvKipcbiAgICogTGludHMgc2VsZWN0ZWQgZmFjdG9yaWVzIGFuZCByZXBvcnRzIGV2ZXJ5IGZhaWx1cmUgdG9nZXRoZXIuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBbb3B0aW9uc10gLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge3N0cmluZ1tdfSBbb3B0aW9ucy5mYWN0b3JpZXNdIC0gRmFjdG9yeSBuYW1lcyB0byBsaW50LiBEZWZhdWx0cyB0byBhbGwuXG4gICAqIEBwYXJhbSB7Ym9vbGVhbn0gW29wdGlvbnMudHJhaXRzXSAtIFdoZXRoZXIgdG8gYWxzbyBsaW50IGVhY2ggZmFjdG9yeSdzIGxvY2FsIHRyYWl0cy5cbiAgICogQHBhcmFtIHtcImF0dHJpYnV0ZXNGb3JcIiB8IFwiYnVpbGRcIiB8IFwiY3JlYXRlXCJ9IFtvcHRpb25zLnN0cmF0ZWd5XSAtIFN0cmF0ZWd5IHRvIGxpbnQgd2l0aC4gRGVmYXVsdHMgdG8gY3JlYXRlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGV2ZXJ5IGNhc2UgcGFzc2VkOyByZWplY3RzIHdpdGggYW4gYWdncmVnYXRlIG90aGVyd2lzZS5cbiAgICovXG4gIGFzeW5jIGxpbnQoe2ZhY3RvcmllcywgdHJhaXRzID0gZmFsc2UsIHN0cmF0ZWd5ID0gXCJjcmVhdGVcIn0gPSB7fSkge1xuICAgIGNvbnN0IGRlZmluaXRpb25zID0gdGhpcy5fc2VsZWN0RGVmaW5pdGlvbnMoZmFjdG9yaWVzKVxuICAgIC8qKiBAdHlwZSB7QXJyYXk8e2xhYmVsOiBzdHJpbmcsIGVycm9yOiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0+fSAqL1xuICAgIGNvbnN0IGZhaWx1cmVzID0gW11cblxuICAgIGZvciAoY29uc3QgZGVmaW5pdGlvbiBvZiBkZWZpbml0aW9ucykge1xuICAgICAgYXdhaXQgdGhpcy5fbGludENhc2UoZGVmaW5pdGlvbiwgW10sIHN0cmF0ZWd5LCBmYWlsdXJlcylcblxuICAgICAgaWYgKHRyYWl0cykge1xuICAgICAgICBmb3IgKGNvbnN0IHRyYWl0TmFtZSBvZiBkZWZpbml0aW9uLmxvY2FsVHJhaXRzLmtleXMoKSkge1xuICAgICAgICAgIGF3YWl0IHRoaXMuX2xpbnRDYXNlKGRlZmluaXRpb24sIFt0cmFpdE5hbWVdLCBzdHJhdGVneSwgZmFpbHVyZXMpXG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAoZmFpbHVyZXMubGVuZ3RoID4gMCkge1xuICAgICAgY29uc3QgZGV0YWlscyA9IGZhaWx1cmVzLm1hcCgoZmFpbHVyZSkgPT4gYCAgJHtmYWlsdXJlLmxhYmVsfTogJHtmYWlsdXJlLmVycm9yICYmIGZhaWx1cmUuZXJyb3IubWVzc2FnZX1gKS5qb2luKFwiXFxuXCIpXG5cbiAgICAgIHRocm93IG5ldyBGYWN0b3J5TGludEVycm9yKGBGYWN0b3J5IGxpbnQgZm91bmQgJHtmYWlsdXJlcy5sZW5ndGh9IGVycm9yKHMpOlxcbiR7ZGV0YWlsc31gKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSZXNvbHZlcyB0aGUgdW5pcXVlIHNldCBvZiBmYWN0b3J5IGRlZmluaXRpb25zIHRvIGxpbnQuXG4gICAqIEBwYXJhbSB7c3RyaW5nW10gfCB1bmRlZmluZWR9IGZhY3RvcmllcyAtIEV4cGxpY2l0IG5hbWVzLCBvciB1bmRlZmluZWQgZm9yIGFsbC5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vZmFjdG9yeS1kZWZpbml0aW9uLmpzXCIpLmRlZmF1bHRbXX0gLSBVbmlxdWUgZGVmaW5pdGlvbnMuXG4gICAqL1xuICBfc2VsZWN0RGVmaW5pdGlvbnMoZmFjdG9yaWVzKSB7XG4gICAgaWYgKGZhY3Rvcmllcykge1xuICAgICAgcmV0dXJuIGZhY3Rvcmllcy5tYXAoKG5hbWUpID0+IHRoaXMucmVnaXN0cnkuX3J1bm5lci5fcmVzb2x2ZUZhY3RvcnkobmFtZSkpXG4gICAgfVxuXG4gICAgcmV0dXJuIFsuLi5uZXcgU2V0KHRoaXMucmVnaXN0cnkuX2ZhY3Rvcmllcy52YWx1ZXMoKSldXG4gIH1cblxuICAvKipcbiAgICogTGludHMgb25lIGZhY3RvcnkvdHJhaXQgY2FzZSwgcm9sbGluZyBiYWNrIGNyZWF0ZS1zdHJhdGVneSBwZXJzaXN0ZW5jZS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2ZhY3RvcnktZGVmaW5pdGlvbi5qc1wiKS5kZWZhdWx0fSBkZWZpbml0aW9uIC0gRmFjdG9yeSBkZWZpbml0aW9uLlxuICAgKiBAcGFyYW0ge3N0cmluZ1tdfSB0cmFpdHMgLSBUcmFpdHMgdG8gYXBwbHkgZm9yIHRoaXMgY2FzZS5cbiAgICogQHBhcmFtIHtcImF0dHJpYnV0ZXNGb3JcIiB8IFwiYnVpbGRcIiB8IFwiY3JlYXRlXCJ9IHN0cmF0ZWd5IC0gU3RyYXRlZ3kgdG8gcnVuLlxuICAgKiBAcGFyYW0ge0FycmF5PHtsYWJlbDogc3RyaW5nLCBlcnJvcjogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59Pn0gZmFpbHVyZXMgLSBGYWlsdXJlIHNpbmsuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gdGhlIGNhc2UgaGFzIGJlZW4gZXZhbHVhdGVkLlxuICAgKi9cbiAgYXN5bmMgX2xpbnRDYXNlKGRlZmluaXRpb24sIHRyYWl0cywgc3RyYXRlZ3ksIGZhaWx1cmVzKSB7XG4gICAgY29uc3QgbGFiZWwgPSB0cmFpdHMubGVuZ3RoID4gMCA/IGAke2RlZmluaXRpb24ubmFtZX0gKyAke3RyYWl0cy5qb2luKFwiLCBcIil9YCA6IGRlZmluaXRpb24ubmFtZVxuXG4gICAgdHJ5IHtcbiAgICAgIGlmIChzdHJhdGVneSA9PT0gXCJjcmVhdGVcIikge1xuICAgICAgICBhd2FpdCB0aGlzLl9saW50Q3JlYXRlQ2FzZShkZWZpbml0aW9uLCB0cmFpdHMpXG4gICAgICB9IGVsc2Uge1xuICAgICAgICBhd2FpdCB0aGlzLnJlZ2lzdHJ5W3N0cmF0ZWd5XShkZWZpbml0aW9uLm5hbWUsIC4uLnRyYWl0cylcbiAgICAgIH1cbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgaWYgKGVycm9yIGluc3RhbmNlb2YgTGludFJvbGxiYWNrU2lnbmFsKSByZXR1cm5cblxuICAgICAgZmFpbHVyZXMucHVzaCh7bGFiZWwsIGVycm9yfSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBhIGNyZWF0ZS1zdHJhdGVneSBjYXNlIGluc2lkZSBhIHRyYW5zYWN0aW9uIGFuZCBmb3JjZXMgYSByb2xsYmFjay5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2ZhY3RvcnktZGVmaW5pdGlvbi5qc1wiKS5kZWZhdWx0fSBkZWZpbml0aW9uIC0gRmFjdG9yeSBkZWZpbml0aW9uLlxuICAgKiBAcGFyYW0ge3N0cmluZ1tdfSB0cmFpdHMgLSBUcmFpdHMgdG8gYXBwbHkuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIChvciByZWplY3RzKSBvbmNlIHRoZSByb2xsYmFjayBjb21wbGV0ZXMuXG4gICAqL1xuICBhc3luYyBfbGludENyZWF0ZUNhc2UoZGVmaW5pdGlvbiwgdHJhaXRzKSB7XG4gICAgY29uc3QgY2hhaW4gPSB0aGlzLnJlZ2lzdHJ5Ll9ydW5uZXIuX3Jlc29sdmVDaGFpbihkZWZpbml0aW9uLm5hbWUpXG4gICAgY29uc3QgbW9kZWxDbGFzcyA9IHRoaXMucmVnaXN0cnkuX3J1bm5lci5fcmVzb2x2ZU1vZGVsQ2xhc3MoY2hhaW4pXG5cbiAgICBpZiAoIW1vZGVsQ2xhc3MpIHtcbiAgICAgIGF3YWl0IHRoaXMucmVnaXN0cnkuY3JlYXRlKGRlZmluaXRpb24ubmFtZSwgLi4udHJhaXRzKVxuXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBhd2FpdCAvKiogQHR5cGUge3R5cGVvZiBpbXBvcnQoXCIuLi8uLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gKi8gKG1vZGVsQ2xhc3MpLnRyYW5zYWN0aW9uKGFzeW5jICgpID0+IHtcbiAgICAgIGF3YWl0IHRoaXMucmVnaXN0cnkuY3JlYXRlKGRlZmluaXRpb24ubmFtZSwgLi4udHJhaXRzKVxuXG4gICAgICB0aHJvdyBuZXcgTGludFJvbGxiYWNrU2lnbmFsKClcbiAgICB9KVxuICB9XG59XG4iXX0=