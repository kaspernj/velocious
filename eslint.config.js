import js from "@eslint/js"
import {jsdoc} from 'eslint-plugin-jsdoc'
import jsdocTagLinesPlugin from "eslint-plugin-jsdoc-tag-lines"
import globals from "globals"
import {defineConfig} from "eslint/config"

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
      "jsdoc-tag-lines": jsdocTagLinesPlugin
    },
    rules: {
      "jsdoc-tag-lines/jsdoc-tag-lines": "error"
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
    // Scoped exception to the repo-wide no-`any` policy. The frontend-model base
    // type definitions deliberately default their attribute/model generic params
    // to `any`: a generated subclass declares typed-attribute generics
    // (`FrontendModelBase<XAttributes, ...>`) and, by TypeScript invariance, only
    // an `any` default lets such a subclass satisfy the bare
    // `FrontendModelClass`/`FrontendModelBase` constraints used across the static
    // query and relationship helpers (`unknown`/`object` do not). The methods'
    // own `@template T` still captures the precise calling subclass for returns,
    // so accessor precision is preserved. Kept to this one foundational file.
    files: ["src/frontend-models/base.js"],
    rules: {
      "jsdoc/reject-any-type": "off"
    }
  },
  {
    files: ["spec/**/*.js"],
    rules: {
      "no-undef": "off"
    }
  }
])
