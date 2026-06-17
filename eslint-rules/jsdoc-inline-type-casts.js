// @ts-check

const typeTagPattern = /^@type\b/

/**
 * ESLint comment shape used by this rule.
 * @typedef {object} SourceComment
 * @property {"Block" | "Line"} type - Comment type.
 * @property {string} value - Comment body without delimiters.
 * @property {[number, number]} range - Comment source range.
 * @property {{start: {line: number, column: number}, end: {line: number, column: number}}} loc - Comment location.
 */

/**
 * Removes the leading JSDoc asterisk from a comment line.
 * @param {string} line - Raw comment value line.
 * @returns {string} Comment line without the leading asterisk.
 */
function lineAfterJSDocPrefix(line) {
  return line.replace(/^\s*\*/, "").trim()
}

/**
 * Finds the inline `@type` tag text from a JSDoc comment.
 * @param {SourceComment} comment - JSDoc comment.
 * @returns {string | undefined} Inline type tag text.
 */
function inlineTypeTag(comment) {
  for (const line of comment.value.split("\n")) {
    const text = lineAfterJSDocPrefix(line)

    if (typeTagPattern.test(text)) return text
  }
}

/**
 * @param {import("eslint").SourceCode} sourceCode - ESLint source code object.
 * @param {SourceComment} comment - Comment node.
 * @returns {boolean} Whether the comment is embedded in an expression or parameter list.
 */
function isInlineTypeComment(sourceCode, comment) {
  const previousToken = sourceCode.getTokenBefore(comment, {includeComments: false})
  const nextToken = sourceCode.getTokenAfter(comment, {includeComments: false})

  return Boolean(
    (previousToken && previousToken.loc.end.line === comment.loc.start.line) ||
      (nextToken && nextToken.loc.start.line === comment.loc.end.line)
  )
}

/**
 * @param {import("eslint").Rule.RuleContext} context - ESLint rule context.
 * @param {SourceComment} comment - Comment node.
 * @param {string} typeTag - Inline type tag text.
 * @returns {void}
 */
function reportInlineTypeCast(context, comment, typeTag) {
  context.report({
    loc: comment.loc,
    messageId: "multilineInlineTypeCast",
    fix: (fixer) => fixer.replaceTextRange(comment.range, `/** ${typeTag} */`)
  })
}

export default {
  meta: {
    type: "layout",
    docs: {
      description: "Require inline JSDoc type casts to stay on one line."
    },
    fixable: "code",
    schema: [],
    messages: {
      multilineInlineTypeCast: "Inline JSDoc @type comments must stay on one line; move complex casts to a named local."
    }
  },

  /**
   * @param {import("eslint").Rule.RuleContext} context - ESLint rule context.
   * @returns {import("eslint").Rule.RuleListener} Rule listener.
   */
  create(context) {
    const sourceCode = context.sourceCode || context.getSourceCode()

    return {
      Program() {
        for (const comment of sourceCode.getAllComments()) {
          if (comment.type !== "Block") continue
          if (!comment.value.startsWith("*")) continue
          if (comment.loc.start.line === comment.loc.end.line) continue
          if (!isInlineTypeComment(sourceCode, comment)) continue

          const typeTag = inlineTypeTag(/** @type {SourceComment} */ (comment))

          if (!typeTag) continue

          reportInlineTypeCast(context, /** @type {SourceComment} */ (comment), typeTag)
        }
      }
    }
  }
}
