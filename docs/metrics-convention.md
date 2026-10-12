# 서비스 공통 메트릭 규약 (#8)

MSA 서비스 전체를 공용 Prometheus·Grafana(`Expo-Monitoring`, Expo-Gateway#12)에서 한 화면으로 보려고 정한
규약이다. 서비스가 Spring(Kotlin)과 NestJS로 섞여 있어서, 포트·경로·지표 이름·라벨이 서비스마다 다르면
Eureka 기반 자동 수집과 공통 대시보드가 동작하지 않는다.

**이 문서의 목적**: Config Server는 아래 `metrics` 값을 내려줄 뿐이고, 값을 어떻게 쓰는지는 각 서비스가
구현한다. 그 약속이 코드에 드러나지 않아서 한곳에 남긴다. 독자는 서비스에 메트릭을 붙이는 개발자와
`Expo-Monitoring`을 운영하는 사람이다. **적용은 각 서비스에서 진행한다**(이 저장소는 값과 규약만 제공).

## 공통 설정

`configs/application-{local,dev,prod}.yml`이 모든 서비스에 내려준다.

```yaml
metrics:
  enabled: true
  port: 9464   # 서비스 포트와 분리. 외부 publish 금지
```

- `metrics.enabled: false`를 서비스별 파일(`{service}-{profile}.yml`)에 두면 그 서비스만 끈다.
- 공통 값 9464는 **한 호스트에 메트릭 listener가 하나뿐일 때만** 그대로 쓸 수 있다. local·dev·prod 어느
  환경이든 같은 호스트(또는 같은 네트워크 네임스페이스)에서 두 서비스 이상이 메트릭 listener를 열면 두 번째
  서비스가 포트 충돌로 기동하지 못하거나 메트릭이 수집되지 않는다. 지금 배포는 모든 서비스가 한 서버
  (`deploy.yml`의 단일 환경)에 함께 뜨므로 **운영도 해당된다.**
- 그래서 메트릭을 켜는 서비스마다 서로 다른 포트를 서비스별로 준다. 비밀 값이 아니므로 서비스별 파일
  (`{service}-{profile}.yml`)의 `metrics.port`에 둔다 (Vault `secret/{service}`의 같은 키도 동작하지만 yml보다
  우선해서 파일만 보고는 실제 값을 알 수 없다). 같은 키는 서비스별 값이 공통 값보다 우선한다
  (`test/metrics-port.e2e-spec.ts`가 `/configs`, `/spring` 응답으로 검증한다).
  Vault `secret/application`에는 `metrics.port`를 두지 않는다. 공용 Vault 값은 모든 서비스의 yml override보다
  우선해서 전 서비스를 다시 한 포트로 모은다.
- Gateway는 config의 `metrics.port`가 아니라 자기 환경변수 `METRICS_PORT`로 listener를 연다(아래 표). Gateway
  포트는 `gateway-{profile}.yml`이 아니라 Gateway의 `METRICS_PORT`로 바꾼다.
- 포트 값은 배포 담당자가 서버에서 실제로 비어 있는 포트를 확인해 정한다. **이 저장소에는 아직 서비스별 할당이
  없다** — 확인되지 않은 값을 임의로 넣지 않는다. 할당이 정해지면 아래 표를 채우고 서비스별 파일에 반영한다.

  | 서비스 | 메트릭 listener | 현재 포트 출처 | 할당 |
  |---|---|---|---|
  | `gateway` | 있음 (Gateway `src/metrics/`) | Gateway 환경변수 `METRICS_PORT`(기본 9464). config의 `metrics.port`는 읽지 않는다 | 미정 |
  | `auth`, `expo`, `apply`, `report` (Spring) | 없음 (`/actuator/prometheus`가 서비스 포트에 있음, `management.server.port` 미설정) | - | 적용 시 정함 |
  | `form`, `notification` | 없음 | - | 적용 시 정함 |

  (각 서비스 리포 develop 기준 확인, 2026-10-12. 운영 서버의 실제 바인딩·`.env` 값은 확인하지 못했다.)
- Eureka metadata의 `prometheus.port`는 **실제 listener가 연 포트**와 같아야 한다. Prometheus는 이 값으로
  `<인스턴스 IP>:<prometheus.port>`를 수집하므로, override한 `metrics.port`와 metadata가 어긋나면 서비스는
  떠도 수집이 실패한다. Spring은 아래 예시처럼 둘 다 `${metrics.port}`로 묶고, Gateway처럼 환경변수로 포트를
  받는 서비스는 그 환경변수와 metadata가 같은 값을 쓰는지 확인한다. 실제 listener 기동과 Prometheus 수집 확인은
  각 서비스와 `Expo-Monitoring` 담당 범위다.

## 규약

1. **Eureka metadata**: 각 인스턴스가 아래 세 키로 수집 여부를 알린다. Prometheus의 `eureka_sd_configs`가
   이 값으로 대상을 찾고, 서비스가 늘어도 Prometheus 설정은 바꾸지 않는다.

   | 키 | 값 | 의미 |
   |---|---|---|
   | `prometheus.scrape` | `"true"` | 이 인스턴스를 수집한다 |
   | `prometheus.port` | `${metrics.port}` (서비스별 값, 공통 기본 9464) | 메트릭 포트 — 실제 listener 포트와 같아야 한다 |
   | `prometheus.path` | `/metrics` 또는 `/actuator/prometheus` | 메트릭 경로 |

2. **HTTP 지표 이름 통일**: `http_server_requests_seconds`(Histogram), 라벨은 `method`, `status`, `uri`.
   `uri`는 **라우트 템플릿만** 쓴다(`/forms/{id}`). 원문 경로·쿼리스트링·사용자 ID를 넣지 않는다
   (라벨 값이 무한히 늘어나 Prometheus가 무거워진다).
3. **보안**: 메트릭 포트는 내부 네트워크 전용이다. 서비스 포트나 Gateway를 통해 노출하지 않고, 메트릭에
   토큰·키·사용자 식별자를 넣지 않는다.

Gateway는 기존 `gateway_http_*`를 유지한다. 공용 대시보드는 recording rule로 공통 이름을 맞춘다
(Expo-Gateway#12).

## Spring (Kotlin)

의존성: `spring-boot-starter-actuator`, `micrometer-registry-prometheus`.

```yaml
management:
  server:
    port: ${metrics.port}
  endpoints:
    web:
      exposure:
        include: prometheus,health
  metrics:
    distribution:
      percentiles-histogram:
        http.server.requests: true   # p95 계산용 버킷

eureka:
  instance:
    metadata-map:
      "[prometheus.scrape]": "true"
      "[prometheus.port]": ${metrics.port}
      "[prometheus.path]": /actuator/prometheus
```

Micrometer가 `http_server_requests_seconds_*`를 `method`, `status`, `uri` 라벨로 내보내므로 규약 2번은 기본값
그대로 충족한다. 키에 점이 들어 있어서 `metadata-map`에는 대괄호 표기가 필요하다.

## NestJS

- `prom-client`로 서비스 포트와 **별도 listener**에서 `GET /metrics`만 응답한다. Expo-Gateway의
  `src/metrics/`(`MetricsService`, `startMetricsServer`)가 참고 구현이다. 공개 포트에 `/metrics`를 두면
  JWT·rate limit·프록시를 우회해 외부에 노출될 수 있다.
- `http_server_requests_seconds`를 위 이름·라벨(`method`, `status`, `uri`)로 기록한다. `uri`에는
  `req.route.path` 같은 라우트 템플릿을 쓰고, 템플릿이 없는 요청(404)은 고정 값 하나(`unmatched`)로 묶는다.
  `method`는 표준 동사만 쓰고 나머지는 `OTHER`로 묶는다.
- 기본 런타임 지표는 `collectDefaultMetrics`로 포함한다.
- `nestjs-eureka`의 `instance.metadata`에 규약 1번의 세 키를 넣는다.

## 정해지지 않은 것

- 서비스별 적용 시점과 담당자. 각 서비스 저장소에 이슈로 올려 진행한다.
- 지연 시간 히스토그램의 버킷 경계. Spring은 위 설정의 기본 버킷을, NestJS는 Gateway의
  `LATENCY_BUCKETS`를 출발점으로 두되, 같은 쿼리로 합치려면 경계를 맞춰야 하므로 공용 대시보드를 만들 때
  확정한다.
