// @ts-check

import {describe, expect, it} from "../../src/testing/test.js"
import {Linter} from "eslint"
import jsdocTagLinesPlugin from "eslint-plugin-jsdoc-tag-lines"

/**
 * Runs the local JSDoc tag-line rule against source text.
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
        "jsdoc-tag-lines": jsdocTagLinesPlugin
      },
      rules: {
        "jsdoc-tag-lines/jsdoc-tag-lines": "error"
      }
    }
  ], {filename: "example.js"})
}

describe("eslint jsdoc tag lines rule", () => {
  it("allows standard JSDoc type tags and inline type casts", () => {
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

  it("rejects multi-line JSDoc tag lines without an asterisk prefix", () => {
    const messages = lintSource(`
      /**
       * Model class.
        @type {typeof import("../database/record/index.js").default | undefined} */
      const ModelClass = undefined
    `)

    expect(messages.map((message) => message.message)).toEqual([
      "JSDoc tag lines in multi-line comments must start with `* @tag`."
    ])
  })

  it("rejects inline type casts with prose before the tag", () => {
    const messages = lintSource(`
      const value = /** Narrows the runtime value to the documented type. @type {string} */ ("name")
    `)

    expect(messages.map((message) => message.message)).toEqual([
      "Inline JSDoc type casts must start with `@type`; move prose to a normal comment."
    ])
  })
})
