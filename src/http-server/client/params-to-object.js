// @ts-check

export default class ParamsToObject {
  /**
   * @param {Record<string, any>} object - Object.
   */
  constructor(object) {
    this.object = object
  }

  /** @returns {Record<string, any>} - The object.  */
  toObject() {
    const result = {}

    for(const key in this.object) {
      const value = this.object[key]

      this.treatInitial(key, value, result)
    }

    return result
  }

  /**
   * @param {string} key - Key.
   * @param {any} value - Value to use.
   * @param {Record<string, any> | any[]} result - Result.
   * @returns {void} - No return value.
   */
  treatInitial(key, value, result) {
    const firstMatch = key.match(/^(.+?)(\[([\s\S]+$))/)

    if (firstMatch) {
      const inputName = firstMatch[1]
      const rest = firstMatch[2]

      /** @type {Array<any> | Record<string, any>} */
      let newResult

      if (inputName in result) {
        newResult = result[inputName]
      } else if (rest == "[]") {
        newResult = []
        result[inputName] = newResult
      } else {
        newResult = {}
        result[inputName] = newResult
      }

      this.treatSecond(value, rest, newResult)
    } else {
      result[key] = value
    }
  }

  /**
   * @param {any} value - Value to use.
   * @param {string} rest - Rest.
   * @param {Record<string, any> | any[]} result - Result.
   * @returns {void} - No return value.
   */
  treatSecond(value, rest, result) {
    const secondMatch = rest.match(/^\[(.*?)\]([\s\S]*)$/)

    if (!secondMatch) throw new Error(`Could not parse rest part: ${rest}`)

    const key = secondMatch[1]
    const newRest = secondMatch[2]

    /** @type {Array<any> | Record<string, any>} */
    let newResult

    if (rest == "[]") {
      result.push(value)
    } else if (newRest == "") {
      result[key] = value
    } else {
      if (typeof result == "object" && key in result) {
        newResult = result[key]
      } else if (newRest == "[]") {
        newResult = []
        result[key] = newResult
      } else {
        newResult = {}
        result[key] = newResult
      }

      this.treatSecond(value, newRest, newResult)
    }
  }
}
