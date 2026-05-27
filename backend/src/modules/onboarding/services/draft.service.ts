import { ConflictException, Injectable } from "@nestjs/common";
import {
  OnboardingStep,
  OnboardingValidationStatus,
  Prisma
} from "@prisma/client";
import { PrismaService } from "../../../database/prisma.service";
import { JsonRecord, ValidationIssue } from "../onboarding.types";

@Injectable()
export class DraftService {
  constructor(private readonly prisma: PrismaService) {}

  async save(
    input: {
      storeId: string;
      step: OnboardingStep;
      payload: JsonRecord;
      expectedVersion?: number;
      validationErrors?: ValidationIssue[];
    },
    tx: Prisma.TransactionClient = this.prisma
  ) {
    const existing = await tx.storeOnboardingDraft.findUnique({
      where: { storeId_step: { storeId: input.storeId, step: input.step } }
    });

    if (
      input.expectedVersion &&
      existing &&
      existing.version !== input.expectedVersion
    ) {
      throw new ConflictException("This onboarding draft has changed. Refresh and try again.");
    }

    const hasValidation = input.validationErrors !== undefined;
    const validationStatus = hasValidation
      ? input.validationErrors?.length
        ? OnboardingValidationStatus.INVALID
        : OnboardingValidationStatus.VALID
      : OnboardingValidationStatus.DRAFT;

    return tx.storeOnboardingDraft.upsert({
      where: { storeId_step: { storeId: input.storeId, step: input.step } },
      create: {
        storeId: input.storeId,
        step: input.step,
        stepPayload: input.payload as Prisma.InputJsonValue,
        validationStatus,
        validationErrors: (input.validationErrors ?? []) as unknown as Prisma.InputJsonValue
      },
      update: {
        stepPayload: input.payload as Prisma.InputJsonValue,
        validationStatus,
        validationErrors: (input.validationErrors ?? []) as unknown as Prisma.InputJsonValue,
        version: { increment: 1 },
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
      }
    });
  }
}
