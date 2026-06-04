import { Injectable } from "@nestjs/common";
import { ObservabilityService } from "../observability/observability.service";
import type { GeoCoordinates } from "./geo-utils";

type CircuitState = "closed" | "half_open" | "open";
type FraudDecision = "allow" | "throttle" | "reject";

const OPEN_MS = 30_000;
const FAILURE_THRESHOLD = 5;

@Injectable()
export class GeoFraudService {
  private state: CircuitState = "closed";
  private failures = 0;
  private openedUntil = 0;

  constructor(private readonly observability: ObservabilityService) {}

  async assess(_input: {
    coordinates: GeoCoordinates;
    ip: string;
    userId?: string | null;
    deviceId?: string | null;
  }): Promise<FraudDecision> {
    const state = this.currentState();
    this.observability.setGeoFraudCircuitState(state);

    if (state === "open") {
      return "throttle";
    }

    try {
      const decision = await withTimeout(localFraudSignal(), 10);
      this.recordSuccess();
      return decision;
    } catch {
      this.recordFailure();
      return "throttle";
    }
  }

  private currentState(): CircuitState {
    if (this.state === "open" && Date.now() >= this.openedUntil) {
      this.state = "half_open";
    }
    return this.state;
  }

  private recordSuccess(): void {
    this.failures = 0;
    this.state = "closed";
    this.observability.setGeoFraudCircuitState("closed");
  }

  private recordFailure(): void {
    this.failures += 1;
    if (this.failures >= FAILURE_THRESHOLD) {
      this.state = "open";
      this.openedUntil = Date.now() + OPEN_MS;
      this.observability.setGeoFraudCircuitState("open");
    }
  }
}

async function localFraudSignal(): Promise<FraudDecision> {
  return "allow";
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("geo fraud signal timed out")), timeoutMs);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}
