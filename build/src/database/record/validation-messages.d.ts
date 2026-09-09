export type ValidationMessageTranslator = (msgID: string, args?: Record<string, string | number> & {
    defaultValue?: string;
}) => string;
/**
 * Translates a validation message ID into a localized message.
 * @callback ValidationMessageTranslator
 * @param {string} msgID - Stable message ID (e.g. "velocious.errors.messages.blank").
 * @param {Record<string, string | number> & {defaultValue?: string}} [args] - Interpolation variables plus the English default message.
 * @returns {string} Localized message.
 */
/**
 * English default validation message predicates keyed by message type,
 * matching Rails' `errors.messages.*` where an equivalent exists. Values may
 * contain `%{variable}` placeholders.
 * @type {Record<string, string>}
 */
export declare const VALIDATION_MESSAGE_DEFAULTS: Record<string, string>;
/**
 * Builds a validation message predicate through the framework's translation
 * layer. The message is looked up under `velocious.errors.messages.<type>`
 * with the English default as fallback; `%{variable}` placeholders are
 * interpolated from the given variables. Without a translator the English
 * default is interpolated directly.
 * @param {object} args - Options.
 * @param {ValidationMessageTranslator | null} [args.translator] - Translator resolving message IDs (usually `configuration.getTranslator()`).
 * @param {string} args.type - Message type key in {@link VALIDATION_MESSAGE_DEFAULTS}.
 * @param {Record<string, string | number>} [args.variables] - Interpolation variables.
 * @returns {string} Localized message predicate.
 */
export default function validationMessage({ translator, type, variables }: {
    translator?: ValidationMessageTranslator | null;
    type: string;
    variables?: Record<string, string | number>;
}): string;
//# sourceMappingURL=validation-messages.d.ts.map