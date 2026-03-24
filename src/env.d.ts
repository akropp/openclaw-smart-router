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

// OpenClaw plugin SDK — types are resolved from the gateway's node_modules at runtime.
// When developing outside the gateway tree, TypeScript needs these ambient declarations.
declare module 'openclaw/plugin-sdk/plugin-entry' {
  export interface PluginEntryDefinition {
    id: string;
    name: string;
    description: string;
    configSchema?: unknown;
    register(api: PluginRegistrationApi): void;
  }

  export interface PluginRegistrationApi {
    pluginConfig: unknown;
    config: unknown;
    logger: {
      info(...args: unknown[]): void;
      warn(...args: unknown[]): void;
      error(...args: unknown[]): void;
      debug(...args: unknown[]): void;
    };
    registerHook(
      events: string | string[],
      handler: (...args: unknown[]) => unknown,
      opts?: { name?: string; description?: string },
    ): void;
    registerHttpRoute(params: {
      path: string;
      handler: (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => void | Promise<void>;
      auth: 'gateway' | 'plugin';
      match?: 'exact' | 'prefix';
    }): void;
    registerTool(tool: unknown, opts?: unknown): void;
    registerService(service: unknown): void;
    registerProvider(provider: unknown): void;
  }

  export function definePluginEntry(definition: PluginEntryDefinition): PluginEntryDefinition;
}
