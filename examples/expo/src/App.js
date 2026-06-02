import React, {useEffect, useState} from "react"
import {StyleSheet, Text, View} from "react-native"

import {configuration, ExpoCompatibilityTask, useCreatedEvent} from "./velocious-runtime"
import runExpoCompatibilityTests from "./expo-compatibility-tests"

function systemTestPort(params) {
  const value = Number(params.get("systemTestClientWsPort") || 1985)

  return Number.isInteger(value) && value > 0 ? value : 1985
}

function systemTestHost(params) {
  const host = params.get("systemTestHost") || window.location.hostname || "localhost"

  return host === "0.0.0.0" ? "127.0.0.1" : host
}

function enableSystemTestingOnWeb() {
  if (typeof window === "undefined") return

  const params = new URLSearchParams(window.location.search)
  if (params.get("systemTest") !== "true") return

  window.__velociousExpoSystemTestWebSocket = new WebSocket(`ws://${systemTestHost(params)}:${systemTestPort(params)}`)
}

enableSystemTestingOnWeb()

export default function App() {
  const [testResult, setTestResult] = useState({details: "waiting", status: "running"})
  const hookStatus = typeof useCreatedEvent === "function" ? "hooks loaded" : "hooks missing"
  const status = `${configuration.getEnvironment()} / ${ExpoCompatibilityTask.getModelName()} / ${hookStatus}`

  useEffect(() => {
    let active = true

    async function runTests() {
      try {
        const details = await runExpoCompatibilityTests()

        if (active) setTestResult({details, status: "passed"})
      } catch (error) {
        const details = error instanceof Error ? error.stack || error.message : String(error)

        if (active) setTestResult({details, status: "failed"})
      }
    }

    runTests()

    return () => {
      active = false
    }
  }, [])

  return React.createElement(
    View,
    {style: styles.container, testID: "systemTestingComponent"},
    React.createElement(Text, {style: styles.title}, "Velocious Expo Compatibility"),
    React.createElement(Text, {style: styles.status, testID: "expoCompatibilityStatus"}, status),
    React.createElement(Text, {style: styles.status, testID: "expoCompatibilityTestStatus"}, testResult.status),
    React.createElement(Text, {style: styles.details, testID: "expoCompatibilityTestDetails"}, testResult.details)
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
  details: {
    color: "#dbeafe",
    fontFamily: "monospace",
    fontSize: 13,
    maxWidth: 720,
    textAlign: "center"
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
