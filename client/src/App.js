// client/src/App.js
/* global webkitSpeechRecognition */
import { useState, useRef, useEffect } from "react";
import TalkingAvatar from "./components/TalkingAvatar";

export default function ChatbotPage() {
  // Voice (Indian English)
  const [preferredVoice, setPreferredVoice] = useState(null);

  // Chat state
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [listening, setListening] = useState(false);
  const [muted, setMuted] = useState(false);
  const [captions, setCaptions] = useState(""); // captions under avatar
  const recognitionRef = useRef(null);
  const sessionIdRef = useRef(crypto.randomUUID());

  // API
  const API_URL = process.env.REACT_APP_API_URL || "http://127.0.0.1:8000/chat";
  const API_BASE = API_URL.replace(/\/chat$/, "");

  // Load voices & pick Indian English
  useEffect(() => {
    const pickVoice = () => {
      const v = window.speechSynthesis?.getVoices?.() || [];
      const byLocale = v.find(voice => /en[-_]IN/i.test(voice.lang));
      const byName = v.find(voice =>
        /India|Aditi|Raveena|Priya|Heera|Neerja|Prabhat|en-IN/i.test(voice.name)
      );
      setPreferredVoice(byLocale || byName || v.find(x => x.default) || v[0] || null);
    };
    pickVoice();
    if (window.speechSynthesis) window.speechSynthesis.onvoiceschanged = pickVoice;
  }, []);

  const speak = (text) => {
    setCaptions(text); // show what’s being said
    if (muted || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    if (preferredVoice) u.voice = preferredVoice;
    u.rate = 0.95;
    u.pitch = 1.0;
    window.speechSynthesis.speak(u);
  };

  // Avatar ref
  const avatarRef = useRef(null);

  // Send a message
  const sendMessage = async (text) => {
    if (!text?.trim()) return;
    const newMsg = { role: "user", content: text.trim() };
    const updated = [...messages, newMsg];
    setMessages(updated);
    setInput("");

    const historyToSend = updated.slice(-6).map((m) => ({
      role: m.role === "bot" ? "assistant" : m.role,
      content: m.content
    }));

    const res = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Session-ID": sessionIdRef.current },
      body: JSON.stringify({ message: text, history: historyToSend })
    });
    const data = await res.json();
    const replyText = data?.response || "Sorry, I didn't catch that.";
    const reply = { role: "bot", content: replyText };
    setMessages([...updated, reply]);

    // Avatar + audio
    avatarRef.current?.setExpression("happy");
    avatarRef.current?.wave();
    avatarRef.current?.driveMouthFromText(replyText);
    speak(replyText);
  };

  // Mic controls
  const toggleMic = () => {
    if (!("webkitSpeechRecognition" in window)) {
      alert("Your browser doesn't support voice recognition");
      return;
    }
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

  // Initial greeting
  useEffect(() => {
    const initial =
      "Hi there! I’m Husain’s AI clone — think of me as his digital twin, but with faster responses and zero need for sleep. I’m glad you’re here. How are you doing today?";
    setMessages([{ role: "bot", content: initial }]);
    avatarRef.current?.driveMouthFromText(initial);
    speak(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="min-h-screen bg-black text-white px-4 md:px-6 lg:px-8 py-4">
      {/* tighter header spacing */}
      <h1 className="text-3xl font-extrabold text-center mb-4">
        🤖 Talk to Husain's AI Clone
      </h1>

      {/* Desktop: 3 columns. Mobile: stacked. */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-7xl mx-auto">
        {/* LEFT — Avatar + controls */}
        <div className="flex flex-col items-center gap-3">
          <TalkingAvatar
            ref={avatarRef}
            avatarUrl="/avatars/husain.glb"
            width={380}
            height={560}
            cameraZ={2.1}     // show more body
            modelScale={1.05}
            modelY={-0.35}
            listeningGlow={listening}
            initialExpression="neutral"
            showFloor={false}
          />

          {/* Captions */}
          <div className="w-full max-w-xs text-center text-gray-200 bg-gray-900/70 border border-gray-700 rounded p-2">
            <div className="text-xs uppercase tracking-wide text-gray-400 mb-1">
              Captions
            </div>
            <div className="text-sm">{captions || "…"}</div>
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
                  if (next && window.speechSynthesis) window.speechSynthesis.cancel();
                  if (next) avatarRef.current?.stopMouth();
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

          {/* Mobile hint */}
          <div className="md:hidden text-sm text-gray-300 mt-1">
            👇 Scroll down to chat with the clone.
          </div>

          {/* Links */}
          <div className="flex flex-wrap gap-3 justify-center mt-2">
            <a
              href="/Resume_Husain_Gittham.pdf"
              download="Husain_Gittham_Resume.pdf"
              className="text-blue-400 underline"
            >
              📄 View my Resume
            </a>
            <a
              href="https://www.linkedin.com/in/husain-gittham-428b51169/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-400 underline"
            >
              💼 Visit my LinkedIn Profile
            </a>
            <a
              href="https://www.linkedin.com/in/husain-gittham-428b51169/details/recommendations/?detailScreenTabIndex=0"
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-400 underline"
            >
              🌟 View my Recommendations
            </a>
          </div>
        </div>

        {/* MIDDLE — Chat */}
        <div className="flex flex-col gap-4">
          <div className="bg-gray-900 p-4 rounded-lg h-[32rem] overflow-y-auto space-y-2">
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
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (e) => {
    e.preventDefault();
    if (!message.trim()) return;
    setSubmitting(true);
    try {
      await fetch(`${apiBase}/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, message })
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
  const [items, setItems] = useState([]);

  const load = async () => {
    try {
      const res = await fetch(`${apiBase}/feedback`);
      const data = await res.json();
      setItems(data);
    } catch {
      // ignore errors
    }
  };

  useEffect(() => {
    load();
    const id = setInterval(load, 10000);
    return () => clearInterval(id);
  }, []);

  // Format UTC timestamp to America/New_York and label ET
  const fmtET = (iso) => {
    try {
      const s = new Date(iso).toLocaleString("en-US", {
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
    <div className="space-y-2 max-h-[34rem] overflow-y-auto">
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
