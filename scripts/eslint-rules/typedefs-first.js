/**
 * Reports top-level JSDoc typedef declarations placed after runtime declarations.
 */
export default {
  meta: {
    docs: {
      description: "Require top-level JSDoc typedefs before runtime declarations"
    },
    messages: {
      typedefsFirst: "Move top-level JSDoc typedef declarations before runtime declarations."
    },
    schema: [],
    type: "suggestion",
    fixable: "code"
  },
  create(context) {
    const sourceCode = context.sourceCode

    return {
      "Program:exit"(program) {
        const runtimeDeclarations = program.body.filter((node) => {
          return node.type != "ImportDeclaration"
        })
        const firstRuntimeDeclaration = runtimeDeclarations[0]

        if (!firstRuntimeDeclaration) return

        const misplacedTypedefs = sourceCode.getAllComments().filter((comment) => {
          if (!/@typedef(?:\s|\{)/u.test(comment.value)) return false
          if (comment.range[0] < firstRuntimeDeclaration.range[0]) return false

          return !runtimeDeclarations.some((node) => {
            return node.range[0] < comment.range[0] && node.range[1] > comment.range[1]
          })
        })

        if (misplacedTypedefs.length == 0) return

        context.report({
          loc: misplacedTypedefs[0].loc,
          messageId: "typedefsFirst",
          fix(fixer) {
            const leadingComments = sourceCode.getCommentsBefore(firstRuntimeDeclaration)
            const firstOrdinaryComment = leadingComments.find((comment) => comment.type != "Shebang")
            const insertionPoint = firstOrdinaryComment?.range[0] ?? firstRuntimeDeclaration.range[0]
            const movedComments = misplacedTypedefs.map((comment) => sourceCode.getText(comment)).join("\n")
            const fixes = [fixer.insertTextBeforeRange([insertionPoint, insertionPoint], `${movedComments}\n`)]

            for (const comment of misplacedTypedefs) {
              let removalEnd = comment.range[1]

              if (sourceCode.text[removalEnd] == "\r" && sourceCode.text[removalEnd + 1] == "\n") {
                removalEnd += 2
              } else if (sourceCode.text[removalEnd] == "\n") {
                removalEnd++
              }

              fixes.push(fixer.removeRange([comment.range[0], removalEnd]))
            }

            return fixes
          }
        })
      }
    }
  }
}
