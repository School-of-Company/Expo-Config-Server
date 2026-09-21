# Config Server Architecture Rules

## Layer Structure

```
config/
├── deep-merge.ts               — 순수 함수. I/O 없음, NestJS 의존성 없음.
├── native-config.provider.ts   — 파일 I/O. configs/*.yml 읽기.
├── vault-config.provider.ts    — HTTP I/O. Vault KV v2 조회.
├── config-merge.service.ts     — 조합. provider들을 호출하고 deep-merge로 합친다.
├── config.controller.ts        — 진입점. 파라미터 검증과 에러→HTTP 상태 매핑만.
└── config.module.ts            — 와이어링만.
```

## Dependency Direction

```
config.controller → config-merge.service → native-config.provider
                                          → vault-config.provider
```

Reverse dependencies are forbidden (e.g., provider가 service를 알거나, service가 controller를 알면 안 됨).

## File Responsibilities

- `*.controller.ts`: 라우트 정의, 파라미터 검증(화이트리스트 정규식), 에러 타입→HTTP 상태 매핑만. 병합 로직이나 I/O를 직접 하지 않는다.
- `*.service.ts`: provider 호출 순서·병합 orchestration. 파일 읽기나 fetch를 직접 하지 않는다.
- `*.provider.ts`: 외부 I/O(파일시스템, HTTP)만. 비즈니스 로직(우선순위 판단 등)을 넣지 않는다.
- `deep-merge.ts`: 순수 함수 유지. 이 파일에 I/O나 NestJS 데코레이터를 추가하지 않는다.

## Error Contract

- `ProfileNotFoundError` (native provider가 던짐) → controller에서 404
- `VaultUnavailableError` (vault provider가 던짐) → controller에서 503
- 그 외 에러는 잡지 않고 그대로 propagate (swallow하지 않는다)

## Abstraction Principle

- Do not introduce abstractions before a second real use case exists.
  예: provider가 2개(native, vault)뿐인 지금 상태에서 공통 `ConfigSource` 인터페이스를 만들지 않는다.
  세 번째 provider(예: 별도 시크릿 매니저)가 실제로 추가될 때 판단한다.
- Move shared utilities out only when used in three or more places.

## Route Parameter Safety

- `service`, `profile` 라우트 파라미터는 파일 경로(`native-config.provider.ts`)와 Vault API 경로
  (`vault-config.provider.ts`)를 구성하는 데 그대로 쓰인다. 컨트롤러 진입점에서 화이트리스트
  정규식(`^[A-Za-z0-9][A-Za-z0-9_-]*$` 형태)으로 검증하지 않으면 path traversal로 이어진다.
  새로운 라우트 파라미터를 추가할 때도 동일한 검증을 거친다.

## Async

- 모든 I/O는 `async`/`await`. Promise 체이닝 대신 async/await로 통일한다.
- 외부 호출(Vault)은 Node 26 전역 `fetch`를 쓴다. 별도 HTTP 클라이언트 라이브러리를 추가하지 않는다.
