import React from "react"

import BrowserCli from "./browser-cli.js"
import restArgsError from "../utils/rest-args-error.js"

/** @type {{browserCli?: BrowserCli}} */
const shared = {}

/**
 * @param {object} args - Options object.
 * @param {import("../configuration.js").default} args.configuration - Configuration instance.
 * @returns {BrowserCli} browserCli
 */
export default function velociousUseBrowserCli({configuration, ...restArgs}) {
  const browserCli = React.useMemo(() => {
    if (!shared.browserCli) {
      shared.browserCli = new BrowserCli({configuration})
      shared.browserCli.enable()
    }

    return shared.browserCli
  }, [configuration])

  restArgsError(restArgs)

  return browserCli
}
