import { Module } from "@nestjs/common";
import { RealtimeCatalogGateway } from "./realtime-catalog.gateway";

@Module({
  providers: [RealtimeCatalogGateway],
  exports: [RealtimeCatalogGateway]
})
export class RealtimeModule {}
