import { App, Modal, Setting, TextComponent, Notice } from 'obsidian';
import type { ChatSummary, ChatUID } from '../types';
import type NexusAiChatImporterPlugin from '../main';

type SortKey = 'updatedAt' | 'createdAt' | 'title';
type SortDir = 'asc' | 'desc';

export class PreImportSelectionModal extends Modal {
  private plugin: NexusAiChatImporterPlugin;
  private provider: string;
  private allSummaries: ChatSummary[];
  private filtered: ChatSummary[] = [];
  private selection: Set<ChatUID> | any = new Set<ChatUID>();
  private keyword = '';
  private sortKey: SortKey = 'updatedAt';
  private sortDir: SortDir = 'desc';

  private listEl!: HTMLElement;
  private countEl!: HTMLElement;
  private importBtn!: HTMLButtonElement;
  private globalIgnores: Record<string, true> = {} as any;

  constructor(plugin: NexusAiChatImporterPlugin, provider: string, summaries: ChatSummary[], private onConfirm: (selected: Set<ChatUID>) => void) {
    super(plugin.app);
    this.plugin = plugin;
    this.provider = provider;
    this.allSummaries = summaries;

    // Initial selection: select all (we will drop globally excluded later)
    this.ensureSelectionSet();
    for (const s of this.allSummaries) (this.selection as Set<ChatUID>).add(s.uid);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('nexus-preimport-modal');

    this.refreshGlobalIgnores();

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

    // Global Exclude controls
    const exclude = new Setting(controls).setName('Global Exclude');
    exclude.addButton(b => b.setButtonText('Add selected to exclude').onClick(async () => {
      const uids = this.getSelectedUids();
      await this.plugin.getProfileStore().addGlobalIgnores(uids);
      new Notice(`Added ${uids.length} chats to global exclude`);
      await this.refreshGlobalIgnores();
    }));
    exclude.addButton(b => b.setButtonText('Clear exclude').onClick(async () => {
      await this.plugin.getProfileStore().setGlobalIgnores({});
      new Notice('Cleared global exclude list');
      await this.refreshGlobalIgnores();
    }));
    exclude.addButton(b => b.setButtonText('Manage excluded…').onClick(async () => {
      const current = await this.plugin.getProfileStore().listGlobalIgnores();
      const modal = new ManageGlobalExcludeModal(this.app, current, this.allSummaries, async (newSet) => {
        await this.plugin.getProfileStore().setGlobalIgnores(newSet);
        new Notice('Updated global exclude list');
        await this.refreshGlobalIgnores();
      });
      modal.open();
    }));

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
      this.onConfirm(new Set(this.selection as Set<ChatUID>));
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

  
}

class ManageGlobalExcludeModal extends Modal {
  private listEl!: HTMLElement;
  private keepSet = new Set<string>();
  constructor(app: App, private current: Record<string, true>, private summaries: ChatSummary[], private onSave: (newSet: Record<string, true>) => void) {
    super(app);
  }
  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl('h3', { text: 'Manage Global Exclude' });
    this.listEl = contentEl.createDiv();
    this.listEl.style.maxHeight = '50vh';
    this.listEl.style.overflow = 'auto';
    const rows = Object.keys(this.current);
    for (const uid of rows) {
      const row = this.listEl.createDiv();
      row.style.display = 'flex';
      row.style.gap = '8px';
      const cb = row.createEl('input');
      cb.type = 'checkbox';
      cb.checked = true;
      cb.onchange = () => { if (cb.checked) this.keepSet.add(uid); else this.keepSet.delete(uid); };
      const title = this.summaries.find(s => s.uid === uid)?.title || uid;
      row.createEl('div', { text: title });
      this.keepSet.add(uid);
    }
    const buttons = contentEl.createDiv();
    const cancel = buttons.createEl('button', { text: 'Cancel' });
    cancel.onclick = () => this.close();
    const save = buttons.createEl('button', { text: 'Save', cls: 'mod-cta' });
    save.onclick = () => {
      const newSet: Record<string, true> = {} as any;
      for (const uid of Array.from(this.keepSet)) newSet[uid] = true as any;
      this.onSave(newSet);
      this.close();
    };
  }
}
