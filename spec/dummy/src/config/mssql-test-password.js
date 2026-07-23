// @ts-check

import {forcedString} from "typanic"

/**
 * Reads the MSSQL test password from the process environment.
 * @param {NodeJS.ProcessEnv} [environment] - Environment to read.
 * @returns {string} - Configured MSSQL test password.
 */
export default function mssqlTestPassword(environment = process.env) {
  const password = forcedString(environment.MSSQL_SA_PASSWORD, "MSSQL_SA_PASSWORD")

  if (!password.trim()) throw new TypeError("Expected MSSQL_SA_PASSWORD to be a non-blank string")

  return password
}
