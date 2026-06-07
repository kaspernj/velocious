/**
 * @param {Promise<unknown>} promise - Promise expected to reject.
 * @param {string} expectedMessage - Expected error message.
 * @returns {Promise<void>} - Resolves when the expected rejection is observed.
 */
export async function expectRejectsWithMessage(promise, expectedMessage) {
  const error = await promise.then(
    () => undefined,
    (caughtError) => caughtError
  )

  expect(error.message).toEqual(expectedMessage)
}

/**
 * @param {{instances: Array<{connected: boolean, closed: boolean}>}} FakeDriver - Fake driver class.
 * @returns {void}
 */
export function expectSingleFakeDriverClosed(FakeDriver) {
  expect(FakeDriver.instances.length).toEqual(1)
  expect(FakeDriver.instances[0].connected).toBe(true)
  expect(FakeDriver.instances[0].closed).toBe(true)
}
