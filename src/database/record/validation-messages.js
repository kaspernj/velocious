// @ts-check

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
export const VALIDATION_MESSAGE_DEFAULTS = {
  blank: "can't be blank",
  greater_than_or_equal_to: "must be greater than or equal to %{count}",
  invalid_boolean: "must be a boolean",
  invalid_datetime: "must be a valid datetime",
  invalid_json: "must be valid JSON",
  invalid_json_value: "must be an object or JSON string",
  invalid_uuid: "must be a valid UUID",
  less_than_or_equal_to: "must be less than or equal to %{count}",
  not_a_number: "is not a number",
  not_an_integer: "must be an integer",
  taken: "has already been taken",
  too_long: "is too long (maximum is %{count} characters)",
  unknown_attribute: "Unknown attribute: %{attribute}."
}

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
export default function validationMessage({translator, type, variables}) {
  const defaultMessage = VALIDATION_MESSAGE_DEFAULTS[type]

  if (!defaultMessage) throw new Error(`Unknown validation message type: ${String(type)}`)

  if (translator) return translator(`velocious.errors.messages.${type}`, {...variables, defaultValue: defaultMessage})

  let message = defaultMessage

  for (const [variableName, variableValue] of Object.entries(variables ?? {})) {
    message = message.replaceAll(`%{${variableName}}`, String(variableValue))
  }

  return message
}
