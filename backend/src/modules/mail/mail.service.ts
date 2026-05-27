import { Injectable, Logger, ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { OutboxStatus, Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { Resend } from "resend";
import { PrismaService } from "../../database/prisma.service";

interface MailMessage {
  to: string;
  subject: string;
  template: string;
  html: string;
  payload: Prisma.InputJsonValue;
  idempotencyKey?: string;
}

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly resend?: Resend;
  private readonly fromEmail?: string;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService
  ) {
    const apiKey = config.get<string>("RESEND_API_KEY");
    this.fromEmail = config.get<string>("RESEND_FROM_EMAIL");
    this.resend = apiKey ? new Resend(apiKey) : undefined;
  }

  async sendSignupOtp(email: string, otp: string, idempotencyKey: string): Promise<void> {
    await this.enqueueAndTrySend({
      to: email,
      subject: "Verify your Namastore account",
      template: "signup_otp",
      idempotencyKey,
      payload: { purpose: "EMAIL_SIGNUP" },
      html: `<p>Your Namastore verification code is <strong>${otp}</strong>.</p><p>This code expires in 10 minutes.</p>`
    });
  }

  async sendPasswordReset(email: string, resetUrl: string, idempotencyKey: string): Promise<void> {
    await this.enqueueAndTrySend({
      to: email,
      subject: "Reset your Namastore password",
      template: "password_reset",
      idempotencyKey,
      payload: { resetUrl },
      html: `<p>Use this secure link to reset your Namastore password:</p><p><a href="${resetUrl}">Reset password</a></p><p>This link expires in 30 minutes.</p>`
    });
  }

  async sendPasswordChangedNotice(email: string): Promise<void> {
    await this.enqueueAndTrySend({
      to: email,
      subject: "Your Namastore password was changed",
      template: "password_changed",
      payload: {},
      html: "<p>Your Namastore password was changed. If this was not you, contact support immediately.</p>"
    });
  }

  async sendEmailChangeOtp(email: string, otp: string, idempotencyKey: string): Promise<void> {
    await this.enqueueAndTrySend({
      to: email,
      subject: "Confirm your Namastore email change",
      template: "email_change_otp",
      idempotencyKey,
      payload: { purpose: "EMAIL_CHANGE" },
      html: `<p>Your Namastore email-change code is <strong>${otp}</strong>.</p><p>This code expires in 10 minutes.</p>`
    });
  }

  async sendAccountDeletionOtp(email: string, otp: string, idempotencyKey: string): Promise<void> {
    await this.enqueueAndTrySend({
      to: email,
      subject: "Confirm Namastore account deletion",
      template: "account_delete_otp",
      idempotencyKey,
      payload: { purpose: "ACCOUNT_DELETE" },
      html: `<p>Your Namastore account deletion code is <strong>${otp}</strong>.</p><p>This code expires in 10 minutes. Do not share it with anyone.</p>`
    });
  }

  private async enqueueAndTrySend(message: MailMessage): Promise<void> {
    let outbox;
    try {
      outbox = await this.prisma.emailOutbox.upsert({
        where: { idempotencyKey: message.idempotencyKey ?? randomUUID() },
        update: {},
        create: {
          toEmail: message.to,
          subject: message.subject,
          template: message.template,
          payload: message.payload,
          idempotencyKey: message.idempotencyKey
        }
      });
    } catch (error) {
      this.logger.error(
        `Email outbox write failed: ${error instanceof Error ? error.message : String(error)}`
      );
      throw new ServiceUnavailableException("Email delivery is temporarily unavailable.");
    }

    if (!this.resend || !this.fromEmail) {
      this.logger.warn(`Resend is not configured. Email ${outbox.id} remains queued.`);
      return;
    }

    void this.trySend(outbox.id, message).catch((error) => {
      this.logger.error(
        `Background email send failed for ${outbox.id}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    });
  }

  private async trySend(outboxId: string, message: MailMessage): Promise<void> {
    if (!this.resend || !this.fromEmail) {
      return;
    }

    try {
      await this.resend.emails.send({
        from: this.fromEmail,
        to: message.to,
        subject: message.subject,
        html: message.html
      });

      await this.prisma.emailOutbox.update({
        where: { id: outboxId },
        data: {
          status: OutboxStatus.SENT,
          sentAt: new Date(),
          attempts: { increment: 1 },
          lastError: null
        }
      });
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error);
      this.logger.error(`Resend send failed for ${outboxId}: ${messageText}`);
      await this.prisma.emailOutbox.update({
        where: { id: outboxId },
        data: {
          status: OutboxStatus.PENDING,
          attempts: { increment: 1 },
          nextAttemptAt: new Date(Date.now() + 5 * 60 * 1000),
          lastError: messageText
        }
      });
    }
  }
}
