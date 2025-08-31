import type { } from 'obsidian';

export type ChatUID = string;

export interface ChatSummary {
    uid: ChatUID;
    title: string;
    createdAt: number;
    updatedAt: number;
    model?: string;
    messageCount: number;
    keywordsSample?: string;
    sourceRef: {
        exportPath: string;
        offset?: number | string;
    };
}

export interface FileMaterialisedMeta {
    uid: ChatUID;
    contentHash: string;
    updatedAt: number;
    filePath: string;
    lastImportedAt: number;
    profileName?: string;
}

export type IncludeState = 'include' | 'ignore' | 'unset';

export interface ImportProfile {
    name: string;
    targetFolder?: string;
    include: Record<ChatUID, true>;
    ignore: Record<ChatUID, true>;
    filters?: ViewFilters;
    filenameTemplate?: string;
    frontMatterTemplate?: string;
}

export interface ViewFilters {
    dateField?: 'createdAt' | 'updatedAt';
    from?: number;
    to?: number;
    keyword?: string;
    status?: Array<'new' | 'updated' | 'imported' | 'ignored'>;
    source?: string;
}
