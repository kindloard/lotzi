import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../database/database.module";
import { GoogleMapsModule } from "../../integrations/google-maps/google-maps.module";
import { StoresModule } from "../stores/stores.module";
import { ShopsController } from "./shops.controller";
import { ShopsService } from "./shops.service";

@Module({
  imports: [DatabaseModule, GoogleMapsModule, StoresModule],
  controllers: [ShopsController],
  providers: [ShopsService],
  exports: [StoresModule, ShopsService]
})
export class ShopsModule {}
