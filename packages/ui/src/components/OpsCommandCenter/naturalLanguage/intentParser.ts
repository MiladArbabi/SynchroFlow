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

  // --- 1. CHECK FOR RESET ---
  // Always check for a reset command first.
  if (isResetQuery(query)) {
    return {
      name: 'reset',
      confidence: 1.0,
      entities: {},
    };
  }
  // 1. Find the best matching intent (the "verb")
  const bestIntent = findBestIntent(query);

  if (bestIntent) {
    // 2. If we found an intent, extract the "nouns"
    const entities = extractEntities(query, bestIntent.entitiesToFind);
    
    return {
      name: bestIntent.name,
      confidence: bestIntent.confidence,
      entities: entities,
    };
  }

  // 3. Fallback: If no intent is found, treat it as a Layer 1 "search"
  return {
    name: 'search',
    confidence: 0.1, // Very low confidence
    entities: { query: query },
  };
};