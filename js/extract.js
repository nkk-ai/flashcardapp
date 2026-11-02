const MAX_CHARS = 80000;

export async function extractTextFromFile(file) {
  const name = (file.name || "").toLowerCase();
  if (name.endsWith(".txt") || name.endsWith(".md")) {
    return clip(await file.text());
  }
  if (name.endsWith(".docx")) {
    return extractDocx(file);
  }
  if (name.endsWith(".pdf")) {
    return extractPdf(file);
  }
  throw new Error("Use a .txt, .md, .pdf, or .docx file.");
}

function clip(text) {
  return String(text || "").replace(/\s+\n/g, "\n").trim().slice(0, MAX_CHARS);
}

async function extractDocx(file) {
  await loadScript("https://unpkg.com/mammoth@1.8.0/mammoth.browser.min.js");
  if (!window.mammoth) {
    throw new Error("Could not load the Word extractor.");
  }
  const arrayBuffer = await file.arrayBuffer();
  const result = await window.mammoth.extractRawText({ arrayBuffer });
  return clip(result.value);
}

async function extractPdf(file) {
  const pdfjs = await import("https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.7.76/pdf.min.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc =
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.7.76/pdf.worker.min.mjs";
  const data = await file.arrayBuffer();
  const doc = await pdfjs.getDocument({ data }).promise;
  const maxPages = Math.min(doc.numPages, 40);
  const parts = [];
  for (let pageNum = 1; pageNum <= maxPages; pageNum += 1) {
    const page = await doc.getPage(pageNum);
    const content = await page.getTextContent();
    parts.push(content.items.map((item) => item.str).join(" "));
  }
  return clip(parts.join("\n"));
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) {
      resolve();
      return;
    }
    const script = document.createElement("script");
    script.src = src;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Failed to load extractor script."));
    document.head.appendChild(script);
  });
}
