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
  import {EventEmitter} from "node:events"

  export interface SMTPConnectionAuth {
    [key: string]: unknown
  }

  export interface SMTPConnectionOptions {
    auth?: SMTPConnectionAuth
    [key: string]: unknown
  }

  export default class SMTPConnection extends EventEmitter {
    constructor(options?: SMTPConnectionOptions)
    close(): void
    connect(callback: () => void): void
    login(authData: SMTPConnectionAuth, callback: (error?: Error | null) => void): void
    send(envelope: unknown, message: unknown, callback: (error?: Error | null, info?: unknown) => void): void
    quit(): void
  }
}

declare module "is-plain-object" {
  export function isPlainObject(value: unknown): value is Record<string, unknown>
}

declare module "escape-string-regexp" {
  export default function escapeStringRegexp(value: string): string
}

declare module "require-context" {
  export interface RequireContext<TModule = {default?: unknown}> {
    (id: string): TModule
    keys(): string[]
  }

  export default function requireContext<TModule = {default?: unknown}>(
    directory: string,
    useSubdirectories?: boolean,
    regExp?: RegExp
  ): RequireContext<TModule>
}
