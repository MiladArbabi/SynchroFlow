//tests/unit/api/services/opsIntel.test.ts
import { OpsIntelEngine } from 'api-src/services/opsIntel'; // This import will fail

// Mock the 'BusinessRule' type for this test
type MockRule = {
  id: string;
  schedule: string; // e.g., '*/5 * * * *'
  execute: jest.Mock;
};

// Use fake timers to control setInterval
jest.useFakeTimers();

describe('OpsIntelEngine', () => {
  let engine: OpsIntelEngine;
  const mockRule: MockRule = {
    id: 'test-rule',
    schedule: '* * * * *', // Every minute
    execute: jest.fn(),
  };

  beforeEach(() => {
    mockRule.execute.mockClear();
    // Create a new engine for each test
    engine = new OpsIntelEngine();
  });

  afterEach(() => {
    engine.stop();
  });

  it('should be able to register a new rule', () => {
    engine.registerRule(mockRule as any);
    // We'll check an internal, but it proves it was added
    expect((engine as any).rules.length).toBe(1);
    expect((engine as any).rules[0].id).toBe('test-rule');
  });

  it('should not execute rules before .start() is called', () => {
    engine.registerRule(mockRule as any);
    
    // Advance time by 5 minutes
    jest.advanceTimersByTime(5 * 60 * 1000);
    
    expect(mockRule.execute).not.toHaveBeenCalled();
  });

  it('should execute a registered rule after .start() is called', () => {
    engine.registerRule(mockRule as any);
    engine.start(); // Start the engine

    // Advance time just past the 1-minute schedule
    jest.advanceTimersByTime(61 * 1000);
    
    // The rule should have been called
    expect(mockRule.execute).toHaveBeenCalledTimes(1);
  });

  it('should stop executing rules after .stop() is called', () => {
    engine.registerRule(mockRule as any);
    engine.start();

    // Run it once
    jest.advanceTimersByTime(61 * 1000);
    expect(mockRule.execute).toHaveBeenCalledTimes(1);

    // Stop the engine
    engine.stop();

    // Advance time again
    jest.advanceTimersByTime(61 * 1000);
    
    // The count should still be 1
    expect(mockRule.execute).toHaveBeenCalledTimes(1);
  });
});