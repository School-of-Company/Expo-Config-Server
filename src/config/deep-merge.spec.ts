import { deepMerge } from './deep-merge';

describe('deepMerge', () => {
  it('overrides top-level keys', () => {
    expect(deepMerge({ a: 1 }, { a: 2 })).toEqual({ a: 2 });
  });

  it('merges nested objects without losing sibling keys', () => {
    const base = { db: { host: 'localhost', port: 5432 } };
    const override = { db: { password: 'secret' } };

    expect(deepMerge(base, override)).toEqual({
      db: { host: 'localhost', port: 5432, password: 'secret' },
    });
  });

  it('replaces arrays wholesale instead of merging them', () => {
    expect(deepMerge({ a: [1, 2] }, { a: [3] })).toEqual({ a: [3] });
  });

  it('keeps base keys that override does not touch', () => {
    expect(deepMerge({ a: 1, b: 2 }, { a: 9 })).toEqual({ a: 9, b: 2 });
  });
});
