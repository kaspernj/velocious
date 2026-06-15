// @ts-check

const jsdocTagPattern = /^@[A-Za-z]/
const proseBeforeTypePattern = /\s@type\b/
const typeTagPattern = /^@type\b/

/**
 * ESLint comment shape used by this rule.
 * @typedef {object} SourceComment
 * @property {"Block" | "Line"} type - Comment type.
 * @property {string} value - Comment body without delimiters.
 * @property {{start: {line: number, column: number}, end: {line: number, column: number}}} loc - Comment location.
 */

/**
 * Removes the leading JSDoc asterisk from a comment line.
 * @param {string} line - Raw comment value line.
 * @returns {string} Comment line without the leading asterisk.
 */
function lineAfterJSDocPrefix(line) {
  return line.replace(/^\s*\*/, "").trimStart()
}

/**
 * @param {import("eslint").Rule.RuleContext} context - ESLint rule context.
 * @param {SourceComment} comment - Comment node.
 * @param {number} index - Comment value line index.
 * @param {string} messageId - Message id.
 * @returns {void}
 */
function reportCommentLine(context, comment, index, messageId) {
  const line = comment.value.split("\n")[index]
  const firstNonWhitespaceColumn = Math.max(line.search(/\S/), 0)

  context.report({
    loc: {
      start: {
        line: comment.loc.start.line + index,
        column: firstNonWhitespaceColumn
      },
      end: {
        line: comment.loc.start.line + index,
        column: line.length
      }
    },
    messageId
  })
}

export default {
  meta: {
    type: "layout",
    docs: {
      description: "Require JSDoc tag lines to keep their leading asterisk and keep inline type casts tag-only."
    },
    schema: [],
    messages: {
      missingAsterisk: "JSDoc tag lines in multi-line comments must start with `* @tag`.",
      proseBeforeType: "Inline JSDoc type casts must start with `@type`; move prose to a normal comment."
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
          if (comment.type !== "Block" || !comment.value.startsWith("*")) continue

          const lines = comment.value.split("\n")
          const multiline = lines.length > 1

          lines.forEach((line, index) => {
            const trimmedLine = line.trimStart()

            if (multiline && jsdocTagPattern.test(trimmedLine)) {
              reportCommentLine(context, comment, index, "missingAsterisk")
              return
            }

            const text = lineAfterJSDocPrefix(line)

            if (proseBeforeTypePattern.test(text) && !typeTagPattern.test(text)) {
              reportCommentLine(context, comment, index, "proseBeforeType")
            }
          })
        }
      }
    }
  }
}
