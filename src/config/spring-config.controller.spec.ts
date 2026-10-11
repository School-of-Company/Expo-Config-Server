import { HttpException, HttpStatus, Logger } from '@nestjs/common';
import { SpringConfigController } from './spring-config.controller';
import { ConfigMergeService } from './config-merge.service';
import { ProfileNotFoundError } from './native-config.provider';
import { VaultUnavailableError } from './vault-config.provider';

function controllerWith(getMergedConfig: jest.Mock) {
  return new SpringConfigController({
    getMergedConfig,
  } as unknown as ConfigMergeService);
}

async function statusOf(promise: Promise<unknown>): Promise<number> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(HttpException);
    return (error as HttpException).getStatus();
  }
  throw new Error('expected the request to fail');
}

describe('SpringConfigController', () => {
  it('returns the merged config as a Spring Cloud Config Environment', async () => {
    const controller = controllerWith(
      jest.fn().mockResolvedValue({
        spring: { datasource: { url: 'jdbc:x' } },
        jwt: { privateKey: 'pem' },
      }),
    );

    await expect(controller.getEnvironment('auth', 'dev')).resolves.toEqual({
      name: 'auth',
      profiles: ['dev'],
      label: null,
      version: null,
      state: null,
      propertySources: [
        {
          name: 'auth-dev',
          source: {
            'spring.datasource.url': 'jdbc:x',
            'jwt.privateKey': 'pem',
          },
        },
      ],
    });
  });

  it('ignores the label', async () => {
    const getMergedConfig = jest.fn().mockResolvedValue({ port: 1 });
    const controller = controllerWith(getMergedConfig);

    const withLabel = await controller.getEnvironmentWithLabel('auth', 'dev');
    const withoutLabel = await controller.getEnvironment('auth', 'dev');

    expect(withLabel).toEqual(withoutLabel);
    expect(getMergedConfig).toHaveBeenCalledWith('auth', 'dev');
  });

  it('maps errors like /configs: 400 invalid, 404 missing profile, 503 Vault down', async () => {
    const getMergedConfig = jest.fn();
    expect(
      await statusOf(
        controllerWith(getMergedConfig).getEnvironment('../etc', 'dev'),
      ),
    ).toBe(HttpStatus.BAD_REQUEST);
    expect(
      await statusOf(
        controllerWith(getMergedConfig).getEnvironment('auth', 'dev,local'),
      ),
    ).toBe(HttpStatus.BAD_REQUEST);
    expect(getMergedConfig).not.toHaveBeenCalled();

    expect(
      await statusOf(
        controllerWith(
          jest.fn().mockRejectedValue(new ProfileNotFoundError('missing')),
        ).getEnvironment('auth', 'missing'),
      ),
    ).toBe(HttpStatus.NOT_FOUND);

    expect(
      await statusOf(
        controllerWith(
          jest.fn().mockRejectedValue(new VaultUnavailableError('down')),
        ).getEnvironment('auth', 'dev'),
      ),
    ).toBe(HttpStatus.SERVICE_UNAVAILABLE);
  });

  it('never logs config values', async () => {
    const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    const debugSpy = jest.spyOn(Logger.prototype, 'debug').mockImplementation();
    const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    const secret = 'super-secret-private-key';

    await controllerWith(
      jest.fn().mockResolvedValue({ jwt: { privateKey: secret } }),
    ).getEnvironment('auth', 'dev');
    await statusOf(
      controllerWith(
        jest.fn().mockRejectedValue(new VaultUnavailableError('down')),
      ).getEnvironment('auth', 'dev'),
    );

    const logged = JSON.stringify([
      errorSpy.mock.calls,
      debugSpy.mock.calls,
      logSpy.mock.calls,
    ]);
    expect(logged).not.toContain(secret);
    errorSpy.mockRestore();
    debugSpy.mockRestore();
    logSpy.mockRestore();
  });
});
