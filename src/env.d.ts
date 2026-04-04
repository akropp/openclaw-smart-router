// Ambient type declarations for runtime dependencies not installed locally.
// These are provided by the OpenClaw gateway runtime.

declare module 'better-sqlite3' {
  export interface RunResult {
    changes: number;
    lastInsertRowid: number | bigint;
  }

  export interface Statement<T = unknown> {
    run(...params: unknown[]): RunResult;
    get(...params: unknown[]): T | undefined;
    all(...params: unknown[]): T[];
    iterate(...params: unknown[]): IterableIterator<T>;
    readonly source: string;
    readonly reader: boolean;
  }

  export interface Database {
    prepare<T = unknown>(sql: string): Statement<T>;
    exec(sql: string): this;
    pragma(pragma: string, options?: { simple?: boolean }): unknown;
    transaction<T>(fn: (...args: unknown[]) => T): (...args: unknown[]) => T;
    close(): void;
    readonly open: boolean;
  }

  export interface Options {
    readonly?: boolean;
    fileMustExist?: boolean;
    timeout?: number;
    verbose?: ((message?: unknown) => void) | null;
  }

  export interface DatabaseConstructor {
    new(filename: string, options?: Options): Database;
  }

  const BetterSqlite3: DatabaseConstructor;
  export default BetterSqlite3;
}

// No SDK module declarations needed — we use the plain register(api) pattern.
