import React from "react"
import BrowserCli from "./browser-cli.js"

const shared = {}

export default function velociousUseBrowserCli() {
  const browserCli = useMemo(async () => {
    if (!shared.browserCli) {
      const commands = commandsFinderBrowser()

      const requireCommand = React.useCallback(async (command) => {
        throw new Error("Not implemented")
      }, [])

      shared.browserCli = new BrowserCli({commands, requireCommand})
      shared.browserCli.enable()
    }

    return shared.browserCli
  })

  return browserCli
}
