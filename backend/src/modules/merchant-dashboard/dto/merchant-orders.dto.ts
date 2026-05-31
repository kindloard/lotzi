import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsUUID } from "class-validator";

export class MerchantOrderStatusUpdateDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @IsUUID("4", { each: true })
  orderIds!: string[];

  @IsIn(["MARK_PACKED", "MOVE_TO_REFUND_REVIEW"])
  action!: "MARK_PACKED" | "MOVE_TO_REFUND_REVIEW";
}
