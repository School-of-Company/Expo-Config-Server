export interface AppEnv {
  CONFIG_DIR?: string;
  VAULT_ADDR: string;
  VAULT_TOKEN: string;
  /** 서비스 식별자 → Basic 인증 비밀번호. 없으면 설정 API 인증을 끈다 (#54, docs/config-access-auth.md) */
  CONFIG_CLIENT_CREDENTIALS?: Record<string, string>;
  VAULT_TIMEOUT_MS?: number;
  /** 요청마다 액세스 로그 한 줄을 남길지. 기본 켜짐, `false`일 때만 끈다 */
  HTTP_ACCESS_LOG_ENABLED: boolean;
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
    CONFIG_CLIENT_CREDENTIALS: parseClientCredentials(
      config.CONFIG_CLIENT_CREDENTIALS,
    ),
    VAULT_TIMEOUT_MS: vaultTimeoutMs,
    HTTP_ACCESS_LOG_ENABLED:
      typeof config.HTTP_ACCESS_LOG_ENABLED !== 'string' ||
      config.HTTP_ACCESS_LOG_ENABLED.trim().toLowerCase() !== 'false',
  };
}
