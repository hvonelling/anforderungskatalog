// Anlegen, Stempeln, Zusammenführen, Import und Export von Projekten.

import type { Attachment, MenuNode, Phase, Prereq, Project, Req, Status, Prio, Version } from "./types";
import { PRIO, STATUS } from "./types";

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

export function emptyProject(name: string, now = Date.now()): Project {
  return { format: 1, id: uid("j"), name, seq: 0, menu: [], versions: [], prereqs: [], reqs: [], gone: {}, createdAt: now, deletedAt: null, u: now };
}

export function newReq(p: Project, menuId: string | null, now = Date.now()): Req {
  p.seq += 1;
  const r: Req = {
    id: uid("r"),
    key: keyOf(p.seq),
    title: "",
    menuId,
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
  p.reqs.push(r);
  return r;
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

/** Verweise bereinigen und doppelte Kennungen auflösen. Ändert keine Zeitstempel. */
export function tidy(p: Project): Project {
  if (p.deletedAt) {
    // Gelöschtes Projekt: nur die Marke behalten.
    p.menu = [];
    p.versions = [];
    p.prereqs = [];
    p.reqs = [];
    p.gone = {};
    return p;
  }
  const menuIds = new Set(p.menu.map((m) => m.id));
  for (const m of p.menu) if (m.parent && !menuIds.has(m.parent)) m.parent = null;
  p.reqs.sort((x, y) => x.createdAt - y.createdAt || (x.id < y.id ? -1 : 1));
  for (const r of p.reqs) {
    const n = Number(/^REQ-(\d+)$/.exec(r.key)?.[1] ?? 0);
    if (n > p.seq) p.seq = n;
  }
  // Zwei Geräte können ohne Verbindung dieselbe Nummer vergeben haben: die jüngere Anforderung bekommt eine neue.
  const used = new Set<string>();
  for (const r of p.reqs) {
    if (used.has(r.key) || !r.key) {
      p.seq += 1;
      r.key = keyOf(p.seq);
    }
    used.add(r.key);
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

/** Beliebig geladenen Stand in ein gültiges Projekt überführen. Wirft, wenn es keines ist. */
export function normalizeProject(raw: unknown, now = Date.now()): Project {
  const j = raw as Record<string, unknown>;
  if (!j || typeof j !== "object" || !Array.isArray(j.reqs) || !Array.isArray(j.menu) || !Array.isArray(j.versions) || !Array.isArray(j.prereqs))
    throw new Error("Datei ist kein Anforderungskatalog.");
  const p: Project = {
    format: 1,
    id: str(j.id) || uid("j"),
    name: str(j.name) || str(j.product) || "Projekt",
    seq: num(j.seq, 0),
    menu: arr(j.menu).map((m, i): MenuNode => ({ id: str(m.id) || uid("m"), name: str(m.name, "Menüpunkt"), parent: str(m.parent) || null, o: num(m.o, i), u: num(m.u, now) })),
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
        prio: (str(r.prio) in PRIO ? r.prio : "S") as Prio,
        status: (str(r.status) in STATUS ? r.status : "open") as Status,
        versionId: str(r.versionId) || null,
        phaseId: str(r.phaseId) || null,
        prereqIds: Array.isArray(r.prereqIds) ? r.prereqIds.filter((x): x is string => typeof x === "string") : [],
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
  p.id = uid("j");
  for (const m of p.menu) m.id = re(m.id, "m");
  for (const m of p.menu) m.parent = m.parent ? (map.get(m.parent) ?? null) : null;
  for (const v of p.versions) {
    v.id = re(v.id, "v");
    for (const ph of v.phases) ph.id = re(ph.id, "p");
  }
  for (const q of p.prereqs) q.id = re(q.id, "q");
  const outFiles: Record<string, string> = {};
  for (const r of p.reqs) {
    r.id = uid("r");
    r.menuId = r.menuId ? (map.get(r.menuId) ?? null) : null;
    r.versionId = r.versionId ? (map.get(r.versionId) ?? null) : null;
    r.phaseId = r.phaseId ? (map.get(r.phaseId) ?? null) : null;
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
  for (const x of [...p.menu, ...p.versions, ...p.versions.flatMap((v) => v.phases), ...p.prereqs]) x.u = now;
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
