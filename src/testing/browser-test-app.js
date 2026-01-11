// @ts-check

import SystemTestBrowserHelper from "system-testing/build/system-test-browser-helper.js"
import BrowserEnvironmentHandler from "../environment-handlers/browser.js"

const root = document.getElementById("root") || (() => {
  const element = document.createElement("div")
  element.id = "root"
  document.body.appendChild(element)
  return element
})()

const systemTestingComponent = document.createElement("div")
systemTestingComponent.setAttribute("data-testid", "systemTestingComponent")
systemTestingComponent.setAttribute("data-focussed", "true")

const blankText = document.createElement("div")
blankText.setAttribute("data-testid", "blankText")
blankText.textContent = "blank"

systemTestingComponent.appendChild(blankText)
root.appendChild(systemTestingComponent)

const systemTestBrowserHelper = new SystemTestBrowserHelper()
systemTestBrowserHelper.enableOnBrowser()

globalThis.velociousBrowserTest = {
  BrowserEnvironmentHandler,
  systemTestBrowserHelper
}
