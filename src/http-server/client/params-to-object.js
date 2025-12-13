// @ts-check

export default class ParamsToObject {
  /**
   * @param {Record<string, string>} object
   */
  constructor(object) {
    this.object = object
  }

  toObject() {
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
   * @param {Record<string, any> | any[]} result
   */
  treatInitial(key, value, result) {
    const firstMatch = key.match(/^(.+?)(\[([\s\S]+$))/)

    if (firstMatch) {
      const inputName = firstMatch[1]
      const rest = firstMatch[2]

      /** @type {Array<any> | Record<string, any>} */
      let newResult

      if (inputName in result) {
        // @ts-expect-error
        newResult = result[inputName]
      } else if (rest == "[]") {
        newResult = []
        // @ts-expect-error
        result[inputName] = newResult
      } else {
        newResult = {}
        // @ts-expect-error
        result[inputName] = newResult
      }

      this.treatSecond(value, rest, newResult)
    } else {
      // @ts-expect-error
      result[key] = value
    }
  }

  /**
   * @param {string} value
   * @param {string} rest
   * @param {Record<string, any> | any[]} result
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
      // @ts-expect-error
      result[key] = value
    } else {
      if (typeof result == "object" && key in result) {
        // @ts-expect-error
        newResult = result[key]
      } else if (newRest == "[]") {
        newResult = []
        // @ts-expect-error
        result[key] = newResult
      } else {
        newResult = {}
        // @ts-expect-error
        result[key] = newResult
      }

      this.treatSecond(value, newRest, newResult)
    }
  }
}