import js from "@eslint/js"
import {jsdoc} from 'eslint-plugin-jsdoc'
import globals from "globals"
import { defineConfig } from "eslint/config"

export default defineConfig([
  {
    files: ["**/*.{js,mjs,cjs}"],
    plugins: {js},
    extends: ["js/recommended"],
    languageOptions: {
      globals: {...globals.browser, ...globals.node}
    }
  },
  jsdoc({
    config: "flat/recommended",
    rules: {
      "jsdoc/reject-any-type": "off",
      "jsdoc/reject-function-type": "off",
      "jsdoc/require-jsdoc": "off",
      "jsdoc/require-param": "off",
      "jsdoc/require-param-description": "off",
      "jsdoc/require-returns": "off",
      "jsdoc/require-returns-description": "off"
    }
  }),
  {
    files: ["spec/**/*.js"],
    rules: {
      "no-undef": "off"
    }
  }
])
