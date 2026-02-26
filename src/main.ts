import { Plugin } from "obsidian";
import { readingViewPostProcessor } from "./reading-view";
import { livePreviewExtension } from "./live-preview";

export default class LinkMentionPlugin extends Plugin {
	async onload(): Promise<void> {
		this.registerMarkdownPostProcessor(readingViewPostProcessor);
		this.registerEditorExtension(livePreviewExtension);
	}
}
