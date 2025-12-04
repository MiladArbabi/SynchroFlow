// apps/backend/src/transformer.ts
// Define the shape of the rules our transformer will use
interface MappingRule {
  source_field_path: string;
  target_field_path: string;
}

// A helper function to set a value on a nested path in an object
// e.g., setNestedValue(obj, 'customer.address.city', 'New York')
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

export function transformPayload(rawPayload: Record<string, any>, mappingRules: MappingRule[]): Record<string, any> {
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