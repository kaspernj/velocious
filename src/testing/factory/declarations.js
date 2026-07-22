// @ts-check

/**
 * A literal or lazy attribute (or transient) declaration. A function value is the
 * lazy form and receives the evaluator context; any other value is a literal.
 * @typedef {object} AttributeDeclaration
 * @property {"attribute"} kind - Discriminant.
 * @property {string} name - Attribute name.
 * @property {boolean} isTransient - Whether the value is transient (never assigned/returned).
 * @property {?} value - Literal value or lazy `(context) => value` function.
 */

/**
 * A lifecycle callback declaration. The same declaration object reached through
 * multiple trait paths runs once per record (dedup is by object identity).
 * @typedef {object} CallbackDeclaration
 * @property {"callback"} kind - Discriminant.
 * @property {string} event - One of the supported callback events.
 * @property {(args: {record: ?, context: ?, strategy: string}) => (void | Promise<void>)} fn - Callback body.
 */

/**
 * A base-trait inclusion declaration (a trait applied by default within a factory
 * or composed inside another trait).
 * @typedef {object} TraitIncludeDeclaration
 * @property {"traitInclude"} kind - Discriminant.
 * @property {string} name - Referenced trait name.
 */

/**
 * A custom-constructor declaration.
 * @typedef {object} InitializeWithDeclaration
 * @property {"initializeWith"} kind - Discriminant.
 * @property {(args: {attributes: Record<string, ?>, context: ?, get: (name: string) => ?}) => (? | Promise<?>)} fn - Constructor body.
 */

/**
 * A custom-persistence declaration.
 * @typedef {object} ToCreateDeclaration
 * @property {"toCreate"} kind - Discriminant.
 * @property {(args: {record: ?, context: ?}) => (void | Promise<void>)} fn - Persistence body.
 */

/**
 * A declaration that disables persistence entirely for the create strategy.
 * @typedef {object} SkipCreateDeclaration
 * @property {"skipCreate"} kind - Discriminant.
 */

/**
 * Union of every declaration kind stored on a factory/trait definition. Includes
 * association declarations imported from their own module.
 * @typedef {AttributeDeclaration | CallbackDeclaration | TraitIncludeDeclaration | InitializeWithDeclaration | ToCreateDeclaration | SkipCreateDeclaration | import("./association-declaration.js").default} Declaration
 */

/**
 * Creates a literal/lazy attribute declaration.
 * @param {string} name - Attribute name.
 * @param {?} value - Literal value or lazy function.
 * @param {boolean} isTransient - Whether the declaration is transient.
 * @returns {AttributeDeclaration} - The frozen declaration.
 */
export function attributeDeclaration(name, value, isTransient) {
  return Object.freeze({kind: "attribute", name, isTransient, value})
}

/**
 * Creates a lifecycle callback declaration.
 * @param {string} event - Callback event name.
 * @param {CallbackDeclaration["fn"]} fn - Callback body.
 * @returns {CallbackDeclaration} - The frozen declaration.
 */
export function callbackDeclaration(event, fn) {
  return Object.freeze({kind: "callback", event, fn})
}

/**
 * Creates a base-trait inclusion declaration.
 * @param {string} name - Referenced trait name.
 * @returns {TraitIncludeDeclaration} - The frozen declaration.
 */
export function traitIncludeDeclaration(name) {
  return Object.freeze({kind: "traitInclude", name})
}

/**
 * Creates a custom-constructor declaration.
 * @param {InitializeWithDeclaration["fn"]} fn - Constructor body.
 * @returns {InitializeWithDeclaration} - The frozen declaration.
 */
export function initializeWithDeclaration(fn) {
  return Object.freeze({kind: "initializeWith", fn})
}

/**
 * Creates a custom-persistence declaration.
 * @param {ToCreateDeclaration["fn"]} fn - Persistence body.
 * @returns {ToCreateDeclaration} - The frozen declaration.
 */
export function toCreateDeclaration(fn) {
  return Object.freeze({kind: "toCreate", fn})
}

/**
 * Creates a skip-create declaration.
 * @returns {SkipCreateDeclaration} - The frozen declaration.
 */
export function skipCreateDeclaration() {
  return Object.freeze({kind: "skipCreate"})
}
