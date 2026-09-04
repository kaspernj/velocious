// @ts-check

const PROTOCOL_MAJOR = 1
const CONTEXT_SCHEMA_VERSION = 2
const DEFAULT_CONTEXT_SYMBOL = Symbol.for("@velocious/testing.default-context.v1")

/** @type {Record<symbol, {protocolMajor: number, schemaVersion: number, registry: {suites: Array<{name: string}>}}>} */
const symbolRegistry = globalThis
const existing = symbolRegistry[DEFAULT_CONTEXT_SYMBOL]

if (existing && (existing.protocolMajor !== PROTOCOL_MAJOR || existing.schemaVersion !== CONTEXT_SCHEMA_VERSION)) {
  throw new Error(`Incompatible @velocious/testing default context: found protocol ${existing.protocolMajor}/schema ${existing.schemaVersion}, expected protocol ${PROTOCOL_MAJOR}/schema ${CONTEXT_SCHEMA_VERSION}`)
}

const defaultTestContext = existing || {
  protocolMajor: PROTOCOL_MAJOR,
  registry: {suites: []},
  schemaVersion: CONTEXT_SCHEMA_VERSION
}

if (!existing) symbolRegistry[DEFAULT_CONTEXT_SYMBOL] = defaultTestContext
