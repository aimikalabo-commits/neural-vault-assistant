"""
Claude API client — handles chat completions with RAG context
and note creation/update instructions.
"""

import os
from typing import Optional
import anthropic

MODEL = "claude-sonnet-4-6"

SYSTEM_PROMPT = """You are a Neural Vault Assistant — an AI embedded inside an Obsidian knowledge base.
You have access to the user's notes via semantic search. Your job is to:

1. Answer questions using the provided note context.
2. Help the user create new notes or update existing ones.
3. Make connections between ideas across the vault.
4. Be concise, clear, and cite which note you're drawing from.

When asked to CREATE a note, respond with a JSON block like:
```json
{"action": "create_note", "title": "Note Title", "content": "# Note Title\n\nFull markdown content..."}
```

When asked to UPDATE an existing note, respond with a JSON block like:
```json
{"action": "update_note", "title": "Existing Note Title", "content": "# Note Title\n\nFull updated markdown content..."}
```

When asked to APPEND to a note, respond with a JSON block like:
```json
{"action": "append_note", "title": "Existing Note Title", "content": "\n\n## New Section\n\nContent to append..."}
```

For regular answers, respond in plain markdown — no JSON needed.
Always be helpful, accurate, and grounded in both vault content and current web information."""


class ClaudeClient:
    def __init__(self):
        api_key = os.environ.get("ANTHROPIC_API_KEY")
        if not api_key:
            raise ValueError("ANTHROPIC_API_KEY not set in environment.")
        self.client = anthropic.Anthropic(api_key=api_key)

    def chat(
        self,
        user_message: str,
        context_chunks: list,
        history: Optional[list] = None,
        web_results: Optional[list] = None,
    ) -> str:
        """Send a message to Claude with vault context and optional web results."""
        context_text = self._format_context(context_chunks)
        web_text = self._format_web(web_results or [])
        augmented_message = f"{context_text}\n\n{web_text}\n\n---\n\nUser: {user_message}"

        messages = []
        if history:
            messages.extend(history[-10:])
        messages.append({"role": "user", "content": augmented_message})

        response = self.client.messages.create(
            model=MODEL,
            max_tokens=2048,
            system=SYSTEM_PROMPT,
            messages=messages,
        )
        return response.content[0].text

    def chat_with_image(
        self,
        user_message: str,
        image_base64: str,
        media_type: str,
        context_chunks: list,
        history: Optional[list] = None,
        web_results: Optional[list] = None,
    ) -> str:
        """Send a message with an image attachment using Claude vision."""
        context_text = self._format_context(context_chunks)
        web_text = self._format_web(web_results or [])
        text_prefix = f"{context_text}\n\n{web_text}\n\n---\n\nUser: {user_message}"

        messages = []
        if history:
            messages.extend(history[-10:])
        messages.append({
            "role": "user",
            "content": [
                {
                    "type": "image",
                    "source": {
                        "type": "base64",
                        "media_type": media_type,
                        "data": image_base64,
                    },
                },
                {
                    "type": "text",
                    "text": text_prefix,
                },
            ],
        })

        response = self.client.messages.create(
            model=MODEL,
            max_tokens=2048,
            system=SYSTEM_PROMPT,
            messages=messages,
        )
        return response.content[0].text

    def _format_context(self, chunks: list) -> str:
        if not chunks:
            return "No relevant notes found in the vault for this query."
        lines = ["## Relevant Notes from Vault\n"]
        for chunk in chunks:
            title = chunk.get("title", "Unknown")
            score = chunk.get("score", 0)
            content = chunk.get("content", "")
            lines.append(f"### [{title}] (relevance: {score})\n{content}\n")
        return "\n".join(lines)

    def _format_web(self, results: list) -> str:
        if not results:
            return ""
        lines = ["## Web Search Results (Bing)\n"]
        for r in results:
            lines.append(f"### {r.get('title', '')}\n{r.get('snippet', '')}\nSource: {r.get('url', '')}\n")
        return "\n".join(lines)
