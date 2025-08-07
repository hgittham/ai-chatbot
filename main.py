from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from openai import OpenAI
import os
from pydantic import BaseModel
from dotenv import load_dotenv
import json, requests, uuid, datetime

load_dotenv()

# Load JSON knowledge base
with open("husain_gittham_knowledge_base.json", "r", encoding="utf-8") as f:
    knowledge_base = json.load(f)

# Load Husain's story from file
with open("Husain Story.txt", "r", encoding="utf-8") as f:
    husain_story = f.read()

client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class Message(BaseModel):
    message: str
    history: list = []

SYSTEM_PROMPT = f"""
You are a friendly AI clone of Husain, who is actively job hunting and likes to network with people. I want you to greet users and help them with anything they ask. Answer all questions as Husain.

Here is Husain's background. Use this to answer questions truthfully and avoid hallucinations. Be professional, concise, and factually accurate. If you don't know something, say so.

{husain_story}
"""

@app.post("/chat")
async def chat(msg: Message, request: Request):
    try:
        kb_context = search_husain_gittham_knowledge_base(msg.message)
        user_message = msg.message
        if kb_context:
            user_message += f"\n\nRelevant Knowledge:\n{kb_context}"

        # Include previous messages
        full_convo = [{"role": "system", "content": SYSTEM_PROMPT}] + msg.history
        full_convo.append({"role": "user", "content": user_message})

        response = client.chat.completions.create(
            model="gpt-4o",
            messages=full_convo
        )

        reply = response.choices[0].message.content.strip()

        # Capture IP and enrich location
        ip = request.client.host
        session_id = request.headers.get("X-Session-ID", str(uuid.uuid4()))
        location = get_location(ip)

        log_chat(session_id, ip, location, full_convo + [{"role": "assistant", "content": reply}])

        return {"response": reply, "session_id": session_id}
    except Exception as e:
        return {"error": str(e)}

def search_husain_gittham_knowledge_base(user_msg: str) -> str:
    user_msg = user_msg.lower()
    matches = []

    def recursive_search(obj, path=""):
        if isinstance(obj, dict):
            for key, value in obj.items():
                recursive_search(value, path + "." + key if path else key)
        elif isinstance(obj, list):
            for i, item in enumerate(obj):
                recursive_search(item, f"{path}[{i}]")
        elif isinstance(obj, str):
            if any(word in obj.lower() for word in user_msg.split()):
                matches.append(f"{path}: {obj}")

    recursive_search(knowledge_base)

    if matches:
        return "Knowledge Snippets:\n" + "\n".join(matches[:5])
    return ""

def get_location(ip):
    try:
        res = requests.get(f"https://ipapi.co/{ip}/json/").json()
        return f"{res.get('city', '')}, {res.get('region', '')}, {res.get('country_name', '')}"
    except:
        return "Unknown"

def log_chat(session_id, ip, location, chat):
    log_entry = {
        "session_id": session_id,
        "ip": ip,
        "location": location,
        "chat": chat,
        "timestamp": datetime.datetime.utcnow().isoformat()
    }
    with open("chat_logs.json", "a", encoding="utf-8") as f:
        f.write(json.dumps(log_entry) + "\n")
