// @ts-check

import {FactoryError} from "./errors.js"

/** Internal sentinel thrown to force a per-case transaction rollback. */
class LintRollbackSignal extends Error {}

/**
 * Aggregated lint failure raised when one or more linted factories/traits error.
 */
class FactoryLintError extends FactoryError {}

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
    this.registry = registry
  }

  /**
   * Lints selected factories and reports every failure together.
   * @param {object} [options] - Options.
   * @param {string[]} [options.factories] - Factory names to lint. Defaults to all.
   * @param {boolean} [options.traits] - Whether to also lint each factory's local traits.
   * @param {"attributesFor" | "build" | "create"} [options.strategy] - Strategy to lint with. Defaults to create.
   * @returns {Promise<void>} - Resolves when every case passed; rejects with an aggregate otherwise.
   */
  async lint({factories, traits = false, strategy = "create"} = {}) {
    const definitions = this._selectDefinitions(factories)
    /** @type {Array<{label: string, error: ?}>} */
    const failures = []

    for (const definition of definitions) {
      await this._lintCase(definition, [], strategy, failures)

      if (traits) {
        for (const traitName of definition.localTraits.keys()) {
          await this._lintCase(definition, [traitName], strategy, failures)
        }
      }
    }

    if (failures.length > 0) {
      const details = failures.map((failure) => `  ${failure.label}: ${failure.error && failure.error.message}`).join("\n")

      throw new FactoryLintError(`Factory lint found ${failures.length} error(s):\n${details}`)
    }
  }

  /**
   * Resolves the unique set of factory definitions to lint.
   * @param {string[] | undefined} factories - Explicit names, or undefined for all.
   * @returns {import("./factory-definition.js").default[]} - Unique definitions.
   */
  _selectDefinitions(factories) {
    if (factories) {
      return factories.map((name) => this.registry._runner._resolveFactory(name))
    }

    return [...new Set(this.registry._factories.values())]
  }

  /**
   * Lints one factory/trait case, rolling back create-strategy persistence.
   * @param {import("./factory-definition.js").default} definition - Factory definition.
   * @param {string[]} traits - Traits to apply for this case.
   * @param {"attributesFor" | "build" | "create"} strategy - Strategy to run.
   * @param {Array<{label: string, error: ?}>} failures - Failure sink.
   * @returns {Promise<void>} - Resolves when the case has been evaluated.
   */
  async _lintCase(definition, traits, strategy, failures) {
    const label = traits.length > 0 ? `${definition.name} + ${traits.join(", ")}` : definition.name

    try {
      if (strategy === "create") {
        await this._lintCreateCase(definition, traits)
      } else {
        await this.registry[strategy](definition.name, ...traits)
      }
    } catch (error) {
      if (error instanceof LintRollbackSignal) return

      failures.push({label, error})
    }
  }

  /**
   * Runs a create-strategy case inside a transaction and forces a rollback.
   * @param {import("./factory-definition.js").default} definition - Factory definition.
   * @param {string[]} traits - Traits to apply.
   * @returns {Promise<void>} - Resolves (or rejects) once the rollback completes.
   */
  async _lintCreateCase(definition, traits) {
    const chain = this.registry._runner._resolveChain(definition.name)
    const modelClass = this.registry._runner._resolveModelClass(chain)

    if (!modelClass) {
      await this.registry.create(definition.name, ...traits)

      return
    }

    await /** @type {typeof import("../../database/record/index.js").default} */ (modelClass).transaction(async () => {
      await this.registry.create(definition.name, ...traits)

      throw new LintRollbackSignal()
    })
  }
}
