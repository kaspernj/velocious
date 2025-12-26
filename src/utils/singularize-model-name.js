import * as inflection from "inflection"

/**
 * @param {string} modelName
 * @returns {string} - Result.
 */
export default function singularizeModelName(modelName) {
  const words = inflection.underscore(modelName).split("_")
  const lastWord = words.pop()

  if (!lastWord) throw new Error(`No words? ${words.join(", ")}`)

  const lastSingularizedWord = inflection.singularize(lastWord)
  const singularizedClassName = inflection.camelize(`${words.join("_")}_${lastSingularizedWord}`)

  return singularizedClassName
}
