const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { getStorage } = require("firebase-admin/storage");

initializeApp();

const geminiKey = defineSecret("GEMINI_API_KEY");
const MODEL = "gemini-2.0-flash";
const MAX_CHARS = 80000;

exports.generateStudySet = onCall(
  {
    region: "us-central1",
    secrets: [geminiKey],
    timeoutSeconds: 180,
    memory: "512MiB",
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Sign in to generate study materials.");
    }

    const setId = request.data && request.data.setId;
    if (!setId || typeof setId !== "string") {
      throw new HttpsError("invalid-argument", "setId is required.");
    }

    const db = getFirestore();
    const setRef = db.collection("sets").doc(setId);
    const snap = await setRef.get();
    if (!snap.exists) {
      throw new HttpsError("not-found", "Study set not found.");
    }

    const setData = snap.data();
    if (setData.ownerId !== request.auth.uid) {
      throw new HttpsError("permission-denied", "You do not own this study set.");
    }

    await setRef.update({
      status: "generating",
      errorMessage: "",
      updatedAt: FieldValue.serverTimestamp(),
    });

    try {
      const sourceText = await loadSourceText(setData, request.auth.uid, setId);
      if (!sourceText || sourceText.trim().length < 40) {
        throw new Error("Could not read enough text from the uploaded file.");
      }

      const materials = await generateWithGemini(sourceText, setData.title || "Study set");
      const quiz = Array.isArray(materials.quiz) ? materials.quiz.slice(0, 10) : [];
      const flashcards = Array.isArray(materials.flashcards)
        ? materials.flashcards.slice(0, 20)
        : [];

      if (quiz.length < 4 || flashcards.length < 4) {
        throw new Error("Gemini returned too few study items. Try a longer file.");
      }

      await writeCollection(setRef.collection("quiz"), quiz.map(normalizeQuestion));
      await writeCollection(setRef.collection("cards"), flashcards.map(normalizeCard));

      await setRef.update({
        status: "ready",
        questionCount: quiz.length,
        cardCount: flashcards.length,
        errorMessage: "",
        updatedAt: FieldValue.serverTimestamp(),
      });

      return { ok: true, questionCount: quiz.length, cardCount: flashcards.length };
    } catch (err) {
      const message = err && err.message ? err.message : "Generation failed.";
      await setRef.update({
        status: "error",
        errorMessage: message.slice(0, 400),
        updatedAt: FieldValue.serverTimestamp(),
      });
      throw new HttpsError("internal", message);
    }
  }
);

async function loadSourceText(setData, uid, setId) {
  if (setData.extractedText && String(setData.extractedText).trim().length >= 40) {
    return String(setData.extractedText).slice(0, MAX_CHARS);
  }

  const fileName = setData.fileName;
  if (!fileName) {
    return "";
  }

  const bucket = getStorage().bucket();
  const file = bucket.file(`uploads/${uid}/${setId}/${fileName}`);
  const [buffer] = await file.download();
  const lower = fileName.toLowerCase();

  if (lower.endsWith(".txt") || lower.endsWith(".md")) {
    return buffer.toString("utf8").slice(0, MAX_CHARS);
  }

  if (lower.endsWith(".pdf")) {
    if (buffer.length > 4 * 1024 * 1024) {
      throw new Error("PDF is too large to send to Gemini and no extracted text was stored.");
    }
    return generateFromPdfInline(buffer, setData.title || fileName);
  }

  return buffer.toString("utf8").slice(0, MAX_CHARS);
}

async function generateFromPdfInline(buffer, title) {
  const apiKey = geminiKey.value();
  const base64 = buffer.toString("base64");
  const body = {
    contents: [
      {
        parts: [
          { text: studyPrompt(title) },
          {
            inline_data: {
              mime_type: "application/pdf",
              data: base64,
            },
          },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.4,
      responseMimeType: "application/json",
    },
  };

  const payload = await callGemini(apiKey, body);
  return JSON.stringify(payload);
}

async function generateWithGemini(sourceText, title) {
  if (looksLikeMaterialsJson(sourceText)) {
    return parseMaterials(sourceText);
  }

  const apiKey = geminiKey.value();
  const body = {
    contents: [
      {
        parts: [{ text: `${studyPrompt(title)}\n\nSOURCE MATERIAL:\n${sourceText.slice(0, MAX_CHARS)}` }],
      },
    ],
    generationConfig: {
      temperature: 0.4,
      responseMimeType: "application/json",
    },
  };

  return callGemini(apiKey, body);
}

function studyPrompt(title) {
  return `You are a study coach. Create learning materials from the source for "${title}".
Return JSON only with this shape:
{
  "quiz": [
    {
      "question": "string",
      "options": ["A", "B", "C", "D"],
      "correctIndex": 0,
      "explanation": "short reason the answer is correct"
    }
  ],
  "flashcards": [
    { "front": "term or prompt", "back": "concise answer" }
  ]
}
Rules:
- Exactly 10 quiz questions. Each has 4 options and one correctIndex (0-3).
- 8 to 20 flashcards covering key facts, terms, and processes.
- Use only information present in the source. Do not invent facts.
- Questions should be mixed difficulty, not trivial yes/no.
- Keep language clear for a student reviewing the material.`;
}

async function callGemini(apiKey, body) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini request failed (${res.status}): ${errText.slice(0, 240)}`);
  }

  const json = await res.json();
  const text =
    json &&
    json.candidates &&
    json.candidates[0] &&
    json.candidates[0].content &&
    json.candidates[0].content.parts
      ? json.candidates[0].content.parts.map((part) => part.text || "").join("\n")
      : "";

  return parseMaterials(text);
}

function looksLikeMaterialsJson(value) {
  const trimmed = String(value).trim();
  return trimmed.startsWith("{") && trimmed.includes('"quiz"');
}

function parseMaterials(raw) {
  if (typeof raw === "object" && raw && raw.quiz) {
    return raw;
  }
  let text = String(raw).trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    text = fenced[1].trim();
  }
  const parsed = JSON.parse(text);
  if (!parsed.quiz || !parsed.flashcards) {
    throw new Error("Gemini JSON was missing quiz or flashcards.");
  }
  return parsed;
}

function normalizeQuestion(item, index) {
  const options = Array.isArray(item.options)
    ? item.options.map((opt) => String(opt)).slice(0, 4)
    : [];
  while (options.length < 4) {
    options.push("None of these");
  }
  let correctIndex = Number(item.correctIndex);
  if (!Number.isInteger(correctIndex) || correctIndex < 0 || correctIndex > 3) {
    correctIndex = 0;
  }
  return {
    order: index,
    question: String(item.question || "Untitled question"),
    options,
    correctIndex,
    explanation: String(item.explanation || ""),
  };
}

function normalizeCard(item, index) {
  return {
    order: index,
    front: String(item.front || "Card"),
    back: String(item.back || ""),
  };
}

async function writeCollection(col, docs) {
  const existing = await col.get();
  const batch = col.firestore.batch();
  existing.docs.forEach((doc) => batch.delete(doc.ref));
  docs.forEach((doc) => {
    const ref = col.doc();
    batch.set(ref, doc);
  });
  await batch.commit();
}
