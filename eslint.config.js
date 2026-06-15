import js from "@eslint/js"
import {jsdoc} from 'eslint-plugin-jsdoc'
import globals from "globals"
import {defineConfig} from "eslint/config"
import jsdocTagLines from "./scripts/eslint-rules/jsdoc-tag-lines.js"

const localPlugin = {
  rules: {
    "jsdoc-tag-lines": jsdocTagLines
  }
}

export default defineConfig([
  {
    name: "global ignores",
    ignores: ["build/**", "dist/**", "examples/expo/.expo/**", "examples/expo/dist/**"],
  },
  {
    files: ["**/*.{js,mjs,cjs}"],
    plugins: {js},
    extends: ["js/recommended"],
    languageOptions: {
      globals: {...globals.browser, ...globals.node}
    },
    rules: {
      "no-unused-vars": ["error", {argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_"}]
    }
  },
  {
    files: ["src/**/*.js"],
    plugins: {
      velocious: localPlugin
    },
    rules: {
      "velocious/jsdoc-tag-lines": "error"
    }
  },
  jsdoc({
    config: "flat/recommended",
    files: ["src/**/*.js"],
    rules: {
      "jsdoc/no-multi-asterisks": "off",
      "jsdoc/require-description": "error",
      "jsdoc/reject-any-type": "error"
    }
  }),
  {
    files: [
      "src/frontend-models/use-model-class-event.js",
      "src/frontend-models/use-created-event.js",
      "src/frontend-models/use-updated-event.js",
      "src/frontend-models/use-destroyed-event.js",
      "src/frontend-models/websocket-channel.js",
      "src/http-server/websocket-channel.js",
      "src/testing/browser-frontend-model-event-hook-scenarios.js"
    ],
    settings: {
      jsdoc: {
        preferredTypes: {
          unknown: false
        }
      }
    },
    rules: {
      "jsdoc/check-types": "error",
      "jsdoc/reject-any-type": "error"
    }
  },
  {
    files: ["spec/**/*.js"],
    rules: {
      "no-undef": "off"
    }
  }
])
