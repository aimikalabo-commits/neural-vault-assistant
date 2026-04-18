/**
 * Neural Vault Assistant — Obsidian Plugin Entry Point
 */

import { App, Plugin, PluginSettingTab, Setting, WorkspaceLeaf } from "obsidian";
import { ApiClient } from "./api-client";
import { ChatView, CHAT_VIEW_TYPE } from "./chat-view";

interface NVASettings {
  backendUrl: string;
  nContext: number;
}

const DEFAULT_SETTINGS: NVASettings = {
  backendUrl: "http://localhost:8765",
  nContext: 5,
};

export default class NeuralVaultPlugin extends Plugin {
  settings: NVASettings;
  client: ApiClient;

  async onload(): Promise<void> {
    await this.loadSettings();
    this.client = new ApiClient(this.settings.backendUrl);

    // Register the sidebar view
    this.registerView(CHAT_VIEW_TYPE, (leaf) => new ChatView(leaf, this.client));

    // Ribbon icon to open the chat
    this.addRibbonIcon("brain-circuit", "Neural Vault Assistant", () => {
      this.activateView();
    });

    // Command palette entry
    this.addCommand({
      id: "open-neural-vault-chat",
      name: "Open Neural Vault Chat",
      callback: () => this.activateView(),
    });

    // Settings tab
    this.addSettingTab(new NVASettingTab(this.app, this));

    console.log("[NeuralVault] Plugin loaded.");
  }

  async onunload(): Promise<void> {
    this.app.workspace.detachLeavesOfType(CHAT_VIEW_TYPE);
  }

  async activateView(): Promise<void> {
    const { workspace } = this.app;
    let leaf: WorkspaceLeaf | null = null;

    const existing = workspace.getLeavesOfType(CHAT_VIEW_TYPE);
    if (existing.length > 0) {
      leaf = existing[0];
    } else {
      leaf = workspace.getRightLeaf(false);
      if (leaf) {
        await leaf.setViewState({ type: CHAT_VIEW_TYPE, active: true });
      }
    }

    if (leaf) {
      workspace.revealLeaf(leaf);
    }
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
    this.client = new ApiClient(this.settings.backendUrl);
  }
}

// ------------------------------------------------------------------
// Settings Tab
// ------------------------------------------------------------------

class NVASettingTab extends PluginSettingTab {
  plugin: NeuralVaultPlugin;

  constructor(app: App, plugin: NeuralVaultPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Neural Vault Assistant Settings" });

    new Setting(containerEl)
      .setName("Backend URL")
      .setDesc("URL of the running Python FastAPI backend.")
      .addText((text) =>
        text
          .setPlaceholder("http://localhost:8765")
          .setValue(this.plugin.settings.backendUrl)
          .onChange(async (value) => {
            this.plugin.settings.backendUrl = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Context chunks")
      .setDesc("Number of note chunks to retrieve per query (1–10).")
      .addSlider((slider) =>
        slider
          .setLimits(1, 10, 1)
          .setValue(this.plugin.settings.nContext)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.nContext = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Test connection")
      .setDesc("Check if the backend is reachable.")
      .addButton((btn) =>
        btn.setButtonText("Test").onClick(async () => {
          const alive = await this.plugin.client.health();
          btn.setButtonText(alive ? "Connected!" : "Failed — is the server running?");
          setTimeout(() => btn.setButtonText("Test"), 3000);
        })
      );
  }
}
