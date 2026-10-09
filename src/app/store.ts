// Zustand der App und alle Aktionen. Die Oberfläche liest nur aus dem Store und ruft seine Methoden auf.

import { useEffect, useState } from "preact/hooks";
import { clone, demoProject, emptyProject, EXPORT_FORMAT, importProject, mergeProject, moveReq, newPart, newReq, nextOrder, removeFrontend, rootsToFrontends, setParent, stamp, tidy, uid, unplan, type ExportFile } from "../domain/model";
import type { Attachment, Brief, Color, PreType, Prereq, Prio, Project, Req, Status } from "../domain/types";
import { applyFeedback, attachmentFile, buildOrder, orderMarkdown, parseFeedback, planOrder, type Feedback } from "../domain/order";
import type { GapKey, SortKey } from "../domain/view";
import { dataUrlToBytes, idbBlobs, type BlobStore } from "../storage/blobs";
import { b64 } from "../storage/crypto";
import type { GitHubConfig } from "../storage/github";
import { local, type SyncMeta, type Theme, type UiPrefs } from "../storage/local";
import { fetchAttachment, fileSlug, MAX_ATTACHMENT, sync } from "../storage/sync";
import { textBytes, zip, type ZipEntry } from "../storage/zip";

export type View = "uebersicht" | "liste" | "board" | "tabelle" | "pre";
export type Dialog = null | "versions" | "projects" | "settings" | "trash" | "order" | "brief";

export interface Ui {
  projectId: string | null;
  view: View;
  /** gewähltes Frontend, null = alle */
  selFe: string | null;
  selMenu: string | null;
  selReq: string | null;
  boardVersion: string | null;
  search: string;
  fPrio: Prio | "";
  fStatus: Status | "";
  gap: GapKey | null;
  sortKey: SortKey;
  sortDir: 1 | -1;
  collapsed: Record<string, boolean>;
  editMenu: string | null;
  /** Frontend, dessen Name gerade bearbeitet wird */
  editFe: string | null;
  editName: string;
  /** Menüpunkt, dessen Farbauswahl offen ist */
  colorMenu: string | null;
  dialog: Dialog;
  report: string | null;
  /** Frontend im Lastenheft, null = alle */
  reportFe: string | null;
  /** Phase, die der Auftragsdialog gerade zeigt */
  orderPhase: string | null;
  /** eingelesene, noch nicht übernommene Rückmeldung */
  feedback: Feedback | null;
  navOpen: boolean;
  mobile: boolean;
  dragId: string | null;
  dragOver: string | null;
  toast: string;
  syncBusy: boolean;
  syncErr: string | null;
}

const MOBILE = "(max-width: 760px)";

export class Store {
  projects: Project[] = local.loadProjects();
  cfg: GitHubConfig | null = local.loadGitHub();
  meta: SyncMeta = local.loadSync();
  prefs: UiPrefs = local.loadUi();
  blobs: BlobStore = idbBlobs;
  ui: Ui;

  private listeners = new Set<() => void>();
  private revs = new Map<string, number>();
  private urls = new Map<string, string>();
  private syncing = false;
  private again = false;
  private syncTimer: ReturnType<typeof setTimeout> | undefined;
  private toastTimer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    const mq = typeof matchMedia === "function" ? matchMedia(MOBILE) : null;
    const first = this.visible().find((p) => p.id === this.prefs.projectId) ?? this.visible()[0] ?? null;
    this.ui = {
      projectId: first ? first.id : null,
      view: "uebersicht",
      selFe: null,
      selMenu: null,
      selReq: null,
      boardVersion: null,
      search: "",
      fPrio: "",
      fStatus: "",
      gap: null,
      sortKey: "key",
      sortDir: 1,
      collapsed: this.prefs.collapsed ?? {},
      editMenu: null,
      editFe: null,
      editName: "",
      colorMenu: null,
      dialog: null,
      report: null,
      reportFe: null,
      orderPhase: null,
      feedback: null,
      navOpen: false,
      mobile: !!mq?.matches,
      dragId: null,
      dragOver: null,
      toast: "",
      syncBusy: false,
      syncErr: null,
    };
    mq?.addEventListener("change", (e) => this.set({ mobile: e.matches, navOpen: false }));
    this.applyTheme();
  }

  // ------------------------------------------------------------ Grundlagen

  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }
  private emit() {
    this.listeners.forEach((fn) => fn());
  }
  set(patch: Partial<Ui>) {
    this.ui = { ...this.ui, ...patch };
    this.emit();
  }
  flash(text: string) {
    clearTimeout(this.toastTimer);
    this.set({ toast: text });
    this.toastTimer = setTimeout(() => this.set({ toast: "" }), 3200);
  }
  /** Projekte ohne gelöschte, nach Name sortiert. */
  visible(): Project[] {
    return this.projects.filter((p) => !p.deletedAt).sort((a, b) => a.name.localeCompare(b.name, "de") || a.createdAt - b.createdAt);
  }
  get project(): Project | null {
    return this.projects.find((p) => p.id === this.ui.projectId && !p.deletedAt) ?? null;
  }
  /** Ansicht unter Berücksichtigung des Geräts: am Handy gibt es kein Board und keine Tabelle. */
  get view(): View {
    return this.ui.mobile && (this.ui.view === "board" || this.ui.view === "tabelle") ? "liste" : this.ui.view;
  }
  private savePrefs(patch: Partial<UiPrefs>) {
    this.prefs = { ...this.prefs, ...patch };
    local.saveUi(this.prefs);
  }
  setTheme(theme: Theme) {
    this.savePrefs({ theme });
    this.applyTheme();
    this.emit();
  }
  private applyTheme() {
    if (typeof document === "undefined") return;
    const t = this.prefs.theme ?? "auto";
    if (t === "auto") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = t;
  }

  // ------------------------------------------------------------ Ändern

  /** Projekt ändern: kopieren, ändern, stempeln, speichern, zum Abgleich vormerken. */
  editProject(id: string, fn: (p: Project) => void) {
    const i = this.projects.findIndex((p) => p.id === id);
    if (i < 0) return;
    const prev = this.projects[i];
    const next = clone(prev);
    fn(next);
    tidy(next);
    stamp(prev, next);
    if (next.deletedAt) tidy(next);
    this.projects = this.projects.map((p, k) => (k === i ? next : p));
    if (!local.saveProject(next)) setTimeout(() => this.flash("Speicher des Browsers ist voll. Änderung nicht gesichert."), 0);
    this.markDirty(id);
    this.emit();
  }
  edit(fn: (p: Project) => void) {
    if (this.ui.projectId) this.editProject(this.ui.projectId, fn);
  }
  upd(reqId: string, fn: (r: Req, p: Project) => void) {
    this.edit((p) => {
      const r = p.reqs.find((x) => x.id === reqId);
      if (r) fn(r, p);
    });
  }
  private markDirty(id: string) {
    this.revs.set(id, (this.revs.get(id) ?? 0) + 1);
    if (!this.meta.dirty.includes(id)) {
      this.meta = { ...this.meta, dirty: [...this.meta.dirty, id] };
      local.saveSync(this.meta);
    }
    this.scheduleSync(5000);
  }

  // ------------------------------------------------------------ Projekte

  selectProject(id: string | null) {
    this.savePrefs({ projectId: id });
    this.set({ projectId: id, selFe: null, selMenu: null, selReq: null, boardVersion: null, gap: null, search: "", fPrio: "", fStatus: "", report: null, reportFe: null, orderPhase: null, feedback: null, editMenu: null, editFe: null, colorMenu: null });
  }
  private addProject(p: Project) {
    this.projects = [...this.projects, p];
    local.saveProject(p);
    this.markDirty(p.id);
    this.selectProject(p.id);
  }
  createProject(name: string) {
    this.addProject(emptyProject(name.trim() || "Neues Projekt"));
    this.set({ dialog: null, view: "liste" });
  }
  loadDemo() {
    this.addProject(demoProject());
    this.set({ dialog: null, view: "uebersicht" });
  }
  deleteProject(id: string) {
    const p = this.projects.find((x) => x.id === id);
    if (!p) return;
    for (const r of p.reqs) for (const a of r.attachments) this.dropAttachment(id, a.id);
    if (this.cfg) {
      // Als Marke behalten, damit die Löschung die anderen Geräte erreicht.
      this.editProject(id, (x) => {
        x.deletedAt = Date.now();
      });
    } else {
      this.projects = this.projects.filter((x) => x.id !== id);
      local.removeProject(id);
      this.meta = { ...this.meta, dirty: this.meta.dirty.filter((x) => x !== id) };
      local.saveSync(this.meta);
    }
    if (this.ui.projectId === id) this.selectProject(this.visible()[0]?.id ?? null);
    else this.emit();
    this.flash("Projekt „" + p.name + "“ gelöscht");
  }

  async importFile(file: File) {
    try {
      const { project, files } = importProject(JSON.parse(await file.text()));
      let lost = 0;
      for (const [id, url] of Object.entries(files)) {
        try {
          await this.blobs.put(id, dataUrlToBytes(url).bytes);
        } catch {
          lost++;
        }
      }
      this.addProject(project);
      this.set({ dialog: null, view: "liste" });
      this.flash(project.reqs.length + " Anforderungen importiert" + (lost ? ", " + lost + " Anhänge nicht speicherbar" : ""));
    } catch {
      this.flash("Datei ist keine gültige Export-Datei");
    }
  }

  async exportProject(id: string) {
    const p = this.projects.find((x) => x.id === id);
    if (!p) return;
    const files: Record<string, string> = {};
    let missing = 0;
    for (const r of p.reqs)
      for (const a of r.attachments) {
        const bytes = await this.attachmentBytes(p.id, a).catch(() => null);
        if (bytes) files[a.id] = "data:" + (a.type || "application/octet-stream") + ";base64," + b64(bytes);
        else missing++;
      }
    const out: ExportFile = { format: EXPORT_FORMAT, exportedAt: new Date().toISOString(), project: p, files };
    const blob = new Blob([JSON.stringify(out, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = (p.name || "anforderungen").replace(/[^\wäöüÄÖÜß-]+/g, "_") + "-anforderungen.json";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    if (missing) this.flash(missing + " Anhänge fehlen im Export, sie liegen nicht auf diesem Gerät");
  }

  // ------------------------------------------------------------ Umsetzung mit Claude

  setBrief(key: Exclude<keyof Brief, "u">, value: string) {
    this.edit((p) => {
      p.brief[key] = value;
    });
  }
  private download(bytes: Uint8Array | string, name: string, type: string) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([bytes as BlobPart], { type }));
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  /** Auftrag für eine Phase als ZIP zusammenstellen: auftrag.json, AUFTRAG.md und die Anhänge als Dateien. */
  async buildOrderZip(versionId: string, phaseId: string): Promise<{ name: string; bytes: Uint8Array; missing: number; count: number } | null> {
    const p = this.project;
    const order = p && buildOrder(p, versionId, phaseId);
    if (!p || !order) return null;
    const entries: ZipEntry[] = [
      { path: "auftrag.json", bytes: textBytes(JSON.stringify(order, null, 2)) },
      { path: "AUFTRAG.md", bytes: textBytes(orderMarkdown(order)) },
    ];
    let missing = 0;
    for (const r of planOrder(p, versionId, phaseId).todo)
      for (const [i, a] of r.attachments.entries()) {
        const bytes = await this.attachmentBytes(p.id, a).catch(() => null);
        if (bytes) entries.push({ path: attachmentFile(r, a, i), bytes });
        else missing++;
      }
    const name = (fileSlug(p.name) || "projekt") + "-" + order.id + ".zip";
    return { name, bytes: zip(entries), missing, count: order.requirements.length };
  }
  async exportOrder(versionId: string, phaseId: string) {
    const z = await this.buildOrderZip(versionId, phaseId);
    if (!z) return;
    this.download(z.bytes, z.name, "application/zip");
    this.flash("Auftrag mit " + z.count + " Anforderungen exportiert" + (z.missing ? ", " + z.missing + " Anhänge fehlen (nicht auf diesem Gerät)" : ""));
  }
  /** Rückmeldung einlesen. Übernommen wird sie erst nach Bestätigung in der Vorschau. */
  async loadFeedback(file: File) {
    try {
      this.set({ feedback: parseFeedback(JSON.parse(await file.text())) });
    } catch {
      this.flash("Datei ist keine gültige Rückmeldung");
    }
  }
  applyFeedback() {
    const f = this.ui.feedback;
    if (!f) return;
    let n = 0;
    this.edit((p) => {
      n = applyFeedback(p, f);
    });
    this.set({ feedback: null });
    this.flash("Rückmeldung für " + n + " Anforderungen übernommen");
  }

  // ------------------------------------------------------------ Anforderungen

  newReq = () => {
    let id = "";
    const menu = this.ui.selMenu;
    this.edit((p) => {
      id = newReq(p, menu && p.menu.some((m) => m.id === menu) ? menu : null, this.ui.selFe).id;
    });
    if (id) this.set({ selReq: id, gap: null, search: "", fPrio: "", fStatus: "", view: this.view === "uebersicht" || this.view === "pre" ? "liste" : this.ui.view });
  };
  move(reqId: string, versionId: string | null, phaseId: string | null) {
    this.edit((p) => moveReq(p, reqId, versionId, phaseId));
  }
  trashReq(id: string) {
    const r = this.project?.reqs.find((x) => x.id === id);
    const now = Date.now();
    this.edit((p) => {
      for (const x of p.reqs) if ((x.id === id || x.parentId === id) && !x.deletedAt) x.deletedAt = now;
    });
    this.set({ selReq: null });
    if (r) this.flash(r.key + " in den Papierkorb gelegt");
  }
  /** Wiederherstellen. Eine große Anforderung bringt ihre Teile mit, ein Teil seine große Anforderung. */
  restoreReq(id: string) {
    this.edit((p) => {
      const r = p.reqs.find((x) => x.id === id);
      if (!r) return;
      const stampOf = r.deletedAt;
      r.deletedAt = null;
      for (const x of p.reqs) {
        if (x.id === r.parentId) x.deletedAt = null;
        if (x.parentId === id && x.deletedAt === stampOf) x.deletedAt = null; // nur Teile, die mit ihr gelöscht wurden
      }
    });
  }
  purgeReqs(ids: string[]) {
    const p = this.project;
    if (!p) return;
    const set = new Set(ids);
    for (const r of p.reqs) if (r.parentId && set.has(r.parentId)) set.add(r.id);
    for (const r of p.reqs) if (set.has(r.id)) for (const a of r.attachments) this.dropAttachment(p.id, a.id);
    this.edit((x) => {
      x.reqs = x.reqs.filter((r) => !set.has(r.id));
    });
  }

  // ------------------------------------------------------------ Teilanforderungen

  addPart(parentId: string, title: string) {
    this.edit((p) => {
      newPart(p, parentId, title);
    });
  }
  /** Zu einem Teil von parentId machen, oder mit null herauslösen. */
  setParent(reqId: string, parentId: string | null) {
    this.edit((p) => setParent(p, reqId, parentId));
  }

  // ------------------------------------------------------------ Frontends

  /** Gewähltes Frontend, sofern es noch existiert. */
  get selFe(): string | null {
    const p = this.project;
    return p && p.frontends.some((f) => f.id === this.ui.selFe) ? this.ui.selFe : null;
  }
  selectFe(id: string | null) {
    const p = this.project;
    const menu = p?.menu.find((m) => m.id === this.ui.selMenu);
    // Ein gewählter Menüpunkt aus einem anderen Frontend passt nicht mehr zur Auswahl.
    this.set({ selFe: id, selMenu: id && menu && menu.fe !== id ? null : this.ui.selMenu, editFe: null, colorMenu: null });
  }
  addFrontend() {
    const id = uid("f");
    this.edit((p) => {
      p.frontends.push({ id, name: "Neues Frontend", o: nextOrder(p.frontends), u: 0 });
      p.feAsked = true;
    });
    this.set({ selFe: id, selMenu: null, editFe: id, editName: "Neues Frontend" });
  }
  commitFe = () => {
    const { editFe, editName } = this.ui;
    if (!editFe) return;
    const name = editName.trim();
    if (name)
      this.edit((p) => {
        const f = p.frontends.find((x) => x.id === editFe);
        if (f) f.name = name;
      });
    this.set({ editFe: null });
  };
  deleteFrontend(id: string) {
    const p = this.project;
    const fe = p?.frontends.find((f) => f.id === id);
    if (!p || !fe || p.frontends.length < 2) return;
    const target = p.frontends.find((f) => f.id !== id)!;
    const had = p.menu.some((m) => m.fe === id) || p.reqs.some((r) => r.fe === id);
    this.edit((d) => removeFrontend(d, id));
    this.set({ selFe: null, selMenu: null });
    this.flash("Frontend „" + fe.name + "“ gelöscht" + (had ? " – Inhalt liegt jetzt unter „" + target.name + "“" : ""));
  }
  /** Antwort auf die einmalige Frage bei älteren Projekten. */
  answerFrontends(convert: boolean) {
    this.edit((p) => {
      if (convert) rootsToFrontends(p);
      else p.feAsked = true;
    });
    this.set({ selFe: null, selMenu: null });
    if (convert) this.flash("Hauptmenüpunkte sind jetzt Frontends");
  }
  setMenuColor(id: string, color: Color | null) {
    this.edit((p) => {
      const m = p.menu.find((x) => x.id === id);
      if (m) m.color = color;
    });
    this.set({ colorMenu: null });
  }

  // ------------------------------------------------------------ Menüstruktur

  addMenu(parent: string | null) {
    const id = uid("m");
    this.edit((p) => {
      p.menu.push({ id, name: "Neuer Menüpunkt", parent, fe: parent ? null : (this.selFe ?? p.frontends[0].id), color: null, o: nextOrder(p.menu), u: 0 });
    });
    this.set({ editMenu: id, editName: "Neuer Menüpunkt", selMenu: id, collapsed: parent ? { ...this.ui.collapsed, [parent]: false } : this.ui.collapsed });
  }
  commitMenu = () => {
    const { editMenu, editName } = this.ui;
    if (!editMenu) return;
    const name = editName.trim();
    if (name)
      this.edit((p) => {
        const m = p.menu.find((x) => x.id === editMenu);
        if (m) m.name = name;
      });
    this.set({ editMenu: null });
  };
  removeMenu(id: string) {
    const p = this.project;
    const node = p?.menu.find((m) => m.id === id);
    if (!p || !node) return;
    const sub = new Set<string>();
    const add = (x: string) => {
      if (sub.has(x)) return;
      sub.add(x);
      p.menu.filter((m) => m.parent === x).forEach((m) => add(m.id));
    };
    add(id);
    let moved = 0;
    this.edit((d) => {
      for (const r of d.reqs)
        if (r.menuId && sub.has(r.menuId)) {
          r.menuId = node.parent;
          moved++;
        }
      d.menu = d.menu.filter((m) => !sub.has(m.id));
    });
    const parentName = node.parent ? p.menu.find((m) => m.id === node.parent)?.name : "Ohne Menüpunkt";
    this.set({ selMenu: node.parent });
    this.flash("„" + node.name + "“ gelöscht" + (moved ? " – Anforderungen nach „" + parentName + "“ verschoben" : ""));
  }
  toggleCollapsed(id: string) {
    const collapsed = { ...this.ui.collapsed, [id]: !this.ui.collapsed[id] };
    this.savePrefs({ collapsed });
    this.set({ collapsed });
  }

  // ------------------------------------------------------------ Voraussetzungen

  addPrereq(title: string, type: PreType): string {
    const id = uid("q");
    this.edit((p) => {
      p.prereqs.push({ id, title, type, done: false, o: nextOrder(p.prereqs), u: 0 });
    });
    return id;
  }
  editPre(id: string, fn: (q: Prereq) => void) {
    this.edit((p) => {
      const q = p.prereqs.find((x) => x.id === id);
      if (q) fn(q);
    });
  }
  removePre(id: string) {
    this.edit((p) => {
      p.prereqs = p.prereqs.filter((x) => x.id !== id);
      for (const r of p.reqs) if (r.prereqIds.includes(id)) r.prereqIds = r.prereqIds.filter((i) => i !== id);
    });
    this.flash("Voraussetzung gelöscht");
  }

  // ------------------------------------------------------------ Versionen und Phasen

  /** Version, die Board und Lastenheft gerade zeigen. */
  curVersion(): string | null {
    const p = this.project;
    if (!p) return null;
    return p.versions.find((v) => v.id === this.ui.boardVersion) ? this.ui.boardVersion : (p.versions[0]?.id ?? null);
  }
  addVersion() {
    this.edit((p) => {
      p.versions.push({ id: uid("v"), name: "v" + (p.versions.length + 1) + ".0", o: nextOrder(p.versions), u: 0, phases: [{ id: uid("p"), name: "Phase 1", o: 0, u: 0 }] });
    });
  }
  removeVersion(id: string) {
    const name = this.project?.versions.find((v) => v.id === id)?.name;
    this.edit((p) => {
      unplan(p, (r) => r.versionId === id);
      p.versions = p.versions.filter((v) => v.id !== id);
    });
    this.flash("Version " + name + " gelöscht");
  }
  addPhase(versionId: string) {
    this.edit((p) => {
      const v = p.versions.find((x) => x.id === versionId);
      if (v) v.phases.push({ id: uid("p"), name: "Phase " + (v.phases.length + 1), o: nextOrder(v.phases), u: 0 });
    });
  }
  removePhase(versionId: string, phaseId: string) {
    this.edit((p) => {
      unplan(p, (r) => r.versionId === versionId && r.phaseId === phaseId);
      const v = p.versions.find((x) => x.id === versionId);
      if (v) v.phases = v.phases.filter((x) => x.id !== phaseId);
    });
  }

  // ------------------------------------------------------------ Anhänge

  async addFiles(reqId: string, files: FileList | File[]) {
    for (const f of Array.from(files)) {
      if (f.size > MAX_ATTACHMENT) {
        this.flash(f.name + " ist größer als 10 MB");
        continue;
      }
      const id = uid("a");
      try {
        await this.blobs.put(id, new Uint8Array(await f.arrayBuffer()));
      } catch {
        this.flash(f.name + " konnte nicht gespeichert werden");
        continue;
      }
      this.upd(reqId, (r) => {
        r.attachments.push({ id, name: f.name, type: f.type, size: f.size });
      });
    }
  }
  removeAttachment(reqId: string, attId: string) {
    if (this.ui.projectId) this.dropAttachment(this.ui.projectId, attId);
    this.upd(reqId, (r) => {
      r.attachments = r.attachments.filter((a) => a.id !== attId);
    });
  }
  /** Inhalt auf diesem Gerät entfernen und zum Löschen im Repo vormerken. */
  private dropAttachment(pid: string, id: string) {
    void this.blobs.del(id).catch(() => undefined);
    const url = this.urls.get(id);
    if (url) {
      URL.revokeObjectURL(url);
      this.urls.delete(id);
    }
    if (this.cfg) {
      this.meta = { ...this.meta, attDel: [...this.meta.attDel, { pid, id }] };
      local.saveSync(this.meta);
    }
  }
  /** Inhalt eines Anhangs: von diesem Gerät, sonst aus dem Repo (und dann hier ablegen). */
  private async attachmentBytes(pid: string, a: Attachment): Promise<Uint8Array | null> {
    let bytes = await this.blobs.get(a.id).catch(() => null);
    if (!bytes && this.cfg) {
      bytes = await fetchAttachment(this.cfg, pid, a.id);
      if (bytes) {
        await this.blobs.put(a.id, bytes).catch(() => undefined);
        if (!this.meta.attRemote.includes(a.id)) {
          this.meta = { ...this.meta, attRemote: [...this.meta.attRemote, a.id] };
          local.saveSync(this.meta);
        }
      }
    }
    return bytes;
  }
  /** Adresse zum Anzeigen oder Herunterladen. null = Inhalt nirgends verfügbar. */
  async attachmentUrl(pid: string, a: Attachment): Promise<string | null> {
    const hit = this.urls.get(a.id);
    if (hit) return hit;
    const bytes = await this.attachmentBytes(pid, a);
    if (!bytes) return null;
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: a.type || "application/octet-stream" }));
    this.urls.set(a.id, url);
    return url;
  }

  // ------------------------------------------------------------ Abgleich

  saveGitHub(cfg: GitHubConfig | null) {
    this.cfg = cfg;
    local.saveGitHub(cfg);
    if (!cfg) {
      // Getrennt: Merkzettel verwerfen, Daten bleiben auf dem Gerät.
      this.meta = { shas: {}, attRemote: [], attDel: [], dirty: this.projects.map((p) => p.id) };
      local.saveSync(this.meta);
      this.set({ syncErr: null });
    }
  }
  scheduleSync(ms: number) {
    if (!this.cfg) return;
    clearTimeout(this.syncTimer);
    this.syncTimer = setTimeout(() => void this.syncNow(), ms);
  }
  /** Abgleich jetzt. Liefert true bei Erfolg. */
  async syncNow(): Promise<boolean> {
    if (!this.cfg) return false;
    if (this.syncing) {
      this.again = true;
      return false;
    }
    clearTimeout(this.syncTimer);
    this.syncing = true;
    this.set({ syncBusy: true });
    const revs = new Map(this.revs);
    const delSnap = this.meta.attDel;
    let ok = false;
    try {
      const r = await sync(this.projects, new Set(this.meta.dirty), this.meta, this.cfg, this.blobs);
      const mine = new Map(this.projects.map((p) => [p.id, p]));
      const next: Project[] = [];
      for (const rp of r.projects) {
        const cur = mine.get(rp.id);
        // Während des Abgleichs kann weitergearbeitet worden sein: beide Stände zusammenführen.
        const fin = cur && cur !== rp ? mergeProject(cur, rp) : rp;
        next.push(fin);
        if (fin !== cur) local.saveProject(fin);
        mine.delete(rp.id);
      }
      for (const [id, p] of mine) {
        if (p.deletedAt) local.removeProject(id);
        else next.push(p); // während des Abgleichs angelegt
      }
      this.projects = next;
      const still = this.meta.dirty.filter((id) => (this.revs.get(id) ?? 0) !== (revs.get(id) ?? 0) || mine.has(id));
      this.meta = {
        shas: r.state.shas,
        attRemote: [...new Set([...r.state.attRemote, ...this.meta.attRemote])],
        attDel: [...r.state.attDel, ...this.meta.attDel.filter((d) => !delSnap.includes(d))],
        dirty: still.filter((id) => next.some((p) => p.id === id)),
        lastSync: Date.now(),
      };
      local.saveSync(this.meta);
      if (!this.project) this.selectProject(this.visible()[0]?.id ?? null);
      this.set({ syncErr: null });
      ok = true;
    } catch (e) {
      this.set({ syncErr: (e as Error).message || "Abgleich fehlgeschlagen" });
    } finally {
      this.syncing = false;
      this.set({ syncBusy: false });
      if (this.again || (ok && this.meta.dirty.length)) {
        this.again = false;
        this.scheduleSync(1500);
      }
    }
    return ok;
  }
  /** Beim Start und bei der Rückkehr in die App abgleichen. */
  start() {
    if (this.cfg) void this.syncNow();
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible" && this.cfg && Date.now() - (this.meta.lastSync ?? 0) > 60_000) void this.syncNow();
    });
    window.addEventListener("online", () => this.scheduleSync(500));
  }
}

export const store = new Store();

/** Komponente bei jeder Änderung neu zeichnen. */
export function useStore(): Store {
  const [, tick] = useState(0);
  useEffect(() => {
    const off = store.subscribe(() => tick((n) => n + 1));
    tick((n) => n + 1); // Änderungen zwischen erstem Zeichnen und Anmelden nachholen
    return off;
  }, []);
  return store;
}
