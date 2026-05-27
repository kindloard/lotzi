import { Module } from "@nestjs/common";
import { RazorpayModule } from "../../integrations/razorpay/razorpay.module";

@Module({
  imports: [RazorpayModule]
})
export class PaymentsModule {}

