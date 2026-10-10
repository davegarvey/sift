export type SchemaType = 'object' | 'string' | 'integer' | 'number' | 'boolean' | 'array' | 'null';

export interface Schema {
  type?: SchemaType | SchemaType[];
  description?: string;
  properties?: Record<string, Schema>;
  required?: string[];
  additionalProperties?: boolean;
  items?: Schema;
  enum?: readonly (string | number | boolean | null)[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
  default?: unknown;
}

function typeMatches(type: SchemaType, value: unknown): boolean {
  switch (type) {
    case 'null':
      return value === null;
    case 'array':
      return Array.isArray(value);
    case 'object':
      return typeof value === 'object' && value !== null && !Array.isArray(value);
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value);
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'string':
      return typeof value === 'string';
    case 'boolean':
      return typeof value === 'boolean';
  }
}

export function validateSchema(schema: Schema, value: unknown, path = '$'): string[] {
  const errors: string[] = [];
  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((type) => typeMatches(type, value))) {
      return [`${path} must be ${types.join(' or ')}`];
    }
  }
  if (schema.enum && !schema.enum.includes(value as string | number | boolean | null)) {
    errors.push(`${path} must be one of ${schema.enum.join(', ')}`);
  }
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${path} must be at least ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) errors.push(`${path} must be at most ${schema.maximum}`);
  }
  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) errors.push(`${path} is too short`);
    if (schema.maxLength !== undefined && value.length > schema.maxLength) errors.push(`${path} is too long`);
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) errors.push(`${path} needs at least ${schema.minItems} items`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems) errors.push(`${path} allows at most ${schema.maxItems} items`);
    const itemSchema = schema.items;
    if (itemSchema) value.forEach((item, index) => errors.push(...validateSchema(itemSchema, item, `${path}[${index}]`)));
  }
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    for (const key of schema.required ?? []) {
      if (record[key] === undefined) errors.push(`${path}.${key} is required`);
    }
    for (const [key, child] of Object.entries(schema.properties ?? {})) {
      if (record[key] !== undefined) errors.push(...validateSchema(child, record[key], `${path}.${key}`));
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(record)) {
        if (!schema.properties || !(key in schema.properties)) errors.push(`${path}.${key} is not allowed`);
      }
    }
  }
  return errors;
}
