// @ts-check

import path from "path"
import {pathToFileURL} from "url"
import {describe, expect, it} from "../../src/testing/test.js"
import toImportSpecifier from "../../src/utils/to-import-specifier.js"

describe("toImportSpecifier", () => {
  it("keeps package and relative specifiers unchanged", () => {
    expect(toImportSpecifier("smtp-connection")).toBe("smtp-connection")
    expect(toImportSpecifier("./controller.js")).toBe("./controller.js")
  })

  it("converts POSIX absolute paths to file URLs", () => {
    const filePath = "/tmp/import-specifier.js"

    expect(toImportSpecifier(filePath)).toBe(pathToFileURL(filePath).href)
  })

  it("converts Windows drive-letter paths to file URLs", () => {
    const filePath = "C:\\Users\\Steve\\my folder\\configuration.js"

    expect(toImportSpecifier(filePath)).toBe("file:///C:/Users/Steve/my%20folder/configuration.js")
  })

  it("converts Windows UNC paths to file URLs", () => {
    const filePath = "\\\\server\\share\\jobs\\daily.js"

    expect(toImportSpecifier(filePath)).toBe("file://server/share/jobs/daily.js")
  })

  it("converts absolute paths from path.join on Windows semantics", () => {
    const filePath = path.win32.join("C:\\", "Users", "Steve", "config", "routes.js")

    expect(toImportSpecifier(filePath)).toBe("file:///C:/Users/Steve/config/routes.js")
  })
})
