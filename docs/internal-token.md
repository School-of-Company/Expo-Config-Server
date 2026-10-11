# 서비스 간 내부 호출 토큰 전달 규약 (#14)

Gateway를 거치지 않는 서비스 간 호출은 `X-Internal-Token` 헤더의 공유 시크릿으로 인증한다
(Expo-Expo-Server#22에서 합의). 이 문서는 그 토큰을 Vault에 **어느 경로에 어떤 키 이름으로** 넣는지 정한다.
Config Server는 `secret/{service}`의 값을 그대로 병합해 내려줄 뿐이라(`GET /configs/:service/:profile`),
규약의 핵심은 경로와 키 이름이다. 독자는 토큰을 발급·교체하는 운영자와 내부 API를 연동하는 개발자다.

## 결정: 환경별 공용 토큰 1개

이슈에서는 "받는 서비스마다 토큰을 따로 두고, 부르는 쪽이 사본을 가진다"를 제안했지만, **지금은 환경(dev/prod)마다
토큰 하나를 내부 호출이 있는 서비스들이 같이 쓴다.** 이유는 두 가지다.

1. **현재 코드가 토큰 하나를 여러 받는 쪽에 보낸다.** 받는 쪽별 토큰으로 나누면 아래 호출이 바로 401이 된다.

   | 부르는 쪽 | 설정 이름 | 이 토큰 하나로 부르는 서비스 |
   |---|---|---|
   | Expo `ExpoDeletionClient` | `expo.delete-internal-token` | 신청(apply), Form, 유저 |
   | Expo `StandardDependenciesClient` | `expo.standard.internal-token` | 유저, 신청 |
   | Expo `TrainingDependenciesClient` | `expo.training.internal-token` | 유저 |
   | 신청 `RegistrationGateway` | `application.internal-token` (**자기가 받는 토큰과 같은 설정**) | Expo, Form, 유저 |

   특히 신청 서비스는 자기가 받는 토큰을 그대로 다른 서비스에 보낸다. 그래서 네 서비스의 토큰이 같아야만 동작한다.
2. **지금 배포 구조에서는 나눠도 격리 효과가 거의 없다.** glink.kr 서버에서 모든 서비스가 한 계정으로 돌고 각 서비스의
   환경 파일도 그 계정 소유라, 한 서비스가 뚫리면 다른 서비스 설정도 읽힌다. 내부 경로(`/internal/**`)는 Gateway
   라우팅에 없고 서비스는 `127.0.0.1`에만 바인딩되어 있어 외부에서 직접 닿지 않는다.

받는 쪽별 토큰은 서비스가 다른 서버/계정으로 나뉘어 격리 이점이 생길 때 하는 **후속 작업**으로 둔다 (아래 참고).

## 규약

| 항목 | 값 |
|---|---|
| 토큰 | 환경마다 1개, 32자 이상 난수 (`openssl rand -hex 32` → 64자) |
| 넣는 곳 | 내부 호출이 있는 서비스 경로에만: `secret/auth`, `secret/expo`, `secret/apply`, `secret/form` |
| 넣지 않는 곳 | **`secret/application`** (Gateway 포함 전 서비스에 내려감), `secret/gateway`, 내부 호출이 없는 서비스(`report`, `notification`) |
| 키 이름 | 각 서비스가 **지금 읽는 설정 이름 그대로** (아래 표). Spring 속성은 점(`.`) 기준으로 중첩한 JSON |
| 값 노출 | 코드·yml·로그·오류 메시지에 값을 남기지 않는다. 확인은 SHA-256 지문 앞 16자리로 한다 |

서비스별 키 (모두 같은 값):

| Vault 경로 | 넣는 JSON | 서비스가 읽는 이름 | 용도 |
|---|---|---|---|
| `secret/auth` | `{"internal": {"token": T}}` | `internal.token` (환경변수 `INTERNAL_TOKEN`) | 유저 `/internal/**` 보호 |
| `secret/auth` | `{"clients": {"expo": {"internal-token": T}}}` | `clients.expo.internal-token` (`EXPO_INTERNAL_TOKEN`) | 유저 → Expo 호출 |
| `secret/expo` | `{"EXPO_INTERNAL_TOKEN": T}` | `EXPO_INTERNAL_TOKEN` | Expo `/internal/expo/**` 보호 |
| `secret/expo` | `{"expo": {"standard": {"internal-token": T}, "training": {"internal-token": T}, "delete-internal-token": T}}` | `expo.standard.internal-token` 등 | Expo → 유저·신청·Form 호출 |
| `secret/apply` | `{"application": {"internal-token": T}}` | `application.internal-token` (`APPLICATION_INTERNAL_TOKEN`) | 신청 `/internal/**` 보호 + 신청 → Expo·Form·유저 호출 |
| `secret/form` | `{"INTERNAL_TOKEN": T, "USER_SERVICE_INTERNAL_TOKEN": T}` | 같은 이름 (Nest `ConfigService`) | Form `/internal/**` 보호 + Form → 유저 호출 |

- Expo의 `EXPO_INTERNAL_TOKEN`, Form의 키들은 서비스 코드가 환경변수 이름 그대로 읽어서 최상위 키로 둔다.
- Form의 `PARTICIPATION_SERVICE_INTERNAL_TOKEN`은 참여(attendance) 서비스에 내부 API가 생기면 같은 값으로 추가한다
  (지금은 비워 두면 현장 QR 설문만 비활성).
- 서비스 식별자는 **`auth`를 유지**한다. 이미 `configs/auth-*.yml`, `secret/auth`(JWT 개인키), 문서가 이 이름을
  쓰고, 유저 서비스는 아직 Config Server를 읽지 않아 이름을 바꿔도 실제로 달라지는 게 없다. `user`로 바꾸기로 하면
  스크립트를 `AUTH_SERVICE=user`로 돌리고 `configs/auth-*.yml` 이름만 바꾸면 된다.

## 발급과 배포

`scripts/seed-internal-tokens.sh`가 토큰을 만들고 위 경로에 한 번에 넣는다. 각 경로의 다른 키(JWT 개인키, DB
비밀번호 등)는 KV v2 merge-patch로 보존된다. 값은 출력하지 않고 지문만 출력한다.

```bash
# 로컬 (docker compose의 dev-mode Vault)
VAULT_TOKEN=dev-root-token ./scripts/seed-internal-tokens.sh

# 이미 서비스들이 쓰고 있는 토큰을 Vault로 옮길 때 (새로 만들지 않음). 파일 내용은 토큰 한 줄
TOKEN_FILE=./internal-token.txt VAULT_ADDR=https://vault.example VAULT_TOKEN=... ./scripts/seed-internal-tokens.sh
```

- `TOKEN_FILE` 없이 실행하면 **항상 새 토큰으로 덮어쓴다.** 운영 중인 환경에서는 의도한 로테이션일 때만 실행한다.
- 여러 경로를 원자적으로 쓰는 연산은 Vault에 없다. 중간에 실패하면 스크립트가 에러로 끝나므로 **같은 명령을 다시
  실행**한다 (`TOKEN_FILE`을 주면 같은 값으로 다시 쓴다).
- 서비스는 부팅 시에만 설정을 읽는다. 실행 후 유저, Expo, 신청, Form을 **모두 재시작**한다.
- 운영 Vault에서는 이 네 경로에만 쓰기 권한이 있는 최소 권한 토큰을 쓴다.

> 참고: 유저·Expo·신청·Form은 아직 Config Server를 읽지 않고 환경변수로 값을 받는다 (Spring Cloud Config 호환은
> #12). 그 전까지 배포 환경은 같은 토큰을 위 표의 환경변수 이름으로 넣으면 된다. glink.kr 서버가 이 방식이다.

## 로테이션

토큰이 하나뿐이고 받는 쪽이 현재 토큰만 받으므로 **무중단 교체는 안 된다.** 스크립트 재실행 → 네 서비스 재시작
순서로 바꾸고, 재시작이 끝날 때까지 서비스 간 호출 일부가 401이 날 수 있다. 무중단이 필요해지면 받는 쪽이 현재 +
이전 토큰을 둘 다 받도록 바꾸는 후속 작업이 필요하다 (각 서비스의 토큰 검증 코드 변경 포함).

## 후속 작업: 받는 쪽별 토큰

서비스가 다른 서버·계정으로 나뉘어 토큰을 나누는 것이 실제 격리가 될 때 진행한다. 먼저 코드가 바뀌어야 한다.

- Expo: `ExpoDeletionClient`, `StandardDependenciesClient`, `TrainingDependenciesClient`가 호출 대상별로 다른 토큰을
  쓰도록 설정을 나눈다 (예: `expo.clients.user.token`, `expo.clients.apply.token`, `expo.clients.form.token`).
- 신청: `RegistrationGateway`가 자기가 받는 토큰(`application.internal-token`) 대신 대상별 사본을 보내도록 바꾼다.
- 그 뒤 이 문서의 표를 받는 쪽 소유 토큰 + 부르는 쪽 사본 구조로 바꾸고, 스크립트가 대상별로 토큰을 따로 만들게 한다.

## 테스트

`test/internal-token-delivery.e2e-spec.ts`가 다음을 검증한다.

- 네 서비스가 같은 토큰을 위 표의 키로 받는다.
- Gateway와 내부 호출이 없는 서비스(`report`) 응답에는 토큰이 없고, Gateway 요청은 네 서비스 경로를 조회하지 않는다.

`src/config/configs-files.spec.ts`는 public 리포의 `configs/*.yml`에 토큰 키가 들어 있지 않은지 확인한다.
