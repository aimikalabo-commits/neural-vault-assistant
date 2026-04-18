/**
 * API Client — talks to the Python FastAPI backend.
 */

export interface ChatResponse {
  reply: string;
  sources: NoteSource[];
  action_result: ActionResult | null;
}

export interface NoteSource {
  title: string;
  content: string;
  source: string;
  score: number;
}

export interface ActionResult {
  status: "created" | "updated" | "appended" | "error";
  title?: string;
  path?: string;
  message?: string;
}

export interface VaultNote {
  title: string;
  source: string;
  tags: string;
}

export class ApiClient {
  private baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  async health(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/health`);
      return res.ok;
    } catch {
      return false;
    }
  }

  async chat(message: string, nContext = 5): Promise<ChatResponse> {
    const res = await fetch(`${this.baseUrl}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, n_context: nContext }),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Backend error ${res.status}: ${err}`);
    }
    return res.json();
  }

  async listNotes(): Promise<VaultNote[]> {
    const res = await fetch(`${this.baseUrl}/notes`);
    if (!res.ok) throw new Error("Failed to fetch notes list.");
    const data = await res.json();
    return data.notes;
  }

  async reindex(): Promise<{ note_count: number }> {
    const res = await fetch(`${this.baseUrl}/reindex`, { method: "POST" });
    if (!res.ok) throw new Error("Reindex failed.");
    return res.json();
  }

  async clearHistory(): Promise<void> {
    await fetch(`${this.baseUrl}/chat/history`, { method: "DELETE" });
  }
}
