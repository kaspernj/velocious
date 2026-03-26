declare module "incorporator" {
  export function incorporate<T extends object, U extends object>(target: T, source: U): T & U
}

declare module "sql-escape-string" {
  export default function escapeString(value: string, quoteCharacter?: string | null): string
}

declare module "sql.js" {
  export interface QueryExecResult {
    columns: string[]
    values: unknown[][]
  }

  export class Database {
    constructor(data?: Uint8Array | ArrayLike<number> | null)
    close(): void
    exec(sql: string): QueryExecResult[]
    export(): Uint8Array
  }

  export interface SqlJsStatic {
    Database: typeof Database
  }

  export default function initSqlJs(options?: {locateFile?: (file: string) => string}): Promise<SqlJsStatic>
}

declare module "smtp-connection" {
  export default class SMTPConnection {
    constructor(options?: Record<string, unknown>)
    connect(callback: (error?: Error | null) => void): void
    send(envelope: unknown, message: unknown, callback: (error?: Error | null, info?: unknown) => void): void
    quit(callback: (error?: Error | null) => void): void
  }
}

declare module "is-plain-object" {
  export function isPlainObject(value: unknown): value is Record<string, unknown>
}

declare module "escape-string-regexp" {
  export default function escapeStringRegexp(value: string): string
}
