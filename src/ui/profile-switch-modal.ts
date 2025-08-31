import { SuggestModal } from 'obsidian';
import type NexusAiChatImporterPlugin from '../main';

export class ProfileSwitchModal extends SuggestModal<string> {
    constructor(
        private plugin: NexusAiChatImporterPlugin,
        private profiles: string[],
    ) {
        super(plugin.app);
        this.setPlaceholder('Select import profile');
    }

    getSuggestions(query: string): string[] {
        const lower = query.toLowerCase();
        return this.profiles.filter(p => p.toLowerCase().includes(lower));
    }

    renderSuggestion(value: string, el: HTMLElement) {
        el.createEl('div', { text: value });
    }

    onChooseSuggestion(item: string) {
        this.plugin.getProfileStore().setActive(item);
    }
}
