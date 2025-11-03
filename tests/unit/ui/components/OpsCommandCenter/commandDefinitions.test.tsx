// tests/unit/ui/components/OpsCommandCenter/commandDefinitions.test.ts
import { ALL_ACTIONS } from 'components/OpsCommandCenter/commandDefinitions';

describe('Kore Command Definitions', () => {
  it('should export a non-empty array of actions', () => {
    // Ensure we have actions defined
    expect(Array.isArray(ALL_ACTIONS)).toBe(true);
    expect(ALL_ACTIONS.length).toBeGreaterThan(0);
  });

  it('should ensure all actions have required properties', () => {
    // Check the shape of the first action
    const firstAction = ALL_ACTIONS[0];
    expect(firstAction).toHaveProperty('id');
    expect(firstAction).toHaveProperty('name');
    expect(firstAction).toHaveProperty('keywords');
    expect(firstAction).toHaveProperty('context');
  });
});