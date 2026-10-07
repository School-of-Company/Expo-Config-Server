import { Controller, Get, Logger, Param } from '@nestjs/common';
import { ConfigMergeService } from './config-merge.service';
import { loadMergedConfig } from './config-request';
import { FlatConfig, flattenConfig } from './flatten-config';

/** Spring Cloud Config Client 가 기대하는 Environment 응답 */
export interface SpringEnvironment {
  name: string;
  profiles: string[];
  label: null;
  version: null;
  state: null;
  propertySources: { name: string; source: FlatConfig }[];
}

/**
 * Spring Cloud Config Client 호환 엔드포인트 (#12).
 * Spring 서비스는 `spring.config.import=configserver:http://<host>:<port>/spring` 으로 붙는다.
 *
 * 내용은 `/configs/:service/:profile` 와 같은 병합 결과(Vault `secret/{name}` > Vault `secret/application` >
 * yml)를 Spring 이 읽는 점 표기 키로 펼친 것이다. 기존 `/configs/...` 응답(Gateway·Form 이 쓰는 중첩 JSON)은
 * 바꾸지 않으려고 경로를 나눴다. label 은 지원하지 않고 무시한다.
 */
@Controller('spring')
export class SpringConfigController {
  private readonly logger = new Logger(SpringConfigController.name);

  constructor(private readonly configMergeService: ConfigMergeService) {}

  @Get(':name/:profile')
  getEnvironment(
    @Param('name') name: string,
    @Param('profile') profile: string,
  ): Promise<SpringEnvironment> {
    return this.load(name, profile);
  }

  @Get(':name/:profile/:label')
  getEnvironmentWithLabel(
    @Param('name') name: string,
    @Param('profile') profile: string,
  ): Promise<SpringEnvironment> {
    return this.load(name, profile);
  }

  private async load(
    name: string,
    profile: string,
  ): Promise<SpringEnvironment> {
    const merged = await loadMergedConfig(
      this.configMergeService,
      this.logger,
      name,
      profile,
    );
    return {
      name,
      profiles: [profile],
      label: null,
      version: null,
      state: null,
      propertySources: [
        { name: `${name}-${profile}`, source: flattenConfig(merged) },
      ],
    };
  }
}
