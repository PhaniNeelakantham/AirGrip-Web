import { Fragment, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MessageCircle, Send, X } from "lucide-react";
import { useScrollLock } from "../hooks/useScrollLock";

// "Ask about my progress" chat; questions go to /api/ask (Gemini)

const SUGGESTIONS = [
  "Am I getting stronger?",
  "How was my week?",
  "What does wrist steadiness mean?",
  "Which game should I play more?",
];
const CONSENT_KEY = "aquagrip.ai.consent";
const DAILY_KEY = "aquagrip.ai.daily";
const DAILY_LIMIT = 20; // questions per device per day (free usage tier)
const WAIT_MS = 30000; // stop waiting after this long and offer Try again

const todayKey = () => new Date().toISOString().slice(0, 10);
function usedToday() {
  try {
    const d = JSON.parse(localStorage.getItem(DAILY_KEY));
    return d?.date === todayKey() ? d.n : 0;
  } catch {
    return 0;
  }
}
function countQuestion() {
  try {
    localStorage.setItem(DAILY_KEY, JSON.stringify({ date: todayKey(), n: usedToday() + 1 }));
  } catch {
    // Storage blocked: the server's limit still applies
  }
}
function hasConsent() {
  try {
    return localStorage.getItem(CONSENT_KEY) === "yes";
  } catch {
    return false;
  }
}

// Gemini may answer with **bold** and "- " bullets; show those simply
function Rich({ text }) {
  const inline = (line) =>
    line.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
      part.startsWith("**") && part.endsWith("**") ? <strong key={i}>{part.slice(2, -2)}</strong> : <Fragment key={i}>{part}</Fragment>
    );
  const blocks = [];
  let bullets = [];
  const flush = () => {
    if (bullets.length) blocks.push(<ul key={`ul${blocks.length}`}>{bullets}</ul>);
    bullets = [];
  };
  text.split("\n").forEach((raw, i) => {
    const line = raw.trim();
    if (/^[-*•]\s+/.test(line)) bullets.push(<li key={i}>{inline(line.replace(/^[-*•]\s+/, ""))}</li>);
    else {
      flush();
      if (line) blocks.push(<p key={i}>{inline(line)}</p>);
    }
  });
  flush();
  return blocks;
}

export default function ProgressChat({ summary, demoMode, onClose }) {
  const { backdropRef, panelRef } = useScrollLock();
  const [consented, setConsented] = useState(hasConsent);
  const [messages, setMessages] = useState([]); // { role: "user" | "model", text, error? }
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const listRef = useRef(null);
  const pending = useRef(null); // the request in flight, so closing can cancel it
  useEffect(() => () => pending.current?.abort(), []);
  const remaining = DAILY_LIMIT - usedToday();

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);

  const ask = async (question, { retry = false } = {}) => {
    const q = question.trim();
    if (!q || busy) return;
    if (usedToday() >= DAILY_LIMIT) {
      setMessages((m) => [...m, { role: "model", text: "That's all the questions for today. Come back tomorrow!", error: true }]);
      return;
    }
    // History for context, minus failed attempts and the retried question
    const earlier = messages.filter((m) => !m.error);
    const history = (retry ? earlier.slice(0, -1) : earlier).map(({ role, text }) => ({ role, text }));
    setMessages((m) => (retry ? m.filter((x) => !x.error) : [...m, { role: "user", text: q }]));
    setInput("");
    setBusy(true);
    countQuestion();
    const abort = new AbortController();
    pending.current = abort;
    const timer = setTimeout(() => abort.abort(), WAIT_MS);
    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q, history, summary }),
        signal: abort.signal,
      });
      const data = await res.json().catch(() => ({}));
      setMessages((m) => [
        ...m,
        res.ok && data.answer
          ? { role: "model", text: data.answer }
          : { role: "model", text: data.error || "Something went wrong.", error: true, retry: q },
      ]);
    } catch {
      if (pending.current !== abort) return; // the panel was closed
      setMessages((m) => [
        ...m,
        {
          role: "model",
          text: abort.signal.aborted
            ? "That's taking too long. The AI helper may be busy."
            : "Couldn't reach the AI helper. Check the internet connection.",
          error: true,
          retry: q,
        },
      ]);
    } finally {
      clearTimeout(timer);
      if (pending.current === abort) {
        pending.current = null;
        setBusy(false);
      }
    }
  };

  const accept = () => {
    try {
      localStorage.setItem(CONSENT_KEY, "yes");
    } catch {
      // Storage blocked: asked again next time
    }
    setConsented(true);
  };

  return createPortal(
    <div className="sheet-backdrop" ref={backdropRef} onClick={onClose}>
      <div
        className="sheet chat-sheet"
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="chat-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sheet-head">
          <h2 id="chat-title" className="chat-title">
            <span className="chat-mark" aria-hidden="true">
              <MessageCircle size={18} />
            </span>
            Ask about my progress
          </h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <X size={22} aria-hidden="true" />
          </button>
        </div>

        {!consented ? (
          <div className="chat-consent">
            <p>
              The AI helper explains your progress in plain words. To answer, your <strong>progress numbers</strong> (like
              squeeze strength, wrist movement and how often you play) are sent to <strong>Google's Gemini AI</strong>.
            </p>
            <p>Your name, age and profile details are never sent.</p>
            <button className="btn btn-primary btn-block btn-big" onClick={accept}>
              OK, continue
            </button>
            <button className="link-btn chat-cancel" onClick={onClose}>
              Not now
            </button>
          </div>
        ) : (
          <>
            <div className="chat-list" ref={listRef} aria-live="polite">
              <div className="chat-msg is-model">
                <p>
                  Hi! Ask me anything about your progress, like how you're doing or what a number means.
                  {demoMode && " (Demo mode: I'll talk about the sample data.)"}
                </p>
              </div>
              {messages.map((m, i) => (
                <div key={i} className={`chat-msg is-${m.role}${m.error ? " is-error" : ""}`}>
                  {m.role === "model" && !m.error ? <Rich text={m.text} /> : <p>{m.text}</p>}
                  {m.retry && (
                    <button className="chat-retry" onClick={() => ask(m.retry, { retry: true })} disabled={busy}>
                      Try again
                    </button>
                  )}
                </div>
              ))}
              {busy && (
                <div className="chat-msg is-model is-typing" aria-label="Thinking">
                  <span />
                  <span />
                  <span />
                </div>
              )}
            </div>

            {messages.length === 0 && (
              <div className="chat-suggestions">
                {SUGGESTIONS.map((s) => (
                  <button key={s} className="chat-chip" onClick={() => ask(s)} disabled={busy}>
                    {s}
                  </button>
                ))}
              </div>
            )}

            <form
              className="chat-input"
              onSubmit={(e) => {
                e.preventDefault();
                ask(input);
              }}
            >
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Type a question…"
                maxLength={500}
                aria-label="Your question"
              />
              <button type="submit" className="btn btn-primary" disabled={busy || !input.trim()} aria-label="Send">
                <Send size={18} aria-hidden="true" />
              </button>
            </form>
            <p className="chat-note">
              AI can make mistakes, and this isn't medical advice. Ask your therapist about your health.
              {remaining <= 5 && remaining > 0 && ` ${remaining} questions left today.`}
            </p>
          </>
        )}
      </div>
    </div>,
    document.body
  );
}
