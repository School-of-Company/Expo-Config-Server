import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { createPino, JsonLogger, readLogEnv } from './logging/json-logger';

Logger.overrideLogger(
  new JsonLogger(
    createPino({ service: 'expo-config-server', ...readLogEnv() }),
  ),
);

async function bootstrap() {
  // AppModule validates the env while it is loaded: load it after the JSON
  // logger is installed so a missing variable is logged as JSON too.
  const { AppModule } = await import('./app.module');
  const app = await NestFactory.create(AppModule);
  await app.listen(process.env.PORT ?? 3000);
}

bootstrap().catch((err: unknown) => {
  new Logger('Bootstrap').fatal(err instanceof Error ? err : String(err));
  process.exit(1);
});
