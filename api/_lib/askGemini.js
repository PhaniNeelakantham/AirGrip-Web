// Shared by the Vercel function and the local dev server

// "-latest" names always point at Google's current model
const MODELS = ["gemini-flash-lite-latest", "gemini-flash-latest"];
// Give up on one model after this long and try the next
const ATTEMPT_MS = 12000;
const LIMITS = { question: 500, summary: 24000, history: 10, historyText: 1500 };

// System prompt: plain-language progress help, never medical advice
const SYSTEM = `You are the AirGrip progress helper. AirGrip is a hand and wrist therapy device (a grip that
measures squeeze pressure in psi, plus a motion sensor for wrist tilt, turn and side-to-side movement) with
short games. Many users are older adults; some have arthritis, Parkinson's disease or are recovering from a stroke.

You will be given ONE person's progress data -- their streaks, a list of every game they played recently,
per-game totals, their measurements, their starting-point check, and the library of AirGrip games -- then their
question. When recommending games, only suggest games from that library, and say briefly why.

Rules:
- Answer ONLY from the data provided. If the data doesn't show something, say so kindly. Never invent numbers.
- For counts and totals (games played, sessions, streaks), use the numbers already worked out in the data; never
  count the history list yourself.
- Use plain, warm, encouraging language a grandparent would understand. Short sentences. No jargon; if you use
  a term like "psi" or "tremor", explain it briefly.
- Keep answers short: 2 to 5 sentences, or a few short bullet points.
- You are NOT a doctor or therapist. Never diagnose, never give medical or medication advice, and never suggest
  changing a treatment plan. For anything about pain, symptoms, diagnosis or what exercises are safe, suggest
  asking their physical therapist or doctor.
- Focus on trends and effort (what improved, what stayed steady, consistency) and celebrate progress honestly.
- Squeeze strength in psi is AirGrip's own measurement; don't compare it to clinical grip-strength norms.
- If asked something unrelated to their AirGrip progress or the games, gently steer back.`;

const clip = (v, n) => (typeof v === "string" ? v.slice(0, n) : "");

// Returns { status, body } so both servers can send it back as JSON
export async function askGemini({ question, history, summary }, env) {
  const apiKey = env.GEMINI_API_KEY;
  if (!apiKey) return { status: 500, body: { error: "The AI helper isn't set up yet (no API key on the server)." } };

  const q = clip(question, LIMITS.question).trim();
  if (!q) return { status: 400, body: { error: "Please type a question." } };
  const turns = (Array.isArray(history) ? history : [])
    .slice(-LIMITS.history)
    .filter((t) => t && (t.role === "user" || t.role === "model"))
    .map((t) => ({ role: t.role, parts: [{ text: clip(t.text, LIMITS.historyText) }] }));

  const request = {
    system_instruction: { parts: [{ text: SYSTEM }] },
    contents: [
      ...turns,
      {
        role: "user",
        parts: [
          {
            text: `Progress data (numbers only, no personal details):\n${clip(summary, LIMITS.summary)}\n\nQuestion: ${q}`,
          },
        ],
      },
    ],
    generationConfig: { temperature: 0.4, maxOutputTokens: 1024 },
  };

  const models = env.GEMINI_MODEL ? [env.GEMINI_MODEL, ...MODELS] : MODELS;
  let lastStatus = 502;
  for (const model of models) {
    let res;
    let data;
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), ATTEMPT_MS);
    try {
      res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify(request),
        signal: abort.signal,
      });
      data = await res.json().catch(() => ({}));
    } catch {
      // Too slow or the network failed: try the next model
      lastStatus = 504;
      continue;
    } finally {
      clearTimeout(timer);
    }
    if (res.ok) {
      const answer = (data.candidates?.[0]?.content?.parts ?? [])
        .map((p) => (p.thought ? "" : (p.text ?? "")))
        .join("")
        .trim();
      if (answer) return { status: 200, body: { answer } };
      lastStatus = 204; // nothing usable: try the next model
      continue;
    }
    lastStatus = res.status;
    // Busy, retired or temporarily failing: try the next model
    if (res.status === 503 || res.status === 404 || res.status === 500) continue;
    break;
  }
  if (lastStatus === 429) {
    return { status: 429, body: { error: "The AI helper has hit its free usage limit for now. Please try again in a minute." } };
  }
  if (lastStatus === 503 || lastStatus === 504) {
    return { status: 503, body: { error: "The AI helper is very busy right now. Please try again in a moment." } };
  }
  return { status: 502, body: { error: "The AI helper couldn't answer just now. Please try again." } };
}
