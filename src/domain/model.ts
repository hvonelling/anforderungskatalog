// Anlegen, Stempeln, Zusammenführen, Import und Export von Projekten.

import type { Attachment, Color, Frontend, MenuNode, Phase, Prereq, Project, Req, Status, Prio, Version } from "./types";
import { COLORS, PRIO, STATUS } from "./types";

export function uid(prefix = ""): string {
  const abc = "abcdefghijklmnopqrstuvwxyz0123456789";
  const buf = new Uint8Array(10);
  globalThis.crypto.getRandomValues(buf);
  let s = prefix;
  for (const b of buf) s += abc[b % abc.length];
  return s;
}

export const clone = <T>(o: T): T => JSON.parse(JSON.stringify(o)) as T;
export const keyOf = (n: number) => "REQ-" + String(n).padStart(3, "0");
export const nextOrder = (list: { o: number }[]) => list.reduce((m, x) => Math.max(m, x.o), -1) + 1;
/** Kennungen so vergleichen, dass REQ-012.2 vor REQ-012.10 steht. */
export const cmpKey = (a: string, b: string) => a.localeCompare(b, "de", { numeric: true });

/**
 * Feste Kennung des ersten Frontends. Projekte aus der Zeit vor den Frontends bekommen es beim Laden;
 * weil die Kennung fest ist, entsteht es auf zwei Geräten nicht doppelt.
 */
export const MAIN_FE = "fmain";
const mainFrontend = (): Frontend => ({ id: MAIN_FE, name: "Allgemein", o: 0, u: 0 });

export function emptyProject(name: string, now = Date.now()): Project {
  return { format: 1, id: uid("j"), name, seq: 0, frontends: [mainFrontend()], feAsked: true, menu: [], versions: [], prereqs: [], reqs: [], gone: {}, createdAt: now, deletedAt: null, u: now };
}

function blankReq(now: number): Req {
  return {
    id: uid("r"),
    key: "",
    title: "",
    menuId: null,
    fe: null,
    also: [],
    parentId: null,
    prio: "S",
    status: "open",
    versionId: null,
    phaseId: null,
    prereqIds: [],
    desc: "",
    story: { role: "", goal: "", benefit: "" },
    criteria: [],
    attachments: [],
    history: [],
    createdAt: now,
    deletedAt: null,
    u: now,
  };
}

export function newReq(p: Project, menuId: string | null, fe: string | null = null, now = Date.now()): Req {
  p.seq += 1;
  const r = { ...blankReq(now), key: keyOf(p.seq), menuId, fe };
  p.reqs.push(r);
  return r;
}

/** Teilanforderung anlegen. Ort folgt der großen Anforderung, Priorität und Planung werden als Startwert übernommen. */
export function newPart(p: Project, parentId: string, title: string, now = Date.now()): Req | null {
  const par = p.reqs.find((x) => x.id === parentId);
  if (!par || par.parentId) return null;
  const r = { ...blankReq(now), title, parentId, menuId: par.menuId, fe: par.fe, prio: par.prio, versionId: par.versionId, phaseId: par.phaseId };
  p.reqs.push(r);
  tidy(p); // vergibt die Unternummer
  return r;
}

/** Bestehende Anforderung zu einem Teil machen (parentId) oder herauslösen (null). */
export function setParent(p: Project, reqId: string, parentId: string | null) {
  const r = p.reqs.find((x) => x.id === reqId);
  if (!r) return;
  if (parentId) {
    const par = p.reqs.find((x) => x.id === parentId);
    // Nur eine Ebene: weder Teile von Teilen noch große Anforderungen als Teil.
    if (!par || par.id === r.id || par.parentId || p.reqs.some((x) => x.parentId === r.id)) return;
  }
  r.parentId = parentId;
  r.key = ""; // neue Nummer passend zur neuen Stellung
  tidy(p);
}

/** Bezeichnung von Version und Phase für den Verlauf. */
export function vpLabel(p: Project, versionId: string | null, phaseId: string | null): string {
  const v = p.versions.find((x) => x.id === versionId);
  if (!v) return "Nicht eingeplant";
  const ph = v.phases.find((x) => x.id === phaseId);
  return v.name + (ph ? " · " + ph.name : " · ohne Phase");
}

/** Anforderung in Version/Phase verschieben und im Verlauf vermerken. */
export function moveReq(p: Project, reqId: string, versionId: string | null, phaseId: string | null, now = Date.now()) {
  const r = p.reqs.find((x) => x.id === reqId);
  if (!r || (r.versionId === versionId && r.phaseId === phaseId)) return;
  r.history.unshift({ date: new Date(now).toISOString(), from: vpLabel(p, r.versionId, r.phaseId), to: vpLabel(p, versionId, phaseId) });
  r.versionId = versionId;
  r.phaseId = phaseId;
}

/** Betroffene Anforderungen auf „nicht eingeplant“ setzen (vor dem Löschen einer Phase oder Version aufrufen). */
export function unplan(p: Project, pred: (r: Req) => boolean, now = Date.now()) {
  for (const r of p.reqs) {
    if (!pred(r)) continue;
    r.history.unshift({ date: new Date(now).toISOString(), from: vpLabel(p, r.versionId, r.phaseId), to: "Nicht eingeplant" });
    r.versionId = null;
    r.phaseId = null;
  }
}

// ---------------------------------------------------------------- Frontends

/**
 * Hauptmenüpunkte zu Frontends machen: Jeder Hauptpunkt wird ein Frontend, seine Unterpunkte
 * werden dessen Hauptmenü. Anforderungen direkt am Hauptpunkt bleiben im neuen Frontend ohne Menüpunkt.
 */
export function rootsToFrontends(p: Project) {
  const before = p.frontends.map((f) => f.id);
  const roots = p.menu.filter((m) => !m.parent);
  for (const root of roots) {
    const fe: Frontend = { id: uid("f"), name: root.name, o: nextOrder(p.frontends), u: 0 };
    p.frontends.push(fe);
    // Die Unterpunkte werden Hauptmenü des neuen Frontends; tidy reicht das Frontend im Baum nach unten durch.
    for (const m of p.menu)
      if (m.parent === root.id) {
        m.parent = null;
        m.fe = fe.id;
      }
    for (const r of p.reqs)
      if (r.menuId === root.id) {
        r.menuId = null;
        r.fe = fe.id;
      }
    p.menu = p.menu.filter((m) => m.id !== root.id);
  }
  p.feAsked = true;
  tidy(p);
  // Frühere Frontends, in denen nun nichts mehr liegt, entfallen.
  if (roots.length) {
    p.frontends = p.frontends.filter((f) => !before.includes(f.id) || p.reqs.some((r) => r.fe === f.id) || p.menu.some((m) => m.fe === f.id));
    tidy(p);
  }
}

/**
 * Frontend löschen. Sein Menübaum geht nicht verloren: Er hängt danach als Hauptmenüpunkt
 * mit dem Namen des Frontends im ersten verbleibenden Frontend. Das letzte Frontend bleibt immer.
 */
export function removeFrontend(p: Project, id: string) {
  const fe = p.frontends.find((f) => f.id === id);
  const target = p.frontends.find((f) => f.id !== id);
  if (!fe || !target) return;
  const roots = p.menu.filter((m) => !m.parent && m.fe === id);
  const loose = p.reqs.filter((r) => !r.menuId && r.fe === id);
  if (roots.length || loose.length) {
    const node: MenuNode = { id: uid("m"), name: fe.name, parent: null, fe: target.id, color: null, o: nextOrder(p.menu), u: 0 };
    p.menu.push(node);
    for (const m of roots) m.parent = node.id;
    for (const r of loose) r.menuId = node.id;
  }
  p.frontends = p.frontends.filter((f) => f.id !== id);
  tidy(p);
}

// ---------------------------------------------------------------- Stempeln

const noU = (o: unknown) => JSON.stringify(o, (k, v) => (k === "u" ? undefined : v));

/**
 * Nach einer Änderung aufrufen: Alle Datensätze, die sich gegenüber "prev" geändert haben,
 * bekommen den Zeitstempel "now". Verschwundene Datensätze werden als gelöscht vermerkt.
 */
export function stamp(prev: Project, next: Project, now = Date.now()) {
  const gone = { ...next.gone };
  const col = <T extends { id: string; u: number }>(a: T[], b: T[], ser: (x: T) => string) => {
    const pm = new Map(a.map((x) => [x.id, x]));
    for (const x of b) {
      const old = pm.get(x.id);
      if (!old || ser(old) !== ser(x)) x.u = now;
      pm.delete(x.id);
    }
    for (const id of pm.keys()) gone[id] = now;
  };
  col(prev.frontends, next.frontends, noU);
  col(prev.menu, next.menu, noU);
  col(prev.prereqs, next.prereqs, noU);
  col(prev.reqs, next.reqs, noU);
  col(prev.versions, next.versions, (v) => noU({ ...v, phases: undefined }));
  col(
    prev.versions.flatMap((v) => v.phases),
    next.versions.flatMap((v) => v.phases),
    noU,
  );
  if (prev.name !== next.name || prev.deletedAt !== next.deletedAt) next.u = now;
  next.gone = gone;
}

// ---------------------------------------------------------------- Zusammenführen

const byOrder = <T extends { o: number; id: string }>(a: T, b: T) => a.o - b.o || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

function mergeCol<T extends { id: string; u: number }>(a: T[], b: T[], gone: Record<string, number>): T[] {
  const bm = new Map(b.map((x) => [x.id, x]));
  const out: T[] = [];
  const seen = new Set<string>();
  const alive = (x: T) => !(gone[x.id] !== undefined && gone[x.id] >= x.u);
  for (const x of a) {
    const y = bm.get(x.id);
    seen.add(x.id);
    let w = x;
    // Bei gleichem Zeitstempel entscheidet der Inhalt, damit beide Geräte gleich wählen.
    if (y && (y.u > x.u || (y.u === x.u && JSON.stringify(y) > JSON.stringify(x)))) w = y;
    if (alive(w)) out.push(w);
  }
  for (const y of b) if (!seen.has(y.id) && alive(y)) out.push(y);
  return out;
}

/**
 * Zwei Stände desselben Projekts zusammenführen. Je Datensatz gewinnt der neuere,
 * Löschungen bleiben erhalten. Das Ergebnis ist unabhängig von der Reihenfolge der Argumente.
 */
export function mergeProject(a: Project, b: Project): Project {
  const gone: Record<string, number> = { ...a.gone };
  for (const [id, t] of Object.entries(b.gone)) gone[id] = Math.max(gone[id] ?? 0, t);

  const head = b.u > a.u || (b.u === a.u && JSON.stringify([b.name, b.deletedAt]) > JSON.stringify([a.name, a.deletedAt])) ? b : a;

  const av = new Map(a.versions.map((v) => [v.id, v]));
  const bv = new Map(b.versions.map((v) => [v.id, v]));
  const versions = mergeCol(
    a.versions.map((v) => ({ ...v, phases: [] as Phase[] })),
    b.versions.map((v) => ({ ...v, phases: [] as Phase[] })),
    gone,
  )
    .map((v) => ({ ...v, phases: mergeCol(av.get(v.id)?.phases ?? [], bv.get(v.id)?.phases ?? [], gone).sort(byOrder) }))
    .sort(byOrder);

  const out: Project = {
    format: 1,
    id: a.id,
    name: head.name,
    seq: Math.max(a.seq, b.seq),
    frontends: mergeCol(a.frontends, b.frontends, gone).sort(byOrder),
    feAsked: a.feAsked || b.feAsked,
    menu: mergeCol(a.menu, b.menu, gone).sort(byOrder),
    versions,
    prereqs: mergeCol(a.prereqs, b.prereqs, gone).sort(byOrder),
    reqs: mergeCol(a.reqs, b.reqs, gone),
    gone,
    createdAt: Math.min(a.createdAt, b.createdAt),
    deletedAt: head.deletedAt,
    u: head.u,
  };
  return tidy(clone(out));
}

/**
 * Verweise bereinigen, abgeleitete Angaben nachführen und doppelte Kennungen auflösen.
 * Das Ergebnis hängt nur vom Inhalt ab, damit zwei Geräte aus demselben Stand dasselbe machen.
 */
export function tidy(p: Project): Project {
  if (p.deletedAt) {
    // Gelöschtes Projekt: nur die Marke behalten.
    p.frontends = [];
    p.menu = [];
    p.versions = [];
    p.prereqs = [];
    p.reqs = [];
    p.gone = {};
    return p;
  }
  // Frontends: mindestens eines, Verweise gültig.
  if (!p.frontends.length) p.frontends.push(mainFrontend());
  const feIds = new Set(p.frontends.map((f) => f.id));
  const firstFe = p.frontends[0].id;

  // Menü: Unterpunkte ohne Elternknoten an die Wurzel, Frontend vom Hauptpunkt nach unten durchreichen.
  const menu = new Map(p.menu.map((m) => [m.id, m]));
  for (const m of p.menu) if (m.parent && !menu.has(m.parent)) m.parent = null;
  const feOf = (m: MenuNode): string => {
    let root = m;
    for (let i = 0; i < 50 && root.parent; i++) root = menu.get(root.parent) ?? root;
    return root.fe && feIds.has(root.fe) ? root.fe : firstFe;
  };
  const feByMenu = new Map(p.menu.map((m) => [m.id, feOf(m)]));
  for (const m of p.menu) m.fe = feByMenu.get(m.id)!;

  p.reqs.sort((x, y) => x.createdAt - y.createdAt || (x.id < y.id ? -1 : 1));
  const reqs = new Map(p.reqs.map((r) => [r.id, r]));

  // Teilanforderungen: nur eine Ebene, Ort folgt der großen Anforderung.
  for (const r of p.reqs) {
    if (!r.parentId) continue;
    const par = reqs.get(r.parentId);
    if (!par || par === r || par.parentId) r.parentId = null;
  }
  for (const r of p.reqs) {
    const par = r.parentId ? reqs.get(r.parentId)! : null;
    if (par) r.menuId = par.menuId;
  }
  for (const r of p.reqs) {
    const src = r.parentId ? reqs.get(r.parentId)! : r;
    r.fe = src.menuId && feByMenu.has(src.menuId) ? feByMenu.get(src.menuId)! : src.fe && feIds.has(src.fe) ? src.fe : firstFe;
    if (r.also.length) r.also = [...new Set(r.also)].filter((f) => feIds.has(f) && f !== r.fe);
  }
  // Nach dem Durchreichen: Teile bekommen genau das Frontend der großen Anforderung.
  for (const r of p.reqs) if (r.parentId) r.fe = reqs.get(r.parentId)!.fe;

  // Kennungen. Zwei Geräte können ohne Verbindung dieselbe Nummer vergeben haben: die jüngere Anforderung bekommt eine neue.
  for (const r of p.reqs) {
    const n = Number(/^REQ-(\d+)/.exec(r.key)?.[1] ?? 0);
    if (n > p.seq) p.seq = n;
  }
  const used = new Set<string>();
  for (const r of p.reqs) {
    if (r.parentId) continue;
    // Eine Unternummer an einer eigenständigen Anforderung stammt von einem herausgelösten Teil.
    if (!r.key || used.has(r.key) || /^REQ-\d+\.\d+$/.test(r.key)) {
      p.seq += 1;
      r.key = keyOf(p.seq);
    }
    used.add(r.key);
  }
  const subNo = (key: string) => Number(/\.(\d+)$/.exec(key)?.[1] ?? 0);
  for (const par of p.reqs) {
    if (par.parentId) continue;
    const parts = p.reqs.filter((r) => r.parentId === par.id);
    if (!parts.length) continue;
    const prefix = par.key + ".";
    let max = parts.reduce((m, r) => Math.max(m, subNo(r.key)), 0);
    for (const r of parts) {
      const want = subNo(r.key) ? prefix + subNo(r.key) : "";
      if (!want || used.has(want)) {
        max += 1;
        r.key = prefix + max;
      } else r.key = want;
      used.add(r.key);
    }
  }
  return p;
}

// Vergleich ohne Rücksicht auf die Reihenfolge der Schlüssel.
function canon(v: unknown): string {
  if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
  if (v && typeof v === "object")
    return (
      "{" +
      Object.keys(v)
        .filter((k) => (v as Record<string, unknown>)[k] !== undefined)
        .sort()
        .map((k) => JSON.stringify(k) + ":" + canon((v as Record<string, unknown>)[k]))
        .join(",") +
      "}"
    );
  return JSON.stringify(v);
}
export const sameProject = (a: Project, b: Project) => canon(a) === canon(b);

// ---------------------------------------------------------------- Laden, Import, Export

const str = (v: unknown, d = "") => (typeof v === "string" ? v : d);
const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);
const arr = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? (v.filter((x) => x && typeof x === "object") as Record<string, unknown>[]) : []);
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

/**
 * Beliebig geladenen Stand in ein gültiges Projekt überführen. Wirft, wenn es keines ist.
 * Ältere Stände (ohne Frontends, Farben, Teilanforderungen) werden dabei ohne Verlust ergänzt.
 */
export function normalizeProject(raw: unknown, now = Date.now()): Project {
  const j = raw as Record<string, unknown>;
  if (!j || typeof j !== "object" || !Array.isArray(j.reqs) || !Array.isArray(j.menu) || !Array.isArray(j.versions) || !Array.isArray(j.prereqs))
    throw new Error("Datei ist kein Anforderungskatalog.");
  const hasFrontends = Array.isArray(j.frontends);
  const p: Project = {
    format: 1,
    id: str(j.id) || uid("j"),
    name: str(j.name) || str(j.product) || "Projekt",
    seq: num(j.seq, 0),
    frontends: arr(j.frontends).map((f, i): Frontend => ({ id: str(f.id) || uid("f"), name: str(f.name, "Frontend"), o: num(f.o, i), u: num(f.u, now) })),
    // Stände aus der Zeit vor den Frontends: einmal nachfragen, ob die Hauptmenüpunkte Frontends sind.
    feAsked: hasFrontends ? j.feAsked !== false : false,
    menu: arr(j.menu).map(
      (m, i): MenuNode => ({
        id: str(m.id) || uid("m"),
        name: str(m.name, "Menüpunkt"),
        parent: str(m.parent) || null,
        fe: str(m.fe) || null,
        color: (COLORS as readonly string[]).includes(str(m.color)) ? (m.color as Color) : null,
        o: num(m.o, i),
        u: num(m.u, now),
      }),
    ),
    versions: arr(j.versions).map(
      (v, i): Version => ({
        id: str(v.id) || uid("v"),
        name: str(v.name, "Version"),
        o: num(v.o, i),
        u: num(v.u, now),
        phases: arr(v.phases).map((ph, k): Phase => ({ id: str(ph.id) || uid("p"), name: str(ph.name, "Phase"), o: num(ph.o, k), u: num(ph.u, now) })),
      }),
    ),
    prereqs: arr(j.prereqs).map(
      (q, i): Prereq => ({ id: str(q.id) || uid("q"), title: str(q.title), type: q.type === "user" ? "user" : "tech", done: !!q.done, o: num(q.o, i), u: num(q.u, now) }),
    ),
    reqs: arr(j.reqs).map((r, i): Req => {
      const st = (r.story || {}) as Record<string, unknown>;
      return {
        id: str(r.id) || uid("r"),
        key: str(r.key),
        title: str(r.title),
        menuId: str(r.menuId) || null,
        fe: str(r.fe) || null,
        also: strs(r.also),
        parentId: str(r.parentId) || null,
        prio: (str(r.prio) in PRIO ? r.prio : "S") as Prio,
        status: (str(r.status) in STATUS ? r.status : "open") as Status,
        versionId: str(r.versionId) || null,
        phaseId: str(r.phaseId) || null,
        prereqIds: strs(r.prereqIds),
        desc: str(r.desc),
        story: { role: str(st.role), goal: str(st.goal), benefit: str(st.benefit) },
        criteria: arr(r.criteria).map((c) => ({ id: str(c.id) || uid("c"), text: str(c.text), done: !!c.done })),
        attachments: arr(r.attachments).map((a): Attachment => ({ id: str(a.id) || uid("a"), name: str(a.name, "Datei"), type: str(a.type), size: num(a.size, 0) })),
        history: arr(r.history).map((h) => ({ date: str(h.date), from: str(h.from), to: str(h.to) })),
        createdAt: num(r.createdAt, now + i),
        deletedAt: typeof r.deletedAt === "number" ? r.deletedAt : null,
        u: num(r.u, now),
      };
    }),
    gone: j.gone && typeof j.gone === "object" ? (j.gone as Record<string, number>) : {},
    createdAt: num(j.createdAt, now),
    deletedAt: typeof j.deletedAt === "number" ? j.deletedAt : null,
    u: num(j.u, now),
  };
  if (!p.menu.some((m) => !m.parent)) p.feAsked = true; // nichts umzustellen
  return tidy(p);
}

export const EXPORT_FORMAT = "anforderungskatalog-export-v1";
export interface ExportFile {
  format: typeof EXPORT_FORMAT;
  exportedAt: string;
  project: Project;
  /** Anhang-ID → Data-URL */
  files: Record<string, string>;
}

/**
 * Exportdatei (oder Export des Prototyps) als neues Projekt einlesen.
 * Alle Kennungen werden neu vergeben, damit ein Import nie ein vorhandenes Projekt überschreibt.
 */
export function importProject(raw: unknown, now = Date.now()): { project: Project; files: Record<string, string> } {
  const j = raw as Record<string, unknown>;
  const isExport = !!j && j.format === EXPORT_FORMAT;
  const src = clone(isExport ? j.project : j) as Record<string, unknown>;
  const files: Record<string, string> = isExport && j.files && typeof j.files === "object" ? { ...(j.files as Record<string, string>) } : {};
  // Der Prototyp legte den Inhalt als Data-URL direkt am Anhang ab.
  if (src && Array.isArray(src.reqs))
    for (const r of src.reqs as Record<string, unknown>[])
      for (const a of arr(r?.attachments)) {
        if (typeof a.url === "string" && a.url.startsWith("data:")) {
          if (!a.id) a.id = uid("a");
          files[a.id as string] = a.url;
          if (typeof a.size !== "number") {
            const b64 = a.url.slice(a.url.indexOf(",") + 1);
            a.size = Math.floor((b64.length * 3) / 4) - (b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0);
          }
        }
      }
  const p = normalizeProject(src, now);
  // Neue Kennungen
  const map = new Map<string, string>();
  const re = (old: string, prefix: string) => {
    const n = uid(prefix);
    map.set(old, n);
    return n;
  };
  const to = (old: string | null) => (old ? (map.get(old) ?? null) : null);
  p.id = uid("j");
  for (const f of p.frontends) f.id = re(f.id, "f");
  for (const m of p.menu) m.id = re(m.id, "m");
  for (const m of p.menu) {
    m.parent = to(m.parent);
    m.fe = to(m.fe);
  }
  for (const v of p.versions) {
    v.id = re(v.id, "v");
    for (const ph of v.phases) ph.id = re(ph.id, "p");
  }
  for (const q of p.prereqs) q.id = re(q.id, "q");
  for (const r of p.reqs) r.id = re(r.id, "r");
  const outFiles: Record<string, string> = {};
  for (const r of p.reqs) {
    r.menuId = to(r.menuId);
    r.fe = to(r.fe);
    r.also = r.also.map((x) => map.get(x)).filter((x): x is string => !!x);
    r.parentId = to(r.parentId);
    r.versionId = to(r.versionId);
    r.phaseId = to(r.phaseId);
    r.prereqIds = r.prereqIds.map((x) => map.get(x)).filter((x): x is string => !!x);
    for (const c of r.criteria) c.id = uid("c");
    r.attachments = r.attachments.filter((a) => files[a.id]);
    for (const a of r.attachments) {
      const n = uid("a");
      outFiles[n] = files[a.id];
      a.id = n;
    }
    r.u = now;
  }
  for (const x of [...p.frontends, ...p.menu, ...p.versions, ...p.versions.flatMap((v) => v.phases), ...p.prereqs]) x.u = now;
  p.gone = {};
  p.createdAt = now;
  p.deletedAt = null;
  p.u = now;
  return { project: tidy(p), files: outFiles };
}

/** Beispielprojekt aus dem Prototyp. */
export function demoProject(now = Date.now()): Project {
  const story = (role: string, goal: string, benefit: string) => ({ role, goal, benefit });
  const R = (
    n: number,
    title: string,
    menuId: string,
    prio: Prio,
    status: Status,
    versionId: string | null,
    phaseId: string | null,
    prereqIds: string[],
    desc = "",
    st: Req["story"] | null = null,
    crit: string[] = [],
  ) => ({
    id: "r" + n,
    key: keyOf(n),
    title,
    menuId,
    prio,
    status,
    versionId,
    phaseId,
    prereqIds,
    desc,
    story: st || story("", "", ""),
    criteria: crit.map((t, i) => ({ id: "c" + n + i, text: t, done: false })),
    attachments: [],
    history: [] as Req["history"],
    createdAt: now + n,
  });
  const reqs = [
    R(1, "Kennzahlen-Kacheln auf dem Dashboard", "m1", "M", "wip", "v1", "p2", [], "Offene Bestellungen, letzte Lieferung und Rechnungssumme des Monats als Kacheln.", story("Kundin", "meine wichtigsten Zahlen auf einen Blick sehen", "ich nicht durch mehrere Seiten klicken muss"), ["Kacheln laden in unter 1 s", "Klick auf Kachel öffnet die passende Liste"]),
    R(2, "Anmeldung mit Firmenkonto (SSO)", "m2", "M", "open", "v1", "p1", ["q1", "q4"], "Anmeldung über den zentralen Identity Provider des Kunden.", story("Mitarbeiter eines Firmenkunden", "mich mit meinem Firmenkonto anmelden", "ich kein separates Passwort brauche"), ["Login-Button „Mit Firmenkonto anmelden“", "Abmeldung beendet auch die SSO-Sitzung"]),
    R(3, "Profilbild hochladen", "m3", "C", "open", "v1", "p3", [], "", null, ["JPG und PNG bis 5 MB"]),
    R(4, "Passwort ändern mit Stärkeanzeige", "m5", "M", "done", "v1", "p1", ["q2"], "Altes Passwort bestätigen, neues Passwort mit Live-Stärkeanzeige.", null, ["Mindestens 12 Zeichen", "Bestätigungsmail nach Änderung"]),
    R(5, "Zwei-Faktor-Anmeldung per SMS", "m6", "S", "open", "v2", "p4", ["q5", "q3"], "", story("Kunde", "einen zweiten Faktor per SMS nutzen", "mein Konto besser geschützt ist"), []),
    R(6, "Zwei-Faktor-Anmeldung per Authenticator-App", "m6", "S", "open", "v2", "p5", [], "TOTP-basiert, QR-Code zur Einrichtung.", null, []),
    R(7, "Bestellliste filtern und sortieren", "m8", "M", "wip", "v1", "p2", ["q2"], "Filter nach Zeitraum, Status und Betrag.", null, ["Filter bleiben beim Zurücknavigieren erhalten"]),
    R(8, "Bestellung als PDF herunterladen", "m9", "S", "open", "v1", "p3", [], "", null, []),
    R(9, "Sendungsverfolgung im Bestelldetail", "m9", "C", "open", null, null, ["q3"], "Tracking-Status des Versanddienstleisters einbetten.", null, []),
    R(10, "Dark Mode", "m10", "W", "open", null, null, [], "", null, []),
    R(11, "Spracheinstellung Deutsch / Englisch", "m10", "S", "open", "v2", "p4", [], "", null, ["Sprache wird pro Benutzer gespeichert"]),
  ];
  reqs[4].history = [{ date: "2026-09-18T10:12:00.000Z", from: "v1.0 · Phase 3 · Feinschliff", to: "v1.1 · Phase 1" }];
  const raw = {
    product: "Kundenportal (Beispiel)",
    seq: 11,
    // Im Beispiel sind die Hauptmenüpunkte gewöhnliche Menüs eines einzigen Frontends.
    frontends: [{ id: "f1", name: "Kundenfrontend" }],
    feAsked: true,
    menu: [
      { id: "m1", name: "Dashboard", parent: null },
      { id: "m2", name: "Konto", parent: null },
      { id: "m3", name: "Profil", parent: "m2" },
      { id: "m4", name: "Sicherheit", parent: "m2" },
      { id: "m5", name: "Passwort ändern", parent: "m4" },
      { id: "m6", name: "Zwei-Faktor-Anmeldung", parent: "m4" },
      { id: "m7", name: "Bestellungen", parent: null },
      { id: "m8", name: "Übersicht", parent: "m7" },
      { id: "m9", name: "Bestelldetail", parent: "m7" },
      { id: "m10", name: "Einstellungen", parent: null },
    ],
    versions: [
      { id: "v1", name: "v1.0", phases: [{ id: "p1", name: "Phase 1 · Grundgerüst" }, { id: "p2", name: "Phase 2 · Kernfunktionen" }, { id: "p3", name: "Phase 3 · Feinschliff" }] },
      { id: "v2", name: "v1.1", phases: [{ id: "p4", name: "Phase 1" }, { id: "p5", name: "Phase 2" }] },
    ],
    prereqs: [
      { id: "q1", title: "SSO-Schnittstelle zum Identity Provider", type: "tech", done: false },
      { id: "q2", title: "Datenbank-Migration Kundenstamm", type: "tech", done: true },
      { id: "q5", title: "Vertrag mit SMS-Gateway", type: "tech", done: false },
      { id: "q3", title: "Schulung Kundenservice", type: "user", done: false },
      { id: "q4", title: "Datenschutzfreigabe durch DSB", type: "user", done: true },
    ],
    reqs,
  };
  return importProject(raw, now).project;
}
