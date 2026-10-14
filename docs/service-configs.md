# 서비스별 설정 파일 (`configs/`)

**이 문서의 목적**: `configs/`의 서비스별 `dev`/`prod` yml은 뼈대만 있고 실제 값은 비어 있다. 값을 채우는
사람이 "어느 파일의 무엇을 채우고, 무엇은 yml이 아니라 Vault에 넣어야 하는지"를 한 번에 볼 수 있게
정리했다. 키 구성은 각 서비스 리포의 `application.yaml`/`.env.example`을 기준으로 잡았다.

## 서비스별 구성

| 식별자 | 서비스 리포 | yml에 있는 키 | Vault에 넣을 값 |
|---|---|---|---|
| `gateway` | Expo-Gateway (NestJS) | `port`, `eureka.serviceUrl`, `routing`, `rateLimit`, `publicPaths`, `docs`(dev만). `cors`는 넣지 않음 | `secret/gateway` → `jwt.publicKey` |
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

## Vault 조회 시간 제한 (#55)

한 번의 설정 요청은 Vault를 두 번 읽는다(`secret/application`, `secret/{service}`). 두 조회 전체에 **하나의
기한**을 두고, 연결·응답 헤더뿐 아니라 JSON 본문을 끝까지 받는 시간까지 포함한다. 기한을 넘기면 재시도 없이
`503`(`Vault is currently unavailable`)을 돌려준다. 서버 로그에는 서비스·프로파일과 "timeout" 사유만 남고 응답
본문은 남지 않는다.

- 기본값 5000ms. 환경변수 `VAULT_TIMEOUT_MS`(양의 정수, ms)로 바꾼다. 잘못된 값이면 config 서버가 기동하지 않는다.
- 소비 서비스 영향: Vault가 멈춰도 설정 요청은 약 5초 안에 `503`으로 끝난다. 서비스는 `fail-fast`로 기동에
  실패하므로(재시작 정책이 있으면 재시도), 런타임 기본 제한(수 분)까지 부팅이 매달리지 않는다. 소비 서비스 쪽
  HTTP 클라이언트 timeout은 이 값보다 길어야 503을 받을 수 있다 (Spring Config Client의 기본 read timeout은
  185초).

## Vault 응답 해석 (#56)

| Vault 응답 | 결과 |
|---|---|
| 200 + `data.data` 객체 (빈 `{}` 포함) | 그 값을 병합 |
| 404 (경로 없음, 최신 버전 soft delete·destroy, metadata 삭제) | 빈 시크릿으로 보고 계속 |
| 200인데 `data.data` 객체가 없음 (`{}`, `{"data":{}}`, `data.data: null` 등), JSON 아님 | `503` |
| 그 밖의 상태 코드, 연결 실패, 시간 초과 | `503` |

삭제 상태의 계약은 Vault 1.20 dev 서버에서 확인했다: `kv delete`·`kv destroy` 후 읽기는 `404` +
`{"data":{"data":null,"metadata":{"deletion_time":...,"destroyed":...}}}`, metadata까지 지우면 `404` +
`{"errors":[]}`이다. 즉 "의도적으로 비운 시크릿"은 항상 404나 200 + `data.data: {}`로 오므로, 200인데 구조가
깨진 응답은 프록시·잘못된 마운트(KV v1 등) 같은 이상으로 보고 native 값만 내려주지 않는다.

## 접근 제어 (중요)

`/configs/...`와 `/spring/...`는 HTTP Basic 인증을 지원한다 (#54, 자세한 내용은 `docs/config-access-auth.md`).
사용자 이름은 서비스 식별자, 비밀번호는 서비스마다 따로 두고, 인증된 서비스는 자기 식별자의 설정만 받는다.
**인증은 config 서버에 `CONFIG_CLIENT_CREDENTIALS`를 넣어야 켜진다.** 켜기 전에는 포트에 닿는 누구에게나 Vault
값까지 병합해 내려준다.

- 외부 방화벽이 막아도, **같은 서버의 다른 계정**은 `127.0.0.1:<port>`로 닿는다. 여러 사람이 쓰는 서버라면
  그 사람들이 개인키·DB 비밀번호를 읽을 수 있다. (glink.kr 서버에서 실제로 확인했고, 그래서 그 서버는 JWT 개인키를
  Vault에 두지 않고 환경변수로만 유저 서비스에 넣는다.)
- 따라서 **인증을 켜기 전까지는**, 접근을 막을 수 없는 환경에서 `secret/{service}`에 민감한 값(개인키, DB 비밀번호,
  내부 토큰)을 넣지 않는다. 그런 환경에서는 해당 서비스에 환경변수로 직접 넣는다.
- 인증을 켜도 막지 못하는 것(config 서버 자신의 환경, 평문 전송, `secret/application`)은
  `docs/config-access-auth.md`의 마지막 절에 있다.

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
  SMS는 세 프로필 모두 `POST /sms`, `POST /sms/verify`, `GET /sms`만 공개하며 `/sms` 접두사 전체를
  공개하지 않는다. `/sms`는 `expo-notification-server`로 라우팅한다 (#26).
  `rateLimit.sms`는 IP별 세 SMS 경로 합산 60초에 10건이고, 기본 500건/60초와 설문 제출
  300건/60초 제한도 함께 유지한다. Gateway는 `/sms` 및 `/sms/*` 요청을 SMS 예산에 포함하므로
  인증에서 거부되는 SMS 요청도 예산을 소비한다. Gateway의 기본 메모리 저장소는 인스턴스별이며
  재시작하면 초기화된다. 여러 인스턴스의 합산 제한이나 알림 서버의 번호별/전체 시간당 제한을
  대체하지 않는다.
- `gateway-dev.yml`은 통합 API 문서(`docs`, Expo-Gateway#30)를 켜되 운영과 같이 **문서 전용 Basic 인증**이 있어야만
  연다(#84). `docs.requireAuth: true`라 Vault dev `secret/gateway`의 `docs.basicAuth.username`·`docs.basicAuth.password`
  (비밀번호 12자 이상)가 없으면 dev Gateway가 부팅하지 않는다. **Vault dev에 이 값을 넣은 뒤에 배포한다.**
  문서 화면·서비스 OpenAPI JSON은 `publicPaths`에 열지 않는다. 열어 두면 Basic 인증을 켜도 경로 표기에 따라 Basic
  검사를 거치지 않고 JSON이 나간다(Gateway의 문서 경로 판정과 `publicPaths` 경로 정규화가 다르다). dev는 Try it out을
  켜 둔다. `docs.services`에는 `/{접두사}/v3/api-docs` 규칙을 따르는 7개 서비스(참여·폼·유저·박람회·신청·알림·리포트)를
  넣는다. 각 서비스 런타임에서 `SWAGGER_ENABLED=true`로 켜야 JSON이 나온다. Notification은 `true`/`false` 외의 값을
  거부한다. Gateway PR #44의 문서 조회 SMS 예산 제외가 먼저 배포돼야 `/sms/v3/api-docs` 조회가 SMS 한도를 소비하지 않는다.
  CORS를 추가하는 경우에는 쓰기 Try it out을 위해 dev Gateway 자신의 정확한 origin도 허용해야 한다.
  현재 BFF 호출 계약에 따라 CORS는 추가하지 않는다. 서비스를 추가할 때 `docs.services`만 고친다.
  `gateway-local.yml`에는 넣지 않는다.
  `gateway-prod.yml`도 통합 문서(`docs`)를 켜되 **문서 전용 Basic 인증**이 있어야만 열린다(Expo-Gateway#50).
  `docs.requireAuth: true`라 Vault `secret/gateway`의 `docs.basicAuth.username`·`docs.basicAuth.password`
  (비밀번호 12자 이상)가 없으면 Gateway가 부팅하지 않고, `tryItOut: false`로 운영에서 Try it out을 끈다.
  운영 설정에는 서비스 문서 JSON·Swagger 화면을 `publicPaths`로 열지 않는다(JWT 없이 공개하지 않는다).
  각 서비스 서버에 `SWAGGER_ENABLED=true`가 있어야 JSON이 나온다. **Gateway가 Expo-Gateway#50(Basic 인증)을 포함한
  버전으로 배포된 뒤에만 이 설정을 배포한다.** 그 전 버전은 `basicAuth`·`requireAuth`를 몰라 문서를 인증 없이 연다.
  `gateway-local.yml`에는 넣지 않는다.
- 참가자 전화 인증·신청 참가자 경로(#53, Expo-Gateway#25/#29/#35). 세 프로필 모두 `/participant-auth`를
  `expo-user-server`로 라우팅한다(`/participant`는 세그먼트 경계로 매칭해 `/participant-auth`를 잡지 않는다).
  `/internal`은 라우팅하지 않는다. 공개 경로는 메서드를 지정한 15개 항목만 연다. User 4개와 Application 11개이며,
  Application에는 #75의 참가자 목록·QR GET이 포함된다. 접두사 항목으로 열지 않는다. `{name}`은 숫자 또는 UUID 한
  세그먼트에만, `{name:A|B}`는 나열 값에만 매칭한다. 이 문법은 Gateway #35부터 동작하고, 이전 Gateway는 문자 그대로
  비교해 해당 경로가 401로 남는다. `rateLimit.participantAuthCode`(IP별 600초에 5건)도 #35부터 읽는다. 이전
  Gateway는 이 키를 무시해 `POST /participant-auth/code`에 기본 제한만 걸리므로, 이 설정은 Gateway #35가
  운영(main)에 배포된 뒤에 main으로 내보낸다.
  같은 문법을 쓰는 `GET /image/{id}`(#64)와 `GET /training/program/{expoId}`(#69)도 같은 조건이다. 연수 프로그램
  목록은 Expo-Client 참가자 연수 사전신청 제출이 토큰 없이 읽는다. `GET /standard/program/{expoId}`는 참가자 화면이
  호출하지 않아(Expo-Client는 관리자 토큰으로만 호출, Expo-Web은 Gateway를 부르지 않음) 열지 않는다.
  `cors`는 넣지 않았다. 현재 브라우저가 Gateway를 직접 부르는 프론트가 없다. Expo-Client는 Next BFF가 서버에서
  호출해 `Origin`이 없고, Expo-Web은 Gateway를 부르지 않는다. 확정된 프론트 origin도 없다. `cors`를 넣으면
  목록 밖 `Origin`의 쓰기가 403이 되므로, 브라우저 직접 호출을 도입할 때 정확한 origin 목록과 함께 넣는다(dev
  `/docs` Try-it-out을 쓰면 Gateway 자신의 origin도 넣는다).
- `application-{local,dev,prod}.yml`의 `port: 3000`은 초기 placeholder인데 전 서비스에 병합된다 (Spring
  서비스에서는 쓰이지 않는 키). 정리가 필요하다.
- Report 서비스의 `application.yaml`은 `spring.security.user.password: ${LOCAL_SECURITY_PASSWORD}`를
  기본값 없이 요구한다. 운영 설정 방식을 Report 쪽에서 정해야 한다.

### SMS 프록시 검증 (#26)

Gateway develop `590427fbb4b8226b88b3dd2903e3d126ab096ab9`에서 선택적 `rateLimit.sms`,
메서드/정확한 경로 공개 매칭, IP별 SMS 합산 카운팅을 확인했다. Gateway 변경은 필요 없다.
Config Server와 Gateway에서 각각 `npm ci`와 `npm run build` 후 실행한다:

```bash
node scripts/verify-gateway.mjs /path/to/Expo-Gateway
```

검증은 실제 `dist/main.js` 프로세스를 부팅하고 Config Server의 실제 프로필 파일을 HTTP로
공급한다. Vault KV 응답은 테스트용 공개키와 loopback Eureka 주소만 병합한다. Eureka와
upstream은 로컬 HTTP stub이며 실제 알림 서버, SMS 업체, 운영 Vault에는 연결하지 않는다.

local/dev/prod 각각의 관측 결과:

| 시나리오 | 결과 |
|---|---|
| `GET /configs/gateway/{profile}` 및 기존 제한/라우팅 보존 | 200, 기본 500 / 설문 300 / SMS 10 |
| 미허용 메서드 5종, `GET /sms/verify`, 미허용 하위/유사 경로 3종 | 9건 모두 401, upstream 호출 0건 |
| 동일 IP로 세 공개 SMS API를 교대로 호출 | 1~10번째 200, 메서드/URL/본문 그대로 upstream 도달 |
| 동일 IP의 11번째 SMS 요청 | 429, `Retry-After-sms` 양수, upstream 호출은 10건 유지 |
| 다른 IP의 SMS 검증(후행 슬래시 포함), 제한된 IP의 auth/설문 제출 | 각각 200 |

실제 dev/prod 인프라, 유료 SMS 발송, 알림 서버 Vault/부팅(#17), 다중 Gateway의 통합 예산은
검증 범위 밖이다. 아래 참가자 시나리오와 같은 스크립트에서 함께 돈다. Gateway 기존 SMS e2e는 최초 실행에서 성공 시나리오가 401로 실패했으나,
동일 develop의 단독 및 전체 재실행에서는 통과했다. 원인은 확인하지 못했으며 위 실제 부팅
검증은 세 프로필 모두 통과했다.

### 참가자 인증·신청 프록시 검증 (#53)

같은 스크립트가 Gateway develop `b3aec9a`(#35 머지)에서 local/dev/prod 각각 다음을 확인한다.
JWT는 스크립트가 만든 테스트 키로 서명하고, upstream은 Eureka 앱 이름별 로컬 stub이다. 실제 User/알림
서버와 SMS 업체에는 연결하지 않는다.

| 시나리오 | 결과 |
|---|---|
| 공개 15개 항목 17건(UUID/숫자 id, 열거값 포함), JWT 없이 `PARTICIPANT_SESSION` 쿠키로 호출 | 200. User/Application stub에 메서드·URL·Cookie 그대로 도달, `Set-Cookie` 그대로 반환 |
| 다른 메서드, 숫자/UUID가 아닌 단어, 목록 밖 열거값, 세그먼트 추가/누락, `GET /application`, `/participant`, `/expo` 15건 | 모두 401, upstream 0건 |
| `/internal/**`, `/participant-auth/internal/x`, `/application/internal/x`, `/application/%69nternal/x` | JWT 없으면 401, 유효 JWT면 404, upstream 0건 |
| 유효 JWT의 `GET /expo` | 200 (보호 경로 프록시 유지) |
| 같은 IP의 `POST /participant-auth/code` | 1~5번째 200, 6번째와 `%63ode` 변형 429(`Retry-After-participantAuthCode`), upstream 5건 |
| 다른 IP의 code, 제한된 IP의 verify·`POST /sms`·신청 등록 | 각각 200 |

Gateway main `a031b5f`(현재 운영)에서는 같은 설정으로 부팅과 SMS 시나리오가 통과하고, placeholder 항목은
401로 남는다(fail-closed). `participantAuthCode`는 무시된다.
