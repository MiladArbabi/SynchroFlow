/**
 * @deprecated
 * ------------------
 * LEGACY TRANSFORMER — DO NOT USE FOR CANONICAL INGESTION
 *
 * This module exists ONLY to support legacy staged-event
 * mapping flows and unit tests.
 *
 * ❌ MUST NOT be used for:
 * - sovereign orders ingestion (orders table)
 * - FT0 / FT2 ingestion paths
 * - production order ingestion
 *
 * Canonical ingestion is handled exclusively by:
 * - staged_events → worker.ts canonical ingestion pipeline
 *
 * Removal requires:
 * - migrating remaining tests
 */

// apps/backend/src/transformer.ts 
// // Define the shape of the rules our transformer will use interface MappingRule { source_field_path: string; target_field_path: string; } 
// // A helper function to set a value on a nested path in an object 
// / e.g., setNestedValue(obj, 'customer.address.city', 'New York') 

function setNestedValue(obj: any, path: string, value: any) {
    const keys = path.split('.');
    let current = obj;
    
    for (let i = 0; i < keys.length - 1; i++) {
        const key = keys[i];
        
        if (current[key] === undefined) {
            current[key] = {};
        }
        
        current = current[key];
    }
    
    current[keys[keys.length - 1]] = value;
}

interface MappingRule {
    source_field_path: string;
    target_field_path: string;
}

export function transformPayload(
    rawPayload: Record<string, any>,
    mappingRules: MappingRule[]
): Record<string, any> {
    const transformedObject: Record<string, any> = {};
    
    for (const rule of mappingRules) {
        // For now, we assume simple, non-nested source paths.
        // We can make this more complex later if needed.
        const sourceValue = rawPayload[rule.source_field_path];
        
        if (sourceValue !== undefined) {
            setNestedValue(transformedObject, rule.target_field_path, sourceValue);
        }
    }
    
    return transformedObject;
}