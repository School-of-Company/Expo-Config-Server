# MSA Config Server 설계

- **날짜**: 2026-09-21
- **대상 리포**: `Expo-Config-Server`
- **참고 사례**: `team-cowork/cowork-server` (`docs/configuration.md`) — Config Server + Vault 분리 패턴을 차용

## 배경

Expo(스타트업 박람회 프로젝트) MSA는 도메인 서비스 약 16개(유저: Auth/Trainee/Participant/Admin,
박람회: Expo/Training/Standard/Image, 폼: Survey/Form/Json, 문자: Sms/Alarm, 신청: Application,
참여: Attendance, 리포트: Excel)와 Gateway로 구성됨. 각 서비스가 설정 파일을 개별 관리하는 대신
중앙 Config Server에서 부트스트랩 시점에 설정을 받아가는 구조가 필요함.

## 목표

- 비민감 공통/서비스별 설정을 git(Config Server 자체 리포) 기반으로 중앙 관리
- 민감정보(DB 계정, JWT 서명 키, OAuth secret 등)는 Vault로 분리해 Config Server가 조회·병합
- 서비스는 부팅 시 Config Server 한 곳만 호출하면 필요한 설정을 전부 받음
- 환경(profile)별로 설정을 분리 관리

## 비목표 (Out of Scope)

- 핫 리로드: 설정 변경의 무중단 실시간 반영은 지원하지 않음. 재시작 시에만 재조회.
- Config Server 자체의 암복호화 로직 구현: 암호화는 Vault에 위임하고 Config Server는 직접 만들지 않음.
- 설정값 전용 별도 git 리포: 만들지 않고 `Expo-Config-Server` 리포 안에 native 파일로 둠.
- Vault 서버 자체의 프로비저닝/운영: 인프라 선행 작업으로 별도 진행. 이 스펙은 Config Server가
  이미 떠 있는 Vault를 어떻게 쓰는지만 다룸.

## 아키텍처

```
[Service] --GET /configs/:service/:profile--> [Config Server]
                                                     |
                                        +------------+------------+
                                        |                         |
                                [Native Provider]          [Vault Provider]
                                configs/*.yml (git,        Vault KV v2
                                Config Server 자체 리포)    secret/application,
                                                            secret/{service}
```

병합 우선순위 (높은 게 우선):

```
Vault secret/{service} > Vault secret/application > native configs/{service}-{profile}.yml
```

같은 키가 여러 소스에 있으면 우선순위 높은 쪽 값으로 덮어씀. 병합은 **deep merge**로 수행 —
예를 들어 native의 `db: { host, port }`에 Vault가 `db: { password }`만 갖고 있어도 host/port가
사라지지 않고 password만 추가/덮어쓰기됨 (top-level만 덮어쓰는 shallow merge는 형제 키 유실 위험이
있어 채택하지 않음).

## 컴포넌트

| 컴포넌트 | 역할 |
|---|---|
| `NativeConfigProvider` | `configs/{service}-{profile}.yml` 파일을 읽어 파싱 |
| `VaultConfigProvider` | Vault KV v2 API(`secret/data/application`, `secret/data/{service}`) 조회 |
| `ConfigMergeService` | 위 두 provider 결과를 우선순위대로 병합 |
| `ConfigController` | `GET /configs/:service/:profile` — 병합 결과를 JSON으로 응답 |
| 클라이언트 부트스트랩 유틸 | 16개 서비스가 공통으로 쓰는, `NestFactory.create` 전에 Config Server를 호출하는 작은 모듈/함수 |

## API 계약

`GET /configs/:service/:profile`

- `service`: 서비스 식별자 (예: `auth`, `expo`, `application`, `gateway`)
- `profile`: 환경 식별자 (예: `local`, `dev`, `prod`)
- 응답: 병합된 설정을 담은 단일 JSON 객체 (평탄화된 key-value)
- 실패 시:
  - `application-{profile}.yml`이 없음 (그 프로파일 자체가 정의되지 않음) → `404`.
    `{service}-{profile}.yml`만 없는 경우는 에러가 아님 — 공통 설정만 반환 (서비스가 아직
    자기 override가 없는 정상 상태).
  - Vault 조회 실패 (네트워크 오류, 인증 실패 등) → `503`
  - 클라이언트는 두 경우 모두 fail-fast 신호로 취급 (재시도 없이 기동 실패).

## 설정 파일 레이아웃 (native)

`Expo-Config-Server` 리포 안:

```
configs/
  application-local.yml       # 전체 공통 (local)
  application-prod.yml        # 전체 공통 (prod)
  auth-local.yml
  auth-prod.yml
  expo-local.yml
  expo-prod.yml
  ...
```

서비스별 파일은 `application-{profile}.yml`을 베이스로 덮어쓰는 것으로 취급 (native 레벨에서도
`application-*` → `{service}-*` 순으로 병합 후, 그 결과가 Vault 병합의 최하위 우선순위 입력이 됨).

## Vault 경로 레이아웃

| 경로 | 내용 |
|---|---|
| `secret/application` | 공통 시크릿 (예: 공유 API key) |
| `secret/{service}` | 서비스별 시크릿 (예: `secret/auth`의 DB 계정, JWT 서명 키) |

## 환경 (Profile)

기본 프로파일: `local`, `dev`, `prod`. 서비스가 늘어나거나 스테이징이 더 필요해지면 프로파일 추가는
native 파일 + Vault 경로만 늘리면 되므로 Config Server 코드 변경 없음.

> **가정**: 정확한 프로파일 이름 세트(예: `staging` 포함 여부)는 아직 팀 합의가 없어 `local`/`dev`/`prod` 3종을 기본값으로 둠. 실제 운영 환경이 확정되면 이 문서와 native 파일 네이밍만 갱신.

## 네트워크/접근 제어

cowork 사례와 동일하게 Config Server는 **내부 private network에서만 접근 가능**하도록 배포 시 제한.
서비스-Config Server 간 별도 인증 토큰은 두지 않음 (네트워크 격리로 대체). 이후 요구사항이 생기면
API key 헤더 검증을 추가하는 정도로 확장 가능.

## 에러 처리

- 서비스 부팅 시 Config Server 호출 실패 (네트워크 오류, 503 등) → 서비스는 재시도 없이 즉시 기동 실패
  (fail-fast). 재시도/서킷브레이커는 지금 범위에 넣지 않음 (YAGNI).
- Config Server 내부에서 Vault unreachable → native 값으로 폴백하지 않고 503 반환 (시크릿이 없는
  상태로 기동하는 것을 방지).

## 테스트 전략

- `ConfigMergeService`: 우선순위대로 병합되는지 (Vault 서비스 경로 > Vault 공통 > native) 단위테스트
- `VaultConfigProvider`: Vault mock(HTTP mock)으로 조회/에러 케이스 테스트
- `ConfigController`: 정상 응답(공통만 있는 경우 포함) / 404(`application-{profile}.yml` 자체가
  없는 미정의 profile) / 503(Vault 실패) 케이스
- 클라이언트 부트스트랩 유틸: Config Server 실패 시 fail-fast 하는지 단위테스트

## 클라이언트 통합 (16개 서비스 공통)

각 서비스의 `main.ts`에서 `NestFactory.create` 호출 전에 부트스트랩 유틸을 호출해 설정을 받아오고,
받아온 값을 `process.env` 또는 Nest `ConfigService`에 주입한 뒤 앱을 기동. 구체적인 배포 형태
(공유 npm 패키지 vs 코드 스니펫 복사)는 구현 계획 단계에서 결정.
