// src/ui/chat-management-modal.ts
import { Modal, Setting } from 'obsidian';
import type NexusAiChatImporterPlugin from '../main';

export class ChatManagementModal extends Modal {
    private containerEl!: HTMLElement;
    private headerEl!: HTMLElement;
    private summaryEl!: HTMLElement;

    constructor(private plugin: NexusAiChatImporterPlugin) {
        super(plugin.app);
    }

    async onOpen(): Promise<void> {
        const { contentEl } = this;
        contentEl.empty();

        // Root container
        this.containerEl = contentEl.createDiv({ cls: 'nexus-chat-management' });

        // Header with active profile and actions
        this.headerEl = this.containerEl.createDiv({ cls: 'nexus-cm-header' });
        await this.renderHeader();

        // Vault summary section
        this.summaryEl = this.containerEl.createDiv({ cls: 'nexus-cm-summary' });
        await this.renderSummary();

        // Placeholder for future list/filters
        const placeholder = this.containerEl.createDiv({ cls: 'nexus-cm-placeholder' });
        placeholder.createEl('p', { text: 'Conversation list and filters coming next.' });
    }

    onClose(): void {
        const { contentEl } = this;
        contentEl.empty();
    }

    private async renderHeader(): Promise<void> {
        this.headerEl.empty();

        const profile = await this.plugin.getProfileStore().getActive();
        const title = this.headerEl.createEl('h2', { text: `Chat Management` });
        title.style.marginBottom = '0.25rem';

        const subtitle = this.headerEl.createEl('div');
        subtitle.style.marginBottom = '0.75rem';
        subtitle.style.color = 'var(--text-muted)';
        subtitle.textContent = `Active profile: ${profile.name}`;

        // Actions row
        new Setting(this.headerEl)
            .setName('Actions')
            .addButton(btn =>
                btn.setButtonText('Switch Profile')
                    .setCta()
                    .onClick(async () => {
                        await this.plugin.openProfileSwitchModal();
                        // Refresh header after small delay to ensure profile persisted
                        setTimeout(() => this.renderHeader(), 50);
                    })
            )
            .addButton(btn =>
                btn.setButtonText('Rescan Vault')
                    .onClick(async () => {
                        await this.renderSummary(true);
                    })
            );
    }

    private async renderSummary(forceRescan: boolean = false): Promise<void> {
        this.summaryEl.empty();

        const loading = this.summaryEl.createEl('div', { text: 'Scanning vault for conversations…' });
        loading.style.color = 'var(--text-muted)';

        // Scan conversations and group by provider
        const conversations = await this.plugin.getStorageService().scanExistingConversations();
        const all = Array.from(conversations.values());

        // Group counts by provider
        const byProvider: Record<string, number> = {};
        for (const c of all) {
            const provider = (c as any).provider || 'unknown';
            byProvider[provider] = (byProvider[provider] || 0) + 1;
        }

        this.summaryEl.empty();
        const summaryHeader = this.summaryEl.createEl('h3', { text: 'Vault Summary' });
        summaryHeader.style.marginBottom = '0.25rem';

        const totalEl = this.summaryEl.createEl('div', { text: `Total conversations: ${all.length}` });
        totalEl.style.marginBottom = '0.5rem';

        if (all.length === 0) {
            this.summaryEl.createEl('div', { text: 'No conversations found in your archive folder yet.' });
            return;
        }

        // Provider breakdown
        const list = this.summaryEl.createEl('ul');
        for (const [provider, count] of Object.entries(byProvider)) {
            list.createEl('li', { text: `${provider}: ${count}` });
        }
    }
}
