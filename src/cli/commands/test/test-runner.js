export default class TestRunner {
  constructor(testFiles) {
    this.testFiles = testFiles
  }

  async importTestFiles() {
    for (const testFile of this.testFiles) {
      const importTestFile = await import(testFile)
    }
  }

  async run() {
    await this.importTestFiles()

    console.log({foundTestFiles: this.testFiles})

    throw new Error("stub")
  }
}
