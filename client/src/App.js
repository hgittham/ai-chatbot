// client/src/App.js
/* global webkitSpeechRecognition */
import { useState, useRef, useEffect } from "react";
import TalkingAvatar from "./components/TalkingAvatar";
import { useState as useState2, useEffect as useEffect2 } from "react";


export default function ChatbotPage() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [listening, setListening] = useState(false);
  const [muted, setMuted] = useState(false);
  const [captions, setCaptions] = useState("");
  const recognitionRef = useRef(null);
  const sessionIdRef = useRef(crypto.randomUUID());
  const avatarRef = useRef(null);
  const audioUnlockedRef = useRef(false); // iOS/Safari unlock

  const API_URL = process.env.REACT_APP_API_URL || "http://127.0.0.1:8000/chat";
  const API_BASE = API_URL.replace(/\/chat$/, "");

  // ---------- iOS/Safari audio unlock ----------
  const unlockAudioForiOS = () => {
    if (audioUnlockedRef.current) return;
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        const ctx = new AudioCtx();
        const buffer = ctx.createBuffer(1, 1, 22050);
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(ctx.destination);
        if (ctx.state === "suspended") ctx.resume();
        source.start(0);
      }
      if (window.speechSynthesis?.resume) window.speechSynthesis.resume();
      audioUnlockedRef.current = true;
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    const onFirstInteract = () => {
      unlockAudioForiOS();
      window.removeEventListener("touchstart", onFirstInteract, true);
      window.removeEventListener("click", onFirstInteract, true);
    };
    window.addEventListener("touchstart", onFirstInteract, true);
    window.addEventListener("click", onFirstInteract, true);
    return () => {
      window.removeEventListener("touchstart", onFirstInteract, true);
      window.removeEventListener("click", onFirstInteract, true);
    };
  }, []);

  // ---------- Azure token fetcher ----------
  const getAzureToken = async () => {
    const res = await fetch(`${API_BASE}/azure/token`);
    if (!res.ok) throw new Error("Azure token failed");
    return res.json(); // { token, region }
  };

  // ---------- Fallback browser TTS (if Azure fails) ----------
  const speakFallback = (text) => {
    setCaptions(text);
    if (muted || !window.speechSynthesis) return;
    unlockAudioForiOS();
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 0.95;
    u.pitch = 1.0;

    // Drive slow, text-based lip sync while browser speaks
    const words = (text || "").trim().split(/\s+/).filter(Boolean).length || 1;
    const estMs = Math.max(1500, Math.min(20000, words * 320 * (1.0 / u.rate)));
    avatarRef.current?.driveMouthStart(text, estMs);

    u.onboundary = (ev) => {
      try {
        const idx = ev.charIndex ?? 0;
        const ch = (text || "").charAt(idx) || " ";
        avatarRef.current?.setMouthByChar(ch);
      } catch {}
    };
    u.onend = () => avatarRef.current?.stopMouth();

    if (window.speechSynthesis?.paused) window.speechSynthesis.resume();
    window.speechSynthesis.speak(u);
  };

  // ---------- Say text via Azure (visemes + audio) with fallback ----------
  const say = async (text) => {
    setCaptions(text);
    try {
      await avatarRef.current?.speakAzure(text, getAzureToken, {
        muted,
        voice: "en-IN-PrabhatNeural",
        rate: "-5%",
      });
    } catch (e) {
      console.warn("Azure speech failed, falling back to browser TTS:", e);
      speakFallback(text);
    }
  };

  // ---------- Chat send ----------
  const sendMessage = async (text) => {
    if (!text?.trim()) return;
    const newMsg = { role: "user", content: text.trim() };
    const updated = [...messages, newMsg];
    setMessages(updated);
    setInput("");

    const historyToSend = updated.slice(-6).map((m) => ({
      role: m.role === "bot" ? "assistant" : m.role,
      content: m.content,
    }));

    const res = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Session-ID": sessionIdRef.current },
      body: JSON.stringify({ message: text, history: historyToSend }),
    });
    const data = await res.json();
    const replyText = data?.response || "Sorry, I didn't catch that.";
    const reply = { role: "bot", content: replyText };
    setMessages([...updated, reply]);

    avatarRef.current?.setExpression("happy");
    avatarRef.current?.wave();
    await say(replyText);
  };

  // ---------- Mic ----------
  const toggleMic = () => {
    if (!("webkitSpeechRecognition" in window)) {
      alert("Your browser doesn't support voice recognition");
      return;
    }
    unlockAudioForiOS();
    if (listening) {
      recognitionRef.current?.stop();
      setListening(false);
      return;
    }
    const recognition = new webkitSpeechRecognition();
    recognitionRef.current = recognition;
    recognition.continuous = false;
    recognition.lang = "en-US";
    recognition.onresult = (event) => {
      const text = event.results[0][0].transcript;
      sendMessage(text);
    };
    recognition.onerror = () => setListening(false);
    recognition.onend = () => setListening(false);
    recognition.start();
    setListening(true);
  };

  // ---------- Initial greeting ----------
  useEffect(() => {
    const initial =
      "Hi there! I’m Husain’s AI clone — think of me as his digital twin, but with faster responses and zero need for sleep. I’m glad you’re here. How are you doing today?";
    setMessages([{ role: "bot", content: initial }]);
    // Don't play audio yet (many browsers require a user gesture first).
    // The first Send/Talk click will speak using say(initial/response).
    setCaptions(initial);
    avatarRef.current?.setExpression("neutral");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------- Links (stacked prop for mobile) ----------
  const Links = ({ stacked = false, className = "" }) => (
    <div
      className={`${className} ${
        stacked
          ? "flex flex-col w-full items-center space-y-2"
          : "flex flex-wrap gap-3 items-center justify-center"
      }`}
    >
      <a
        href="/Resume_Husain_Gittham.pdf"
        download="Husain_Gittham_Resume.pdf"
        className={`text-blue-400 underline ${stacked ? "w-full text-center py-1" : ""}`}
      >
        📄 View my Resume
      </a>
      <a
        href="https://www.linkedin.com/in/husain-gittham-428b51169/"
        target="_blank"
        rel="noopener noreferrer"
        className={`text-blue-400 underline ${stacked ? "w-full text-center py-1" : ""}`}
      >
        💼 Visit my LinkedIn Profile
      </a>
      <a
        href="https://www.linkedin.com/in/husain-gittham-428b51169/details/recommendations/?detailScreenTabIndex=0"
        target="_blank"
        rel="noopener noreferrer"
        className={`text-blue-400 underline ${stacked ? "w-full text-center py-1" : ""}`}
      >
        🌟 View my Recommendations
      </a>
    </div>
  );

  return (
    <div className="min-h-screen bg-black text-white px-4 md:px-6 lg:px-8 py-3">
      <h1 className="text-3xl font-extrabold text-center mb-3">🤖 Talk to Husain's AI Clone</h1>

      {/* Desktop-only links above chat */}
      <div className="hidden md:flex justify-center mb-3">
        <Links />
      </div>

      {/* 3 columns on desktop; stacked on mobile */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-7xl mx-auto items-start">
        {/* LEFT — Avatar panel */}
        <div className="flex flex-col items-center gap-3 self-start -mt-4">
          {/* Mobile-only: stacked, centered links above avatar */}
          <div className="md:hidden w-full text-center mb-2">
            <Links stacked />
          </div>

          <TalkingAvatar
            ref={avatarRef}
            avatarUrl="/avatars/husain.glb"
            width={320}
            height={440}
            cameraZ={1.85}
            modelScale={1.14}
            modelY={-0.44}
            modelRotationY={0}
            listeningGlow={listening}
            initialExpression="neutral"
            showFloor={false}
          />

          {/* Captions: full text, no scrollbar */}
          <div className="w-full max-w-xs text-center text-gray-200 bg-gray-900/70 border border-gray-700 rounded p-2">
            <div className="text-[10px] uppercase tracking-wide text-gray-400 mb-1">Captions</div>
            <div className="text-sm whitespace-pre-wrap">{captions || "…"}</div>
          </div>

          {/* Mic + Mute */}
          <div className="flex items-center gap-3">
            <button
              onClick={toggleMic}
              className={`px-4 py-2 rounded font-semibold ${
                listening ? "bg-blue-600" : "bg-green-600"
              }`}
              title="Start voice input"
            >
              {listening ? "🎧 Listening…" : "🎙️ Talk to Husain"}
            </button>

            <button
              onClick={() => {
                setMuted((m) => {
                  const next = !m;
                  if (next) {
                    // turning mute ON: stop current audio & mouth
                    if (window.speechSynthesis) window.speechSynthesis.cancel();
                    avatarRef.current?.stopMouth();
                  }
                  return next;
                });
              }}
              className={`px-4 py-2 rounded ${muted ? "bg-gray-700" : "bg-red-600"}`}
              title={muted ? "Unmute voice" : "Mute voice"}
            >
              {muted ? "🔇 Muted" : "🔊 Mute"}
            </button>
          </div>

          <div className="text-xs text-gray-400">
            Pro tip: manage your <strong>speaker volume</strong> before talking.
          </div>
        </div>

        {/* MIDDLE — Chat */}
        <div className="flex flex-col gap-3">
          <div className="bg-gray-900 p-4 rounded-lg h-[30rem] overflow-y-auto space-y-2">
            {messages.map((m, i) => (
              <div key={i} className={m.role === "user" ? "text-right" : "text-left"}>
                ➡️ <strong>{m.role === "user" ? "You" : "Husain"}:</strong> {m.content}
              </div>
            ))}
          </div>

          <div className="flex space-x-2">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && sendMessage(input)}
              className="flex-1 px-4 py-2 text-black rounded"
              placeholder="Type your question..."
            />
            <button onClick={() => sendMessage(input)} className="bg-green-500 px-4 py-2 rounded">
              Send
            </button>
            <button onClick={toggleMic} className="bg-blue-500 px-4 py-2 rounded">
              {listening ? "Stop" : "🎤 Talk"}
            </button>
          </div>
        </div>

        {/* RIGHT — Feedback */}
        <div className="bg-gray-950/60 p-3 rounded-lg border border-gray-800">
          <h2 className="text-xl font-semibold mb-2">🔗 From LinkedIn</h2>
          <div className="w-full overflow-hidden rounded">
            <iframe
              src="https://www.linkedin.com/embed/feed/update/urn:li:share:7360713923483869184"
              title="Embedded LinkedIn post"
              height="640"
              width="100%"
              frameBorder="0"
              allowFullScreen
              style={{ background: "transparent" }}
            />
          </div>
        </div>
        <div className="space-y-4">
          <div className="bg-gray-950/60 p-4 rounded-lg border border-gray-800">
            <h2 className="text-2xl font-semibold mb-1">💬 Feedback & Suggestions</h2>
            <p className="text-sm text-gray-400 mb-4">
              Share ideas, bugs, or critique. This wall is public.
            </p>
            <div className="space-y-3">
              <FeedbackForm apiBase={API_BASE} />
              <FeedbackFeed apiBase={API_BASE} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ----------------- Feedback Components ----------------- */


function FeedbackForm({ apiBase }) {
  const [name, setName] = useState2("");
  const [message, setMessage] = useState2("");
  const [submitting, setSubmitting] = useState2(false);

  const onSubmit = async (e) => {
    e.preventDefault();
    if (!message.trim()) return;
    setSubmitting(true);
    try {
      await fetch(`${apiBase}/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, message }),
      });
      setMessage("");
    } catch {
      alert("Could not submit feedback. Try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-2">
      <div className="flex gap-2">
        <input
          className="flex-1 px-3 py-2 rounded text-black"
          placeholder="Your name (optional)"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <textarea
        className="w-full px-3 py-2 rounded text-black"
        placeholder="Share feedback/suggestions (public)"
        rows={3}
        value={message}
        onChange={(e) => setMessage(e.target.value)}
      />
      <button
        type="submit"
        disabled={submitting}
        className="self-start bg-purple-600 hover:bg-purple-700 px-4 py-2 rounded disabled:opacity-50"
      >
        {submitting ? "Submitting..." : "Submit feedback"}
      </button>
    </form>
  );
}

function FeedbackFeed({ apiBase }) {
  const [items, setItems] = useState2([]);

  const load = async () => {
    try {
      const res = await fetch(`${apiBase}/feedback`);
      const data = await res.json();
      setItems(data);
    } catch {
      // ignore
    }
  };

  useEffect2(() => {
    load();
    const id = setInterval(load, 10000);
    return () => clearInterval(id);
  }, []);

  const fmtET = (iso) => {
    try {
      // if timestamp has no timezone, assume UTC
      const utcish = /Z|[+-]\d\d:?\d\d$/.test(iso) ? iso : `${iso}Z`;
      const s = new Date(utcish).toLocaleString("en-US", {
        timeZone: "America/New_York",
        hour: "2-digit",
        minute: "2-digit",
        year: "numeric",
        month: "short",
        day: "2-digit",
      });
      return `${s}  —  ET`;
    } catch {
      return iso;
    }
  };


  return (
    <div className="space-y-2 max-h-[30rem] overflow-y-auto">
      {items.length === 0 && (
        <div className="text-gray-400 text-sm">No feedback yet. Be the first!</div>
      )}
      {items.map((f) => (
        <div key={f.id} className="bg-gray-900 rounded p-3 border border-gray-800">
          <div className="text-sm text-gray-300">
            <strong>{f.name || "Anonymous"}</strong>{" "}
            <span className="text-gray-400">• {fmtET(f.created_at)}</span>
          </div>
          <div className="mt-1">{f.message}</div>
        </div>
      ))}
    </div>
  );
}
