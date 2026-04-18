/**
 * Chat View — the sidebar panel UI rendered inside Obsidian.
 */

import { ItemView, WorkspaceLeaf, setIcon } from "obsidian";
import { ApiClient, ChatResponse, NoteSource } from "./api-client";

export const CHAT_VIEW_TYPE = "neural-vault-chat";

interface Message {
  role: "user" | "assistant" | "system";
  content: string;
  sources?: NoteSource[];
  actionResult?: ChatResponse["action_result"];
}

export class ChatView extends ItemView {
  private client: ApiClient;
  private messages: Message[] = [];
  private messagesEl: HTMLElement;
  private inputEl: HTMLTextAreaElement;
  private sendBtn: HTMLButtonElement;
  private statusEl: HTMLElement;

  constructor(leaf: WorkspaceLeaf, client: ApiClient) {
    super(leaf);
    this.client = client;
  }

  getViewType(): string {
    return CHAT_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "Neural Vault";
  }

  getIcon(): string {
    return "brain-circuit";
  }

  async onOpen(): Promise<void> {
    this.buildUI();
    await this.checkBackendStatus();
  }

  async onClose(): Promise<void> {}

  // ------------------------------------------------------------------
  // UI Construction
  // ------------------------------------------------------------------

  private buildUI(): void {
    const root = this.containerEl.children[1] as HTMLElement;
    root.empty();
    root.addClass("nva-root");

    // Header
    const header = root.createDiv({ cls: "nva-header" });
    const titleEl = header.createDiv({ cls: "nva-title" });
    setIcon(titleEl.createSpan({ cls: "nva-icon" }), "brain-circuit");
    titleEl.createSpan({ text: " Neural Vault" });

    const headerActions = header.createDiv({ cls: "nva-header-actions" });
    const reindexBtn = headerActions.createEl("button", {
      cls: "nva-btn-icon",
      attr: { title: "Re-index vault" },
    });
    setIcon(reindexBtn, "refresh-cw");
    reindexBtn.addEventListener("click", () => this.handleReindex());

    const clearBtn = headerActions.createEl("button", {
      cls: "nva-btn-icon",
      attr: { title: "Clear conversation" },
    });
    setIcon(clearBtn, "trash-2");
    clearBtn.addEventListener("click", () => this.handleClear());

    // Status bar
    this.statusEl = root.createDiv({ cls: "nva-status" });

    // Messages area
    this.messagesEl = root.createDiv({ cls: "nva-messages" });
    this.addSystemMessage("Hello! I'm your Neural Vault assistant. Ask me anything about your notes, or tell me to create/update a note.");

    // Input area
    const inputArea = root.createDiv({ cls: "nva-input-area" });
    this.inputEl = inputArea.createEl("textarea", {
      cls: "nva-input",
      attr: { placeholder: "Ask about your notes, or say 'Create a note about...'", rows: "3" },
    });
    this.inputEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        this.handleSend();
      }
    });

    this.sendBtn = inputArea.createEl("button", { cls: "nva-send-btn", text: "Send" });
    this.sendBtn.addEventListener("click", () => this.handleSend());

    this.applyStyles(root);
  }

  // ------------------------------------------------------------------
  // Actions
  // ------------------------------------------------------------------

  private async checkBackendStatus(): Promise<void> {
    const alive = await this.client.health();
    if (alive) {
      this.setStatus("Connected", "green");
    } else {
      this.setStatus("Backend offline — start the Python server", "red");
    }
  }

  private async handleSend(): Promise<void> {
    const text = this.inputEl.value.trim();
    if (!text) return;

    this.inputEl.value = "";
    this.addMessage({ role: "user", content: text });
    this.setSending(true);

    try {
      const response = await this.client.chat(text);
      this.addMessage({
        role: "assistant",
        content: response.reply,
        sources: response.sources,
        actionResult: response.action_result,
      });
    } catch (err) {
      this.addMessage({
        role: "system",
        content: `Error: ${err instanceof Error ? err.message : String(err)}`,
      });
    } finally {
      this.setSending(false);
    }
  }

  private async handleReindex(): Promise<void> {
    this.setStatus("Re-indexing...", "orange");
    try {
      const result = await this.client.reindex();
      this.setStatus(`Indexed ${result.note_count} chunks`, "green");
      this.addSystemMessage(`Vault re-indexed. ${result.note_count} chunks in store.`);
    } catch {
      this.setStatus("Reindex failed", "red");
    }
  }

  private async handleClear(): Promise<void> {
    await this.client.clearHistory();
    this.messages = [];
    this.messagesEl.empty();
    this.addSystemMessage("Conversation cleared.");
  }

  // ------------------------------------------------------------------
  // Message rendering
  // ------------------------------------------------------------------

  private addMessage(msg: Message): void {
    this.messages.push(msg);
    const el = this.messagesEl.createDiv({ cls: `nva-msg nva-msg-${msg.role}` });

    // Role label
    const label = el.createDiv({ cls: "nva-msg-label" });
    label.setText(msg.role === "user" ? "You" : msg.role === "assistant" ? "Assistant" : "System");

    // Content
    const content = el.createDiv({ cls: "nva-msg-content" });
    content.innerHTML = this.simpleMarkdown(msg.content);

    // Action result badge
    if (msg.actionResult) {
      const badge = el.createDiv({ cls: `nva-action-badge nva-action-${msg.actionResult.status}` });
      const statusText = {
        created: `Created note: ${msg.actionResult.title}`,
        updated: `Updated note: ${msg.actionResult.title}`,
        appended: `Appended to: ${msg.actionResult.title}`,
        error: `Error: ${msg.actionResult.message}`,
      }[msg.actionResult.status] ?? "Action taken";
      badge.setText(statusText);
    }

    // Sources
    if (msg.sources && msg.sources.length > 0) {
      const sourcesEl = el.createDiv({ cls: "nva-sources" });
      sourcesEl.createDiv({ cls: "nva-sources-label", text: "Sources:" });
      for (const src of msg.sources.slice(0, 3)) {
        const chip = sourcesEl.createDiv({ cls: "nva-source-chip" });
        chip.setText(`${src.title} (${src.score})`);
        chip.addEventListener("click", () => {
          this.app.workspace.openLinkText(src.title, "", false);
        });
      }
    }

    this.messagesEl.scrollTo({ top: this.messagesEl.scrollHeight, behavior: "smooth" });
  }

  private addSystemMessage(text: string): void {
    this.addMessage({ role: "system", content: text });
  }

  // ------------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------------

  private setStatus(text: string, color: string): void {
    this.statusEl.setText(text);
    this.statusEl.style.color = color;
  }

  private setSending(sending: boolean): void {
    this.sendBtn.disabled = sending;
    this.sendBtn.setText(sending ? "..." : "Send");
    this.inputEl.disabled = sending;
  }

  private simpleMarkdown(text: string): string {
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/\*(.+?)\*/g, "<em>$1</em>")
      .replace(/`(.+?)`/g, "<code>$1</code>")
      .replace(/^### (.+)$/gm, "<h3>$1</h3>")
      .replace(/^## (.+)$/gm, "<h2>$1</h2>")
      .replace(/^# (.+)$/gm, "<h1>$1</h1>")
      .replace(/^- (.+)$/gm, "<li>$1</li>")
      .replace(/\n/g, "<br>");
  }

  // ------------------------------------------------------------------
  // Styles (injected inline so no separate CSS file needed)
  // ------------------------------------------------------------------

  private applyStyles(root: HTMLElement): void {
    const style = document.createElement("style");
    style.textContent = `
      .nva-root {
        display: flex;
        flex-direction: column;
        height: 100%;
        font-family: var(--font-interface);
        font-size: 14px;
        background: var(--background-primary);
      }
      .nva-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 10px 12px;
        border-bottom: 1px solid var(--background-modifier-border);
        background: var(--background-secondary);
      }
      .nva-title {
        display: flex;
        align-items: center;
        gap: 6px;
        font-weight: 600;
        font-size: 15px;
        color: var(--text-accent);
      }
      .nva-header-actions {
        display: flex;
        gap: 6px;
      }
      .nva-btn-icon {
        background: none;
        border: none;
        cursor: pointer;
        color: var(--text-muted);
        padding: 4px;
        border-radius: 4px;
        display: flex;
        align-items: center;
      }
      .nva-btn-icon:hover { color: var(--text-normal); background: var(--background-modifier-hover); }
      .nva-status {
        font-size: 11px;
        padding: 3px 12px;
        color: var(--text-muted);
        background: var(--background-secondary-alt);
        border-bottom: 1px solid var(--background-modifier-border);
      }
      .nva-messages {
        flex: 1;
        overflow-y: auto;
        padding: 12px;
        display: flex;
        flex-direction: column;
        gap: 10px;
      }
      .nva-msg {
        padding: 10px 12px;
        border-radius: 8px;
        max-width: 100%;
      }
      .nva-msg-user {
        background: var(--interactive-accent);
        color: var(--text-on-accent);
        align-self: flex-end;
        max-width: 85%;
      }
      .nva-msg-assistant {
        background: var(--background-secondary);
        border: 1px solid var(--background-modifier-border);
        align-self: flex-start;
        max-width: 95%;
      }
      .nva-msg-system {
        background: var(--background-secondary-alt);
        color: var(--text-muted);
        font-style: italic;
        font-size: 12px;
        align-self: center;
        text-align: center;
      }
      .nva-msg-label {
        font-size: 11px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        margin-bottom: 5px;
        opacity: 0.7;
      }
      .nva-msg-content { line-height: 1.5; }
      .nva-msg-content code {
        background: var(--code-background);
        padding: 1px 4px;
        border-radius: 3px;
        font-family: var(--font-monospace);
        font-size: 12px;
      }
      .nva-action-badge {
        margin-top: 8px;
        padding: 4px 8px;
        border-radius: 4px;
        font-size: 12px;
        font-weight: 500;
      }
      .nva-action-created { background: #1a4a2e; color: #4ade80; }
      .nva-action-updated { background: #1a3a4a; color: #60a5fa; }
      .nva-action-appended { background: #2a3a1a; color: #a3e635; }
      .nva-action-error { background: #4a1a1a; color: #f87171; }
      .nva-sources {
        margin-top: 8px;
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
        align-items: center;
      }
      .nva-sources-label { font-size: 11px; color: var(--text-muted); margin-right: 4px; }
      .nva-source-chip {
        font-size: 11px;
        padding: 2px 7px;
        border-radius: 10px;
        background: var(--background-modifier-border);
        color: var(--text-accent);
        cursor: pointer;
        transition: background 0.15s;
      }
      .nva-source-chip:hover { background: var(--interactive-accent); color: var(--text-on-accent); }
      .nva-input-area {
        padding: 10px 12px;
        border-top: 1px solid var(--background-modifier-border);
        background: var(--background-secondary);
        display: flex;
        gap: 8px;
        align-items: flex-end;
      }
      .nva-input {
        flex: 1;
        resize: none;
        border-radius: 6px;
        border: 1px solid var(--background-modifier-border);
        padding: 8px 10px;
        background: var(--background-primary);
        color: var(--text-normal);
        font-family: var(--font-interface);
        font-size: 13px;
        line-height: 1.4;
      }
      .nva-input:focus { outline: none; border-color: var(--interactive-accent); }
      .nva-send-btn {
        background: var(--interactive-accent);
        color: var(--text-on-accent);
        border: none;
        border-radius: 6px;
        padding: 8px 16px;
        cursor: pointer;
        font-weight: 500;
        font-size: 13px;
        white-space: nowrap;
        transition: opacity 0.15s;
      }
      .nva-send-btn:hover { opacity: 0.9; }
      .nva-send-btn:disabled { opacity: 0.5; cursor: not-allowed; }
    `;
    document.head.appendChild(style);
  }
}
