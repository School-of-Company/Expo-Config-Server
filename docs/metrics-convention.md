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
- 서비스 포트(`port`)와 달리 메트릭 포트는 모든 서비스가 같은 값(9464)을 쓴다. 한 호스트에 두 서비스를 함께
  띄우는 로컬 환경에서는 충돌하므로, 그때만 서비스별 파일에서 바꾼다.

## 규약

1. **Eureka metadata**: 각 인스턴스가 아래 세 키로 수집 여부를 알린다. Prometheus의 `eureka_sd_configs`가
   이 값으로 대상을 찾고, 서비스가 늘어도 Prometheus 설정은 바꾸지 않는다.

   | 키 | 값 | 의미 |
   |---|---|---|
   | `prometheus.scrape` | `"true"` | 이 인스턴스를 수집한다 |
   | `prometheus.port` | `"9464"` (`metrics.port`) | 메트릭 포트 |
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
