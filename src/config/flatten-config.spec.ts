import { flattenConfig } from './flatten-config';

describe('flattenConfig', () => {
  it('joins nested objects with dots', () => {
    expect(
      flattenConfig({
        spring: {
          datasource: { url: 'jdbc:postgresql://db/expo', username: 'expo' },
        },
        port: 3000,
      }),
    ).toEqual({
      'spring.datasource.url': 'jdbc:postgresql://db/expo',
      'spring.datasource.username': 'expo',
      port: 3000,
    });
  });

  it('expands arrays as key[index], including objects inside arrays', () => {
    expect(
      flattenConfig({
        publicPaths: ['/health', 'POST /auth'],
        servers: [{ host: 'a', port: 1 }, { host: 'b' }],
      }),
    ).toEqual({
      'publicPaths[0]': '/health',
      'publicPaths[1]': 'POST /auth',
      'servers[0].host': 'a',
      'servers[0].port': 1,
      'servers[1].host': 'b',
    });
  });

  it('keeps number and boolean types', () => {
    const flat = flattenConfig({
      redis: { port: 6379 },
      feature: { enabled: false },
    });

    expect(flat['redis.port']).toBe(6379);
    expect(flat['feature.enabled']).toBe(false);
  });

  it('skips null values and empty objects/arrays', () => {
    expect(
      flattenConfig({ a: null, b: {}, c: [], d: { e: null }, f: 'kept' }),
    ).toEqual({ f: 'kept' });
  });

  it('keeps dots inside keys as part of the path', () => {
    expect(
      flattenConfig({
        eureka: {
          instance: { 'metadata-map': { 'prometheus.scrape': 'true' } },
        },
      }),
    ).toEqual({ 'eureka.instance.metadata-map.prometheus.scrape': 'true' });
  });

  it('keeps multi-line values (PEM) unchanged', () => {
    const pem = '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n';

    expect(flattenConfig({ jwt: { privateKey: pem } })).toEqual({
      'jwt.privateKey': pem,
    });
  });

  it('keeps top-level env-style keys as they are', () => {
    expect(
      flattenConfig({ JWT_PUBLIC_KEY: 'pem', INTERNAL_TOKEN: 't' }),
    ).toEqual({
      JWT_PUBLIC_KEY: 'pem',
      INTERNAL_TOKEN: 't',
    });
  });
});
