// === React Chatbot Frontend ===
// Text input, mic input, TTS output, public feedback wall
/* global webkitSpeechRecognition */

import { useState, useRef, useEffect } from "react";

export default function ChatbotPage() {
  // ---- Voice (Indian-accent English preference) ----
  const [voices, setVoices] = useState([]);
  const [preferredVoice, setPreferredVoice] = useState(null);

  // ---- Chat state ----
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef(null);
  const sessionIdRef = useRef(crypto.randomUUID());

  // ---- API ----
  const API_URL = process.env.REACT_APP_API_URL || "http://127.0.0.1:8000/chat";
  const API_BASE = API_URL.replace(/\/chat$/, ""); // e.g. https://api.maixed.com

  // Load voices and pick Indian English if available
  useEffect(() => {
    const loadVoices = () => {
      const v = window.speechSynthesis?.getVoices?.() || [];
      setVoices(v);

      // try locale first, then common Indian voice names, then default
      const byLocale = v.find(voice => /en[-_]IN/i.test(voice.lang));
      const byName = v.find(voice =>
        /India|Aditi|Raveena|Priya|Heera|Neerja|Prabhat|en-IN/i.test(voice.name)
      );
      setPreferredVoice(byLocale || byName || v.find(x => x.default) || v[0] || null);
    };

    loadVoices();
    if (window.speechSynthesis) {
      window.speechSynthesis.onvoiceschanged = loadVoices;
    }
  }, []);

  const speak = (text) => {
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel(); // avoid double playback
    const u = new SpeechSynthesisUtterance(text);
    if (preferredVoice) u.voice = preferredVoice;
    u.rate = 0.95; // slight pacing tweak
    u.pitch = 1.0;
    window.speechSynthesis.speak(u);
  };

  // ---- Chat send ----
  const sendMessage = async (text) => {
    if (!text?.trim()) return;

    const newMsg = { role: "user", content: text.trim() };
    const updatedMessages = [...messages, newMsg];
    setMessages(updatedMessages);
    setInput("");

    // Normalize roles for backend/OpenAI
    const historyToSend = updatedMessages.slice(-6).map((m) => ({
      role: m.role === "bot" ? "assistant" : m.role,
      content: m.content
    }));

    const res = await fetch(API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Session-ID": sessionIdRef.current
      },
      body: JSON.stringify({
        message: text,
        history: historyToSend
      })
    });

    const data = await res.json();
    const replyText = data?.response || "Sorry, I didn't catch that.";
    const reply = { role: "bot", content: replyText };
    setMessages([...updatedMessages, reply]);
    speak(replyText);
  };

  // ---- Mic ----
  const handleMic = () => {
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
    recognition.onerror = (e) => console.error(e);
    recognition.onend = () => setListening(false);
    recognition.start();
    setListening(true);
  };

  // ---- Initial greeting ----
  useEffect(() => {
    const initialGreeting =
      "Hi there! I’m Husain’s AI clone — think of me as his digital twin, but with faster responses and zero need for sleep. I’m glad you’re here. How are you doing today?";
    const reply = { role: "bot", content: initialGreeting };
    setMessages([reply]);
    speak(initialGreeting);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // run once

  return (
    <div className="min-h-screen bg-black text-white flex flex-col items-center p-6 space-y-4">
      <h1 className="text-3xl font-bold">🤖 Talk to Husain's AI Clone</h1>

      {/* Links */}
      <div className="flex flex-wrap gap-4 justify-center mt-4">
        {/* Use download attribute to force save */}
        <a
          href="/Resume_Husain_Gittham.pdf"
          download="Husain_Gittham_Resume.pdf"
          className="text-blue-400 underline"
        >
          📄View my Resume
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

      {/* Optional: voice picker for you to fine‑tune */}
      <div className="text-sm text-gray-300 mt-2">
        <label className="mr-2">Voice:</label>
        <select
          className="bg-gray-800 border border-gray-700 rounded p-1"
          value={preferredVoice?.name || ""}
          onChange={(e) =>
            setPreferredVoice(voices.find((v) => v.name === e.target.value) || null)
          }
        >
          {voices.map((v) => (
            <option key={v.name} value={v.name}>
              {v.name} ({v.lang})
            </option>
          ))}
        </select>
      </div>

      {/* Feedback section */}
      <div className="w-full max-w-xl space-y-3 bg-gray-950/60 p-4 rounded-lg border border-gray-800 mt-4">
        <h2 className="text-xl font-semibold">💬 Public feedback</h2>
        <FeedbackForm apiBase={API_BASE} />
        <FeedbackFeed apiBase={API_BASE} />
      </div>

      {/* Chat */}
      <div className="w-full max-w-xl space-y-4">
        <div className="bg-gray-900 p-4 rounded-lg h-96 overflow-y-auto space-y-2">
          {messages.map((m, i) => (
            <div key={i} className={`${m.role === "user" ? "text-right" : "text-left"}`}>
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
          <button
            onClick={() => sendMessage(input)}
            className="bg-green-500 px-4 py-2 rounded"
          >
            Send
          </button>
          <button onClick={handleMic} className="bg-blue-500 px-4 py-2 rounded">
            🎤 {listening ? "Stop" : "Talk"}
          </button>
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
    const id = setInterval(load, 10000); // refresh every 10s
    return () => clearInterval(id);
  }, []);

  return (
    <div className="space-y-2 max-h-64 overflow-y-auto">
      {items.length === 0 && (
        <div className="text-gray-400 text-sm">No feedback yet. Be the first!</div>
      )}
      {items.map((f) => (
        <div key={f.id} className="bg-gray-900 rounded p-3 border border-gray-800">
          <div className="text-sm text-gray-400">
            <strong>{f.name || "Anonymous"}</strong> •{" "}
            {new Date(f.created_at).toLocaleString()}
          </div>
          <div className="mt-1">{f.message}</div>
        </div>
      ))}
    </div>
  );
}
