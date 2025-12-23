// @ts-check

/**
 * @typedef {Record<string, any>} ParamsObject
 * @typedef {ParamsObject | any[]} ParamsBranch
 */

export default class ParamsToObject {
  /**
   * @param {Record<string, string>} object
   */
  constructor(object) {
    this.object = object
  }

  /** @returns {ParamsObject} */
  toObject() {
    /** @type {ParamsObject} */
    const result = {}

    for(const key in this.object) {
      const value = this.object[key]

      this.treatInitial(key, value, result)
    }

    return result
  }

  /**
   * @param {string} key
   * @param {string} value
   * @param {ParamsObject} result
   * @returns {void}
   */
  treatInitial(key, value, result) {
    const firstMatch = key.match(/^(.+?)(\[([\s\S]+$))/)

    if (firstMatch) {
      const inputName = firstMatch[1]
      const rest = firstMatch[2]
      const newResult = this._getOrCreateBranch(result, inputName, rest)

      this.treatSecond(value, rest, newResult)
    } else {
      result[key] = value
    }
  }

  /**
   * @param {string} value
   * @param {string} rest
   * @param {ParamsBranch} result
   * @returns {void}
   */
  treatSecond(value, rest, result) {
    const secondMatch = rest.match(/^\[(.*?)\]([\s\S]*)$/)

    if (!secondMatch) throw new Error(`Could not parse rest part: ${rest}`)

    const key = secondMatch[1]
    const newRest = secondMatch[2]

    if (rest == "[]") {
      this._ensureArray(result).push(value)
      return
    }

    if (newRest == "") {
      if (Array.isArray(result)) {
        result[this._coerceArrayIndex(key)] = value
      } else {
        result[key] = value
      }
      return
    }

    const newResult = this._getOrCreateBranch(result, key, newRest)

    this.treatSecond(value, newRest, newResult)
  }

  /**
   * @param {ParamsBranch} branch
   * @param {string} key
   * @param {string} rest
   * @returns {ParamsBranch}
   */
  _getOrCreateBranch(branch, key, rest) {
    if (Array.isArray(branch)) {
      if (key in branch && typeof branch[key] == "object") {
        return /** @type {ParamsBranch} */ (branch[key])
      }

      const newBranch = rest == "[]" ? [] : {}
      branch[key] = newBranch

      return newBranch
    }

    if (key in branch && typeof branch[key] == "object") {
      return /** @type {ParamsBranch} */ (branch[key])
    }

    const newBranch = rest == "[]" ? [] : {}
    branch[key] = newBranch

    return newBranch
  }

  /**
   * @param {ParamsBranch} result
   * @returns {any[]}
   */
  _ensureArray(result) {
    if (!Array.isArray(result)) throw new Error("Expected array when pushing to params result")

    return result
  }

  /**
   * @param {string} key
   * @returns {number | string}
   */
  _coerceArrayIndex(key) {
    const index = Number(key)

    return Number.isNaN(index) ? key : index
  }
}
