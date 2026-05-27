import {
  Body,
  BadRequestException,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards
} from "@nestjs/common";
import { OnboardingStep } from "@prisma/client";
import { AuthenticatedRequest } from "../auth/auth.types";
import { AccessTokenGuard } from "../auth/guards/access-token.guard";
import { CsrfGuard } from "../auth/guards/csrf.guard";
import {
  AttachMediaDto,
  CompleteStepDto,
  DraftPayloadDto,
  LaunchOnboardingDto,
  MediaSignatureDto,
  parseOnboardingStep
} from "./dto/onboarding.dto";
import { BrandingService } from "./services/branding.service";
import { OnboardingService } from "./services/onboarding.service";

@Controller("merchant/onboarding")
@UseGuards(AccessTokenGuard)
export class OnboardingController {
  constructor(
    private readonly onboarding: OnboardingService,
    private readonly branding: BrandingService
  ) {}

  @Get()
  bootstrap(@Req() request: AuthenticatedRequest) {
    return this.onboarding.bootstrap(request.auth!);
  }

  @Patch("drafts/:step")
  @UseGuards(CsrfGuard)
  saveDraft(
    @Req() request: AuthenticatedRequest,
    @Param("step") step: string,
    @Body() dto: DraftPayloadDto
  ) {
    return this.onboarding.saveDraft(request.auth!, this.step(step), dto);
  }

  @Post("steps/:step/complete")
  @UseGuards(CsrfGuard)
  completeStep(
    @Req() request: AuthenticatedRequest,
    @Param("step") step: string,
    @Body() dto: CompleteStepDto
  ) {
    return this.onboarding.completeStep(request.auth!, this.step(step), dto);
  }

  @Post("media/signature")
  @UseGuards(CsrfGuard)
  mediaSignature(@Req() request: AuthenticatedRequest, @Body() dto: MediaSignatureDto) {
    return this.branding.createSignature(request.auth!, dto);
  }

  @Post("media/attach")
  @UseGuards(CsrfGuard)
  attachMedia(@Req() request: AuthenticatedRequest, @Body() dto: AttachMediaDto) {
    return this.branding.attach(request.auth!, dto);
  }

  @Post("launch")
  @UseGuards(CsrfGuard)
  launch(@Req() request: AuthenticatedRequest, @Body() dto: LaunchOnboardingDto) {
    return this.onboarding.launch(request.auth!, dto);
  }

  private step(value: string): OnboardingStep {
    const step = parseOnboardingStep(value);
    if (!step) {
      throw new BadRequestException("Unsupported onboarding step.");
    }
    return step as OnboardingStep;
  }
}
