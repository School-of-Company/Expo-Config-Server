import { HttpException, HttpStatus } from '@nestjs/common';
import { ConfigController } from './config.controller';
import { ConfigMergeService } from './config-merge.service';
import { ProfileNotFoundError } from './native-config.provider';
import { VaultUnavailableError } from './vault-config.provider';

describe('ConfigController', () => {
  it('returns the merged config on success', async () => {
    const configMergeService = {
      getMergedConfig: jest.fn().mockResolvedValue({ port: 3000 }),
    } as unknown as ConfigMergeService;

    const controller = new ConfigController(configMergeService);
    const result = await controller.getConfig('auth', 'local');

    expect(result).toEqual({ port: 3000 });
  });

  it('maps ProfileNotFoundError to a 404 HttpException', async () => {
    expect.assertions(2);
    const configMergeService = {
      getMergedConfig: jest
        .fn()
        .mockRejectedValue(new ProfileNotFoundError('missing')),
    } as unknown as ConfigMergeService;
    const controller = new ConfigController(configMergeService);

    try {
      await controller.getConfig('auth', 'missing');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(HttpStatus.NOT_FOUND);
    }
  });

  it('maps VaultUnavailableError to a 503 HttpException', async () => {
    expect.assertions(2);
    const configMergeService = {
      getMergedConfig: jest
        .fn()
        .mockRejectedValue(new VaultUnavailableError('down')),
    } as unknown as ConfigMergeService;
    const controller = new ConfigController(configMergeService);

    try {
      await controller.getConfig('auth', 'local');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  });

  it('does not leak the internal VaultUnavailableError message to the client', async () => {
    expect.assertions(2);
    const configMergeService = {
      getMergedConfig: jest
        .fn()
        .mockRejectedValue(
          new VaultUnavailableError(
            'Failed to reach Vault: connect ECONNREFUSED 10.0.5.12:8200',
          ),
        ),
    } as unknown as ConfigMergeService;
    const controller = new ConfigController(configMergeService);

    try {
      await controller.getConfig('auth', 'local');
    } catch (error) {
      expect((error as HttpException).message).not.toMatch(/10\.0\.5\.12/);
      expect((error as HttpException).message).not.toMatch(/ECONNREFUSED/);
    }
  });

  it('rejects a path-traversal-shaped service or profile with 400 without calling the merge service', async () => {
    expect.assertions(5);
    const getMergedConfig = jest.fn();
    const configMergeService = {
      getMergedConfig,
    } as unknown as ConfigMergeService;
    const controller = new ConfigController(configMergeService);

    try {
      await controller.getConfig('../etc', 'local');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(HttpStatus.BAD_REQUEST);
    }

    try {
      await controller.getConfig('auth', '..%2F..%2Fdocker');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(HttpStatus.BAD_REQUEST);
    }

    expect(getMergedConfig).not.toHaveBeenCalled();
  });
});
