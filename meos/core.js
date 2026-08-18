export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function normalize(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

export function asArray(value) {
  return Array.isArray(value) ? value : [];
}

export function searchTokens(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .map((token) => token.trim())
    .filter(Boolean);
}

export function editDistance(left, right) {
  const a = String(left || "");
  const b = String(right || "");
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let previous = [...Array(b.length + 1).keys()];
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(current[j - 1] + 1, previous[j] + 1, previous[j - 1] + cost);
    }
    previous = current;
  }
  return previous[b.length];
}

export function fuzzyTokenMatches(queryToken, targetToken) {
  if (!queryToken || !targetToken) return false;
  if (targetToken.includes(queryToken) || queryToken.includes(targetToken)) return true;
  if (queryToken.length === 1) return targetToken.startsWith(queryToken);
  const tolerance = queryToken.length >= 6 ? 2 : 1;
  return editDistance(queryToken, targetToken) <= tolerance;
}

export function fuzzyNameMatches(name, query) {
  const queryTokens = searchTokens(query);
  if (!queryTokens.length) return true;
  const nameTokens = searchTokens(name);
  return queryTokens.every((queryToken) => nameTokens.some((targetToken) => fuzzyTokenMatches(queryToken, targetToken)));
}

export function todayMeosDate() {
  const date = new Date();
  const months = ["jan.", "feb.", "mrt.", "apr.", "mei", "jun.", "jul.", "aug.", "sep.", "okt.", "nov.", "dec."];
  return `${date.getDate()} ${months[date.getMonth()]} ${date.getFullYear()}`;
}

export function formPayload(form) {
  const data = new FormData(form);
  return Object.fromEntries([...data.entries()].map(([key, value]) => [key, String(value || "").trim()]));
}

export async function normalizeUploadedImageToPng(file) {
  if (!file?.type?.startsWith("image/")) return file;
  if (file.type === "image/png" && /\.png$/i.test(file.name || "")) return file;
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const context = canvas.getContext("2d");
  context.drawImage(bitmap, 0, 0);
  bitmap.close?.();
  const blob = await new Promise((resolve, reject) => {
    canvas.toBlob((pngBlob) => pngBlob ? resolve(pngBlob) : reject(new Error("PNG conversie mislukt.")), "image/png");
  });
  const name = String(file.name || "upload").replace(/\.[^.]+$/, "") || "upload";
  return new File([blob], `${name}.png`, { type: "image/png", lastModified: Date.now() });
}

export function shouldNormalizeImageInput(input) {
  if (!input?.matches?.('input[type="file"]')) return false;
  const accept = String(input.getAttribute("accept") || "").toLowerCase();
  return input.dataset.meosPngUpload === "true" || accept.includes("image");
}

export async function normalizeImageInputFiles(input) {
  const files = [...(input.files || [])];
  if (!files.length || typeof DataTransfer === "undefined") return;
  try {
    const transfer = new DataTransfer();
    for (const file of files) transfer.items.add(await normalizeUploadedImageToPng(file));
    input.files = transfer.files;
    input.dispatchEvent(new CustomEvent("meos:png-ready", { bubbles: true }));
  } catch {
    input.value = "";
    window.alert("Upload alleen afbeeldingen die naar PNG kunnen worden omgezet.");
  }
}
