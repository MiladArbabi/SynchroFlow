//packages/ui/src/components/OpsCommandCenter/naturalLanguage/types.ts
/* eslint-disable @typescript-eslint/no-explicit-any */
// These types are for the NLP engine (Layer 2)

/**
 * A map of extracted entities, e.g., { status: 'unfulfilled', date: 'yesterday' }
 */
export type EntityMap = {
  [key: string]: string | number | boolean | null;
};

/**
 * The structure of a recognized intent
 */
export interface Intent {
  name: string;
  confidence: number;
  entities: EntityMap;
  // For Layer 2.75
  clarificationOptions?: ClarificationOption[];
  clarificationReason?: 'ambiguous-entities' | 'multiple-intents' | 'low-confidence';
}

/**
 * The structure for our training data
 */
export interface IntentTrainingData {
  phrases: string[];
  entities: string[]; // List of entity *types* to look for
}

export interface TrainingData {
  [intentName: string]: IntentTrainingData;
}

/**
 * The structure of Kore's short-term memory (for Layer 2.5)
 */
export interface KoreConversation {
  topic: string; // e.g., 'find-orders'
  entities: EntityMap;
  timestamp: number;
}

/**
 * The structure for a single clarification option
 */
export interface ClarificationOption {
  label: string; // The text shown to the user (e.g., "Filter your last search for 'unfulfilled'?")
  intent: Intent; // The *actual* intent Kore would run if this is selected
}