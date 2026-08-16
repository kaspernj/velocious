// @ts-check

import { describe, expect, it } from "../../../../src/testing/test.js"
import { configuration, DiagnosticMysqlDriver, SECRET_SQL } from "../../../helpers/mysql-deadlock-diagnostics-test-helper.js"

describe("Database - drivers - mysql deadlock diagnostic parser", () => {
  it("emits only bounded structural lock-cycle nodes from fixed-format status", async () => {
    const appConfiguration = configuration()
    const driver = new DiagnosticMysqlDriver({deadlockBaseWaitMs: 1, deadlockMaxRetries: 2}, appConfiguration)
    const diagnostics = []
    const diagnosticReported = new Promise((resolve) => appConfiguration.getErrorEvents().once("database-deadlock-retry", resolve))

    driver.status = `LATEST DETECTED DEADLOCK
*** (1) TRANSACTION:
TRANSACTION 998877, ACTIVE 3 sec
UPDATE secret_accounts SET api_key = 'literal-api-secret' WHERE customer_id = 778899
*** (1) HOLDS THE LOCK(S):
RECORD LOCKS space id 7 page no 8 n bits 64 index \`tenant_index_secret\` of table \`private_db\`.\`secret_accounts\` trx id 998877 lock_mode S
*** (1) WAITING FOR THIS LOCK TO BE GRANTED:
RECORD LOCKS space id 7 page no 9 n bits 64 index PRIMARY of table \`private_db\`.\`secret_accounts\` trx id 998877 lock_mode X waiting
Record lock, heap no 7 PHYSICAL RECORD: n_fields 3; compact format
 0: len 16; hex 6c69746572616c2d6170692d736563726574; asc literal-api-secret;;
*** (2) TRANSACTION:
TRANSACTION 112233, ACTIVE 2 sec
DELETE FROM customer_secrets WHERE token = 'second-secret'
*** (2) HOLDS THE LOCK(S):
RECORD LOCKS space id 7 page no 9 n bits 64 index PRIMARY of table \`private_db\`.\`secret_accounts\` trx id 112233 lock_mode X
*** (2) WAITING FOR THIS LOCK TO BE GRANTED:
RECORD LOCKS space id 7 page no 8 n bits 64 index \`tenant_index_secret\` of table \`private_db\`.\`secret_accounts\` trx id 112233 lock_mode S waiting
*** WE ROLL BACK TRANSACTION (2)
------------
TRANSACTIONS
------------
stale raw status must not be scanned`
    driver.setDesiredSessionTimeZone(null)
    appConfiguration.getErrorEvents().on("database-deadlock-retry", (payload) => diagnostics.push(payload))

    await driver.transaction(async () => await driver.query(SECRET_SQL))
    await diagnosticReported

    const summary = diagnostics[0].context.innodbDeadlockSummary

    expect(summary).toMatchObject({transactions: 2, victimTransaction: 2})
    expect(summary.transactionNodes).toMatchObject([
      {conflictingLocks: [], locks: [{lockMode: "S", state: "held"}, {lockMode: "X", state: "waiting"}], ordinal: 1},
      {conflictingLocks: [], locks: [{lockMode: "X", state: "held"}, {lockMode: "S", state: "waiting"}], ordinal: 2}
    ])

    for (const transactionNode of summary.transactionNodes) {
      for (const lock of transactionNode.locks) {
        expect(Object.keys(lock).sort()).toEqual(["indexFingerprint", "lockMode", "state", "tableFingerprint"])
        expect(lock.indexFingerprint).toMatch(/^sha256:[0-9a-f]{64}$/)
        expect(lock.tableFingerprint).toMatch(/^sha256:[0-9a-f]{64}$/)
      }
    }

    const serialized = JSON.stringify(diagnostics[0])

    for (const unsafeValue of [
      "private_db",
      "secret_accounts",
      "tenant_index_secret",
      "UPDATE secret_accounts",
      "literal-api-secret",
      "second-secret",
      "998877",
      "112233",
      "6c69746572616c",
      "PHYSICAL RECORD",
      "stale raw status"
    ]) {
      expect(serialized).not.toContain(unsafeValue)
    }
  })

  it("parses MariaDB unnumbered waiting and conflicting lock sections with bounded transaction IDs", async () => {
    const appConfiguration = configuration()
    const driver = new DiagnosticMysqlDriver({deadlockBaseWaitMs: 1, deadlockMaxRetries: 2}, appConfiguration)
    const diagnostics = []
    const diagnosticReported = new Promise((resolve) => appConfiguration.getErrorEvents().once("database-deadlock-retry", resolve))
    const conflictingLockLines = Array.from({length: 10}, (_, lockIndex) => `RECORD LOCKS space id 7 page no ${9 + lockIndex} n bits 64 index \`maria_conflict_index_${lockIndex}\` of table \`raw_tenant\`.\`raw_orders\` trx id ${700000 + lockIndex} lock_mode S`).join("\n")

    driver.status = `LATEST DETECTED DEADLOCK
*** (1) TRANSACTION:
TRANSACTION 991122, ACTIVE 2 sec
UPDATE maria_secret_orders SET token = 'maria-secret-literal'
*** WAITING FOR THIS LOCK TO BE GRANTED:
RECORD LOCKS space id 7 page no 8 n bits 64 index \`maria_wait_index\` of table \`raw_tenant\`.\`raw_orders\` trx id 991122 334455 lock_mode X waiting
*** CONFLICTING WITH:
${conflictingLockLines}
*** (2) TRANSACTION:
TRANSACTION 556677, ACTIVE 1 sec
DELETE FROM maria_secret_orders WHERE token = 'other-secret-literal'
*** WE ROLL BACK TRANSACTION (2)`
    driver.setDesiredSessionTimeZone(null)
    appConfiguration.getErrorEvents().on("database-deadlock-retry", (payload) => diagnostics.push(payload))

    await driver.transaction(async () => await driver.query(SECRET_SQL))
    await diagnosticReported

    const summary = diagnostics[0].context.innodbDeadlockSummary

    expect(summary).toMatchObject({lockRecordsTruncated: true, transactions: 2, victimTransaction: 2})
    expect(summary.transactionNodes).toMatchObject([
      {
        conflictingLocks: Array.from({length: 7}, () => ({lockMode: "S", state: "conflicting"})),
        locks: [{lockMode: "X", state: "waiting"}],
        ordinal: 1
      },
      {conflictingLocks: [], locks: [], ordinal: 2}
    ])
    expect(summary.transactionNodes[0].locks.some((lock) => lock.state == "held")).toBeFalse()

    for (const conflict of summary.transactionNodes[0].conflictingLocks) {
      expect(Object.keys(conflict).sort()).toEqual(["indexFingerprint", "lockMode", "state", "tableFingerprint"])
      expect(conflict.indexFingerprint).toMatch(/^sha256:[0-9a-f]{64}$/)
      expect(conflict.tableFingerprint).toMatch(/^sha256:[0-9a-f]{64}$/)
    }

    const serialized = JSON.stringify(diagnostics[0])

    for (const unsafeValue of [
      "maria_wait_index",
      "maria_conflict_index",
      "raw_tenant",
      "raw_orders",
      "maria_secret_orders",
      "maria-secret-literal",
      "other-secret-literal",
      "991122",
      "334455",
      "556677",
      "700000"
    ]) {
      expect(serialized).not.toContain(unsafeValue)
    }
  })

  it("bounds oversized and malformed status without masking the retry", async () => {
    const oversizedTransactions = Array.from({length: 40}, (_, transactionIndex) => `*** (${transactionIndex + 1}) TRANSACTION:
*** (${transactionIndex + 1}) WAITING FOR THIS LOCK TO BE GRANTED:
${Array.from({length: 10}, (_, lockIndex) => `RECORD LOCKS space id 7 page no 8 n bits 64 index \`sensitive_index_${transactionIndex}_${lockIndex}\` of table \`secret_db\`.\`sensitive_table_${transactionIndex}\` trx id ${900000 + transactionIndex} lock_mode X waiting`).join("\n")}`).join("\n")

    for (const [status, structurallyOversized] of [
      [`LATEST DETECTED DEADLOCK\n${oversizedTransactions}`, true],
      [`malformed password=oversized-secret\n${"x".repeat(70000)}`, false]
    ]) {
      const appConfiguration = configuration()
      const driver = new DiagnosticMysqlDriver({deadlockBaseWaitMs: 1, deadlockMaxRetries: 2}, appConfiguration)
      const diagnostics = []
      const diagnosticReported = new Promise((resolve) => appConfiguration.getErrorEvents().once("database-deadlock-retry", resolve))

      driver.status = status
      driver.setDesiredSessionTimeZone(null)
      appConfiguration.getErrorEvents().on("database-deadlock-retry", (payload) => diagnostics.push(payload))

      await driver.transaction(async () => await driver.query(SECRET_SQL))
      await diagnosticReported

      expect(driver.attempts).toEqual(2)
      expect(JSON.stringify(diagnostics[0]).length < 12000).toBeTrue()
      expect(JSON.stringify(diagnostics[0])).not.toContain("oversized-secret")
      expect(JSON.stringify(diagnostics[0])).not.toContain("sensitive_table")

      if (structurallyOversized) {
        const summary = diagnostics[0].context.innodbDeadlockSummary
        const emittedLockCount = summary.transactionNodes.reduce((count, transactionNode) => count + transactionNode.locks.length, 0)

        expect(summary.transactionNodes.length).toEqual(8)
        expect(emittedLockCount).toEqual(32)
        expect(summary.lockRecordsTruncated).toBeTrue()
        expect(summary.sectionTruncated).toBeTrue()
        expect(summary.transactionNodesTruncated).toBeTrue()
      }
    }
  })
})
