import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updateProfile,
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";
import { doc, serverTimestamp, setDoc } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";
import { auth, db, googleProvider, firebaseReady } from "./firebase-init.js";

const banner = document.querySelector("[data-banner]");

export function showBanner(message) {
  if (!banner) {
    return;
  }
  banner.textContent = message;
  banner.classList.toggle("show", Boolean(message));
}

export function requireConfig() {
  if (!firebaseReady) {
    showBanner("Add your Firebase web config in js/firebase-config.js, then reload.");
    return false;
  }
  return true;
}

export function watchAuth({ onUser, requireUser, redirectIfSignedIn }) {
  if (!requireConfig()) {
    return;
  }
  onAuthStateChanged(auth, async (user) => {
    if (user) {
      await ensureUserDoc(user);
      if (redirectIfSignedIn) {
        window.location.replace(redirectIfSignedIn);
        return;
      }
    } else if (requireUser) {
      window.location.replace("index.html");
      return;
    }
    if (onUser) {
      onUser(user);
    }
  });
}

async function ensureUserDoc(user) {
  await setDoc(
    doc(db, "users", user.uid),
    {
      displayName: user.displayName || user.email || "Learner",
      email: user.email || "",
      updatedAt: serverTimestamp(),
      createdAt: serverTimestamp(),
    },
    { merge: true }
  );
}

export async function signInEmail(email, password) {
  await signInWithEmailAndPassword(auth, email, password);
}

export async function registerEmail(email, password, displayName) {
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  if (displayName) {
    await updateProfile(cred.user, { displayName });
  }
}

export async function signInGoogle() {
  await signInWithPopup(auth, googleProvider);
}

export async function logOut() {
  await signOut(auth);
  window.location.replace("index.html");
}

export function bindLandingAuth() {
  if (!requireConfig()) {
    return;
  }

  const signInForm = document.querySelector("[data-signin]");
  const registerForm = document.querySelector("[data-register]");
  const tabButtons = document.querySelectorAll("[data-auth-tab]");

  tabButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const tab = button.dataset.authTab;
      signInForm.hidden = tab !== "signin";
      registerForm.hidden = tab !== "register";
      tabButtons.forEach((item) => item.classList.toggle("btn-primary", item === button));
      tabButtons.forEach((item) => item.classList.toggle("btn-ghost", item !== button));
    });
  });

  signInForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(signInForm);
    try {
      showBanner("");
      await signInEmail(String(data.get("email")), String(data.get("password")));
    } catch (err) {
      showBanner(humanAuthError(err));
    }
  });

  registerForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(registerForm);
    try {
      showBanner("");
      await registerEmail(
        String(data.get("email")),
        String(data.get("password")),
        String(data.get("name") || "")
      );
    } catch (err) {
      showBanner(humanAuthError(err));
    }
  });

  document.querySelector("[data-google]")?.addEventListener("click", async () => {
    try {
      showBanner("");
      await signInGoogle();
    } catch (err) {
      showBanner(humanAuthError(err));
    }
  });
}

function humanAuthError(err) {
  const code = err && err.code;
  if (code === "auth/invalid-credential" || code === "auth/wrong-password") {
    return "Email or password is incorrect.";
  }
  if (code === "auth/email-already-in-use") {
    return "That email is already registered. Sign in instead.";
  }
  if (code === "auth/weak-password") {
    return "Use a password with at least 6 characters.";
  }
  if (code === "auth/popup-closed-by-user") {
    return "Google sign-in was closed before finishing.";
  }
  return err && err.message ? err.message : "Could not sign in.";
}

const landing = document.querySelector("[data-page='landing']");
if (landing) {
  bindLandingAuth();
  watchAuth({ redirectIfSignedIn: "app.html" });
}

document.querySelectorAll("[data-logout]").forEach((button) => {
  button.addEventListener("click", () => logOut());
});
