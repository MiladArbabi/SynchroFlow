/* eslint-disable @typescript-eslint/no-unused-vars */
//packages/ui/src/components/OpsCommandCenter/naturalLanguage/intentParser.ts
import { Intent, TrainingData, EntityMap, KoreConversation } from './types';
import { TRAINING_DATA } from './trainingData';
import { extractEntities } from './entityExtractor';

/**
 * Calculates a confidence score based on how many words from
 * a training phrase are present in the user's query.
 * @param query The user's query (e.g., "show unfulfilled orders")
 * @param trainingPhrase A phrase from TRAINING_DATA (e.g., "show orders")
 * @returns A score between 0 and 1.
 */
const calculateConfidence = (query: string, trainingPhrase: string): number => {
  const queryWords = new Set(query.toLowerCase().split(' '));
  const phraseWords = new Set(trainingPhrase.toLowerCase().split(' '));

  if (phraseWords.size === 0) return 0;

  let intersectionSize = 0;
  for (const word of phraseWords) {
    if (queryWords.has(word)) {
      intersectionSize++;
    }
  }

  // Simple Jaccard-like score: (intersection / union)
  // We use (queryWords.size + phraseWords.size - intersectionSize) for the union
  return intersectionSize / (queryWords.size + phraseWords.size - intersectionSize);
};

/**
 * Checks if the query is a command to reset the conversation.
 */
const isResetQuery = (query: string): boolean => {
  const lowerQuery = query.toLowerCase().trim();
  const resetPhrases = ['reset', 'clear', 'start over', 'new search', 'nevermind'];

  // Check if the query *is* one of the reset phrases
  return resetPhrases.includes(lowerQuery);
};


/**
 * Merges new entities into old ones, overriding any existing keys.
 */
const mergeEntities = (oldEntities: EntityMap, newEntities: EntityMap): EntityMap => {
  return { ...oldEntities, ...newEntities };
};

/**
 * Finds the best matching intent from our training data.
 * @param query The user's search query
 * @returns The highest-confidence matching intent, or null.
 */
const findBestIntent = (
  query: string,
): { name: string; confidence: number; entitiesToFind: string[] } | null => {
  let bestIntent: string | null = null;
  let bestConfidence = 0.0;
  let entitiesToFind: string[] = [];

  const lowerQuery = query.toLowerCase();

  // Loop through every intent in our training data
  for (const [intentName, training] of Object.entries(TRAINING_DATA)) {
    // Loop through every phrase for that intent
    for (const phrase of training.phrases) {
      
      // Check for an exact match first
      if (lowerQuery === phrase) {
        return {
          name: intentName,
          confidence: 1.0, // Exact match is 100% confidence
          entitiesToFind: training.entities,
        };
      }

      // Calculate confidence score
      const confidence = calculateConfidence(lowerQuery, phrase);

      if (confidence > bestConfidence) {
        bestConfidence = confidence;
        bestIntent = intentName;
        entitiesToFind = training.entities;
      }
    }
  }

  // We set a minimum confidence threshold to avoid bad matches
  if (bestIntent && bestConfidence > 0.4) {
    return {
      name: bestIntent,
      confidence: bestConfidence,
      entitiesToFind: entitiesToFind,
    };
  }

  return null;
};

/**
 * Main parser function.
 * Takes a user query and returns a structured Intent object.
 * (For now, it ignores the conversation context)
 */
export const parseIntent = (
  query: string,
  conversation: KoreConversation | null, // We'll use this in Layer 2.5
): Intent => {
  const lowerQuery = query.toLowerCase();

  // --- 1. CHECK FOR RESET ---
  // Always check for a reset command first.
  if (isResetQuery(query)) {
    return {
      name: 'reset',
      confidence: 1.0,
      entities: {},
    };
  }

  // --- 2. CHECK FOR A NEW HIGH-CONFIDENCE INTENT ---
  // We check for a *new* command before checking for a follow-up.
  // This allows "find customer" to override a "find-orders" conversation.
  const bestIntent = findBestIntent(query);

  if (bestIntent && bestIntent.confidence === 1.0) {
    const entities = extractEntities(query, bestIntent.entitiesToFind);
    return {
      name: bestIntent.name,
      confidence: 1.0,
      entities: entities,
    };
  }

  // --- 3. CHECK FOR A FOLLOW-UP ---
  // If it's not a reset and not a new high-confidence command,
  // check if it's a follow-up to the existing conversation.
  if (conversation) {
    // Extract any *new* entities from the query
    // We must check for *all* known entity types.
    const allEntityTypes = [
      'status', 'date', 'customer', 'product', 'orderId',
      'amount', 'reason', 'threshold', 'customerName',
      'email', 'phone', 'metrics'
    ];
    const newEntities = extractEntities(query, allEntityTypes);

    // If we found new entities, assume it's a follow-up
    if (Object.keys(newEntities).length > 0) {
      return {
        name: conversation.topic, // Use the *old* topic
        confidence: 0.9, // High-confidence follow-up
        entities: mergeEntities(conversation.entities, newEntities),
      };
    }
  }

  // --- 4. CHECK FOR A REGULAR (NON-EXACT) NEW INTENT ---
  // This is the original logic.
  // This must come *after* the follow-up check.
  if (bestIntent) {
    const entities = extractEntities(query, bestIntent.entitiesToFind);
    return {
      name: bestIntent.name,
      confidence: bestIntent.confidence,
      entities: entities,
    };
  }

  return {
    name: 'search',
    confidence: 0.1, // Very low confidence
    entities: { query: query },
  };
};