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

interface MailSendOptions {
  requireDelivery?: boolean;
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
      subject: "Verify your Lotzi account",
      template: "signup_otp",
      idempotencyKey,
      payload: { purpose: "EMAIL_SIGNUP" },
      html: `<p>Your Lotzi verification code is <strong>${otp}</strong>.</p><p>This code expires in 10 minutes.</p>`
    }, { requireDelivery: true });
  }

  async sendPasswordReset(email: string, resetUrl: string, idempotencyKey: string): Promise<void> {
    await this.enqueueAndTrySend({
      to: email,
      subject: "Reset your Lotzi password",
      template: "password_reset",
      idempotencyKey,
      payload: { resetUrl },
      html: `<p>Use this secure link to reset your Lotzi password:</p><p><a href="${resetUrl}">Reset password</a></p><p>This link expires in 30 minutes.</p>`
    });
  }

  async sendPasswordChangedNotice(email: string): Promise<void> {
    await this.enqueueAndTrySend({
      to: email,
      subject: "Your Lotzi password was changed",
      template: "password_changed",
      payload: {},
      html: "<p>Your Lotzi password was changed. If this was not you, contact support immediately.</p>"
    });
  }

  async sendEmailChangeOtp(email: string, otp: string, idempotencyKey: string): Promise<void> {
    await this.enqueueAndTrySend({
      to: email,
      subject: "Confirm your Lotzi email change",
      template: "email_change_otp",
      idempotencyKey,
      payload: { purpose: "EMAIL_CHANGE" },
      html: `<p>Your Lotzi email-change code is <strong>${otp}</strong>.</p><p>This code expires in 10 minutes.</p>`
    });
  }

  async sendAccountDeletionOtp(email: string, otp: string, idempotencyKey: string): Promise<void> {
    await this.enqueueAndTrySend({
      to: email,
      subject: "Confirm Lotzi account deletion",
      template: "account_delete_otp",
      idempotencyKey,
      payload: { purpose: "ACCOUNT_DELETE" },
      html: `<p>Your Lotzi account deletion code is <strong>${otp}</strong>.</p><p>This code expires in 10 minutes. Do not share it with anyone.</p>`
    });
  }

  private async enqueueAndTrySend(
    message: MailMessage,
    options: MailSendOptions = {}
  ): Promise<void> {
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

    if (outbox.status === OutboxStatus.SENT) {
      return;
    }

    if (!this.resend || !this.fromEmail) {
      const messageText = "Resend is not configured. Set RESEND_API_KEY and RESEND_FROM_EMAIL.";
      this.logger.warn(`${messageText} Email ${outbox.id} remains queued.`);
      await this.markPending(outbox.id, messageText);
      if (options.requireDelivery) {
        throw this.emailDeliveryUnavailable();
      }
      return;
    }

    if (options.requireDelivery) {
      try {
        await this.trySend(outbox.id, message);
      } catch {
        throw this.emailDeliveryUnavailable();
      }
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
      throw error;
    }
  }

  private async markPending(outboxId: string, messageText: string): Promise<void> {
    await this.prisma.emailOutbox.update({
      where: { id: outboxId },
      data: {
        status: OutboxStatus.PENDING,
        nextAttemptAt: new Date(Date.now() + 5 * 60 * 1000),
        lastError: messageText
      }
    });
  }

  private emailDeliveryUnavailable() {
    return new ServiceUnavailableException({
      code: "EMAIL_OTP_PROVIDER_UNAVAILABLE",
      message: "We could not send the verification email. Try again shortly.",
      retryable: true
    });
  }
}
