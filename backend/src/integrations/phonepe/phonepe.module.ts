import { Module } from "@nestjs/common";
import { PhonepeClient } from "./phonepe.client";

@Module({
  providers: [PhonepeClient],
  exports: [PhonepeClient]
})
export class PhonepeModule {}
