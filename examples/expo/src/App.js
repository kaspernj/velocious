import React from "react"
import {StyleSheet, Text, View} from "react-native"
import BrowserEnvironmentHandler from "velocious/build/src/environment-handlers/browser.js"
import Configuration from "velocious/build/src/configuration.js"
import FrontendModelBase from "velocious/build/src/frontend-models/base.js"
import SingleMultiUsePool from "velocious/build/src/database/pool/single-multi-use.js"
import SqliteDriver from "velocious/build/src/database/drivers/sqlite/index"
import useCreatedEvent from "velocious/build/src/frontend-models/use-created-event.js"

const configuration = new Configuration({
  database: {
    development: {
      default: {
        driver: SqliteDriver,
        locateFile: (file) => `/${file}`,
        migrations: true,
        name: "velocious-expo-example-development",
        poolType: SingleMultiUsePool,
        type: "sqlite"
      }
    },
    production: {
      default: {
        driver: SqliteDriver,
        locateFile: (file) => `/${file}`,
        migrations: true,
        name: "velocious-expo-example-production",
        poolType: SingleMultiUsePool,
        type: "sqlite"
      }
    }
  },
  environment: "development",
  environmentHandler: new BrowserEnvironmentHandler(),
  locale: () => "en",
  localeFallbacks: {en: ["en"]},
  locales: ["en"]
})

configuration.setCurrent()

FrontendModelBase.configureTransport({
  requestHeaders: () => ({}),
  url: () => "https://example.invalid"
})

class ExpoCompatibilityTask extends FrontendModelBase {
  static resourceConfig() {
    return {
      attributes: {
        id: {type: "integer"},
        name: {type: "string"}
      },
      builtInCollectionCommands: ["index", "create"],
      builtInMemberCommands: ["show", "update", "destroy"],
      modelName: "ExpoCompatibilityTask",
      primaryKey: "id",
      resourcePath: "/frontend-models/expo-compatibility-tasks"
    }
  }
}

FrontendModelBase.registerModel(ExpoCompatibilityTask)

export default function App() {
  const hookStatus = typeof useCreatedEvent === "function" ? "hooks loaded" : "hooks missing"
  const status = `${configuration.getEnvironment()} / ${ExpoCompatibilityTask.getModelName()} / ${hookStatus}`

  return React.createElement(
    View,
    {style: styles.container},
    React.createElement(Text, {style: styles.title}, "Velocious Expo Compatibility"),
    React.createElement(Text, {style: styles.status, testID: "expoCompatibilityStatus"}, status)
  )
}

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    backgroundColor: "#0f172a",
    flex: 1,
    gap: 12,
    justifyContent: "center",
    padding: 24
  },
  status: {
    color: "#bfdbfe",
    fontSize: 16,
    textAlign: "center"
  },
  title: {
    color: "#f8fafc",
    fontSize: 24,
    fontWeight: "700",
    textAlign: "center"
  }
})
