import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import * as yaml from 'js-yaml';
import { isPlainObject } from './deep-merge';

const configsDir = join(__dirname, '..', '..', 'configs');

const SERVICES = [
  'gateway',
  'auth',
  'expo',
  'apply',
  'report',
  'form',
  'notification',
];
const PROFILES = ['dev', 'prod'];

describe('configs/ files', () => {
  let fileNames: string[];

  beforeAll(async () => {
    fileNames = (await readdir(configsDir)).filter((name) =>
      name.endsWith('.yml'),
    );
  });

  it.each(PROFILES)('has the shared application-%s.yml', (profile) => {
    expect(fileNames).toContain(`application-${profile}.yml`);
  });

  it.each(
    SERVICES.flatMap((service) =>
      PROFILES.map((profile): [string, string] => [service, profile]),
    ),
  )('has %s-%s.yml', (service, profile) => {
    expect(fileNames).toContain(`${service}-${profile}.yml`);
  });

  it('parses every file to a YAML mapping', async () => {
    for (const fileName of fileNames) {
      const parsed: unknown = yaml.load(
        await readFile(join(configsDir, fileName), 'utf-8'),
      );
      expect({ fileName, isMapping: isPlainObject(parsed) }).toEqual({
        fileName,
        isMapping: true,
      });
    }
  });
});
