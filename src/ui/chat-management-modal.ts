// src/ui/chat-management-modal.ts
import { Modal } from 'obsidian';
import type NexusAiChatImporterPlugin from '../main';

export class ChatManagementModal extends Modal {
    constructor(private plugin: NexusAiChatImporterPlugin) {
        super(plugin.app);
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl('h2', { text: 'Chat Management' });
        contentEl.createEl('p', {
            text: 'This is a placeholder for the upcoming chat management interface.'
        });
    }

    onClose(): void {
        const { contentEl } = this;
        contentEl.empty();
    }
}
