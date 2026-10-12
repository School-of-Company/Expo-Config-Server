# 설정 API 접근 인증 (#54)

**이 문서의 목적**: `/configs/...`와 `/spring/...`는 Vault 비밀까지 병합해 내려준다. 이 문서는 인증을 켜는 순서,
소비 서비스 설정, 자격증명 교체 방법과 이 방식이 막지 못하는 것을 정리한다. 독자는 config 서버와 소비 서비스를
배포하는 사람이다.

## 동작

- HTTP Basic 인증이다. **사용자 이름은 서비스 식별자**(`gateway`, `auth`, `notification` ...)이고, 비밀번호는
  서비스마다 다르다.
- 인증된 서비스는 **자기 식별자의 설정만** 받는다. `/configs/{service}/...`, `/spring/{name}/...`의 식별자가
  사용자 이름과 다르면 `403`이다.
- 헤더가 없거나, 형식이 틀리거나, 비밀번호가 틀리거나, 모르는 서비스면 `401` + `WWW-Authenticate: Basic realm="config"`.
  두 경로(`/configs`, `/spring`, label 경로 포함) 모두 같고, 응답에 설정 값은 들어가지 않는다.
- 인증을 통과한 뒤의 계약(병합, Spring 변환, `400`/`404`/`503`)은 그대로다.
- 서버 로그에는 거부된 요청의 서비스 식별자만 남고 헤더·비밀번호는 남지 않는다.

### 왜 서비스별 비밀번호인가

Vault 값은 서비스마다 다르다. `secret/auth`에는 JWT 개인키·DB 비밀번호·내부 토큰이 있고, `secret/{service}`마다
DB 비밀번호가 있다 (`docs/service-configs.md`). 공용 자격증명 하나를 모든 서비스가 나눠 가지면, 외부에 열린
Gateway 하나만 뚫려도 그 자격증명으로 `auth`의 개인키까지 읽는다. 공용 자격증명은 **누가** 호출하는지 구분하지
못하므로 서비스 간 격리를 제공하지 않는다. 지금 소비자는 모두 자기 식별자만 조회하므로(아래 표) 서비스별로 묶어도
깨지는 호출이 없다.

## config 서버 설정

환경변수 `CONFIG_CLIENT_CREDENTIALS`에 서비스 → 비밀번호 JSON을 준다. 서버의 `.env`(또는 pm2 ecosystem)에만
두고 이 리포·`configs/*.yml`·Vault `secret/application`에는 넣지 않는다.

```text
CONFIG_CLIENT_CREDENTIALS={"gateway":"<gateway 비밀번호>","notification":"<notification 비밀번호>"}
```

- 없거나 빈 값이면 **인증이 꺼진다**(지금과 같음). 기동 로그에
  `CONFIG_CLIENT_CREDENTIALS is not set: config API authentication is disabled` 경고가 남는다.
- 값이 있으면 모든 설정 요청에 인증을 요구한다. 목록에 없는 서비스는 `401`이다.
- 형식이 틀리면(JSON 아님, 빈 객체, 빈 비밀번호, 식별자 형식 위반) config 서버가 기동하지 않는다. 오류 메시지에
  값은 나오지 않는다.
- 비밀번호는 서비스마다 새로 만든다. 예: `openssl rand -hex 32` (16진수라 JSON·Basic 인증 어디서도 이스케이프가
  필요 없다). 같은 비밀번호를 두 서비스에 쓰지 않는다.

## 소비 서비스 (2026-10-12, 각 리포 develop 기준)

| 서비스 | 지금 config 서버 호출 | 인증 설정 |
|---|---|---|
| Gateway | `GET /configs/gateway/{PROFILE}` (필수) | `CONFIG_SERVER_PASSWORD` (Expo-Gateway#45 배포 필요) |
| Notification | `CONFIG_SERVER_URL`이 있을 때만 `GET /configs/{CONFIG_SERVICE_NAME:-notification}/{CONFIG_PROFILE}` | `CONFIG_SERVER_PASSWORD` (Expo-Notification-Server#36 배포 필요). 사용자 이름은 `CONFIG_SERVICE_NAME` 값 |
| Form | 호출하지 않음 (`.env`만 사용) | 없음 |
| User·Expo·Application·Report·Attendance (Spring) | 호출하지 않음 (`spring.config.import: configserver:` 없음, `spring-cloud-starter-config` 없음) | 붙일 때 아래 Spring 설정 |

- Gateway·Notification은 비밀번호가 없으면 헤더 없이 호출한다. 그래서 소비 서비스를 먼저 배포해도 인증이 꺼진
  config 서버와 그대로 동작한다.
- 비밀번호를 `CONFIG_SERVER_URL`에 `user:pass@host`로 넣지 않는다. Node `fetch`가 거부하고, Gateway 오류 메시지는
  URL을 그대로 출력한다.
- Spring 서비스는 Spring Cloud Config Client의 기본 Basic 인증을 쓴다. 비밀번호는 환경변수로 준다.

  ```yaml
  spring:
    cloud:
      config:
        name: auth                                  # 서비스 식별자 = 사용자 이름
        username: auth
        password: ${CONFIG_SERVER_PASSWORD}
  ```

## 켜는 순서

운영 서버(glink.kr)의 실제 `.env`·pm2 설정과 각 서비스의 실제 `CONFIG_SERVER_URL` 사용 여부는 이 작업에서 확인하지
못했다. 아래 순서는 그 확인을 포함한다.

1. **config 서버 배포 (인증 꺼짐)**: 이 변경을 배포한다. `CONFIG_CLIENT_CREDENTIALS`가 없으므로 동작은 그대로다.
2. **소비 서비스 확인**: 서버에서 각 서비스의 `.env`/pm2 설정에 `CONFIG_SERVER_URL`이 있는지 **이름만** 확인한다.
   있는 서비스가 인증 대상이다 (코드상 Gateway는 필수, Notification은 선택).
3. **소비 서비스 배포**: 대상 서비스의 인증 헤더 PR을 배포하고, 각자 `.env`에 자기 `CONFIG_SERVER_PASSWORD`를
   넣고 재시작한다. config 서버가 아직 인증을 안 하므로 헤더가 있어도 결과는 같다.
4. **인증 켜기**: config 서버 `.env`에 2단계의 모든 대상 서비스를 담은 `CONFIG_CLIENT_CREDENTIALS`를 넣고 config
   서버를 재시작한다. 이미 떠 있는 서비스는 부팅 때만 설정을 읽으므로 영향이 없다.
5. **확인**: 헤더 없는 요청이 `401`인지, 각 서비스를 재시작해 정상 기동하는지 본다. 비밀번호가 명령 인자·셸
   히스토리에 남지 않게 stdin으로 넘긴다.

   ```bash
   curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:<config 포트>/configs/gateway/<profile>   # 401
   printf 'user = "gateway:%s"\n' "$CONFIG_SERVER_PASSWORD" | \
     curl -s -o /dev/null -w '%{http_code}\n' -K - http://127.0.0.1:<config 포트>/configs/gateway/<profile>  # 200
   ```

6. **그 다음에만** 접근을 막을 수 없는 환경의 민감한 값(개인키, DB 비밀번호, 내부 토큰)을 Vault에 넣는다.

되돌리기: config 서버 `.env`에서 `CONFIG_CLIENT_CREDENTIALS`를 지우고 재시작하면 인증이 꺼진다. 소비 서비스는
헤더를 보내도 그대로 동작하므로 되돌릴 필요가 없다.

## 비밀번호 교체·폐기

서비스는 부팅할 때만 설정을 읽으므로 무중단 교체에 별도 기능이 필요 없다.

1. 새 비밀번호를 만든다.
2. config 서버 `CONFIG_CLIENT_CREDENTIALS`의 그 서비스 값을 바꾸고 config 서버를 재시작한다.
3. 바로 이어서 그 서비스의 `CONFIG_SERVER_PASSWORD`를 바꾸고 재시작한다.

2와 3 사이에 그 서비스가 재시작되면 `401`로 기동에 실패한다(fail-fast). 폐기는 2단계에서 키를 지운다.
유출이 의심되면 그 서비스의 Vault 비밀(`secret/{service}`)도 함께 교체한다.

## 이 방식이 막지 못하는 것

- **config 서버 자신**: config 서버의 환경에는 모든 서비스 비밀번호와 `VAULT_TOKEN`이 있다. 이 환경(파일·프로세스)을
  읽을 수 있는 계정은 모든 비밀을 읽는다.
- **같은 서버의 다른 계정**: 소비 서비스의 `.env`나 프로세스 환경을 읽을 수 있으면 그 서비스의 비밀번호, 즉 그
  서비스의 설정을 얻는다. 파일 권한으로 막아야 한다.
- **평문 전송**: TLS가 없으므로 Basic 헤더는 평문이다. config 서버는 loopback·내부망에서만 받는다. 같은 호스트에서
  loopback 트래픽을 볼 수 있는 계정(root 등)은 비밀번호를 본다.
- **공용 경로 `secret/application`**: 인증된 모든 서비스에 병합된다. 여기 넣은 값은 서비스별 격리가 없다
  (그래서 개인키는 여기 넣지 않는다, `docs/jwt-signing-key.md`).
- **비밀번호 재사용**: 두 서비스에 같은 비밀번호를 주거나, 한 서비스가 다른 식별자(`CONFIG_SERVICE_NAME`)와 그
  비밀번호를 쓰면 격리는 사라진다.
- 실패 횟수 제한은 없다. 비밀번호를 충분히 길게(위 `openssl rand -hex 32`) 만드는 것으로 대신한다.
