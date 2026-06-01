import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../database/database.module";
import { CartValidationService } from "./cart-validation.service";
import { CartController } from "./cart.controller";

@Module({
  imports: [DatabaseModule],
  controllers: [CartController],
  providers: [CartValidationService],
  exports: [CartValidationService]
})
export class CartModule {}
