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
      getMergedConfig: jest.fn().mockRejectedValue(new ProfileNotFoundError('missing')),
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
      getMergedConfig: jest.fn().mockRejectedValue(new VaultUnavailableError('down')),
    } as unknown as ConfigMergeService;
    const controller = new ConfigController(configMergeService);

    try {
      await controller.getConfig('auth', 'local');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(HttpStatus.SERVICE_UNAVAILABLE);
    }
  });
});
