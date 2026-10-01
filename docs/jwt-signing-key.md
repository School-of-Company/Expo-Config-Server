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
| 서명(개인키) 서비스 식별자 | `auth` | **협의 필요** (아래 참고) |
| 개인키 위치 | Vault `secret/auth` → `{"jwt": {"privateKey": "<PEM>"}}` | 제안 |
| 공개키 위치 | Vault `secret/gateway` → `{"jwt": {"publicKey": "<PEM>"}}` | Gateway 쪽 기존 규약 |
| 알고리즘 / 형식 | RS256, 개인키 PKCS#8 PEM, 공개키 SPKI PEM | 제안 |
| PEM 표현 | 실제 개행이 들어간 JSON 문자열 (`\n` 이스케이프). 서버는 값을 변형 없이 전달 | 테스트로 고정 |

개인키는 **반드시 `secret/auth`(소유 서비스 경로)에만** 둔다. `secret/application`은 모든 서비스에 내려가므로
거기에 두면 Gateway를 포함한 전 서비스가 개인키를 받게 된다. (`test/jwt-key-delivery.e2e-spec.ts`가
gateway 응답에 개인키가 없고 `secret/auth`를 조회하지도 않는다는 것을 검증한다.)

## 키 발급과 배포

`scripts/seed-jwt-keys.sh`가 RS256 키쌍을 만들고 두 경로에 한 번에 넣는다. 이미 있는 다른 키
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
- 서비스는 부팅 시에만 설정을 읽는다(핫리로드 없음). 실행 후 유저 서비스와 Gateway를 **둘 다 재시작**한다.
- 운영 Vault에서는 `secret/auth`, `secret/gateway`에만 쓰기 권한이 있는 최소 권한 토큰을 쓴다.

## 로테이션

현재 Gateway는 공개키 하나만 받으므로 무중단 교체는 불가능하고, 스크립트 재실행 + 양쪽 재시작으로
교체한다. 재시작 사이와 이후에는 **이전 키로 서명된 토큰이 검증 실패**하므로 클라이언트가 재로그인/재발급을
해야 한다. 무중단 교체가 필요해지면 JWT 헤더에 `kid`를 넣고 Gateway가 공개키 여러 개(현재+이전)를
받도록 바꾸는 후속 작업이 필요하다 (Gateway 변경 포함).

## 다른 시크릿 (DB 비밀번호 등)

같은 방식으로 전달한다. 전 서비스 공용이면 `secret/application`, 특정 서비스 전용이면 `secret/{식별자}`에
yml과 같은 중첩 구조로 넣는다 (예: `{"db": {"password": "..."}}`). 키 이름이 환경변수 형태
(`DB_PASSWORD`)로 바뀌어야 하는지는 클라이언트 쪽(유저 서비스) 매핑에서 정한다.

## 아직 정해지지 않은 것

- **서비스 식별자 `auth` vs `user`**: 유저 서비스는 `auth/admin/trainee/participant`를 한 프로세스로 묶은
  `expo-user-server`다. 지금은 기존 샘플(`configs/auth-local.yml`)과 이슈 제안에 맞춰 `auth`로 두었고,
  `user`로 정하면 `AUTH_SERVICE=user`로 스크립트를 돌리고 샘플 파일 이름만 바꾸면 된다.
- **Spring Cloud Config Client 호환**: Spring Cloud Config Client는 `GET /{name}/{profile}`에서
  `propertySources` 배열이 든 Environment JSON을 기대한다. 이 서버의 `GET /configs/:service/:profile`는
  병합된 중첩 JSON을 돌려주므로 `spring.config.import=configserver:...`로 그대로는 붙지 않는다.
  호환 엔드포인트를 이 서버에 추가할지, 유저 서비스에서 이 엔드포인트를 직접 읽을지 정해야 한다.
- **Gateway 라우팅 prefix**: `gateway-*.yml`의 `/auth`, `/admin`, `/trainee`, `/participant`는 서비스 4개로
  매핑되어 있는데 유저 서비스는 `expo-user-server` 하나로 등록된다. 이 문서 범위 밖이라 건드리지 않았다.
