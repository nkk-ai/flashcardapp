import {
  addDoc,
  collection,
  onSnapshot,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-functions.js";
import { getDownloadURL, ref, uploadBytes } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-storage.js";
import { auth, db, functions, storage } from "./firebase-init.js";
import { showBanner, watchAuth } from "./auth.js";
import { extractTextFromFile } from "./extract.js";

const listEl = document.querySelector("[data-sets]");
const emptyEl = document.querySelector("[data-empty]");
const form = document.querySelector("[data-upload]");
const whoEl = document.querySelector("[data-who]");
let unsub = null;

watchAuth({
  requireUser: true,
  onUser(user) {
    if (!user) {
      return;
    }
    if (whoEl) {
      whoEl.textContent = user.displayName || user.email;
    }
    listenToSets(user.uid);
  },
});

form?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const user = auth.currentUser;
  if (!user) {
    return;
  }

  const data = new FormData(form);
  const file = data.get("file");
  const title = String(data.get("title") || "").trim() || (file && file.name) || "Untitled set";
  if (!(file instanceof File) || !file.size) {
    showBanner("Choose a file to upload.");
    return;
  }

  const submit = form.querySelector("button[type='submit']");
  submit.disabled = true;
  showBanner("Uploading and preparing your study set…");
  let setRef = null;

  try {
    const extractedText = await extractTextFromFile(file);
    setRef = await addDoc(collection(db, "sets"), {
      ownerId: user.uid,
      title,
      fileName: file.name,
      status: "uploading",
      errorMessage: "",
      extractedText,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    const storageRef = ref(storage, `uploads/${user.uid}/${setRef.id}/${file.name}`);
    await uploadBytes(storageRef, file);
    const fileUrl = await getDownloadURL(storageRef);

    await updateDoc(setRef, {
      status: "generating",
      fileUrl,
      updatedAt: serverTimestamp(),
    });

    const generateStudySet = httpsCallable(functions, "generateStudySet");
    await generateStudySet({ setId: setRef.id });
    form.reset();
    showBanner("Study set is ready.");
  } catch (err) {
    if (setRef) {
      try {
        await updateDoc(setRef, {
          status: "error",
          errorMessage: humanAppError(err).slice(0, 400),
          updatedAt: serverTimestamp(),
        });
      } catch (_updateErr) {
        /* keep the original error visible */
      }
    }
    showBanner(humanAppError(err));
  } finally {
    submit.disabled = false;
  }
});

function listenToSets(uid) {
  if (unsub) {
    unsub();
  }
  const setsQuery = query(collection(db, "sets"), where("ownerId", "==", uid));
  unsub = onSnapshot(
    setsQuery,
    (snap) => {
      const sets = snap.docs
        .map((item) => ({ id: item.id, ...item.data() }))
        .sort((a, b) => {
          const aTime = a.createdAt && a.createdAt.toMillis ? a.createdAt.toMillis() : 0;
          const bTime = b.createdAt && b.createdAt.toMillis ? b.createdAt.toMillis() : 0;
          return bTime - aTime;
        });
      renderSets(sets);
    },
    (err) => {
      showBanner(
        err.code === "failed-precondition"
          ? "Create the Firestore index prompted in the browser console, then reload."
          : err.message
      );
    }
  );
}

function renderSets(sets) {
  if (!listEl) {
    return;
  }
  listEl.innerHTML = "";
  if (emptyEl) {
    emptyEl.hidden = sets.length > 0;
  }
  sets.forEach((set) => {
    const card = document.createElement("article");
    card.className = "set-card";
    const status = set.status || "uploading";
    card.innerHTML = `
      <span class="pill ${status}">${status}</span>
      <h3></h3>
      <p class="muted"></p>
      <div class="row"></div>
    `;
    card.querySelector("h3").textContent = set.title || "Untitled";
    card.querySelector("p").textContent = set.errorMessage
      ? set.errorMessage
      : `${set.fileName || "file"} · ${set.questionCount || 0} questions · ${set.cardCount || 0} cards`;

    const row = card.querySelector(".row");
    if (status === "ready") {
      row.append(
        linkButton(`study.html?id=${set.id}&mode=quiz`, "Quiz"),
        linkButton(`study.html?id=${set.id}&mode=cards`, "Flashcards")
      );
    }
    listEl.appendChild(card);
  });
}

function linkButton(href, label) {
  const a = document.createElement("a");
  a.className = "btn btn-primary";
  a.href = href;
  a.textContent = label;
  return a;
}

function humanAppError(err) {
  const message = (err && (err.message || err.code)) || "Upload failed.";
  if (String(message).includes("generateStudySet")) {
    return "Generation function is not deployed yet. Deploy functions and set GEMINI_API_KEY. See README.";
  }
  return message;
}
