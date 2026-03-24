// Ambient type declarations for runtime dependencies not installed in node_modules.

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

declare module 'openclaw/plugin-sdk/plugin-entry' {
  export interface PluginRequest {
    method: string;
    url: string;
    path: string;
    query: Record<string, string>;
    params: Record<string, string>;
    body: unknown;
    headers: Record<string, string>;
  }

  export interface PluginResponse {
    status(code: number): this;
    json(body: unknown): void;
    send(body: string): void;
    setHeader(name: string, value: string): void;
  }

  export type RouteHandler = (req: PluginRequest, res: PluginResponse) => void | Promise<void>;

  export interface PluginAPI {
    registerHttpRoute(
      method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH',
      path: string,
      handler: RouteHandler,
    ): void;
    log(level: 'debug' | 'info' | 'warn' | 'error', message: string, data?: unknown): void;
  }

  export interface BeforeModelResolveContext {
    requestId: string;
    prompt: string;
    agentId?: string;
    sessionKey?: string;
    defaultModel: string;
    pluginConfig: unknown;
  }

  export interface BeforeModelResolveResult {
    modelOverride?: string;
  }

  export interface AgentEndContext {
    requestId: string;
    agentId?: string;
    sessionKey?: string;
    model: string;
    latencyMs: number;
    inputTokens?: number;
    outputTokens?: number;
    error?: string;
  }

  export interface PluginHooks {
    before_model_resolve?: (
      ctx: BeforeModelResolveContext,
    ) => BeforeModelResolveResult | Promise<BeforeModelResolveResult>;
    agent_end?: (ctx: AgentEndContext) => void | Promise<void>;
  }

  export interface PluginDefinition {
    setup(api: PluginAPI): void | Promise<void>;
    hooks: PluginHooks;
  }

  export function definePluginEntry(definition: PluginDefinition): PluginDefinition;
}
