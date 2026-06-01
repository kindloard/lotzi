import { Body, Controller, Post, Res } from "@nestjs/common";
import type { Response } from "express";
import { CartValidationService } from "./cart-validation.service";
import { CartValidationDto } from "./dto/cart-validation.dto";

@Controller("v1/cart")
export class CartController {
  constructor(private readonly validation: CartValidationService) {}

  @Post("validate")
  validate(
    @Body() dto: CartValidationDto,
    @Res({ passthrough: true }) response: Response
  ) {
    response.setHeader("Cache-Control", "no-store, max-age=0, must-revalidate");
    return this.validation.validate(dto);
  }
}
