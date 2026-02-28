import { Plugin, PluginSettingTab, Setting, App } from "obsidian";
import { readingViewPostProcessor } from "./reading-view";
import { livePreviewExtension } from "./live-preview";
import { setMaxConcurrent } from "./metadata";

interface LinkMentionSettings {
  showExternalArrow: boolean;
  maxConcurrentFetches: number;
}

/** Default number of concurrent metadata fetches. */
const DEFAULT_CONCURRENT_FETCHES = 4;
/** Upper bound for the concurrent fetches slider. Too high can freeze the UI on link-heavy notes. */
const MAX_CONCURRENT_LIMIT = 30;

const DEFAULT_SETTINGS: LinkMentionSettings = {
  showExternalArrow: true,
  maxConcurrentFetches: DEFAULT_CONCURRENT_FETCHES,
};

const HIDE_ARROW_CLASS = "link-mention-hide-arrow";

/**
 * Obsidian plugin entry point. Registers the reading-view post-processor
 * and the live-preview CodeMirror extension so that empty markdown links
 * (`[](url)`) are rendered as mention-style pills with title and favicon.
 */
export default class LinkMentionPlugin extends Plugin {
  settings!: LinkMentionSettings;

  async onload(): Promise<void> {
    await this.loadSettings();
    setMaxConcurrent(this.settings.maxConcurrentFetches);
    this.applyBodyClass();
    this.addSettingTab(new LinkMentionSettingTab(this.app, this));
    this.registerMarkdownPostProcessor(readingViewPostProcessor);
    this.registerEditorExtension(livePreviewExtension);
  }

  onunload(): void {
    document.body.classList.remove(HIDE_ARROW_CLASS);
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
    this.applyBodyClass();
  }

  applyBodyClass(): void {
    document.body.classList.toggle(
      HIDE_ARROW_CLASS,
      !this.settings.showExternalArrow,
    );
  }
}

class LinkMentionSettingTab extends PluginSettingTab {
  plugin: LinkMentionPlugin;

  constructor(app: App, plugin: LinkMentionPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName("Show external link arrow")
      .setDesc(
        "Show Obsidian's external-link arrow icon next to link mention pills.",
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.showExternalArrow)
          .onChange(async (value) => {
            this.plugin.settings.showExternalArrow = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Max concurrent fetches")
      .setDesc(
        "Number of link metadata requests that can run in parallel. Higher values populate pills faster but may cause rate limiting.",
      )
      .addSlider((slider) =>
        slider
          .setLimits(1, MAX_CONCURRENT_LIMIT, 1)
          .setValue(this.plugin.settings.maxConcurrentFetches)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.maxConcurrentFetches = value;
            setMaxConcurrent(value);
            await this.plugin.saveSettings();
          }),
      );
  }
}
