//tests/unit/ui/components/OpsCommandCenter/naturalLanguage/trainingData.test.tsx
// This import will fail
import { TRAINING_DATA } from 'components/OpsCommandCenter/naturalLanguage/trainingData';

describe('Kore NLP Training Data', () => {
  it('should export a valid training data object', () => {
    // Check that it exists and is an object
    expect(TRAINING_DATA).toBeDefined();
    expect(typeof TRAINING_DATA).toBe('object');
  });

  it('should contain the 5 core intents', () => {
    const intents = Object.keys(TRAINING_DATA);
    
    // Check for the 5 intents we planned
    expect(intents).toContain('find-orders');
    expect(intents).toContain('refund-order');
    expect(intents).toContain('check-inventory');
    expect(intents).toContain('customer-lookup');
    expect(intents).toContain('daily-report');
  });

  it('should ensure each intent has phrases and entities', () => {
    const firstIntentKey = Object.keys(TRAINING_DATA)[0];
    const firstIntent = TRAINING_DATA[firstIntentKey];

    // Check the shape of the data
    expect(firstIntent).toHaveProperty('phrases');
    expect(firstIntent).toHaveProperty('entities');
    expect(Array.isArray(firstIntent.phrases)).toBe(true);
    expect(Array.isArray(firstIntent.entities)).toBe(true);
  });
});