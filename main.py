# main.py
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from typing import List, Optional
from dotenv import load_dotenv
from openai import OpenAI
import os, json, requests, uuid, datetime, sqlite3, pathlib

# ---------- Config ----------
load_dotenv()
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
if not OPENAI_API_KEY:
    raise RuntimeError("OPENAI_API_KEY is not set")

# Comma-separated list of allowed origins, e.g. "https://maixed.com,https://www.maixed.com"
ALLOW_ORIGINS = [
    o.strip() for o in os.getenv("ALLOW_ORIGINS", "*").split(",")
    if o.strip()
]

# Files
ROOT = pathlib.Path(__file__).parent
KB_PATH = ROOT / "husain_gittham_knowledge_base.json"
STORY_PATH = ROOT / "Husain Story.txt"
CHAT_LOG = ROOT / "chat_logs.jsonl"   # JSON Lines log

# ---------- Load KB + Story ----------
knowledge_base = {}
if KB_PATH.exists():
    with KB_PATH.open("r", encoding="utf-8") as f:
        knowledge_base = json.load(f)

husain_story = ""
if STORY_PATH.exists():
    with STORY_PATH.open("r", encoding="utf-8") as f:
        husain_story = f.read()

# ---------- OpenAI ----------
client = OpenAI(api_key=OPENAI_API_KEY)

# ---------- FastAPI ----------
app = FastAPI(title="Husain AI Backend", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOW_ORIGINS if ALLOW_ORIGINS != ["*"] else ["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------- Models ----------
class HistoryMessage(BaseModel):
    role: str  # "user" | "assistant" (we'll accept "bot" and normalize)
    content: str

class ChatMessage(BaseModel):
    message: str
    history: List[HistoryMessage] = []

class FeedbackIn(BaseModel):
    name: Optional[str] = ""
    message: str

# ---------- System Prompt ----------
SYSTEM_PROMPT = f"""
You are a friendly AI clone of Husain, who is actively job hunting and likes to network with people.
Greet users and help them with anything they ask. Always answer as Husain.

Use the following background to answer questions truthfully and avoid hallucinations. Be professional, concise,
and factually accurate. If you don't know something, say so.

--- HUSAIN STORY ---
{husain_story}
"""

# ---------- Utils ----------
def search_kb(user_msg: str) -> str:
    """Very simple keyword-based search over the JSON KB."""
    try:
        q = (user_msg or "").lower()
        if not q or not knowledge_base:
            return ""
        terms = [t for t in q.split() if t]
        matches = []

        def walk(obj, path=""):
            if isinstance(obj, dict):
                for k, v in obj.items():
                    walk(v, f"{path}.{k}" if path else k)
            elif isinstance(obj, list):
                for i, item in enumerate(obj):
                    walk(item, f"{path}[{i}]")
            elif isinstance(obj, str):
                low = obj.lower()
                if any(t in low for t in terms):
                    matches.append(f"{path}: {obj}")

        walk(knowledge_base)
        if matches:
            return "Knowledge Snippets:\n" + "\n".join(matches[:5])
        return ""
    except Exception:
        return ""

def get_location(ip: str) -> str:
    try:
        res = requests.get(f"https://ipapi.co/{ip}/json/", timeout=3).json()
        city = res.get("city") or ""
        region = res.get("region") or ""
        country = res.get("country_name") or ""
        parts = [p for p in [city, region, country] if p]
        return ", ".join(parts) if parts else "Unknown"
    except Exception:
        return "Unknown"

def log_chat(session_id: str, ip: str, location: str, convo: list):
    try:
        entry = {
            "session_id": session_id,
            "ip": ip,
            "location": location,
            "chat": convo,
            "timestamp": datetime.datetime.utcnow().isoformat()
        }
        with CHAT_LOG.open("a", encoding="utf-8") as f:
            f.write(json.dumps(entry) + "\n")
    except Exception:
        pass  # best effort logging

# ---------- Feedback (SQLite) ----------
DB_PATH = ROOT / "feedback.db"

def init_feedback_db():
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("""
      CREATE TABLE IF NOT EXISTS feedback (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT,
        message TEXT NOT NULL,
        created_at TEXT NOT NULL
      )
    """)
    conn.commit()
    conn.close()

init_feedback_db()

@app.post("/feedback")
async def post_feedback(item: FeedbackIn, request: Request):
    if not item.message or not item.message.strip():
        return JSONResponse({"ok": False, "error": "Empty message"}, status_code=400)
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute(
        "INSERT INTO feedback (name, message, created_at) VALUES (?, ?, ?)",
        (item.name or "", item.message.strip(), datetime.datetime.utcnow().isoformat())
    )
    conn.commit()
    conn.close()

    # also log to chat log for continuity
    ip = request.client.host
    session_id = request.headers.get("X-Session-ID", str(uuid.uuid4()))
    location = get_location(ip)
    log_chat(session_id, ip, location, [
        {"role": "system", "content": f"feedback from {item.name or 'Anonymous'}"},
        {"role": "user", "content": item.message.strip()},
    ])
    return {"ok": True}

@app.get("/feedback")
async def get_feedback():
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("SELECT id, name, message, created_at FROM feedback ORDER BY id DESC LIMIT 100")
    rows = c.fetchall()
    conn.close()
    return [
        {"id": r[0], "name": r[1], "message": r[2], "created_at": r[3]}
        for r in rows
    ]

# ---------- Health ----------
@app.get("/health")
async def health():
    return {"ok": True, "time": datetime.datetime.utcnow().isoformat()}

# ---------- Chat ----------
@app.post("/chat")
async def chat(msg: ChatMessage, request: Request):
    try:
        # Build context
        kb_context = search_kb(msg.message)
        user_message = msg.message
        if kb_context:
            user_message += f"\n\n{kb_context}"

        # Normalize last few turns
        history_norm = []
        for m in msg.history[-6:]:
            role = m.role
            if role == "bot":
                role = "assistant"
            elif role not in ("user", "assistant", "system"):
                role = "user"
            history_norm.append({"role": role, "content": m.content})

        messages = [{"role": "system", "content": SYSTEM_PROMPT}] + history_norm
        messages.append({"role": "user", "content": user_message})

        # Call OpenAI
        completion = client.chat.completions.create(
            model="gpt-4o",
            messages=messages
        )
        reply = completion.choices[0].message.content.strip()

        # Log session
        ip = request.client.host
        session_id = request.headers.get("X-Session-ID", str(uuid.uuid4()))
        location = get_location(ip)
        convo_for_log = messages + [{"role": "assistant", "content": reply}]
        log_chat(session_id, ip, location, convo_for_log)

        return {"response": reply, "session_id": session_id}

    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)
