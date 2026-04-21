"""
Neural Vault Assistant — FastAPI Backend
Run with: uvicorn main:app --reload --port 8765
"""

import os
import re
from contextlib import asynccontextmanager
from typing import Optional
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from indexer import VaultIndexer, start_watcher
from claude_client import ClaudeClient
from note_writer import NoteWriter
from web_search import WebSearch

load_dotenv()

VAULT_PATH = os.environ.get("VAULT_PATH", "../demo-vault")

# ------------------------------------------------------------------
# App state
# ------------------------------------------------------------------

indexer: VaultIndexer = None
claude: ClaudeClient = None
writer: NoteWriter = None
searcher: WebSearch = None
watcher = None
conversation_history: list = []


@asynccontextmanager
async def lifespan(app: FastAPI):
    global indexer, claude, writer, searcher, watcher
    print("[Startup] Initializing Neural Vault Assistant...")

    indexer = VaultIndexer(VAULT_PATH)
    indexer.index_all()

    claude = ClaudeClient()
    writer = NoteWriter(VAULT_PATH)
    searcher = WebSearch()
    print(f"[Startup] Web search: {'enabled (Bing)' if searcher.enabled else 'disabled'}")

    watcher = start_watcher(indexer)
    print("[Startup] File watcher started.")

    yield

    if watcher:
        watcher.stop()
        watcher.join()
    print("[Shutdown] Stopped.")


app = FastAPI(title="Neural Vault Assistant", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["app://obsidian.md", "http://localhost", "*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ------------------------------------------------------------------
# Request / Response models
# ------------------------------------------------------------------

class ChatRequest(BaseModel):
    message: str
    n_context: int = 5
    web_search: bool = True  # enable/disable web search per request


class ChatResponse(BaseModel):
    reply: str
    sources: list
    web_results: list = []
    action_result: Optional[dict] = None


class ReindexResponse(BaseModel):
    status: str
    note_count: int


class NoteListResponse(BaseModel):
    notes: list


class NoteReadRequest(BaseModel):
    title: str


class ImageChatRequest(BaseModel):
    message: str
    image_base64: str        # base64-encoded image data
    media_type: str = "image/png"  # image/png, image/jpeg, image/gif, image/webp
    n_context: int = 5
    web_search: bool = True


# ------------------------------------------------------------------
# Endpoints
# ------------------------------------------------------------------

@app.get("/health")
def health():
    return {"status": "ok", "vault": VAULT_PATH}


def _process_reply(reply: str, user_message: str) -> tuple:
    """Execute any note action, update history, return (display_reply, action_result)."""
    action_result = writer.parse_and_execute(reply)
    if action_result and action_result.get("status") in ("created", "updated", "appended"):
        indexer.index_file(action_result["path"])

    conversation_history.append({"role": "user", "content": user_message})
    conversation_history.append({"role": "assistant", "content": reply})
    if len(conversation_history) > 40:
        conversation_history[:] = conversation_history[-40:]

    display_reply = re.sub(r"```json\s*\{.*?\}\s*```", "", reply, flags=re.DOTALL).strip() if action_result else reply
    return display_reply, action_result


@app.post("/chat", response_model=ChatResponse)
def chat(req: ChatRequest):
    chunks = indexer.search(req.message, n_results=req.n_context)

    web_results = []
    if req.web_search and searcher.enabled:
        web_results = searcher.search(req.message, n_results=4)

    reply = claude.chat(req.message, chunks, history=conversation_history, web_results=web_results)
    display_reply, action_result = _process_reply(reply, req.message)

    return ChatResponse(reply=display_reply, sources=chunks, web_results=web_results, action_result=action_result)


@app.post("/reindex", response_model=ReindexResponse)
def reindex():
    indexer.index_all()
    return ReindexResponse(status="ok", note_count=indexer.count())


@app.get("/graph")
def get_graph():
    return indexer.get_graph()


@app.get("/notes", response_model=NoteListResponse)
def list_notes():
    notes = indexer.list_notes()
    return NoteListResponse(notes=notes)


@app.post("/notes/read")
def read_note(req: NoteReadRequest):
    content = writer.read_note(req.title)
    if content is None:
        raise HTTPException(status_code=404, detail=f"Note '{req.title}' not found.")
    return {"title": req.title, "content": content}


@app.post("/chat/image", response_model=ChatResponse)
def chat_image(req: ImageChatRequest):
    chunks = indexer.search(req.message, n_results=req.n_context)

    web_results = []
    if req.web_search and searcher.enabled:
        web_results = searcher.search(req.message, n_results=3)

    reply = claude.chat_with_image(
        req.message,
        req.image_base64,
        req.media_type,
        chunks,
        history=conversation_history,
        web_results=web_results,
    )
    display_reply, action_result = _process_reply(reply, f"[Image] {req.message}")

    return ChatResponse(reply=display_reply, sources=chunks, web_results=web_results, action_result=action_result)


@app.delete("/chat/history")
def clear_history():
    global conversation_history
    conversation_history = []
    return {"status": "cleared"}
