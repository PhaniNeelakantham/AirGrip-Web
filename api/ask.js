import { askGemini } from "./_lib/askGemini.js";

// Vercel serverless function: POST /api/ask { question, history, summary }.
// The Gemini key comes from the GEMINI_API_KEY environment variable set in
// the Vercel project (never from the app's code).

// Best-effort limit per visitor, so one person can't use up the free quota.
// (Serverless instances are short-lived, so the app also limits per device.)
const WINDOW_MS = 60 * 60 * 1000;
const MAX_PER_WINDOW = 30;
const seen = new Map();

function allowed(ip) {
  const now = Date.now();
  const hits = (seen.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  if (hits.length >= MAX_PER_WINDOW) return false;
  hits.push(now);
  seen.set(ip, hits);
  return true;
}

// Room for both models' attempts (12 s each) on Vercel.
export const maxDuration = 30;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Use POST." });
  }
  const ip = String(req.headers["x-forwarded-for"] ?? "").split(",")[0].trim() || "unknown";
  if (!allowed(ip)) {
    return res.status(429).json({ error: "That's a lot of questions! Please take a break and try again later." });
  }
  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body ?? {});
  const { status, body: out } = await askGemini(body, process.env);
  return res.status(status).json(out);
}
