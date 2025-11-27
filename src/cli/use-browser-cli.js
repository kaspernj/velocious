import React from "react"
import BrowserCli from "./browser-cli.js"
import VelociousEnvironmentsHandlerBrowser from "../environment-handlers/browser.js"
import restArgsError from "../utils/rest-args-error.js"

const shared = {}

export default function velociousUseBrowserCli({migrationsRequireContextCallback, ...restArgs}) {
  const browserCli = React.useMemo(async () => {
    if (!shared.browserCli) {
      const environmentHandler = new VelociousEnvironmentsHandlerBrowser({migrationsRequireContextCallback})

      shared.browserCli = new BrowserCli({environmentHandler})
      shared.browserCli.enable()
    }

    return shared.browserCli
  })

  restArgsError(restArgs)

  return browserCli
}
