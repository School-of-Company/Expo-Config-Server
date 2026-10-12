export interface AppEnv {
  CONFIG_DIR?: string;
  VAULT_ADDR: string;
  VAULT_TOKEN: string;
  VAULT_TIMEOUT_MS?: number;
}

const MAX_TIMER_MS = 2_147_483_647;

export function validateEnv(config: Record<string, unknown>): AppEnv {
  const vaultAddr = config.VAULT_ADDR;
  const vaultToken = config.VAULT_TOKEN;

  if (typeof vaultAddr !== 'string' || vaultAddr.length === 0) {
    throw new Error('Missing required environment variable: VAULT_ADDR');
  }
  if (typeof vaultToken !== 'string' || vaultToken.length === 0) {
    throw new Error('Missing required environment variable: VAULT_TOKEN');
  }

  const configDir = config.CONFIG_DIR;
  const timeout = config.VAULT_TIMEOUT_MS;
  let vaultTimeoutMs: number | undefined;
  if (timeout !== undefined && timeout !== '') {
    vaultTimeoutMs = Number(timeout);
    // 2^31-1 을 넘으면 Node 타이머가 1ms 로 바뀌거나 AbortSignal.timeout 이 예외를 던진다.
    if (
      !Number.isInteger(vaultTimeoutMs) ||
      vaultTimeoutMs <= 0 ||
      vaultTimeoutMs > MAX_TIMER_MS
    ) {
      throw new Error(
        `VAULT_TIMEOUT_MS must be an integer between 1 and ${MAX_TIMER_MS}`,
      );
    }
  }

  return {
    CONFIG_DIR:
      typeof configDir === 'string' && configDir.length > 0
        ? configDir
        : undefined,
    VAULT_ADDR: vaultAddr,
    VAULT_TOKEN: vaultToken,
    VAULT_TIMEOUT_MS: vaultTimeoutMs,
  };
}
