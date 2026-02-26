import { Plugin } from "obsidian";
import { readingViewPostProcessor } from "./reading-view";
import { livePreviewExtension } from "./live-preview";

/**
 * Obsidian plugin entry point. Registers the reading-view post-processor
 * and the live-preview CodeMirror extension so that empty markdown links
 * (`[](url)`) are rendered as mention-style pills with title and favicon.
 */
export default class LinkMentionPlugin extends Plugin {
	async onload(): Promise<void> {
		this.registerMarkdownPostProcessor(readingViewPostProcessor);
		this.registerEditorExtension(livePreviewExtension);
	}
}
