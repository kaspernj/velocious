// @ts-check

import SelectBase from "./select-base.js"

export default class VelociousDatabaseQuerySelectPlain extends SelectBase {
  /**
   * Runs constructor.
   * @param {string} plain - Plain.
   */
  constructor(plain) {
    super()
    this.plain = plain

    const aliasMatch = plain.match(/\sAS\s+([^\s]+)\s*$/iu)

    this.alias = aliasMatch
      ? aliasMatch[1].replace(/^["[`]|["`\]]$/gu, "")
      : undefined
  }

  /**
   * Returns the explicit terminal AS alias parsed at the raw-select boundary.
   * @returns {string | undefined} - Explicit terminal AS alias, or undefined when absent.
   */
  getAlias() { return this.alias }

  toSql() {
    return this.plain
  }
}
