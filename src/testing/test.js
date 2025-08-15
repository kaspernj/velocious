const tests = {
  args: {},
  subs: {},
  tests: {}
}

let currentPath = [tests]

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
  throw new Error("expect stub")
}

function it(description, arg1, args) {
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
