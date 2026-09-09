// @ts-check

/**
 * Base error for every Factory-framework failure so callers can catch the whole
 * family with a single `instanceof FactoryError` check.
 */
class FactoryError extends Error {
  /**
   * Builds a factory error.
   * @param {string} message - Human readable description of the failure.
   */
  constructor(message) {
    super(message)
    this.name = this.constructor.name
  }
}

/**
 * Raised when a factory, trait or sequence is declared twice within the same
 * registry, matching FactoryBot's duplicate-definition guard.
 */
class DuplicateDefinitionError extends FactoryError {}

/**
 * Raised when a strategy references a factory name that was never registered.
 */
class UndefinedFactoryError extends FactoryError {}

/**
 * Raised when a trait name cannot be resolved in the factory-local or global scope.
 */
class UndefinedTraitError extends FactoryError {}

/**
 * Raised when a sequence name cannot be resolved in the factory-local or global scope.
 */
class UndefinedSequenceError extends FactoryError {}

/**
 * Raised when a lazy attribute references another attribute that does not exist.
 */
class UndefinedAttributeError extends FactoryError {}

/**
 * Raised when attribute or factory/trait resolution forms a cycle. The message
 * always contains the full offending path so the author can break it.
 */
class FactoryCycleError extends FactoryError {}

/**
 * Raised when a definition is structurally invalid at declaration time (bad
 * names, option shapes, event names, or model references).
 */
class InvalidDefinitionError extends FactoryError {}

/**
 * Raised when a build/create strategy is asked to construct a class that is not a
 * supported, initialized Velocious backend record.
 */
class ModelContractError extends FactoryError {}

/**
 * Raised when setup-time mutation (define/modify/reset/sequence set/rewind) is
 * attempted while the registry has in-flight evaluations.
 */
class RegistryBusyError extends FactoryError {}

export {
  DuplicateDefinitionError,
  FactoryCycleError,
  FactoryError,
  InvalidDefinitionError,
  ModelContractError,
  RegistryBusyError,
  UndefinedAttributeError,
  UndefinedFactoryError,
  UndefinedSequenceError,
  UndefinedTraitError
}
