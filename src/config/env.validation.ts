export interface AppEnv {
  CONFIG_DIR?: string;
  VAULT_ADDR: string;
  VAULT_TOKEN: string;
  /** 서비스 식별자 → Basic 인증 비밀번호. 없으면 설정 API 인증을 끈다 (#54, docs/config-access-auth.md) */
  CONFIG_CLIENT_CREDENTIALS?: Record<string, string>;
}

/** 서비스 식별자·프로파일 형식. 파일 경로와 Vault 경로에 그대로 들어가므로 경로 탐색을 막는 화이트리스트다. */
export const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

function parseClientCredentials(
  raw: unknown,
): Record<string, string> | undefined {
  if (raw === undefined || raw === '') return undefined;
  // 값(비밀번호)이 오류 메시지에 섞이지 않도록 파싱 오류 원문은 버린다.
  let parsed: unknown;
  try {
    parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    parsed = undefined;
  }
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    Array.isArray(parsed) ||
    Object.keys(parsed).length === 0 ||
    !Object.entries(parsed).every(
      ([service, password]) =>
        SAFE_SEGMENT.test(service) &&
        typeof password === 'string' &&
        password.length > 0,
    )
  ) {
    throw new Error(
      'CONFIG_CLIENT_CREDENTIALS must be a non-empty JSON object of {"<service>": "<password>"}',
    );
  }
  return parsed as Record<string, string>;
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
    CONFIG_DIR:
      typeof configDir === 'string' && configDir.length > 0
        ? configDir
        : undefined,
    VAULT_ADDR: vaultAddr,
    VAULT_TOKEN: vaultToken,
    CONFIG_CLIENT_CREDENTIALS: parseClientCredentials(
      config.CONFIG_CLIENT_CREDENTIALS,
    ),
  };
}
