import { ConfigRecord, isPlainObject } from './deep-merge';

export type FlatValue = string | number | boolean;
export type FlatConfig = Record<string, FlatValue>;

/**
 * Spring Cloud Config 의 `propertySources[].source` 형식으로 펼친다.
 *
 * - 중첩 객체는 점으로 잇는다: `{ spring: { datasource: { url } } }` → `spring.datasource.url`
 * - 배열은 `key[0]` 으로 펼친다. 배열 안의 객체도 계속 펼친다: `servers[0].host`
 * - 문자열·숫자·불리언은 타입을 그대로 둔다 (Spring 이 바인딩할 때 변환한다).
 * - `null` 과 빈 객체·빈 배열은 키를 만들지 않는다. Spring 은 값이 없는 키를 "설정 안 됨"으로 보므로
 *   기본값이 그대로 쓰이게 된다.
 * - 키 안의 점은 그대로 둔다 (`prometheus.scrape` → `...metadata-map.prometheus.scrape`).
 *   Spring 은 Map 바인딩에서 나머지 경로를 키로 쓰므로 같은 값으로 읽힌다.
 */
export function flattenConfig(config: ConfigRecord): FlatConfig {
  const result: FlatConfig = {};
  flattenInto(result, config, '');
  return result;
}

function flattenInto(result: FlatConfig, value: unknown, path: string): void {
  if (value === null || value === undefined) {
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      flattenInto(result, item, `${path}[${index}]`),
    );
    return;
  }
  if (isPlainObject(value)) {
    for (const [key, child] of Object.entries(value)) {
      flattenInto(result, child, path === '' ? key : `${path}.${key}`);
    }
    return;
  }
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    if (path !== '') {
      result[path] = value;
    }
  }
}
