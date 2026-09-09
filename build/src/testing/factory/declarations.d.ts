export type AttributeDeclaration = {
    /**
     * - Discriminant.
     */
    kind: "attribute";
    /**
     * - Attribute name.
     */
    name: string;
    /**
     * - Whether the value is transient (never assigned/returned).
     */
    isTransient: boolean;
    /**
     * - Literal value or lazy `(context) => value` function.
     */
    value: ReturnType<typeof JSON.parse>;
};
export type CallbackDeclaration = {
    /**
     * - Discriminant.
     */
    kind: "callback";
    /**
     * - One of the supported callback events.
     */
    event: string;
    /**
     * - Callback body.
     */
    fn: (args: {
        record: ReturnType<typeof JSON.parse>;
        context: ReturnType<typeof JSON.parse>;
        strategy: string;
    }) => (void | Promise<void>);
};
export type TraitIncludeDeclaration = {
    /**
     * - Discriminant.
     */
    kind: "traitInclude";
    /**
     * - Referenced trait name.
     */
    name: string;
};
export type InitializeWithDeclaration = {
    /**
     * - Discriminant.
     */
    kind: "initializeWith";
    /**
     * - Constructor body.
     */
    fn: (args: {
        attributes: Record<string, ReturnType<typeof JSON.parse>>;
        context: ReturnType<typeof JSON.parse>;
        get: (name: string) => ReturnType<typeof JSON.parse>;
    }) => (ReturnType<typeof JSON.parse> | Promise<ReturnType<typeof JSON.parse>>);
};
export type ToCreateDeclaration = {
    /**
     * - Discriminant.
     */
    kind: "toCreate";
    /**
     * - Persistence body.
     */
    fn: (args: {
        record: ReturnType<typeof JSON.parse>;
        context: ReturnType<typeof JSON.parse>;
    }) => (void | Promise<void>);
};
export type SkipCreateDeclaration = {
    /**
     * - Discriminant.
     */
    kind: "skipCreate";
};
export type Declaration = AttributeDeclaration | CallbackDeclaration | TraitIncludeDeclaration | InitializeWithDeclaration | ToCreateDeclaration | SkipCreateDeclaration | import("./association-declaration.js").default;
/**
 * A literal or lazy attribute (or transient) declaration. A function value is the
 * lazy form and receives the evaluator context; any other value is a literal.
 * @typedef {object} AttributeDeclaration
 * @property {"attribute"} kind - Discriminant.
 * @property {string} name - Attribute name.
 * @property {boolean} isTransient - Whether the value is transient (never assigned/returned).
 * @property {ReturnType<typeof JSON.parse>} value - Literal value or lazy `(context) => value` function.
 */
/**
 * A lifecycle callback declaration. The same declaration object reached through
 * multiple trait paths runs once per record (dedup is by object identity).
 * @typedef {object} CallbackDeclaration
 * @property {"callback"} kind - Discriminant.
 * @property {string} event - One of the supported callback events.
 * @property {(args: {record: ReturnType<typeof JSON.parse>, context: ReturnType<typeof JSON.parse>, strategy: string}) => (void | Promise<void>)} fn - Callback body.
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
 * @property {(args: {attributes: Record<string, ReturnType<typeof JSON.parse>>, context: ReturnType<typeof JSON.parse>, get: (name: string) => ReturnType<typeof JSON.parse>}) => (ReturnType<typeof JSON.parse> | Promise<ReturnType<typeof JSON.parse>>)} fn - Constructor body.
 */
/**
 * A custom-persistence declaration.
 * @typedef {object} ToCreateDeclaration
 * @property {"toCreate"} kind - Discriminant.
 * @property {(args: {record: ReturnType<typeof JSON.parse>, context: ReturnType<typeof JSON.parse>}) => (void | Promise<void>)} fn - Persistence body.
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
 * @param {ReturnType<typeof JSON.parse>} value - Literal value or lazy function.
 * @param {boolean} isTransient - Whether the declaration is transient.
 * @returns {AttributeDeclaration} - The frozen declaration.
 */
export declare function attributeDeclaration(name: string, value: ReturnType<typeof JSON.parse>, isTransient: boolean): AttributeDeclaration;
/**
 * Creates a lifecycle callback declaration.
 * @param {string} event - Callback event name.
 * @param {CallbackDeclaration["fn"]} fn - Callback body.
 * @returns {CallbackDeclaration} - The frozen declaration.
 */
export declare function callbackDeclaration(event: string, fn: CallbackDeclaration["fn"]): CallbackDeclaration;
/**
 * Creates a base-trait inclusion declaration.
 * @param {string} name - Referenced trait name.
 * @returns {TraitIncludeDeclaration} - The frozen declaration.
 */
export declare function traitIncludeDeclaration(name: string): TraitIncludeDeclaration;
/**
 * Creates a custom-constructor declaration.
 * @param {InitializeWithDeclaration["fn"]} fn - Constructor body.
 * @returns {InitializeWithDeclaration} - The frozen declaration.
 */
export declare function initializeWithDeclaration(fn: InitializeWithDeclaration["fn"]): InitializeWithDeclaration;
/**
 * Creates a custom-persistence declaration.
 * @param {ToCreateDeclaration["fn"]} fn - Persistence body.
 * @returns {ToCreateDeclaration} - The frozen declaration.
 */
export declare function toCreateDeclaration(fn: ToCreateDeclaration["fn"]): ToCreateDeclaration;
/**
 * Creates a skip-create declaration.
 * @returns {SkipCreateDeclaration} - The frozen declaration.
 */
export declare function skipCreateDeclaration(): SkipCreateDeclaration;
//# sourceMappingURL=declarations.d.ts.map