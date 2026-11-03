/**
 * Paste your Firebase web app config here.
 * Firebase console → Project settings → Your apps → SDK setup.
 */

// Thêm "export" ở trước const firebaseConfig
export const firebaseConfig = {
  apiKey: "AIzaSyCWdbat0XOE_pA4mbNCQXAHiRsDnarDS1c",
  authDomain: "flashcard-app-76b36.firebaseapp.com",
  projectId: "flashcard-app-76b36",
  storageBucket: "flashcard-app-76b36.firebasestorage.app",
  messagingSenderId: "163217102177",
  appId: "1:163217102177:web:ac54bb408efeac379fa120",
  measurementId: "G-31XY3TKT3F"
};

export const isFirebaseConfigured = !String(firebaseConfig.apiKey).startsWith("YOUR_");
