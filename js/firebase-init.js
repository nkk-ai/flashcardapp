import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js";
import { getAuth, GoogleAuthProvider } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-storage.js";
import { getFunctions } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-functions.js";
import { firebaseConfig, isFirebaseConfigured } from "./firebase-config.js";

if (!isFirebaseConfigured()) {
  console.warn(
    "LearnKit: replace the placeholders in js/firebase-config.js with your Firebase web config."
  );
}

export const firebaseReady = isFirebaseConfigured();
export const app = firebaseReady ? initializeApp(firebaseConfig) : null;
export const auth = app ? getAuth(app) : null;
export const db = app ? getFirestore(app) : null;
export const storage = app ? getStorage(app) : null;
export const functions = app ? getFunctions(app, "us-central1") : null;
export const googleProvider = new GoogleAuthProvider();
