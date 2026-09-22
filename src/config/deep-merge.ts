export type ConfigRecord = Record<string, unknown>;

export function deepMerge(base: ConfigRecord, override: ConfigRecord): ConfigRecord {
  const result: ConfigRecord = { ...base };

  for (const key of Object.keys(override)) {
    const baseValue = result[key];
    const overrideValue = override[key];

    if (isPlainObject(baseValue) && isPlainObject(overrideValue)) {
      result[key] = deepMerge(baseValue, overrideValue);
    } else {
      result[key] = overrideValue;
    }
  }

  return result;
}

export function isPlainObject(value: unknown): value is ConfigRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
