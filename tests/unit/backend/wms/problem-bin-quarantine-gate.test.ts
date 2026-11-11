import { isProblemBinQuarantineEnabled, quarantineUnitToProblemBin } from 'api-src/services/inventory/problemBinQuarantine.service';
import { quarantineStowUnit } from 'api-src/services/wms/stowQuarantine.service';
import type { Knex } from 'knex';

const FLAG = 'PROBLEM_BIN_QUARANTINE_ENABLED';

describe('Problem Bin quarantine server gate', () => {
  it.each([undefined, '', 'false', 'TRUE', '1'])('is disabled for %s', value => {
    expect(isProblemBinQuarantineEnabled(value === undefined ? {} : { [FLAG]: value })).toBe(false);
  });
  it('enables only the exact server-side true value', () => {
    expect(isProblemBinQuarantineEnabled({ [FLAG]: 'true' })).toBe(true);
  });
  it('the retired S2 flag does not enable anything', () => {
    expect(isProblemBinQuarantineEnabled({ STOW_QUARANTINE_ENABLED: 'true' })).toBe(false);
  });
  it.each([
    ['free scan core', (trx: Knex.Transaction) => quarantineUnitToProblemBin(trx, {
      shopId: 1, actorId: 1, lasyncroUnitId: 'LSU-test', problemBinScan: 'PROBLEM', deviceEventId: 'event', quarantineReason: 'routine' })],
    ['stow adapter', (trx: Knex.Transaction) => quarantineStowUnit(trx, {
      shopId: 1, stowTaskId: 'task', claimedBy: 1, lasyncroUnitId: 'LSU-test', problemBinLocation: 'PROBLEM', deviceEventId: 'event', quarantineReason: 'routine' })],
  ])('%s rejects before any database access when unset', async (_name, call) => {
    const saved = process.env[FLAG];
    delete process.env[FLAG];
    const databaseAccess = jest.fn(() => { throw new Error('Database must not be touched'); });
    try {
      await expect(call(databaseAccess as unknown as Knex.Transaction))
        .rejects.toMatchObject({ errorCode: 'PROBLEM_BIN_QUARANTINE_DISABLED', statusCode: 409 });
      expect(databaseAccess).not.toHaveBeenCalled();
    } finally {
      if (saved === undefined) delete process.env[FLAG];
      else process.env[FLAG] = saved;
    }
  });
});
