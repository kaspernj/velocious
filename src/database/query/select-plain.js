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
    const aliasSql = aliasMatch ? aliasMatch[1] : undefined

    this.alias = aliasSql
      ? aliasSql.replace(/^["[`]|["`\]]$/gu, "")
      : undefined
    this.aliasQuoted = Boolean(aliasSql && (
      (aliasSql.startsWith('"') && aliasSql.endsWith('"'))
      || (aliasSql.startsWith("`") && aliasSql.endsWith("`"))
      || (aliasSql.startsWith("[") && aliasSql.endsWith("]"))
    ))
  }

  /**
   * Returns the explicit terminal AS alias parsed at the raw-select boundary.
   * @param {{getType: () => string}} driver - Driver that determines returned identifier spelling.
   * @returns {string | undefined} - Driver-returned terminal AS alias, or undefined when absent.
   */
  getAlias(driver) {
    if (!this.alias) return undefined
    if (!this.aliasQuoted && driver.getType() == "pgsql") return this.alias.toLowerCase()

    return this.alias
  }

  toSql() {
    return this.plain
  }
}
