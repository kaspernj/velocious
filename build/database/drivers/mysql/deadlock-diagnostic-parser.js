// @ts-check

/**
 * InnodbDeadlockLockNode type.
 * @typedef {object} InnodbDeadlockLockNode
 * @property {string} indexFingerprint - Opaque index identity.
 * @property {string} lockMode - Allowlisted lock mode.
 * @property {"conflicting" | "held" | "waiting"} state - Lock relationship to its transaction.
 * @property {string} tableFingerprint - Opaque table identity.
 */

/**
 * InnodbDeadlockTransactionNode type.
 * @typedef {object} InnodbDeadlockTransactionNode
 * @property {InnodbDeadlockLockNode[]} conflictingLocks - Bounded counterparty conflict edges whose owner is unavailable.
 * @property {InnodbDeadlockLockNode[]} locks - Bounded locks owned or awaited by this transaction.
 * @property {number} ordinal - Report-local transaction ordinal.
 */

/**
 * InnodbDeadlockParserState type.
 * @typedef {object} InnodbDeadlockParserState
 * @property {InnodbDeadlockTransactionNode | undefined} currentTransaction - Current bounded transaction node.
 * @property {"conflicting" | "held" | "waiting" | undefined} currentLockState - Current lock section state.
 * @property {number} lockRecordCount - Total emitted lock nodes.
 * @property {boolean} lockRecordsTruncated - Whether a lock-node bound was reached.
 * @property {InnodbDeadlockTransactionNode[]} transactionNodes - Bounded transaction nodes.
 * @property {boolean} transactionNodesTruncated - Whether the transaction-node bound was reached.
 * @property {number} transactions - Transaction headers observed in the bounded section.
 * @property {number | null} victimTransaction - Victim ordinal.
 */

import sha256Hex from "../../../utils/sha256-hex.js"

const INNODB_STATUS_SCAN_MAX_CHARS = 65536
const INNODB_DEADLOCK_SECTION_MAX_CHARS = 16384
const INNODB_DEADLOCK_TRANSACTION_MAX = 8
const INNODB_DEADLOCK_LOCKS_PER_TRANSACTION_MAX = 8
const INNODB_DEADLOCK_LOCK_RECORD_MAX = 32
const INNODB_DEADLOCK_LINE_MAX_CHARS = 1024

/**
 * Parses a bounded InnoDB latest-deadlock section into safe structural context.
 * @param {string} status - SHOW ENGINE INNODB STATUS text.
 * @returns {{lockRecordsTruncated: boolean, sectionTruncated: boolean, transactionNodes: InnodbDeadlockTransactionNode[], transactionNodesTruncated: boolean, transactions: number, victimTransaction: number | null}} - Structural deadlock summary.
 */
export default function parseInnodbDeadlockSummary(status) {
  const {candidate, sectionTruncated} = boundedDeadlockSection(status)
  /** @type {InnodbDeadlockParserState} */
  const state = {
    currentTransaction: undefined,
    currentLockState: undefined,
    lockRecordCount: 0,
    lockRecordsTruncated: false,
    transactionNodes: [],
    transactionNodesTruncated: false,
    transactions: 0,
    victimTransaction: null
  }

  for (const line of candidate.split(/\r?\n/)) {
    const trimmed = line.slice(0, INNODB_DEADLOCK_LINE_MAX_CHARS).trim()
    const transactionOrdinal = transactionHeaderOrdinal(trimmed)

    if (transactionOrdinal !== undefined) {
      startTransactionNode(state, transactionOrdinal)
      continue
    }

    const lockStateMarker = transactionLockStateMarker(trimmed, state.currentTransaction)

    if (lockStateMarker.matched) {
      state.currentLockState = lockStateMarker.state
      continue
    }

    const victimOrdinal = victimTransactionOrdinal(trimmed)

    if (victimOrdinal !== undefined) state.victimTransaction = victimOrdinal
    appendLockNode(state, trimmed)
  }

  return {
    lockRecordsTruncated: state.lockRecordsTruncated,
    sectionTruncated,
    transactionNodes: state.transactionNodes,
    transactionNodesTruncated: state.transactionNodesTruncated,
    transactions: state.transactions,
    victimTransaction: state.victimTransaction
  }
}

/**
 * Extracts and caps the latest-deadlock section.
 * @param {string} status - Raw server status.
 * @returns {{candidate: string, sectionTruncated: boolean}} - Bounded candidate and truncation state.
 */
function boundedDeadlockSection(status) {
  const scannedStatus = status.slice(0, INNODB_STATUS_SCAN_MAX_CHARS)
  const deadlockStart = scannedStatus.indexOf("LATEST DETECTED DEADLOCK")
  const availableSection = deadlockStart >= 0 ? scannedStatus.slice(deadlockStart) : ""
  const boundedSection = availableSection.slice(0, INNODB_DEADLOCK_SECTION_MAX_CHARS)
  const sectionEndMatch = /\n-{10,}\r?\nTRANSACTIONS\r?\n-{10,}/.exec(boundedSection)
  const scannedStatusTruncated = status.length > scannedStatus.length

  return {
    candidate: sectionEndMatch ? boundedSection.slice(0, sectionEndMatch.index) : boundedSection,
    sectionTruncated: !sectionEndMatch && deadlockStart >= 0 && (
      availableSection.length > boundedSection.length || scannedStatusTruncated
    )
  }
}

/**
 * Returns a fixed-format transaction header ordinal.
 * @param {string} line - Bounded status line.
 * @returns {number | undefined} - Transaction ordinal.
 */
function transactionHeaderOrdinal(line) {
  const match = /^\*\*\* \((\d{1,6})\) TRANSACTION:$/.exec(line)

  return match ? Number(match[1]) : undefined
}

/**
 * Starts a bounded transaction node.
 * @param {InnodbDeadlockParserState} state - Parser state.
 * @param {number} ordinal - Transaction ordinal.
 * @returns {void}
 */
function startTransactionNode(state, ordinal) {
  state.transactions++
  state.currentLockState = undefined

  if (state.transactionNodes.length >= INNODB_DEADLOCK_TRANSACTION_MAX) {
    state.currentTransaction = undefined
    state.transactionNodesTruncated = true
    return
  }

  state.currentTransaction = {conflictingLocks: [], locks: [], ordinal}
  state.transactionNodes.push(state.currentTransaction)
}

/**
 * Parses a fixed-format held/waiting marker for the current transaction.
 * @param {string} line - Bounded status line.
 * @param {InnodbDeadlockTransactionNode | undefined} currentTransaction - Current transaction.
 * @returns {{matched: boolean, state: "conflicting" | "held" | "waiting" | undefined}} - Marker result.
 */
function transactionLockStateMarker(line, currentTransaction) {
  const numberedMatch = /^\*\*\* \((\d{1,6})\) (HOLDS THE LOCK\(S\)|WAITING FOR THIS LOCK TO BE GRANTED):$/.exec(line)

  if (numberedMatch) {
    if (!currentTransaction || currentTransaction.ordinal != Number(numberedMatch[1])) return {matched: true, state: undefined}

    return {matched: true, state: numberedMatch[2] == "HOLDS THE LOCK(S)" ? "held" : "waiting"}
  }

  const unnumberedMatch = /^\*\*\* (WAITING FOR THIS LOCK TO BE GRANTED|CONFLICTING WITH):$/.exec(line)

  if (!unnumberedMatch) return {matched: false, state: undefined}
  if (!currentTransaction) return {matched: true, state: undefined}

  return {matched: true, state: unnumberedMatch[1] == "CONFLICTING WITH" ? "conflicting" : "waiting"}
}

/**
 * Returns a fixed-format victim ordinal.
 * @param {string} line - Bounded status line.
 * @returns {number | undefined} - Victim ordinal.
 */
function victimTransactionOrdinal(line) {
  const match = /^\*\*\* WE ROLL BACK TRANSACTION \((\d{1,6})\)$/.exec(line)

  return match ? Number(match[1]) : undefined
}

/**
 * Appends one bounded, fixed-format lock node when the line is eligible.
 * @param {InnodbDeadlockParserState} state - Parser state.
 * @param {string} line - Bounded status line.
 * @returns {void}
 */
function appendLockNode(state, line) {
  if (!state.currentTransaction || !state.currentLockState || !line.startsWith("RECORD LOCKS ")) return

  if (
    state.lockRecordCount >= INNODB_DEADLOCK_LOCK_RECORD_MAX ||
    state.currentTransaction.locks.length + state.currentTransaction.conflictingLocks.length >= INNODB_DEADLOCK_LOCKS_PER_TRANSACTION_MAX
  ) {
    state.lockRecordsTruncated = true
    return
  }

  const lock = deadlockLockNode(line, state.currentLockState)

  if (!lock) return

  if (state.currentLockState == "conflicting") {
    state.currentTransaction.conflictingLocks.push(lock)
  } else {
    state.currentTransaction.locks.push(lock)
  }
  state.lockRecordCount++
}

/**
 * Parses one fixed-format RECORD LOCKS line into safe structural fields.
 * @param {string} line - One bounded InnoDB status line.
 * @param {"conflicting" | "held" | "waiting"} state - Lock relationship to its transaction.
 * @returns {InnodbDeadlockLockNode | undefined} - Safe lock node.
 */
function deadlockLockNode(line, state) {
  const identifier = "(?:`(?:``|[^`\\r\\n]){1,128}`|[A-Za-z0-9_$-]{1,128})"
  const tableIdentifier = `(?:${identifier}\\.)?${identifier}`
  const lockMatch = new RegExp(`^RECORD LOCKS .{1,512}? index (${identifier}) of table (${tableIdentifier}) trx id \\S{1,64}(?: \\S{1,64})? lock_mode (X|S|IX|IS|AUTO_INC)(?:\\s|$)`).exec(line)

  if (!lockMatch) return undefined

  return {
    indexFingerprint: `sha256:${sha256Hex(`innodb-index:v1\0${lockMatch[1]}`)}`,
    lockMode: lockMatch[3],
    state,
    tableFingerprint: `sha256:${sha256Hex(`innodb-table:v1\0${lockMatch[2]}`)}`
  }
}
