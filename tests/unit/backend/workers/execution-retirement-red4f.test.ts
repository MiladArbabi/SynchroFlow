/** RED-4F worker classification: real consumer/executeJob, bounded DB/queue seams. */
const mockChannel = { consume: jest.fn(), addSetup: jest.fn(), ack: jest.fn(), sendToQueue: jest.fn(() => true) };
const mockQuery: any = { where: jest.fn(), first: jest.fn(), update: jest.fn() };
mockQuery.where.mockImplementation(() => mockQuery);
mockQuery.first.mockResolvedValue({ status: 'pending' }); mockQuery.update.mockResolvedValue(1);
const mockDb: any = jest.fn(() => mockQuery); mockDb.fn = { now: () => new Date('2026-10-08T00:00:00Z') };
jest.mock('@lasyncro/backend-core/db.js', () => ({ __esModule: true, default: mockDb,
  withTenant: jest.fn(async (_shopId, callback) => callback(mockDb)) }));
jest.mock('api-src/queue', () => ({ getQueueChannel: jest.fn(() => mockChannel) }));
jest.mock('api-src/execution/execution.guard', () => ({ validateExecution: jest.fn(async () => { throw new Error('PROCEED_FULFILLMENT_RETIRED'); }) }));
jest.mock('api-src/execution/execution.registry', () => ({ getExecutionHandler: jest.fn(() => jest.fn(async () => {})) }));
jest.mock('api-src/domain/decision/decision.repository', () => ({ DecisionRepository: {
  markStarted: jest.fn(async () => {}), markFailure: jest.fn(async () => {}), markSuccess: jest.fn(async () => {}),
} }));

import fs from 'fs';
import path from 'path';
import ts from 'typescript';
const { startExecutionWorker } = require('api-src/workers/execution.worker');
const { withTenant } = require('@lasyncro/backend-core/db.js');
const { validateExecution } = require('api-src/execution/execution.guard');
const { DecisionRepository } = require('api-src/domain/decision/decision.repository');
const { getExecutionHandler } = require('api-src/execution/execution.registry');
const RETIRED = 'PROCEED_FULFILLMENT_RETIRED';
let logs: unknown[][], spies: jest.SpyInstance[];
beforeEach(() => {
  jest.clearAllMocks(); logs = [];
  spies = ['error', 'warn', 'log', 'info'].map(m => jest.spyOn(console, m as 'error').mockImplementation((...args: unknown[]) => { logs.push(args); }));
});
afterEach(() => { spies.forEach(s => s.mockRestore()); });

describe('RED-4F worker non-retryable retirement', () => {
  it('F11: active soft-block set contains the exact retired code', () => {
    const file = 'apps/backend/src/workers/execution.worker.ts';
    const ast = ts.createSourceFile(file, fs.readFileSync(path.resolve(process.cwd(), file), 'utf8'), ts.ScriptTarget.Latest, true);
    const sets: ts.NewExpression[] = [];
    function walk(n: ts.Node) {
      if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === 'SOFT_BLOCK_ERRORS' && n.initializer && ts.isNewExpression(n.initializer)) sets.push(n.initializer);
      ts.forEachChild(n, walk);
    }
    walk(ast); expect(sets).toHaveLength(1);
    expect(sets[0].expression.getText(ast)).toBe('Set');
    const array = sets[0].arguments?.[0]; expect(array && ts.isArrayLiteralExpression(array)).toBe(true);
    const values = (array as ts.ArrayLiteralExpression).elements.filter(ts.isStringLiteral).map(n => n.text);
    expect(values).toContain(RETIRED);
  });
  it('F12: retired attempt ACKs the original message without enqueue or header increment', async () => {
    startExecutionWorker(); expect(mockChannel.consume).toHaveBeenCalledTimes(1);
    const [queue, callback, options] = mockChannel.consume.mock.calls[0];
    expect(queue).toBe('execution.jobs.v1'); expect(options).toEqual({ noAck: false });
    const msg = { content: Buffer.from(JSON.stringify({ decision_id: 'red4f-worker-decision', entity_id: 'red4f-worker-order',
      shop_id: 94001, aggregate_version: 1, action_type: 'proceed_fulfillment', payload: {}, execution_mode: 'automated' })),
      properties: { headers: { 'x-retry-count': 0 } } };
    await callback(msg);
    expect(validateExecution).toHaveBeenCalledTimes(1);
    expect(DecisionRepository.markFailure).toHaveBeenCalledWith(mockDb, 'red4f-worker-decision', RETIRED);
    expect(DecisionRepository.markSuccess).not.toHaveBeenCalled();
    const handler = (getExecutionHandler as jest.Mock).mock.results[0].value; expect(handler).not.toHaveBeenCalled();
    process.stdout.write('\n[RED4F_F12_EVIDENCE] '+JSON.stringify({
      ackCalls: mockChannel.ack.mock.calls.length,
      retryEnqueues: mockChannel.sendToQueue.mock.calls.length,
      retryHeader: mockChannel.sendToQueue.mock.calls[0]?.[2]?.headers?.['x-retry-count'] ?? null,
      tenantTransactions: (withTenant as jest.Mock).mock.calls.length,
      failureMarks: DecisionRepository.markFailure.mock.calls.length,
      queueFailureWrites: mockQuery.update.mock.calls.length,
    })+'\n');

    // ARCH-10F terminality addendum:
    // 1 = queue-state read
    // 2 = executeJob-owned transaction, whose failure writes roll back
    // 3 = post-rollback durable terminalization transaction
    expect(withTenant).toHaveBeenCalledTimes(3);
    expect(DecisionRepository.markFailure).toHaveBeenCalledTimes(2);
    expect(mockQuery.update).toHaveBeenCalledTimes(2);
    expect(mockQuery.update).toHaveBeenLastCalledWith({
      status: 'failure',
      executed_at: expect.any(Date),
      error: RETIRED,
    });

    const durableTerminalizationCall =
      (withTenant as jest.Mock).mock.invocationCallOrder[2];
    const ackCall = mockChannel.ack.mock.invocationCallOrder[0];
    expect(durableTerminalizationCall).toBeLessThan(ackCall);

    expect(mockChannel.ack).toHaveBeenCalledTimes(1);
    expect(mockChannel.ack).toHaveBeenCalledWith(msg);
    expect(mockChannel.sendToQueue).not.toHaveBeenCalled();
    expect(msg.properties.headers['x-retry-count']).toBe(0);
    expect(logs.some(args => args[0] === '[EXECUTION_RETRY_SCHEDULED]')).toBe(false);
  });
});
