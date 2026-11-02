import {
  collection,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";
import { auth, db } from "./firebase-init.js";
import { showBanner, watchAuth } from "./auth.js";

const params = new URLSearchParams(window.location.search);
const setId = params.get("id");
const mode = params.get("mode") === "cards" ? "cards" : "quiz";

const titleEl = document.querySelector("[data-study-title]");
const metaEl = document.querySelector("[data-study-meta]");
const barEl = document.querySelector("[data-progress] span");
const stageEl = document.querySelector("[data-stage]");
const actionsEl = document.querySelector("[data-actions]");

watchAuth({
  requireUser: true,
  onUser(user) {
    if (user) {
      loadSet(user.uid);
    }
  },
});

async function loadSet(uid) {
  if (!setId) {
    showBanner("Missing study set id.");
    return;
  }
  const setSnap = await getDoc(doc(db, "sets", setId));
  if (!setSnap.exists() || setSnap.data().ownerId !== uid) {
    showBanner("This study set is not available.");
    return;
  }
  const setData = setSnap.data();
  if (titleEl) {
    titleEl.textContent = setData.title || "Study set";
  }
  if (metaEl) {
    metaEl.textContent = mode === "cards" ? "Flashcards" : "Multiple choice quiz";
  }
  if (setData.status !== "ready") {
    showBanner("This set is still generating. Return to the dashboard in a moment.");
    return;
  }

  if (mode === "cards") {
    const cards = await loadItems("cards");
    startFlashcards(uid, cards);
  } else {
    const questions = await loadItems("quiz");
    startQuiz(uid, questions);
  }
}

async function loadItems(sub) {
  const snap = await getDocs(collection(db, "sets", setId, sub));
  return snap.docs
    .map((item) => ({ id: item.id, ...item.data() }))
    .sort((a, b) => (a.order || 0) - (b.order || 0));
}

function startQuiz(uid, questions) {
  if (!questions.length) {
    showBanner("No quiz questions were generated.");
    return;
  }
  let index = 0;
  let score = 0;
  let locked = false;

  const render = () => {
    const item = questions[index];
    updateProgress(index, questions.length);
    stageEl.innerHTML = `<h2></h2><div class="quiz-options"></div><div class="explain" hidden></div>`;
    stageEl.querySelector("h2").textContent = item.question;
    const optionsEl = stageEl.querySelector(".quiz-options");
    const explainEl = stageEl.querySelector(".explain");
    item.options.forEach((option, optionIndex) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = option;
      button.addEventListener("click", () => {
        if (locked) {
          return;
        }
        locked = true;
        const correct = optionIndex === item.correctIndex;
        if (correct) {
          score += 1;
          button.classList.add("correct");
        } else {
          button.classList.add("wrong");
          const right = optionsEl.children[item.correctIndex];
          if (right) {
            right.classList.add("correct");
          }
        }
        explainEl.hidden = false;
        explainEl.textContent = item.explanation || (correct ? "Correct." : "Review this one.");
        actionsEl.innerHTML = "";
        const next = document.createElement("button");
        next.className = "btn btn-primary";
        next.textContent = index + 1 === questions.length ? "See results" : "Next question";
        next.addEventListener("click", () => {
          locked = false;
          index += 1;
          if (index >= questions.length) {
            finishQuiz(uid, score, questions.length);
          } else {
            render();
          }
        });
        actionsEl.appendChild(next);
      });
      optionsEl.appendChild(button);
    });
    actionsEl.innerHTML = "";
  };

  render();
}

async function finishQuiz(uid, score, total) {
  updateProgress(total, total);
  stageEl.innerHTML = `<h2>Quiz complete</h2><p class="lede">You scored ${score} / ${total}.</p>`;
  actionsEl.innerHTML = `
    <a class="btn btn-primary" href="study.html?id=${setId}&mode=quiz">Retry quiz</a>
    <a class="btn btn-ghost" href="study.html?id=${setId}&mode=cards">Study flashcards</a>
    <a class="btn btn-ghost" href="app.html">Back to library</a>
  `;
  await saveProgress(uid, {
    quizScore: score,
    quizTotal: total,
    lastMode: "quiz",
  });
}

function startFlashcards(uid, cards) {
  if (!cards.length) {
    showBanner("No flashcards were generated.");
    return;
  }
  let index = 0;
  let showBack = false;
  const known = new Set();
  const unknown = new Set();

  const render = () => {
    const card = cards[index];
    updateProgress(index, cards.length);
    stageEl.innerHTML = `<div class="flash-card"><p></p><span class="muted">Click the card to flip</span></div>`;
    const face = stageEl.querySelector("p");
    face.textContent = showBack ? card.back : card.front;
    stageEl.querySelector(".flash-card").addEventListener("click", () => {
      showBack = !showBack;
      render();
    });

    actionsEl.innerHTML = "";
    const mark = (kind) => {
      if (kind === "known") {
        known.add(card.id);
        unknown.delete(card.id);
      } else {
        unknown.add(card.id);
        known.delete(card.id);
      }
      showBack = false;
      if (index + 1 >= cards.length) {
        finishCards(uid, cards.length, known.size, unknown.size);
      } else {
        index += 1;
        render();
      }
    };
    actionsEl.append(
      makeButton("Still learning", "btn-ghost", () => mark("unknown")),
      makeButton("I know this", "btn-primary", () => mark("known"))
    );
  };

  render();
}

async function finishCards(uid, total, knownCount, unknownCount) {
  updateProgress(total, total);
  stageEl.innerHTML = `<h2>Deck complete</h2><p class="lede">Known: ${knownCount}. Still learning: ${unknownCount}.</p>`;
  actionsEl.innerHTML = `
    <a class="btn btn-primary" href="study.html?id=${setId}&mode=cards">Review again</a>
    <a class="btn btn-ghost" href="study.html?id=${setId}&mode=quiz">Take the quiz</a>
    <a class="btn btn-ghost" href="app.html">Back to library</a>
  `;
  await saveProgress(uid, {
    knownCount,
    unknownCount,
    cardTotal: total,
    lastMode: "cards",
  });
}

function makeButton(label, cls, onClick) {
  const button = document.createElement("button");
  button.className = `btn ${cls}`;
  button.type = "button";
  button.textContent = label;
  button.addEventListener("click", onClick);
  return button;
}

function updateProgress(current, total) {
  if (!barEl) {
    return;
  }
  const pct = total ? Math.round((current / total) * 100) : 0;
  barEl.style.width = `${pct}%`;
}

async function saveProgress(uid, extra) {
  await setDoc(
    doc(db, "progress", `${uid}_${setId}`),
    {
      ownerId: uid,
      setId,
      lastStudiedAt: serverTimestamp(),
      ...extra,
    },
    { merge: true }
  );
}
