import { Module } from "@nestjs/common";
import { StoresModule } from "../stores/stores.module";

@Module({
  imports: [StoresModule],
  exports: [StoresModule]
})
export class ShopsModule {}
