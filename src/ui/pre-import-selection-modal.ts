import { App, Modal, Setting, TextComponent, SuggestModal, Notice } from 'obsidian';
import type { ChatSummary, ChatUID, ImportProfile } from '../types';
import type NexusAiChatImporterPlugin from '../main';

type SortKey = 'updatedAt' | 'createdAt' | 'title';
type SortDir = 'asc' | 'desc';

export class PreImportSelectionModal extends Modal {
  private plugin: NexusAiChatImporterPlugin;
  private provider: string;
  private profile: ImportProfile;
  private allSummaries: ChatSummary[];
  private filtered: ChatSummary[] = [];
  private selection: Set<ChatUID> | any = new Set<ChatUID>();
  private keyword = '';
  private sortKey: SortKey = 'updatedAt';
  private sortDir: SortDir = 'desc';

  private listEl!: HTMLElement;
  private countEl!: HTMLElement;
  private importBtn!: HTMLButtonElement;
  private persistUnselected = false;
  private useGlobalIgnore = false;
  private globalIgnores: Record<string, true> = {} as any;

  constructor(plugin: NexusAiChatImporterPlugin, provider: string, summaries: ChatSummary[], profile: ImportProfile, private onConfirm: (result: { selected: Set<ChatUID>, persistUnselected: boolean, ignoreScope: 'profile'|'global' }) => void) {
    super(plugin.app);
    this.plugin = plugin;
    this.provider = provider;
    this.profile = profile;
    this.allSummaries = summaries;

    // Initial selection: include all not explicitly ignored by profile
    this.ensureSelectionSet();
    for (const s of this.allSummaries) {
      if (profile.ignore?.[s.uid]) continue;
      // If include set exists, prioritize it; otherwise default include
      if (!profile.include || profile.include[s.uid] || Object.keys(profile.include).length === 0) {
        (this.selection as Set<ChatUID>).add(s.uid);
      }
    }
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('nexus-preimport-modal');

    // Load global ignores and adjust selection before rendering
    this.plugin.getProfileStore().listGlobalIgnores().then((gi) => {
      this.globalIgnores = gi || {} as any;
      // If profile has explicit includes, prefer them; else drop any globally ignored from selection
      const includeKeys = Object.keys(this.profile.include || {});
      if (includeKeys.length > 0) {
        this.selection = new Set<ChatUID>(includeKeys as ChatUID[]);
      } else {
        for (const s of this.allSummaries) {
          if ((this.globalIgnores as any)[s.uid]) {
            (this.selection as Set<ChatUID>).delete(s.uid);
          }
        }
      }
      this.renderList();
      this.updateCounts();
    }).catch(() => {});

    // Make modal spacious
    const modalEl = (this as any).modalEl as HTMLElement | undefined;
    if (modalEl) {
      modalEl.style.width = '80vw';
      modalEl.style.maxWidth = '80vw';
      modalEl.style.maxHeight = '85vh';
    }

    // Header
    const header = contentEl.createEl('div');
    header.createEl('h2', { text: `Select Chats to Import (${this.provider})` });
    const sub = header.createEl('div', { text: `Active profile: ${this.profile.name}` });
    sub.style.color = 'var(--text-muted)';
    const loaded = header.createEl('div', { text: `Loaded ${this.allSummaries.length} chats from archive` });
    loaded.style.color = 'var(--text-accent)';
    loaded.style.fontWeight = '600';

    // Controls: keyword + sort + bulk
    const controls = contentEl.createDiv();
    controls.style.display = 'flex';
    controls.style.gap = '8px';
    controls.style.alignItems = 'center';

    // Keyword filter
    const filterSetting = new Setting(controls).setName('Filter');
    const input = new TextComponent(filterSetting.controlEl);
    input.setPlaceholder('Filter by title or keyword…');
    input.inputEl.style.width = '220px';
    input.onChange((v) => {
      this.keyword = v.trim().toLowerCase();
      this.applyFilters();
      this.renderList();
      this.updateCounts();
    });

    // Sort select
    const sortSetting = new Setting(controls).setName('Sort');
    const sortSelect = sortSetting.controlEl.createEl('select');
    const options: Array<{key: SortKey; dir: SortDir; label: string}> = [
      { key: 'updatedAt', dir: 'desc', label: 'Updated (newest)' },
      { key: 'updatedAt', dir: 'asc', label: 'Updated (oldest)' },
      { key: 'createdAt', dir: 'desc', label: 'Created (newest)' },
      { key: 'createdAt', dir: 'asc', label: 'Created (oldest)' },
      { key: 'title', dir: 'asc', label: 'Title (A→Z)' },
      { key: 'title', dir: 'desc', label: 'Title (Z→A)' },
    ];
    for (const opt of options) {
      const el = sortSelect.createEl('option', { text: opt.label });
      el.value = `${opt.key}:${opt.dir}`;
      if (opt.key === this.sortKey && opt.dir === this.sortDir) el.selected = true;
    }
    sortSelect.onchange = () => {
      const [k, d] = (sortSelect.value.split(':') as [SortKey, SortDir]);
      this.sortKey = k; this.sortDir = d;
      this.applyFilters();
      this.renderList();
    };

    // Selection actions
    const bulk = new Setting(controls).setName('Bulk');
    bulk.addButton(b => b.setButtonText('Select all in view').onClick(() => {
      for (const s of this.filtered) (this.selection as Set<ChatUID>).add(s.uid);
      this.renderList();
      this.updateCounts();
    }));
    bulk.addButton(b => b.setButtonText('Clear selection in view').onClick(() => {
      for (const s of this.filtered) (this.selection as Set<ChatUID>).delete(s.uid);
      this.renderList();
      this.updateCounts();
    }));

    // Global actions
    const globalSel = new Setting(controls).setName('Global');
    globalSel.addButton(b => b.setButtonText('Select all (all chats)').onClick(() => {
      this.selection = new Set<ChatUID>(this.allSummaries.map(s => s.uid));
      this.renderList();
      this.updateCounts();
    }));
    globalSel.addButton(b => b.setButtonText('Clear all').onClick(() => {
      this.selection = new Set<ChatUID>();
      this.renderList();
      this.updateCounts();
    }));

    // Persistence options
    const persist = new Setting(controls).setName('Persist unselected as ignore');
    persist.addToggle(t => t.setValue(this.persistUnselected).onChange(v => { this.persistUnselected = v; }));
    const scope = new Setting(controls).setName('Ignore scope');
    scope.addDropdown(d => {
      d.addOption('profile', 'Profile');
      d.addOption('global', 'Global');
      d.setValue('profile');
      d.onChange(v => { this.useGlobalIgnore = (v === 'global'); });
    });

    // Counts
    this.countEl = contentEl.createDiv();
    this.countEl.style.margin = '6px 0';
    this.countEl.style.color = 'var(--text-normal)';
    this.countEl.style.fontWeight = '500';

    // List container
    this.listEl = contentEl.createDiv();
    this.listEl.style.maxHeight = '60vh';
    this.listEl.style.overflow = 'auto';
    this.listEl.style.border = '1px solid var(--background-modifier-border)';
    this.listEl.style.borderRadius = '6px';
    this.listEl.style.padding = '6px';

    // Footer with Import button
    const footer = contentEl.createDiv();
    footer.style.display = 'flex';
    footer.style.justifyContent = 'space-between';
    footer.style.alignItems = 'center';
    footer.style.marginTop = '10px';

    const left = footer.createDiv();
    left.style.color = 'var(--text-muted)';
    left.textContent = 'Review selection, then import';

    const right = footer.createDiv();

    const cancelBtn = right.createEl('button', { text: 'Cancel' });
    cancelBtn.onclick = () => this.close();

    this.importBtn = right.createEl('button', { text: 'Import selected', cls: 'mod-cta' });
    this.importBtn.onclick = () => {
      this.onConfirm({ selected: new Set(this.selection as Set<ChatUID>), persistUnselected: this.persistUnselected, ignoreScope: this.useGlobalIgnore ? 'global' : 'profile' });
      this.close();
    };

    // Profile actions
    const actions = contentEl.createDiv();
    actions.style.display = 'flex';
    actions.style.gap = '8px';
    actions.style.alignItems = 'center';
    actions.style.marginTop = '8px';

    new Setting(actions)
      .setName('Profile actions')
      .addButton(b => b.setButtonText('Save Profile').onClick(() => this.saveProfile()))
      .addButton(b => b.setButtonText('Save As…').onClick(() => this.saveProfile(true)))
      .addButton(b => b.setButtonText('Add to…').onClick(() => this.addToProfile()))
      .addButton(b => b.setButtonText('Apply…').onClick(() => this.applyProfile()))
      .addButton(b => b.setButtonText('Delete…').onClick(() => this.deleteProfile()));

    // Initial render
    this.applyFilters();
    this.renderList();
    this.updateCounts();
  }

  private applyFilters() {
    this.ensureSelectionSet();
    const kw = this.keyword;
    const base = this.allSummaries;
    let res = kw
      ? base.filter(s => (s.title || '').toLowerCase().includes(kw) || (s.keywordsSample || '').toLowerCase().includes(kw))
      : [...base];

    const dir = this.sortDir === 'asc' ? 1 : -1;
    res.sort((a, b) => {
      if (this.sortKey === 'title') {
        return a.title.localeCompare(b.title) * dir;
      }
      const av = (this.sortKey === 'updatedAt' ? a.updatedAt : a.createdAt) || 0;
      const bv = (this.sortKey === 'updatedAt' ? b.updatedAt : b.createdAt) || 0;
      return (av - bv) * dir;
    });

    this.filtered = res;
  }

  private renderList() {
    this.listEl.empty();
    this.ensureSelectionSet();

    if (this.filtered.length === 0) {
      this.listEl.createEl('div', { text: 'No chats match the current filter.' });
      return;
    }

    // Lightweight list (no virtualisation in MVP). Limit to 2000 displayed to avoid UI jank.
    const maxRender = 2000;
    const toRender = this.filtered.slice(0, maxRender);

    for (const s of toRender) {
      const row = this.listEl.createDiv();
      row.style.display = 'flex';
      row.style.alignItems = 'center';
      row.style.gap = '8px';
      row.style.padding = '4px 2px';

      const cb = row.createEl('input');
      cb.type = 'checkbox';
      cb.checked = (this.selection as Set<ChatUID>).has(s.uid);
      cb.onchange = () => {
        const set = this.selection as Set<ChatUID>;
        if (cb.checked) set.add(s.uid); else set.delete(s.uid);
        this.updateCounts();
      };

      const main = row.createDiv();
      main.style.flex = '1';
      main.createEl('div', { text: s.title || '(Untitled)' });
      const meta = main.createEl('div');
      meta.style.color = 'var(--text-muted)';
      meta.style.fontSize = '0.85em';
      const created = s.createdAt ? new Date(s.createdAt).toISOString().slice(0,10) : '-';
      const updated = s.updatedAt ? new Date(s.updatedAt).toISOString().slice(0,10) : '-';
      const status = s.status ? ` • Status: ${s.status}` : '';
      meta.textContent = `Created: ${created} • Updated: ${updated}${status}`;
  }

    if (this.filtered.length > maxRender) {
      const note = this.listEl.createDiv();
      note.style.color = 'var(--text-muted)';
      note.style.marginTop = '6px';
      note.textContent = `Showing first ${maxRender} of ${this.filtered.length}. Refine filters to narrow results.`;
    }
  }

  private updateCounts() {
    this.ensureSelectionSet();
    const total = this.allSummaries.length;
    const shown = this.filtered.length;
    const selectedInAll = (this.selection as Set<ChatUID>).size;
    this.countEl.textContent = `Showing ${shown} of ${total} • Selected ${selectedInAll}`;
    this.importBtn.textContent = `Import selected (${selectedInAll})`;
    this.importBtn.disabled = selectedInAll === 0;
  }

  private ensureSelectionSet() {
    const sel: any = this.selection as any;
    if (!sel || typeof sel.has !== 'function' || typeof sel.add !== 'function' || typeof sel.delete !== 'function') {
      let initial: ChatUID[] = [];
      if (Array.isArray(sel)) {
        initial = sel;
      } else if (sel && typeof sel === 'object') {
        // If it was accidentally an object map, take keys
        initial = Object.keys(sel) as ChatUID[];
      }
      this.selection = new Set<ChatUID>(initial);
    }
  }

  private getSelectedUids(): ChatUID[] {
    return Array.from((this.selection as Set<ChatUID>).values());
  }

  private async saveProfile(saveAs: boolean = false) {
    try {
      const input = await promptForProfileName(this.app, saveAs ? '' : this.profile.name, this.profile.targetFolder || '');
      if (!input) return;
      const { name, folder: targetFolder } = input;

      const store = this.plugin.getProfileStore();
      const profile: ImportProfile = (await store.get(name)) || { name, include: {}, ignore: {} };
      profile.targetFolder = targetFolder || profile.targetFolder;

      // includes from selection
      for (const uid of this.getSelectedUids()) profile.include[uid] = true;

      // optionally persist unselected as ignore
      if (this.persistUnselected) {
        const selected = new Set(this.getSelectedUids());
        const unselected = this.allSummaries.map(s => s.uid).filter(uid => !selected.has(uid));
        if (this.useGlobalIgnore) {
          await store.addGlobalIgnores(unselected);
        } else {
          for (const uid of unselected) profile.ignore[uid] = true;
        }
      }

      await store.save(profile);
      this.profile = profile;
      new Notice(`Saved profile: ${name}`);
    } catch (e) {
      console.error('Save profile failed', e);
    }
  }

  private async applyProfile() {
    try {
      const chosen = await chooseProfile(this.app, this.plugin.getProfileStore());
      if (!chosen) return;
      const prof = await this.plugin.getProfileStore().get(chosen);
      if (!prof) return;
      this.profile = prof;
      const includeUids = new Set(Object.keys(prof.include || {}));
      this.selection = includeUids;
      this.renderList();
      this.updateCounts();
    } catch (e) {
      console.error('Apply profile failed', e);
    }
  }

  private async deleteProfile() {
    try {
      const toDelete = await chooseProfile(this.app, this.plugin.getProfileStore(), 'Delete profile');
      if (!toDelete) return;
      await this.plugin.getProfileStore().delete(toDelete);
      if (this.profile.name === toDelete) {
        const active = await this.plugin.getProfileStore().getActive();
        this.profile = active;
        this.selection = new Set<ChatUID>();
      }
      this.renderList();
      this.updateCounts();
    } catch (e) {
      console.error('Delete profile failed', e);
    }
  }

  private async addToProfile() {
    try {
      const chosen = await chooseProfile(this.app, this.plugin.getProfileStore(), 'Add selection to profile');
      if (!chosen) return;
      const store = this.plugin.getProfileStore();
      const prof = (await store.get(chosen)) || { name: chosen, include: {}, ignore: {} };
      for (const uid of this.getSelectedUids()) prof.include[uid] = true;
      await store.save(prof);
      new Notice(`Added ${this.getSelectedUids().length} chats to ${chosen}`);
    } catch (e) {
      console.error('Add to profile failed', e);
    }
  }
}

// Simple input modal for profile name and folder
class ProfileNameModal extends Modal {
  private nameInput!: TextComponent;
  private folderInput!: TextComponent;
  private result: { name: string; folder: string } | null = null;
  constructor(app: App, private initialName: string, private initialFolder: string, private onSubmit: (res: {name: string; folder: string}) => void) {
    super(app);
  }
  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl('h3', { text: 'Save Import Profile' });
    new Setting(contentEl).setName('Profile name').addText(t => {
      this.nameInput = t;
      t.setValue(this.initialName || '').onChange(() => {});
    });
    new Setting(contentEl).setName('Target folder').setDesc('Vault-relative (optional)').addText(t => {
      this.folderInput = t;
      t.setValue(this.initialFolder || '').onChange(() => {});
    });
    const buttons = contentEl.createDiv();
    const cancel = buttons.createEl('button', { text: 'Cancel' });
    cancel.onclick = () => { this.close(); };
    const save = buttons.createEl('button', { text: 'Save', cls: 'mod-cta' });
    save.onclick = () => {
      const name = (this.nameInput.getValue() || '').trim();
      const folder = (this.folderInput.getValue() || '').trim();
      if (!name) { new Notice('Profile name is required'); return; }
      this.result = { name, folder };
      this.onSubmit(this.result);
      this.close();
    };
  }
}

function promptForProfileName(app: App, name: string, folder: string): Promise<{name: string; folder: string} | null> {
  return new Promise(resolve => {
    const modal = new ProfileNameModal(app, name, folder, (res) => resolve(res));
    modal.onClose = () => { if (!(modal as any).result) resolve(null); };
    modal.open();
  });
}

class ProfileSuggestModal extends SuggestModal<string> {
  constructor(app: App, private options: string[], private title: string, private onChoose: (value: string) => void) {
    super(app);
    this.setPlaceholder(this.title);
  }
  getSuggestions(query: string): string[] {
    const q = query.toLowerCase();
    return this.options.filter(o => o.toLowerCase().includes(q));
  }
  renderSuggestion(value: string, el: HTMLElement) { el.createEl('div', { text: value }); }
  onChooseSuggestion(item: string) { this.onChoose(item); }
}

async function chooseProfile(app: App, store: any, title: string = 'Choose profile'): Promise<string | null> {
  const names: string[] = await store.list();
  if (!names || names.length === 0) return null;
  return new Promise(resolve => {
    const modal = new ProfileSuggestModal(app, names, title, (v) => resolve(v));
    modal.onClose = () => resolve(null);
    modal.open();
  });
}
