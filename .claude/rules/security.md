# Config Server Security Rules

## Strictly Forbidden

- Reading or printing `.env`, `.env.*` files
- Printing `VAULT_TOKEN` or any other Vault credential
- Logging the response body returned by `VaultConfigProvider` (it may contain secrets)
- Hardcoding Vault tokens, DB passwords, or any credential in code
- Committing real secret values into `configs/*.yml` — that tree is for non-secret settings only, Vault owns secrets
- Reading files under a `secrets/` directory if one is ever introduced

## Environment Variable Management

Config server 자신의 부트스트랩 값(`CONFIG_DIR`, `VAULT_ADDR`, `VAULT_TOKEN`)은 각 provider
내부에서만 `process.env`로 읽는다. 컨트롤러나 서비스 레이어에서 직접 `process.env`를 읽지 않는다.

```ts
// vault-config.provider.ts 안에서만
const vaultAddr = process.env.VAULT_ADDR;
const vaultToken = process.env.VAULT_TOKEN;
```

## Route Parameter Injection

- `service`/`profile` 파라미터는 검증 없이 파일 경로나 Vault API 경로에 들어가면 안 된다
  (`.claude/rules/architecture.md`의 Route Parameter Safety 참고).
- 화이트리스트 정규식 검증을 통과하지 못하면 400을 반환하고, 그 값이 provider까지 전달되지
  않도록 컨트롤러 레벨에서 막는다.

## Vault Response Handling

- Vault가 200과 함께 비정상적인(malformed) 본문을 반환해도 그대로 클라이언트에 흘리지 않는다 —
  파싱 실패는 `VaultUnavailableError`로 매핑해서 503으로 응답한다.
- Vault 개별 경로가 404인 것은 "그 경로에 시크릿 없음"이며 에러가 아니다. 빈 객체로 처리한다.

## Error Messages to Clients

- `HttpException`에 담기는 메시지에 Vault 주소, 네트워크 에러의 원본 문자열 등 내부 정보를
  그대로 노출하지 않는다. 상세는 서버 로그로, 클라이언트에는 일반화된 메시지로 응답한다.

## Logging

- Never include `VAULT_TOKEN`, Vault response bodies, or the contents of any `secret/*` path in logs
- Do not log full request/response bodies for `/configs/:service/:profile` in production
- Use structured logging (JSON) if logging is added
