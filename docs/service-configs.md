# 서비스별 설정 파일 (`configs/`)

**이 문서의 목적**: `configs/`의 서비스별 `dev`/`prod` yml은 뼈대만 있고 실제 값은 비어 있다. 값을 채우는
사람이 "어느 파일의 무엇을 채우고, 무엇은 yml이 아니라 Vault에 넣어야 하는지"를 한 번에 볼 수 있게
정리했다. 키 구성은 각 서비스 리포의 `application.yaml`/`.env.example`을 기준으로 잡았다.

## 서비스별 구성

| 식별자 | 서비스 리포 | yml에 있는 키 | Vault에 넣을 값 |
|---|---|---|---|
| `gateway` | Expo-Gateway (NestJS) | `port`, `eureka.serviceUrl`, `routing`, `rateLimit`, `publicPaths` | `secret/gateway` → `jwt.publicKey` |
| `auth` | Expo-User-Server (Spring) | `spring.datasource.url/username`, `spring.data.redis`, `eureka.client` | `secret/auth` → `spring.datasource.password`, `jwt.privateKey` |
| `expo` | Expo-Expo-Server (Spring) | 위와 같음 (DB `expo`) | `secret/expo` → `spring.datasource.password` |
| `apply` | Expo-Application-Server (Spring) | 위와 같음 (DB `expo_application`) | `secret/apply` → `spring.datasource.password` |
| `report` | Expo-Report-Server (Spring) | `spring.datasource.url/username`, `eureka.client` (Redis 없음) | `secret/report` → `spring.datasource.password` |
| `form` | Expo-Form-Server (NestJS) | `port`, `database.sslRejectUnauthorized`(prod만) | `secret/form` → `database.url` (접속 계정 포함 전체 URL) |

`auth`는 `auth`/`user` 중 무엇으로 할지 아직 미확정이다 (`docs/jwt-signing-key.md` 참고). Spring 서비스의
키는 Spring 속성 이름 그대로 중첩해 두었다. 나중에 Spring 호환 엔드포인트를 붙일 때 평탄화만 하면 되게
하려는 것이고, 그 결정 전까지는 이 구조가 확정은 아니다.

## 값 채우기

- `<EUREKA_HOST>`, `<DB_HOST>`, `<REDIS_HOST>`는 일부러 유효하지 않은 값이다. 안 채우고 배포하면 서비스가
  연결 실패로 바로 드러난다. `grep -rn "<[A-Z_]*>" configs/`로 남은 자리를 찾는다.
- DB 이름과 계정(`expo_user`, `expo` 등)은 각 서비스의 로컬 기본값을 따왔다. 실제 환경과 다르면 고친다.
- **비밀 값은 yml에 쓰지 않는다.** 위 표의 Vault 값은 `secret/{식별자}`에 넣는다. 이 리포는 public이라
  한 번 커밋하면 지워도 공개된 것으로 봐야 한다. DB/Redis 호스트 같은 내부 주소를 public 리포에 올릴지도
  먼저 정한다.
- 반영 순서: 브랜치에서 수정 → `develop`으로 PR → config 서버 이미지 재배포 → 각 서비스 재시작
  (config 서버는 `configs/`를 이미지에 담고, 서비스는 부팅 시에만 설정을 읽는다).

## 예약어: `application`

`application`은 서비스 식별자로 쓰면 안 된다. `application-{profile}.yml`은 **전 서비스 공용 파일**이고
`secret/application`은 **전 서비스 공용 Vault 경로**라서, 신청(Application) 서비스를 `application`으로
부르면 그 서비스 전용 시크릿이 모든 서비스에 내려간다. 그래서 신청 서비스는 `apply`로 두었다.

## 아직 없거나 미확인인 것

- `sms`, `attendance`는 서비스 리포가 아직 없어서 파일이 없다. `training`/`standard`/`image`는 Gateway
  라우팅에는 있지만 `expo` 서비스 안에 있는지 별도 서비스인지 확인되지 않아 만들지 않았다. 확정되면
  파일을 추가하고 `src/config/configs-files.spec.ts`의 `SERVICES`에도 넣는다.
- `form`은 Eureka 등록 여부를 확인하지 못해 eureka 키가 없다. Redis 비밀번호 사용 여부도 미확인이라
  `spring.data.redis.password`는 넣지 않았다.
- `gateway-*.yml`의 `routing`은 `gateway-local.yml`을 그대로 복사했다. 유저 서비스 prefix 4개(`/auth`,
  `/admin`, `/trainee`, `/participant`)는 Expo-User-Server가 하나의 `expo-user-server`로 등록되므로 모두
  `expo-user-server`로 보낸다 (#6 참고).
- `application-{local,dev,prod}.yml`의 `port: 3000`은 초기 placeholder인데 전 서비스에 병합된다 (Spring
  서비스에서는 쓰이지 않는 키). 정리가 필요하다.
- Report 서비스의 `application.yaml`은 `spring.security.user.password: ${LOCAL_SECURITY_PASSWORD}`를
  기본값 없이 요구한다. 운영 설정 방식을 Report 쪽에서 정해야 한다.
