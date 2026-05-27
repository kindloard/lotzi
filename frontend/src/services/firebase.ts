import { FirebaseApp, getApps, initializeApp } from "firebase/app";
import { Auth, getAuth } from "firebase/auth";

let app: FirebaseApp | undefined;
let auth: Auth | undefined;

export function getFirebaseAuth() {
  if (auth) {
    return auth;
  }

  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
  const authDomain = process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN;
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;

  if (!apiKey || !authDomain || !projectId) {
    throw new Error("Firebase Google sign-in is not configured.");
  }

  app = getApps().length
    ? getApps()[0]
    : initializeApp({
        apiKey,
        authDomain,
        projectId
      });
  auth = getAuth(app);
  return auth;
}
