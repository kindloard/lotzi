import { Injectable, Logger } from "@nestjs/common";
import { AuditOutcome, Prisma } from "@prisma/client";
import { AuditRepository } from "./audit.repository";

export interface AuditEvent {
  eventType: string;
  actor?: string;
  actorUserId?: string;
  outcome: AuditOutcome;
  metadata?: Prisma.InputJsonValue;
  ip?: string;
  requestId?: string;
  sessionId?: string;
  storeId?: string;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly repository: AuditRepository) {}

  record(event: AuditEvent): void {
    void this.write(event);
  }

  async write(event: AuditEvent): Promise<void> {
    try {
      const auditLog = await this.repository.createLog({
        data: {
          eventType: event.eventType,
          actor: event.actor,
          actorUser: event.actorUserId ? { connect: { id: event.actorUserId } } : undefined,
          store: event.storeId ? { connect: { id: event.storeId } } : undefined,
          outcome: event.outcome,
          metadata: event.metadata ?? {},
          ipAddress: event.ip,
          requestId: event.requestId,
          session: event.sessionId ? { connect: { id: event.sessionId } } : undefined
        }
      });

      await this.repository.createOutbox({
        data: {
          auditLogId: auditLog.id,
          eventType: event.eventType,
          payload: {
            id: auditLog.id,
            ...event
          } as Prisma.InputJsonObject
        }
      });
    } catch (error) {
      this.logger.error(
        `Failed to write audit event ${event.eventType}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }
}
