// === React Chatbot Frontend ===
// This app supports: text input, microphone input, audio output (TTS placeholder), iframe embedding
/* global webkitSpeechRecognition */

import { useState, useRef, useEffect } from "react";

export default function ChatbotPage() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef(null);
  const sessionIdRef = useRef(crypto.randomUUID());

  const API_URL = process.env.REACT_APP_API_URL || "http://127.0.0.1:8000/chat";

  const WEATHER_API_KEY = "YOUR_OPENWEATHERMAP_API_KEY"; // Replace with your actual API key

  const speak = (text) => {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.voice = speechSynthesis.getVoices().find(v => v.name.includes("Google") || v.default);
    speechSynthesis.cancel(); // Prevent overlapping speech
    speechSynthesis.speak(utterance);
  };

  const sendMessage = async (text) => {
    const newMsg = { role: "user", content: text };
    const updatedMessages = [...messages, newMsg];
    setMessages(updatedMessages);
    setInput("");

    const historyToSend = updatedMessages.slice(-6).map((m) => ({
      role: m.role === "bot" ? "assistant" : m.role,
      content: m.content
    }));

    const response = await fetch(API_URL, {
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

    const data = await response.json();
    const reply = { role: "bot", content: data.response };
    setMessages([...updatedMessages, reply]);
    speak(data.response);
  };

  const handleMic = () => {
    if (!('webkitSpeechRecognition' in window)) {
      alert("Your browser doesn't support voice recognition");
      return;
    }
    if (listening) {
      recognitionRef.current.stop();
      setListening(false);
      return;
    }
    const recognition = new webkitSpeechRecognition();
    recognitionRef.current = recognition;
    recognition.continuous = false;
    recognition.lang = 'en-US';
    recognition.onresult = (event) => {
      const text = event.results[0][0].transcript;
      sendMessage(text);
    };
    recognition.onerror = (e) => console.error(e);
    recognition.start();
    setListening(true);
  };

  useEffect(() => {
    const initialGreeting = "Hi there! I’m Husain’s AI clone - think of me as his digital twin, but with faster response time and zero need for sleep. I am glad you are here today. How are you doing?";
    const reply = { role: "bot", content: initialGreeting };
    setMessages([reply]);
    speak(initialGreeting);
  }, []);

  return (
    <div className="min-h-screen bg-black text-white flex flex-col items-center p-6 space-y-4">
      <h1 className="text-3xl font-bold">🤖 Talk to Husain's AI Clone</h1>

      {/* Useful Links */}
      <div className="flex flex-wrap gap-4 justify-center mt-4">
        <a href="/Resume_Husain_Gittham.pdf" target="_blank" rel="noopener noreferrer" className="text-blue-400 underline">📄 Resume</a>
        {/* <a href="/coverletter.pdf" target="_blank" rel="noopener noreferrer" className="text-blue-400 underline">📝 Cover Letter</a> */}
        <a href="https://www.linkedin.com/in/husain-gittham-428b51169/" target="_blank" rel="noopener noreferrer" className="text-blue-400 underline">💼 LinkedIn</a>
        {/* <a href="https://www.instagram.com/husain.gittham" target="_blank" rel="noopener noreferrer" className="text-blue-400 underline">📸 Instagram</a> */}
        <a href="https://www.linkedin.com/in/husain-gittham-428b51169/details/recommendations/?detailScreenTabIndex=0" target="_blank" rel="noopener noreferrer" className="text-blue-400 underline">🌟 Recommendations</a>
      </div>

      <div className="w-full max-w-xl space-y-4">
        <div className="bg-gray-900 p-4 rounded-lg h-96 overflow-y-auto space-y-2">
          {messages.map((m, i) => (
            <div key={i} className={`${m.role === "user" ? "text-right" : "text-left"}`}>➡️ <strong>{m.role === "user" ? "You" : "Husain"}:</strong> {m.content}</div>
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
          <button onClick={() => sendMessage(input)} className="bg-green-500 px-4 py-2 rounded">Send</button>
          <button onClick={handleMic} className="bg-blue-500 px-4 py-2 rounded">🎤 {listening ? "Stop" : "Talk"}</button>
        </div>
      </div>
    </div>
  );
}
