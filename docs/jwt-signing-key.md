# JWT 서명 키 전달 규약 (#6)

유저 서비스가 토큰을 **서명**하는 개인키와, Gateway가 **검증**하는 공개키를 Vault → Config Server 경로로
전달하는 규약. Config Server 코드는 `secret/{service}`에 들어있는 값을 그대로 병합해 내려줄 뿐이라
(`GET /configs/:service/:profile`), 규약의 핵심은 "어느 경로에 어떤 키 이름으로 넣느냐"이다.

**이 문서의 목적**: 이 키쌍은 Config Server, 유저 서비스, Gateway 세 곳이 같은 약속(Vault 경로, 키 이름,
PEM 형식, 로테이션 순서)을 지켜야 동작한다. 그런데 Config Server 코드에는 이 약속이 드러나지 않는다
(Vault에 든 값을 그대로 통과시킬 뿐이다). 그래서 #6의 "정해야 할 것"에 대한 현재 합의안과 아직 정해지지
않은 항목을 한곳에 남기려고 만들었다. 독자는 키를 발급·교체하는 운영자와 유저 서비스·Gateway를 연동하는
개발자다.

## 규약 요약

| 항목 | 값 | 상태 |
|---|---|---|
| 서명(개인키) 서비스 식별자 | `auth` | 유지 (`docs/internal-token.md` 참고) |
| 개인키 위치 | Vault `secret/auth` → `{"jwt": {"privateKey": "<PEM>"}}` | 제안 |
| 공개키 위치 | Vault `secret/gateway` → `{"jwt": {"publicKey": "<PEM>"}}` | Gateway 쪽 기존 규약 |
| 공개키 위치 (역할 검증) | Vault `secret/expo`, `secret/report` → `{"JWT_PUBLIC_KEY": "<PEM>"}` | Expo·Report가 `@Value("${JWT_PUBLIC_KEY}")`로 읽는 이름 그대로 |
| 알고리즘 / 형식 | RS256, 개인키 PKCS#8 PEM, 공개키 SPKI PEM | 제안 |
| PEM 표현 | 실제 개행이 들어간 JSON 문자열 (`\n` 이스케이프). 서버는 값을 변형 없이 전달 | 테스트로 고정 |

개인키는 **반드시 `secret/auth`(소유 서비스 경로)에만** 둔다. `secret/application`은 모든 서비스에 내려가므로
거기에 두면 Gateway를 포함한 전 서비스가 개인키를 받게 된다. (`test/jwt-key-delivery.e2e-spec.ts`가
gateway 응답에 개인키가 없고 `secret/auth`를 조회하지도 않는다는 것을 검증한다.)

공개키는 Gateway(서명 검증) 외에 **Expo, Report**도 받는다. 두 서비스는 Gateway가 보지 않는 `role` 클레임으로
관리자 전용 API를 막으려고 토큰을 직접 다시 검증한다. 공개키라 노출돼도 위험은 없지만, 개인키와 짝이 맞아야
하므로 같은 스크립트로 한 번에 넣는다.

## 키 발급과 배포

`scripts/seed-jwt-keys.sh`가 RS256 키쌍을 만들고 개인키는 `secret/auth`에, 공개키는 `secret/gateway`와
`PUBLIC_KEY_SERVICES`(기본 `expo report`) 경로에 한 번에 넣는다. 이미 있는 다른 키
(예: `db.password`)는 KV v2 merge-patch로 보존된다. 개인키는 화면/로그에 출력하지 않고, 대신 공개키
SHA-256 지문 앞 16자리를 출력해서 양쪽이 같은 쌍인지 확인할 수 있다.

```bash
# 로컬 (docker compose의 dev-mode Vault)
VAULT_TOKEN=dev-root-token ./scripts/seed-jwt-keys.sh

# 서비스 식별자나 Vault 주소가 다르면
VAULT_ADDR=https://vault.example AUTH_SERVICE=user VAULT_TOKEN=... ./scripts/seed-jwt-keys.sh
```

- 스크립트는 기존 키쌍이 있어도 **항상 새 쌍으로 덮어쓴다** (별도 확인 절차 없음). 운영 중인 환경에서
  실행하면 이전 키로 서명된 토큰이 전부 무효가 되므로, 의도한 로테이션일 때만 실행한다.
- 두 경로를 동시에 쓰는 원자적 연산은 Vault에 없다. 두 번째 쓰기가 실패하면 스크립트가 에러로 종료하므로
  **그대로 다시 실행**하면 새 쌍이 양쪽에 다시 들어간다.
- 서비스는 부팅 시에만 설정을 읽는다(핫리로드 없음). 실행 후 유저 서비스, Gateway, Expo, Report를 **모두 재시작**한다.
- 운영 Vault에서는 `secret/auth`, `secret/gateway`, `secret/expo`, `secret/report`에만 쓰기 권한이 있는 최소 권한 토큰을 쓴다.

## 로테이션

현재 Gateway는 공개키 하나만 받으므로 무중단 교체는 불가능하고, 스크립트 재실행 + 양쪽 재시작으로
교체한다. 재시작 사이와 이후에는 **이전 키로 서명된 토큰이 검증 실패**하므로 클라이언트가 재로그인/재발급을
해야 한다. 무중단 교체가 필요해지면 JWT 헤더에 `kid`를 넣고 Gateway가 공개키 여러 개(현재+이전)를
받도록 바꾸는 후속 작업이 필요하다 (Gateway 변경 포함).

## 다른 시크릿 (DB 비밀번호 등)

같은 방식으로 전달한다. 규칙은 다음과 같다.

- **서비스 전용 시크릿은 `secret/{식별자}`에만** 둔다. `secret/application`은 정말 전 서비스가 같은 값을 써야
  할 때만 쓴다 (지금은 없음).
- **키 이름은 그 서비스가 지금 읽는 설정 이름 그대로** 중첩한다. Spring 속성은 점 기준 중첩
  (예: 유저 `{"spring": {"datasource": {"password": "..."}}}`), 코드가 환경변수 이름으로 읽는 값은 그 이름을
  최상위 키로 둔다 (예: Expo `{"JWT_PUBLIC_KEY": "..."}`). 서비스별 키 목록은 `docs/service-configs.md` 표에 있다.
  서비스 간 내부 토큰은 `docs/internal-token.md`.
- 이렇게 두면 서비스가 Config Server를 읽게 됐을 때(#12) 매핑 없이 그대로 바인딩된다.

## 현재 전달 방식 (Config Server 연동 전)

유저, Expo, Report는 아직 Config Server를 읽지 않는다. 그 전까지 배포 환경은 **같은 키쌍을 환경변수로** 넣는다.

| 서비스 | 환경변수 | 형식 |
|---|---|---|
| 유저 | `JWT_PRIVATE_KEY` | PKCS#8 PEM, 줄바꿈을 `
` 문자로 쓴 한 줄 (유저 `JwtProperties`가 받아 줌) |
| Expo, Report | `JWT_PUBLIC_KEY` | SPKI PEM, 줄바꿈 `
` 한 줄 또는 실제 줄바꿈 둘 다 됨 (헤더 제거 후 MIME Base64 디코드) |
| Gateway | (Config Server → `secret/gateway`의 `jwt.publicKey`) | 이미 Config Server로 받음 |

키 원본은 Vault에 두고(이 스크립트), 환경변수는 거기서 꺼내 넣는다. glink.kr 서버가 이 방식이다.
Config Server 연동이 되면 환경변수 대신 위 Vault 경로를 바로 읽으면 된다.

## 정리된 항목 (#6)

- **서비스 식별자**: `auth` 유지 (`docs/internal-token.md` 참고). `user`로 바꾸면 `AUTH_SERVICE=user`로 스크립트를
  돌리고 `configs/auth-*.yml` 이름만 바꾸면 된다.
- **Vault 경로·키 이름, PEM 형식**: 위 "규약 요약" 표. 줄바꿈은 테스트로 고정.
- **로테이션**: 위 "로테이션" 절. 무중단 교체는 `kid` 도입 후속 작업.
- **다른 시크릿**: 위 "다른 시크릿" 절의 규칙.
- **Gateway 라우팅 prefix**: #15에서 `/auth`, `/admin`, `/trainee`, `/participant`를 `expo-user-server`로 정리했다.
- **유저 서비스가 Config Server에서 키를 읽는 것**: Spring Cloud Config Client 호환 엔드포인트(#12)와 유저 서비스 쪽
  `spring.config.import` 작업이 필요하다. 이 문서의 규약은 그대로 쓰면 된다.
