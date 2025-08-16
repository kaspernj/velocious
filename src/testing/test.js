const tests = {
  args: {},
  subs: {},
  tests: {}
}

let currentPath = [tests]

class Expect {
  constructor(object) {
    this._object = object
  }

  toEqual(result) {
    if (this._object != result) {
      throw new Error(`${this._object} wasn't equal to ${result}`)
    }
  }

  toHaveAttributes(result) {
    const differences = {}

    for (const key in result) {
      const value = result[key]
      const objectValue = this._object[key]()

      if (value != objectValue) {
        differences[key] = [value, objectValue]
      }
    }

    if (Object.keys(differences).length > 0)
    throw new Error(`Object had differet values: ${JSON.stringify(differences)}`)
  }
}

async function describe(description, arg1, arg2) {
  let testArgs, testFunction

  if (typeof arg2 == "function") {
    testFunction = arg2
    testArgs = arg1
  } else if (typeof arg1 == "function") {
    testFunction = arg1
    testArgs = {}
  } else {
    throw new Error(`Invalid arguments for describe: ${arg1}, ${arg2}`)
  }

  const currentTest = currentPath[currentPath.length - 1]
  const newTestArgs = Object.assign({}, currentTest.args, testArgs)

  if (description in currentTest.subs) {
    throw new Error(`Duplicate test description: ${description}`)
  }

  const newTestData = {args: newTestArgs, subs: {}, tests: {}}

  currentTest.subs[description] = newTestData
  currentPath.push(newTestData)

  try {
    await testFunction()
  } finally {
    currentPath.pop()
  }
}

function expect(arg) {
  return new Expect(arg)
}

function it(description, arg1, arg2) {
  const currentTest = currentPath[currentPath.length - 1]
  let testArgs, testFunction

  if (typeof arg1 == "function") {
    testFunction = arg1
    testArgs = {}
  } else if (typeof arg2 == "function") {
    testFunction = arg2
    testArgs = arg1
  } else {
    throw new Error(`Invalid arguments for it: ${description}, ${arg1}`)
  }

  const newTestArgs = Object.assign({}, currentTest.args, testArgs)

  currentTest.tests[description] = {args: newTestArgs, function: testFunction}
}

export {describe, expect, it, tests}
