import { GoogleAuthProvider, signInWithPopup, signOut } from "firebase/auth";
import { getFirebaseAuth } from "@/services/firebase";

export async function signInWithGoogle() {
  if (process.env.NODE_ENV !== "production" && process.env.NEXT_PUBLIC_E2E_GOOGLE_ID_TOKEN) {
    return process.env.NEXT_PUBLIC_E2E_GOOGLE_ID_TOKEN;
  }
  const firebaseAuth = getFirebaseAuth();
  const credential = await signInWithPopup(firebaseAuth, new GoogleAuthProvider());
  return credential.user.getIdToken();
}

export async function signOutGoogle() {
  await signOut(getFirebaseAuth()).catch(() => undefined);
}
