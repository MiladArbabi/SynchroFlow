import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

function loadEntry(filename: string) {
  // Preserve ESM entry identity without Babel's __filename/import.meta collision.
  const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
    transformers: { before: [(context) => (source) => {
      const visit: ts.Visitor = (node) => {
        if (ts.isPropertyAccessExpression(node) && ts.isMetaProperty(node.expression) && node.name.text === 'url') {
          return ts.factory.createStringLiteral(pathToFileURL(filename).href);
        }
        return ts.visitEachChild(node, visit, context);
      };
      return ts.visitNode(source, visit) as ts.SourceFile;
    }] },
  });
  const localRequire = (id: string) => {
    if (!id.startsWith('.')) return require(id);

    const resolved = path.resolve(path.dirname(filename), id);
    const sourcePath = resolved.endsWith('.js')
      ? `${resolved.slice(0, -3)}.ts`
      : resolved;

    return require(sourcePath);
  };
  new Function('require', 'exports', compiled.outputText)(localRequire, {});
}

function deferred() {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

describe.each(['server', 'worker-entry'])('%s production shutdown signals', (entry) => {
  const stop = jest.fn();
  const cleanup = jest.fn();
  const close = jest.fn();
  const handlers = new Map<string, () => unknown>();
  let exit: jest.SpyInstance;
  let originalArgv: string[];

  beforeEach(() => {
    jest.resetModules();
    jest.resetAllMocks();
    jest.useFakeTimers();
    handlers.clear();
    originalArgv = process.argv;
    process.argv = [process.execPath, require.resolve(`api-src/${entry}`)];
    exit = jest.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    jest.spyOn(process, 'on').mockImplementation((event, listener) => {
      handlers.set(String(event), listener);
      return process;
    });
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    stop.mockResolvedValue(undefined);
    cleanup.mockResolvedValue(undefined);
    close.mockImplementation((done: (error?: Error) => void) => { done(); });
    jest.doMock('dotenv', () => ({ config: jest.fn() }));
    jest.doMock('api-src/bootstrap/env', () => ({}));
    jest.doMock('api-src/bootstrap/tsconfig-paths-register', () => ({}));
    jest.doMock('api-src/api/shopify/shopify.webhook', () => ({}));
    jest.doMock('api-src/bootstrap/express', () => ({ createApp: () => ({
      listen: (_port: number, _host: string, done: () => void) => {
        queueMicrotask(done);
        return { close };
      },
    }) }));
    jest.doMock('api-src/bootstrap/workers', () => ({ startWorkers: jest.fn().mockResolvedValue(undefined), stopWorkers: stop }));
    jest.doMock('api-src/queue', () => ({ initQueue: jest.fn(), closeQueue: cleanup }));
    jest.doMock('api-src/bootstrap/queue', () => ({ initQueue: jest.fn(), closeQueue: cleanup }));
    jest.doMock('api-src/queue.topology', () => ({ declareTopology: jest.fn() }));
    jest.doMock('api-src/utils/schemaGuard', () => ({ runSchemaGuard: jest.fn() }));
    jest.doMock('api-src/utils/analytics', () => ({ flushAnalytics: cleanup }));
    jest.doMock('@lasyncro/backend-core/db.js', () => ({ assertRuntimeDatabaseIdentity: jest.fn() }), { virtual: true });
    jest.doMock('@lasyncro/backend-core/services/redis.client.js', () => ({ initRedisClient: jest.fn(), closeRedisClient: cleanup }), { virtual: true });
    jest.doMock('api-src/workers/domain-event-outbox.dispatcher', () => ({ startDomainEventOutboxDispatcher: jest.fn() }));
    jest.doMock('api-src/workers/projection.health.worker', () => ({ startProjectionHealthWorker: jest.fn() }));
  });
  afterEach(() => {
    process.argv = originalArgv;
    jest.clearAllTimers();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });
  async function boot() {
    loadEntry(require.resolve(`api-src/${entry}`));
    await jest.advanceTimersByTimeAsync(0);
  }
  function signal(name: string) {
    const handler = handlers.get(name);
    expect(handler).toBeDefined();
    return handler?.();
  }
  it.each(['SIGTERM', 'SIGINT'])('%s stops registered workers exactly once', async (name) => {
    await boot();
    signal(name);
    await jest.advanceTimersByTimeAsync(0);
    expect(stop).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(0);
  });
  it('mixed repeated signals share the operation and deadline', async () => {
    await boot();
    const gate = deferred();
    stop.mockReturnValue(gate.promise);
    const first = signal('SIGTERM');
    await jest.advanceTimersByTimeAsync(9_000);
    const second = signal('SIGINT');
    expect(first).toBe(second);
    expect(stop).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1_000);
    expect(exit).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(1);
    gate.resolve();
    await jest.advanceTimersByTimeAsync(0);
    expect(exit).toHaveBeenCalledTimes(1);
  });
  it('keeps infrastructure open while registered work drains', async () => {
    await boot();
    const gate = deferred();
    stop.mockReturnValue(gate.promise);
    signal('SIGTERM');
    await jest.advanceTimersByTimeAsync(0);
    expect(stop).toHaveBeenCalledTimes(1);
    expect(cleanup).not.toHaveBeenCalled();
    expect(exit).not.toHaveBeenCalled();
    gate.resolve();
    await jest.advanceTimersByTimeAsync(0);
    expect(exit).toHaveBeenCalledWith(0);
  });
  it('required stop failure terminates nonzero', async () => {
    await boot();
    stop.mockRejectedValue(new Error('worker stop failed'));
    signal('SIGINT');
    await jest.advanceTimersByTimeAsync(0);
    expect(cleanup).toHaveBeenCalled();
    expect(exit).toHaveBeenCalledWith(1);
  });
  it('a hung stop terminates at the single 10-second deadline', async () => {
    await boot();
    stop.mockReturnValue(new Promise(() => undefined));
    signal('SIGTERM');
    await jest.advanceTimersByTimeAsync(9_999);
    expect(exit).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);
    expect(exit).toHaveBeenCalledWith(1);
    expect(cleanup).not.toHaveBeenCalled();
  });
  if (entry === 'server') {
    it('starts HTTP close and worker stop concurrently, before cleanup', async () => {
      await boot();
      let finishHttp: (error?: Error) => void = () => undefined;
      close.mockImplementation((done: (error?: Error) => void) => { finishHttp = done; });
      const gate = deferred();
      stop.mockReturnValue(gate.promise);
      signal('SIGTERM');
      expect(close).toHaveBeenCalledTimes(1);
      expect(stop).toHaveBeenCalledTimes(1);
      expect(cleanup).not.toHaveBeenCalled();
      gate.resolve();
      await jest.advanceTimersByTimeAsync(0);
      expect(cleanup).not.toHaveBeenCalled();
      finishHttp();
      await jest.advanceTimersByTimeAsync(0);
      expect(cleanup).toHaveBeenCalledTimes(3);
      expect(exit).toHaveBeenCalledWith(0);
    });
    it('HTTP close failure terminates nonzero and still requests worker stop', async () => {
      await boot();
      close.mockImplementation((done: (error?: Error) => void) => done(new Error('HTTP close failed')));
      signal('SIGTERM');
      await jest.advanceTimersByTimeAsync(0);
      expect(stop).toHaveBeenCalledTimes(1);
      expect(exit).toHaveBeenCalledWith(1);
    });
    it('hung cleanup is bounded by the original deadline', async () => {
      await boot();
      cleanup.mockReturnValue(new Promise(() => undefined));
      signal('SIGTERM');
      await jest.advanceTimersByTimeAsync(10_000);
      expect(exit).toHaveBeenCalledWith(1);
      expect(cleanup).toHaveBeenCalledTimes(1);
    });
  }
});
