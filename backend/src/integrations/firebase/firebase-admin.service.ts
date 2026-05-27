import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { App, cert, getApps, initializeApp, ServiceAccount } from "firebase-admin/app";
import { Auth, getAuth } from "firebase-admin/auth";

@Injectable()
export class FirebaseAdminService {
  private appInstance?: App;
  private authInstance?: Auth;

  constructor(config: ConfigService) {
    this.projectId = config.get<string>("FIREBASE_PROJECT_ID");
    this.clientEmail = config.get<string>("FIREBASE_CLIENT_EMAIL");
    this.privateKey = config
      .get<string>("FIREBASE_PRIVATE_KEY")
      ?.replace(/\\n/g, "\n");
    this.serviceAccountPath = config.get<string>("FIREBASE_SERVICE_ACCOUNT_PATH");
    this.serviceAccountJson = config.get<string>("FIREBASE_SERVICE_ACCOUNT_JSON");
  }

  private readonly projectId?: string;
  private readonly clientEmail?: string;
  private readonly privateKey?: string;
  private readonly serviceAccountPath?: string;
  private readonly serviceAccountJson?: string;

  get app(): App {
    if (this.appInstance) {
      return this.appInstance;
    }
    const serviceAccount = this.getServiceAccount();

    this.appInstance = getApps().length
      ? getApps()[0]
      : initializeApp({
          credential: cert(serviceAccount)
        });

    return this.appInstance;
  }

  get auth(): Auth {
    this.authInstance ??= getAuth(this.app);
    return this.authInstance;
  }

  private getServiceAccount(): ServiceAccount {
    if (this.serviceAccountJson) {
      return this.parseServiceAccount(this.serviceAccountJson);
    }

    if (this.serviceAccountPath) {
      const filePath = isAbsolute(this.serviceAccountPath)
        ? this.serviceAccountPath
        : resolve(process.cwd(), this.serviceAccountPath);
      return this.parseServiceAccount(readFileSync(filePath, "utf8"));
    }

    if (this.projectId && this.clientEmail && this.privateKey) {
      return {
        projectId: this.projectId,
        clientEmail: this.clientEmail,
        privateKey: this.privateKey
      };
    }

    throw new Error(
      "Firebase Admin credentials are not configured. Set FIREBASE_SERVICE_ACCOUNT_PATH, FIREBASE_SERVICE_ACCOUNT_JSON, or split Firebase Admin env vars."
    );
  }

  private parseServiceAccount(rawJson: string): ServiceAccount {
    const parsed = JSON.parse(rawJson) as {
      project_id?: string;
      projectId?: string;
      client_email?: string;
      clientEmail?: string;
      private_key?: string;
      privateKey?: string;
    };

    const projectId = parsed.projectId ?? parsed.project_id;
    const clientEmail = parsed.clientEmail ?? parsed.client_email;
    const privateKey = parsed.privateKey ?? parsed.private_key;

    if (!projectId || !clientEmail || !privateKey) {
      throw new Error("Firebase service account JSON is missing project_id, client_email, or private_key.");
    }

    return {
      projectId,
      clientEmail,
      privateKey
    };
  }
}
