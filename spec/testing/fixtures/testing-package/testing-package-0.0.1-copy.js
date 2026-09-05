// @ts-check

// Reproduces the default-context identity published by @velocious/testing 0.0.1.
const PROTOCOL_MAJOR = 1
const CONTEXT_SCHEMA_VERSION = 1
const DEFAULT_CONTEXT_SYMBOL = Symbol.for("@velocious/testing.default-context.v1")

// Narrows the realm object at the symbol-keyed compatibility boundary.
/** @type {Record<symbol, {protocolMajor: number, schemaVersion: number, registry?: {suites: ReturnType<typeof JSON.parse>[]}}>} */
const symbolRegistry = globalThis
const existing = symbolRegistry[DEFAULT_CONTEXT_SYMBOL]

if (existing && (existing.protocolMajor !== PROTOCOL_MAJOR || existing.schemaVersion !== CONTEXT_SCHEMA_VERSION)) {
  throw new Error(`Incompatible @velocious/testing default context: found protocol ${existing.protocolMajor}/schema ${existing.schemaVersion}, expected protocol ${PROTOCOL_MAJOR}/schema ${CONTEXT_SCHEMA_VERSION}`)
}

const defaultTestContext = existing || {
  protocolMajor: PROTOCOL_MAJOR,
  schemaVersion: CONTEXT_SCHEMA_VERSION,
  registry: {suites: []}
}

if (!existing) symbolRegistry[DEFAULT_CONTEXT_SYMBOL] = defaultTestContext

export {defaultTestContext}
