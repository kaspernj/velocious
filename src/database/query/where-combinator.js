// @ts-check

import WhereBase from "./where-base.js"

export default class VelociousDatabaseQueryWhereCombinator extends WhereBase {
  /**
 * Runs constructor.
   * @param {object} args - Options.
   * @param {"and" | "or"} args.combinator - SQL boolean combinator.
   * @param {import("./index.js").default} args.query - Query instance.
   * @param {import("./where-base.js").default[]} args.wheres - Where clauses to combine.
   */
  constructor({combinator, query, wheres}) {
    super()
    this.combinator = combinator
    this.query = query
    this.wheres = wheres
  }

  /**
 * Documents this API.
 * @returns {string} - SQL string. */
  // fallow-ignore-next-line unused-class-member
  toSql() {
    if (this.wheres.length < 1) return "(1=1)"

    const separator = ` ${this.combinator.toUpperCase()} `

    return `(${this.wheres.map((where) => where.toSql()).join(separator)})`
  }
}
