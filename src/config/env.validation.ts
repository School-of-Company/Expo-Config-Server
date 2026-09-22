export interface AppEnv {
  CONFIG_DIR?: string;
  VAULT_ADDR: string;
  VAULT_TOKEN: string;
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

  return {
    CONFIG_DIR: typeof configDir === 'string' && configDir.length > 0 ? configDir : undefined,
    VAULT_ADDR: vaultAddr,
    VAULT_TOKEN: vaultToken,
  };
}
