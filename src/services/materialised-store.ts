// src/services/materialised-store.ts
import { normalizePath } from 'obsidian';
import type NexusAiChatImporterPlugin from '../main';
import type { ChatUID, FileMaterialisedMeta } from '../types';

export class MaterialisedStore {
    private materialisedDir: string;

    constructor(private plugin: NexusAiChatImporterPlugin) {
        this.materialisedDir = normalizePath(`${this.plugin.manifest.id}/data/materialised`);
    }

    private async ensureDir() {
        const adapter = this.plugin.app.vault.adapter;
        if (!(await adapter.exists(this.materialisedDir))) {
            await adapter.mkdir(this.materialisedDir);
        }
    }

    async get(uid: ChatUID): Promise<FileMaterialisedMeta | null> {
        const adapter = this.plugin.app.vault.adapter;
        const path = `${this.materialisedDir}/${uid}.json`;
        if (!(await adapter.exists(path))) return null;
        const data = await adapter.read(path);
        return JSON.parse(data) as FileMaterialisedMeta;
    }

    async put(meta: FileMaterialisedMeta): Promise<void> {
        await this.ensureDir();
        const adapter = this.plugin.app.vault.adapter;
        const path = `${this.materialisedDir}/${meta.uid}.json`;
        await adapter.write(path, JSON.stringify(meta, null, 2));
    }
}
