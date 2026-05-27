import { Global, Module } from "@nestjs/common";
import { I18nObservabilityController } from "./i18n-observability.controller";
import { ObservabilityController } from "./observability.controller";
import { ObservabilityService } from "./observability.service";

@Global()
@Module({
  controllers: [I18nObservabilityController, ObservabilityController],
  providers: [ObservabilityService],
  exports: [ObservabilityService]
})
export class ObservabilityModule {}
