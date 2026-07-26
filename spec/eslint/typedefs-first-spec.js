// @ts-check

import { describe, expect, it } from "../../src/testing/test.js"
import { Linter } from "eslint"
import typedefsFirstRule from "../../scripts/eslint-rules/typedefs-first.js"

/**
 * Runs the local typedef declaration-order rule against source text.
 * @param {string} source - JavaScript source.
 * @returns {import("eslint").Linter.LintMessage[]} Lint messages.
 */
function lintSource(source) {
  const linter = new Linter({configType: "flat"})

  return linter.verify(source, lintConfig(), {filename: "example.js"})
}

/**
 * Builds the flat ESLint configuration for the local typedef declaration-order rule.
 * @returns {import("eslint").Linter.Config[]} ESLint flat configuration.
 */
function lintConfig() {
  return [
    {
      files: ["**/*.js"],
      languageOptions: {
        ecmaVersion: "latest",
        sourceType: "module"
      },
      plugins: {
        local: {rules: {"typedefs-first": typedefsFirstRule}}
      },
      rules: {
        "local/typedefs-first": "error"
      }
    }
  ]
}

describe("eslint typedefs-first rule", () => {
  it("allows imports before top-level typedef declarations", () => {
    const messages = lintSource(`
      import value from "./value.js"
      /** @typedef {{name: string}} Options */
      const runtimeValue = value
    `)

    expect(messages).toEqual([])
  })

  it("rejects top-level typedef declarations after runtime declarations", () => {
    const messages = lintSource(`
      const runtimeValue = 1
      /** @typedef {{name: string}} Options */
    `)

    expect(messages.map((message) => message.message)).toEqual([
      "Move top-level JSDoc typedef declarations before runtime declarations."
    ])
  })

  it("allows method-local typedef declarations", () => {
    const messages = lintSource(`
      class Example {
        method() {
          /** @typedef {{name: string}} Options */
          const value = 1
          return value
        }
      }
    `)

    expect(messages).toEqual([])
  })

  it("moves top-level typedef declarations after a shebang", () => {
    const linter = new Linter({configType: "flat"})
    const source = [
      "#!/usr/bin/env node",
      "const runtimeValue = 1",
      "/** @typedef {{name: string}} Options */",
      ""
    ].join("\n")
    const firstFix = linter.verifyAndFix(source, lintConfig(), {filename: "example.js"})

    expect(firstFix.output.startsWith("#!/usr/bin/env node\n")).toBe(true)
    expect(firstFix.output.indexOf("/** @typedef")).toBeGreaterThan("#!/usr/bin/env node\n".length - 1)
    expect(firstFix.output.indexOf("/** @typedef")).toBeLessThan(firstFix.output.indexOf("const runtimeValue"))
    expect(firstFix.messages).toEqual([])

    const secondFix = linter.verifyAndFix(firstFix.output, lintConfig(), {filename: "example.js"})

    expect(secondFix.fixed).toBe(false)
    expect(secondFix.output).toBe(firstFix.output)
    expect(secondFix.messages).toEqual([])
  })
})
