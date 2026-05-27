import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

@Injectable()
export class ProcessingSemaphore {
  private active = 0;
  private readonly limit: number;

  constructor(config: ConfigService) {
    this.limit = config.get<number>("UPLOAD_PROCESSING_CONCURRENCY", 2);
  }

  tryAcquire(): (() => void) | null {
    if (this.active >= this.limit) {
      return null;
    }
    this.active += 1;
    let released = false;
    return () => {
      if (released) {
        return;
      }
      released = true;
      this.active = Math.max(0, this.active - 1);
    };
  }
}
