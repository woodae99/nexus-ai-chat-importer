// src/services/profile-store.ts
import { normalizePath } from 'obsidian';
import type NexusAiChatImporterPlugin from '../main';
import type { ImportProfile } from '../types';

interface ProfileState {
    profiles: string[];
    activeProfile: string;
    globalIgnores: Record<string, true>;
}

export class ProfileStore {
    private statePath: string;
    private profilesDir: string;

    constructor(private plugin: NexusAiChatImporterPlugin) {
        const base = normalizePath(`${this.plugin.manifest.id}/data`);
        this.statePath = `${base}/state.json`;
        this.profilesDir = `${base}/profiles`;
    }

    private async ensureDir(path: string): Promise<void> {
        const adapter = this.plugin.app.vault.adapter;
        if (!(await adapter.exists(path))) {
            await adapter.mkdir(path);
        }
    }

    private async readState(): Promise<ProfileState> {
        const adapter = this.plugin.app.vault.adapter;
        if (await adapter.exists(this.statePath)) {
            const data = await adapter.read(this.statePath);
            return JSON.parse(data);
        }
        return { profiles: ['Default'], activeProfile: 'Default', globalIgnores: {} };
    }

    private async writeState(state: ProfileState): Promise<void> {
        const adapter = this.plugin.app.vault.adapter;
        await this.ensureDir(this.statePath.substring(0, this.statePath.lastIndexOf('/')));
        await adapter.write(this.statePath, JSON.stringify(state, null, 2));
    }

    async list(): Promise<string[]> {
        const state = await this.readState();
        return state.profiles;
    }

    async get(name: string): Promise<ImportProfile | null> {
        const adapter = this.plugin.app.vault.adapter;
        const path = `${this.profilesDir}/${name}.json`;
        if (!(await adapter.exists(path))) return null;
        const data = await adapter.read(path);
        return JSON.parse(data) as ImportProfile;
    }

    async getActive(): Promise<ImportProfile> {
        const state = await this.readState();
        const profile = await this.get(state.activeProfile);
        if (profile) return profile;
        return { name: state.activeProfile, include: {}, ignore: {} };
    }

    async save(profile: ImportProfile): Promise<void> {
        const adapter = this.plugin.app.vault.adapter;
        await this.ensureDir(this.profilesDir);
        const path = `${this.profilesDir}/${profile.name}.json`;
        await adapter.write(path, JSON.stringify(profile, null, 2));

        const state = await this.readState();
        if (!state.profiles.includes(profile.name)) {
            state.profiles.push(profile.name);
        }
        await this.writeState(state);
    }

    async setActive(name: string): Promise<void> {
        const state = await this.readState();
        state.activeProfile = name;
        if (!state.profiles.includes(name)) {
            state.profiles.push(name);
        }
        await this.writeState(state);
    }
}
