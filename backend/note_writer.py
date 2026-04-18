"""
Note Writer — parses Claude's response for action blocks
and writes/updates files in the vault.
"""

import json
import re
from pathlib import Path
from typing import Optional


class NoteWriter:
    def __init__(self, vault_path: str):
        self.vault_path = Path(vault_path)

    def parse_and_execute(self, response_text: str) -> Optional[dict]:
        """
        Look for a JSON action block in Claude's response.
        If found, execute the file operation and return result metadata.
        Returns None if no action was found.
        """
        match = re.search(r"```json\s*(\{.*?\})\s*```", response_text, re.DOTALL)
        if not match:
            return None

        try:
            action = json.loads(match.group(1))
        except json.JSONDecodeError:
            return None

        action_type = action.get("action")
        title = action.get("title", "").strip()
        content = action.get("content", "")

        if not title:
            return None

        if action_type == "create_note":
            return self._create_note(title, content)
        elif action_type == "update_note":
            return self._update_note(title, content)
        elif action_type == "append_note":
            return self._append_note(title, content)

        return None

    # ------------------------------------------------------------------
    # File operations
    # ------------------------------------------------------------------

    def _create_note(self, title: str, content: str) -> dict:
        path = self._note_path(title)
        if path.exists():
            return {"status": "error", "message": f"Note '{title}' already exists. Use update instead."}
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")
        return {"status": "created", "title": title, "path": str(path)}

    def _update_note(self, title: str, content: str) -> dict:
        path = self._note_path(title)
        if not path.exists():
            # Create it if it doesn't exist
            path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")
        return {"status": "updated", "title": title, "path": str(path)}

    def _append_note(self, title: str, content: str) -> dict:
        path = self._note_path(title)
        if not path.exists():
            return {"status": "error", "message": f"Note '{title}' not found."}
        with open(path, "a", encoding="utf-8") as f:
            f.write(content)
        return {"status": "appended", "title": title, "path": str(path)}

    def _note_path(self, title: str) -> Path:
        # Sanitize title for filesystem
        safe_title = re.sub(r'[<>:"/\\|?*]', "", title)
        return self.vault_path / "notes" / f"{safe_title}.md"

    def read_note(self, title: str) -> Optional[str]:
        """Read the full content of a note by title."""
        path = self._note_path(title)
        if path.exists():
            return path.read_text(encoding="utf-8")
        return None
