// @ts-check

import {describe, expect, it} from "../../src/testing/test.js"
import {Linter} from "eslint"
import jsdocInlineTypeCastsRule from "../../eslint-rules/jsdoc-inline-type-casts.js"

/**
 * Runs the local inline JSDoc type-cast rule against source text.
 * @param {string} source - JavaScript source.
 * @returns {import("eslint").Linter.LintMessage[]} Lint messages.
 */
function lintSource(source) {
  const linter = new Linter({configType: "flat"})

  return linter.verify(source, [
    {
      files: ["**/*.js"],
      languageOptions: {
        ecmaVersion: "latest",
        sourceType: "module"
      },
      plugins: {
        "jsdoc-inline-type-casts": {
          rules: {
            "jsdoc-inline-type-casts": jsdocInlineTypeCastsRule
          }
        }
      },
      rules: {
        "jsdoc-inline-type-casts/jsdoc-inline-type-casts": "error"
      }
    }
  ], {filename: "example.js"})
}

/**
 * Runs the local inline JSDoc type-cast rule with fixes.
 * @param {string} source - JavaScript source.
 * @returns {import("eslint").Linter.FixReport} Fix report.
 */
function fixSource(source) {
  const linter = new Linter({configType: "flat"})

  return linter.verifyAndFix(source, [
    {
      files: ["**/*.js"],
      languageOptions: {
        ecmaVersion: "latest",
        sourceType: "module"
      },
      plugins: {
        "jsdoc-inline-type-casts": {
          rules: {
            "jsdoc-inline-type-casts": jsdocInlineTypeCastsRule
          }
        }
      },
      rules: {
        "jsdoc-inline-type-casts/jsdoc-inline-type-casts": "error"
      }
    }
  ], {filename: "example.js"})
}

describe("eslint jsdoc inline type casts rule", () => {
  it("allows single-line inline type casts and standalone multi-line JSDoc", () => {
    const messages = lintSource(`
      /**
       * Model class.
       * @type {typeof import("../database/record/index.js").default | undefined}
       */
      const ModelClass = undefined

      const value = /** @type {string} */ ("name")
    `)

    expect(messages).toEqual([])
  })

  it("rejects multiline inline type casts", () => {
    const messages = lintSource(`
      const value = /**
                     * Narrows the runtime value to the documented type.
                     * @type {string} */ (input)
    `)

    expect(messages.map((message) => message.message)).toEqual([
      "Inline JSDoc @type comments must stay on one line; move complex casts to a named local."
    ])
  })

  it("rejects multiline inline parameter type comments", () => {
    const messages = lintSource(`
      const callback = (/**
                        * @type {Error} */ error) => error
    `)

    expect(messages.map((message) => message.message)).toEqual([
      "Inline JSDoc @type comments must stay on one line; move complex casts to a named local."
    ])
  })

  it("fixes multiline inline type casts to a single-line cast", () => {
    const report = fixSource(`
      const value = /**
                     * Narrows the runtime value to the documented type.
                     * @type {string} */ (input)
    `)

    expect(report.fixed).toEqual(true)
    expect(report.output).toContain("const value = /** @type {string} */ (input)")
  })
})
