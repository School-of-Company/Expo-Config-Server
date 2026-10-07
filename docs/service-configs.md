# 서비스별 설정 파일 (`configs/`)

**이 문서의 목적**: `configs/`의 서비스별 `dev`/`prod` yml은 뼈대만 있고 실제 값은 비어 있다. 값을 채우는
사람이 "어느 파일의 무엇을 채우고, 무엇은 yml이 아니라 Vault에 넣어야 하는지"를 한 번에 볼 수 있게
정리했다. 키 구성은 각 서비스 리포의 `application.yaml`/`.env.example`을 기준으로 잡았다.

## 서비스별 구성

| 식별자 | 서비스 리포 | yml에 있는 키 | Vault에 넣을 값 |
|---|---|---|---|
| `gateway` | Expo-Gateway (NestJS) | `port`, `eureka.serviceUrl`, `routing`, `rateLimit`, `publicPaths` | `secret/gateway` → `jwt.publicKey` |
| `auth` | Expo-User-Server (Spring) | `spring.datasource.url/username`, `spring.data.redis`, `eureka.client` | `secret/auth` → `spring.datasource.password`, `jwt.privateKey`, 내부 토큰(`internal.token`, `clients.expo.internal-token`) |
| `expo` | Expo-Expo-Server (Spring) | 위와 같음 (DB `expo`) | `secret/expo` → `spring.datasource.password`, `JWT_PUBLIC_KEY`, 내부 토큰(`EXPO_INTERNAL_TOKEN`, `expo.*.internal-token`) |
| `apply` | Expo-Application-Server (Spring) | 위와 같음 (DB `expo_application`) | `secret/apply` → `spring.datasource.password`, 내부 토큰(`application.internal-token`) |
| `report` | Expo-Report-Server (Spring) | `spring.datasource.url/username`, `eureka.client` (Redis 없음) | `secret/report` → `spring.datasource.password`, `JWT_PUBLIC_KEY` |
| `form` | Expo-Form-Server (NestJS) | `port`, `database.sslRejectUnauthorized`(prod만) | `secret/form` → `database.url` (접속 계정 포함 전체 URL), 내부 토큰(`INTERNAL_TOKEN`, `USER_SERVICE_INTERNAL_TOKEN`) |
| `notification` | Expo-Notification-Server (NestJS) | `port`, `kafka`, `redis`, `sms`(발신번호·발송 한도), `eureka.serviceUrl` (`local` 파일도 있음) | `secret/notification` → `sms.apiKey`, `sms.apiSecret`, `discord.participantNumberUrl`(선택), `redis.password`(쓰는 경우) |

서비스 간 내부 호출 토큰의 경로·키 이름과 발급 방법은 `docs/internal-token.md`에 있다. 유저 서비스 식별자는 `auth`를 유지한다
(이미 `auth-*.yml`, `secret/auth`, 문서가 이 이름을 쓴다. 근거는 `docs/internal-token.md`). Spring 서비스의
키는 Spring 속성 이름 그대로 중첩해 두었다. 나중에 Spring 호환 엔드포인트를 붙일 때 평탄화만 하면 되게
하려는 것이고, 그 결정 전까지는 이 구조가 확정은 아니다.

## 값 채우기

- `<EUREKA_HOST>`, `<DB_HOST>`, `<REDIS_HOST>`, `<KAFKA_HOST>`는 일부러 유효하지 않은 값이다. 안 채우고
  배포하면 서비스가 연결 실패로 바로 드러난다. 남은 자리는 `grep -rnE "<[^>]+>" configs/`로 찾는다
  (`<일반 참가자 발신번호>` 같은 한글 자리도 잡힌다).
- `notification`의 발신번호(`sms.fromStandardNumber`, `sms.fromTraineeNumber`)는 `<...>` 문구 그대로 두어도
  알림 서버의 부팅 검증을 **통과한다** (비어 있지 않은 문자열이라서). 연결 실패처럼 바로 드러나지 않고 문자를
  발송할 때에야 실패하므로, 배포 전에 위 `grep`으로 반드시 확인한다. 이 번호가 public 리포에 올려도 되는
  번호인지는 먼저 정한다. 올리면 안 되는 번호라면 yml이 아니라 Vault `secret/notification`에 같은 키로 넣는다
  (같은 키는 Vault 값이 yml보다 우선한다).
- `notification-local.yml`은 발신번호를 파일에 두지 않는다. 알림 서버는 원격 값이 환경변수보다 우선해서,
  파일에 placeholder가 있으면 `SMS_FROM_STANDARD_NUMBER`/`SMS_FROM_TRAINEE_NUMBER`의 실제 번호를 덮어쓰기
  때문이다. 로컬에서는 이 두 환경변수나 Vault로 주고, 안 주면 알림 서버가 부팅할 때 실패한다. 같은 이유로
  `local`의 `port`는 config 서버 docker compose가 쓰는 3000이 아니라 3001이다.
- DB 이름과 계정(`expo_user`, `expo` 등)은 각 서비스의 로컬 기본값을 따왔다. 실제 환경과 다르면 고친다.
- **비밀 값은 yml에 쓰지 않는다.** 위 표의 Vault 값은 `secret/{식별자}`에 넣는다. 이 리포는 public이라
  한 번 커밋하면 지워도 공개된 것으로 봐야 한다. DB/Redis 호스트 같은 내부 주소를 public 리포에 올릴지도
  먼저 정한다.
- 반영 순서: 브랜치에서 수정 → `develop`으로 PR → config 서버 이미지 재배포 → 각 서비스 재시작
  (config 서버는 `configs/`를 이미지에 담고, 서비스는 부팅 시에만 설정을 읽는다).

## Vault에 시크릿 넣기

표의 `sms.apiKey` 같은 이름은 "`sms` 객체 안의 `apiKey`"라는 뜻이라, **중첩 JSON**으로 넣어야 한다.
`vault kv put ... sms.apiKey=값`처럼 점이 들어간 이름으로 넣으면 `sms` 객체에 병합되지 않아서 서비스는 값이
없다고 본다 (알림 서버로 직접 확인했다).

시크릿 파일(`secret.json`)을 만들어 stdin으로 넣고 바로 지운다. 이렇게 하면 비밀 값이 셸 히스토리나 명령
인자에 남지 않는다. 경로에 이미 값이 있는지에 따라 아래 둘 중 **하나만** 실행한다.

`secret.json` 예시 (notification):

```json
{"sms": {"apiKey": "...", "apiSecret": "..."}, "discord": {"participantNumberUrl": "..."}}
```

**1. 경로에 값이 아직 없을 때 (처음 만들 때): `put`**

```bash
vault kv put -mount=secret notification - < secret.json
```

**2. 경로에 이미 값이 있을 때 (일부만 추가/수정): `patch`**

```bash
vault kv patch -mount=secret notification - < secret.json
```

끝나면 `rm secret.json`으로 지운다.

- 두 명령을 이어서 실행하지 않는다. 이미 값이 있는 경로에 `put`을 쓰면 JSON에 없는 기존 키가 사라지고,
  `patch`는 지워진 키를 되돌리지 못한다. 반대로 값이 없는 경로에 `patch`를 쓰면 404로 실패한다 (둘 다 로컬
  Vault로 직접 확인했다).
- 로컬 dev-mode Vault(docker compose)는 컨테이너 안의 CLI로 넣는다. 위 명령 앞에
  `docker exec -i -e VAULT_ADDR=http://127.0.0.1:8200 -e VAULT_TOKEN=dev-root-token expo-config-vault`를
  붙이면 된다 (처음이면 `put`, 이미 있으면 `patch`).
- 이 방식은 위 표의 모든 서비스(`secret/{식별자}`)에 똑같이 적용된다.

## Spring 서비스 연결 (`/spring`, #12)

Spring Cloud Config Client는 `propertySources`가 든 Environment JSON을 기대해서 `/configs/...`(중첩 JSON)에는
그대로 붙지 않는다. 그래서 같은 병합 결과를 Spring 형식으로 돌려주는 경로를 따로 둔다.
`/configs/:service/:profile`는 Gateway·Form이 쓰는 계약이라 바꾸지 않았다.

| 경로 | 응답 |
|---|---|
| `GET /spring/:name/:profile` | `{name, profiles: [profile], label: null, version: null, state: null, propertySources: [{name: "<name>-<profile>", source}]}` |
| `GET /spring/:name/:profile/:label` | 위와 같음 (label은 지원하지 않고 무시) |

`source`는 `/configs/:name/:profile`와 같은 병합 결과(Vault `secret/{name}` > Vault `secret/application` > yml)를
펼친 것이다 (`src/config/flatten-config.ts`).

- 중첩 객체는 점으로 잇는다: `spring.datasource.url`
- 배열은 `key[0]`: `publicPaths[0]`, 배열 안의 객체는 `servers[0].host`
- 문자열·숫자·불리언은 타입 그대로 둔다
- `null`, 빈 객체·빈 배열은 키를 만들지 않는다 (Spring에서 "설정 안 됨" → 기본값 사용)
- 키 안의 점은 그대로 둔다: `metadata-map: {prometheus.scrape: "true"}` → `...metadata-map.prometheus.scrape`
  (Spring Map 바인딩은 나머지 경로를 키로 쓰므로 같은 값으로 읽힌다)
- 오류는 `/configs`와 같다: 잘못된 식별자·프로파일 `400`, 프로파일 없음 `404`, Vault 장애 `503`
  (빈 설정으로 내려주면 서비스가 비밀 값 없이 기동하므로 실패로 돌려준다)
- **프로파일은 하나만** 받는다. `dev,local` 같은 여러 개는 식별자 검증에서 `400`이다.

Spring 서비스 쪽 설정 (예: 유저 서비스):

```yaml
spring:
  application:
    name: expo-user-server
  config:
    import: configserver:http://<config-host>:<port>/spring
  cloud:
    config:
      name: auth          # 이 리포의 서비스 식별자 (파일 이름·Vault 경로와 같게)
      profile: dev
      fail-fast: true     # Config Server 가 응답하지 않으면 기동 실패
```

## 접근 제어 (중요)

Config Server에는 **인증이 없다.** `/configs/...`와 `/spring/...` 모두 포트에 닿는 누구에게나 Vault 값까지 병합해
내려준다. 지금은 네트워크 수준 제한(방화벽, 바인딩 주소)에만 의존한다.

- 외부 방화벽이 막아도, **같은 서버의 다른 계정**은 `127.0.0.1:<port>`로 닿는다. 여러 사람이 쓰는 서버라면
  그 사람들이 개인키·DB 비밀번호를 읽을 수 있다. (glink.kr 서버에서 실제로 확인했고, 그래서 그 서버는 JWT 개인키를
  Vault에 두지 않고 환경변수로만 유저 서비스에 넣는다.)
- 따라서 **인증을 붙이기 전까지는**, 접근을 막을 수 없는 환경에서 `secret/{service}`에 민감한 값(개인키, DB 비밀번호,
  내부 토큰)을 넣지 않는다. 그런 환경에서는 해당 서비스에 환경변수로 직접 넣는다.
- 인증을 붙인다면 Spring Cloud Config Client가 기본 지원하는 Basic 인증(`spring.cloud.config.username/password`)이
  가장 적게 바꾸는 방법이다. Gateway·Form도 `/configs` 호출에 같은 헤더를 보내야 한다 (후속 작업).

## 공용 파일(`application-{profile}.yml`) 주의

공용 파일의 값은 **모든 서비스**에 병합된다. 서비스 전용 파일에 같은 키가 있으면 서비스 쪽이 우선하므로
(지금의 `port`가 그렇다) 충돌은 없지만, 공용 파일에 키를 추가할 때는 서비스들의 최상위 키와 이름이 겹치지
않는지 확인한다. 예를 들어 알림 서버는 `kafka`, `redis`, `sms`, `discord`를 최상위 키로 쓰므로, 공용
파일에 같은 이름의 키를 넣으면 알림 서버 설정에 그 값이 섞여 들어간다.

## 예약어: `application`

`application`은 서비스 식별자로 쓰면 안 된다. `application-{profile}.yml`은 **전 서비스 공용 파일**이고
`secret/application`은 **전 서비스 공용 Vault 경로**라서, 신청(Application) 서비스를 `application`으로
부르면 그 서비스 전용 시크릿이 모든 서비스에 내려간다. 그래서 신청 서비스는 `apply`로 두었다.

## 아직 없거나 미확인인 것

- `sms`는 알림 서버(`notification`)로 통합되어 별도 파일이 없다. 참여(attendance) 서비스는
  Expo-Attention-Server 리포가 생겼지만 서비스 식별자가 정해지지 않아 설정 파일이 아직 없다.
  `training`/`standard`/`image`는 Expo-Expo-Server 안에 구현되어 있어(`/training`, `/standard`,
  `/image` 컨트롤러) Gateway 라우팅을 `expo-expo-server`로 보낸다. 별도 서비스가 아니므로 설정 파일도
  따로 두지 않는다.
- `notification`의 `eureka.serviceUrl` 키 이름은 Expo-Notification-Server#4(Eureka 등록 구현)에서
  확정되면 맞춘다. 알림 서버는 지금 이 키를 읽지 않는다 (모르는 키는 무시한다).
- `form`은 Eureka 등록 여부를 확인하지 못해 eureka 키가 없다. Redis 비밀번호 사용 여부도 미확인이라
  `spring.data.redis.password`는 넣지 않았다.
- `gateway-*.yml`의 `routing`은 `gateway-local.yml`을 그대로 복사했다. 유저 서비스 prefix 4개(`/auth`,
  `/admin`, `/trainee`, `/participant`)는 Expo-User-Server가 하나의 `expo-user-server`로 등록되므로 모두
  `expo-user-server`로 보낸다 (#6 참고).
- `application-{local,dev,prod}.yml`의 `port: 3000`은 초기 placeholder인데 전 서비스에 병합된다 (Spring
  서비스에서는 쓰이지 않는 키). 정리가 필요하다.
- Report 서비스의 `application.yaml`은 `spring.security.user.password: ${LOCAL_SECURITY_PASSWORD}`를
  기본값 없이 요구한다. 운영 설정 방식을 Report 쪽에서 정해야 한다.
