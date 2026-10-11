export interface AppEnv {
  CONFIG_DIR?: string;
  VAULT_ADDR: string;
  VAULT_TOKEN: string;
  VAULT_TIMEOUT_MS?: number;
}

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
    if (!Number.isInteger(vaultTimeoutMs) || vaultTimeoutMs <= 0) {
      throw new Error('VAULT_TIMEOUT_MS must be a positive integer');
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
