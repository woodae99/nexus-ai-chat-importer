// src/ui/chat-management-modal.ts
import { Modal } from 'obsidian';
import type NexusAiChatImporterPlugin from '../main';

export class ChatManagementModal extends Modal {
    constructor(private plugin: NexusAiChatImporterPlugin) {
        super(plugin.app);
    }

    async onOpen(): Promise<void> {
        const { contentEl } = this;
        const profile = await this.plugin.getProfileStore().getActive();
        contentEl.empty();
        contentEl.createEl('h2', { text: `Chat Management - ${profile.name}` });
        contentEl.createEl('p', {
            text: 'This is a placeholder for the upcoming chat management interface.'
        });
    }

    onClose(): void {
        const { contentEl } = this;
        contentEl.empty();
    }
}
