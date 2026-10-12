import {
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ConfigAuthGuard } from './config-auth.guard';
import { AppEnv } from './env.validation';

function guardWith(credentials: unknown): ConfigAuthGuard {
  return new ConfigAuthGuard(
    new ConfigService<AppEnv, true>({
      VAULT_ADDR: 'http://vault.local',
      VAULT_TOKEN: 'token',
      CONFIG_CLIENT_CREDENTIALS: credentials as Record<string, string>,
    }),
  );
}

function contextFor(
  params: Record<string, string>,
  authorization?: string,
): { context: ExecutionContext; setHeader: jest.Mock } {
  const setHeader = jest.fn();
  const context = {
    switchToHttp: () => ({
      getRequest: () => ({ params, headers: { authorization } }),
      getResponse: () => ({ setHeader }),
    }),
  } as unknown as ExecutionContext;
  return { context, setHeader };
}

const basic = (value: string) =>
  `Basic ${Buffer.from(value).toString('base64')}`;

describe('ConfigAuthGuard', () => {
  it('lets every request through when CONFIG_CLIENT_CREDENTIALS is unset (staged rollout)', () => {
    const guard = guardWith(undefined);

    expect(guard.canActivate(contextFor({ service: 'auth' }).context)).toBe(
      true,
    );
  });

  it('refuses to start from an unvalidated raw string instead of disabling auth', () => {
    expect(() => guardWith('{"auth":"pw"}')).toThrow(
      'CONFIG_CLIENT_CREDENTIALS was not validated',
    );
  });

  describe('when enabled', () => {
    const guard = guardWith({ auth: 'pw:with:colons', gateway: 'gw-pw' });

    it('accepts the owning service on /configs and /spring params, scheme case-insensitive', () => {
      expect(
        guard.canActivate(
          contextFor({ service: 'auth' }, basic('auth:pw:with:colons')).context,
        ),
      ).toBe(true);
      expect(
        guard.canActivate(
          contextFor(
            { name: 'auth' },
            basic('auth:pw:with:colons').replace('Basic', 'basic'),
          ).context,
        ),
      ).toBe(true);
    });

    it.each([
      ['no header', undefined],
      ['wrong password', basic('auth:pw')],
      ['unknown user', basic('nobody:gw-pw')],
      ['prototype key as user', basic('__proto__:x')],
      ['constructor as user', basic('constructor:x')],
      ['no colon', basic('auth')],
      ['Bearer scheme', 'Bearer gw-pw'],
    ])('401 with WWW-Authenticate for %s', (_name, header) => {
      const { context, setHeader } = contextFor({ service: 'auth' }, header);

      expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
      expect(setHeader).toHaveBeenCalledWith(
        'WWW-Authenticate',
        'Basic realm="config"',
      );
    });

    it('403 when an authenticated service asks for another service', () => {
      expect(() =>
        guard.canActivate(
          contextFor({ service: 'auth' }, basic('gateway:gw-pw')).context,
        ),
      ).toThrow(ForbiddenException);
    });
  });
});
