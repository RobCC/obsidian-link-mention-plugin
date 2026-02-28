import { Plugin, PluginSettingTab, Setting, App } from "obsidian";
import { readingViewPostProcessor } from "./reading-view";
import { livePreviewExtension } from "./live-preview";

interface LinkMentionSettings {
	showExternalArrow: boolean;
}

const DEFAULT_SETTINGS: LinkMentionSettings = {
	showExternalArrow: true,
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
		document.body.classList.toggle(HIDE_ARROW_CLASS, !this.settings.showExternalArrow);
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
			.setDesc("Show Obsidian's external-link arrow icon next to link mention pills.")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.showExternalArrow)
					.onChange(async (value) => {
						this.plugin.settings.showExternalArrow = value;
						await this.plugin.saveSettings();
					}),
			);
	}
}
