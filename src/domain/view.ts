// Abgeleitete Sichten auf ein Projekt: Baum, Filter, Gruppen, Board, Tabelle, Übersicht, Lastenheft.
// Reine Funktionen ohne Oberfläche, damit sie sich einzeln prüfen lassen.

import type { MenuNode, Phase, Prereq, Prio, Project, Req, Status, Version } from "./types";
import { PRIO, STATUS } from "./types";

export interface MenuIndex {
  byId: Map<string, MenuNode>;
  kids(parent: string | null): MenuNode[];
  pathOf(id: string | null): string;
  subOf(id: string): Set<string>;
  /** Baum in Anzeige-Reihenfolge */
  dfs: { m: MenuNode; depth: number }[];
  order: Map<string, number>;
}

export function menuIndex(p: Project): MenuIndex {
  const byId = new Map(p.menu.map((m) => [m.id, m]));
  const children = new Map<string | null, MenuNode[]>();
  for (const m of p.menu) {
    const k = m.parent && byId.has(m.parent) ? m.parent : null;
    (children.get(k) ?? children.set(k, []).get(k)!).push(m);
  }
  const kids = (parent: string | null) => children.get(parent) ?? [];
  const pathOf = (id: string | null) => {
    const a: string[] = [];
    let m = id ? byId.get(id) : undefined;
    let guard = 0;
    while (m && guard++ < 50) {
      a.unshift(m.name);
      m = m.parent ? byId.get(m.parent) : undefined;
    }
    return a.join(" / ");
  };
  const subOf = (id: string) => {
    const set = new Set<string>();
    const add = (x: string) => {
      if (set.has(x)) return;
      set.add(x);
      kids(x).forEach((m) => add(m.id));
    };
    add(id);
    return set;
  };
  const dfs: { m: MenuNode; depth: number }[] = [];
  const walk = (parent: string | null, depth: number) =>
    kids(parent).forEach((m) => {
      if (depth > 50) return;
      dfs.push({ m, depth });
      walk(m.id, depth + 1);
    });
  walk(null, 0);
  return { byId, kids, pathOf, subOf, dfs, order: new Map(dfs.map((x, i) => [x.m.id, i])) };
}

export const liveReqs = (p: Project) => p.reqs.filter((r) => !r.deletedAt);
export const trashedReqs = (p: Project) => p.reqs.filter((r) => r.deletedAt).sort((a, b) => (b.deletedAt ?? 0) - (a.deletedAt ?? 0));

// ---------------------------------------------------------------- Lücken

export type GapKey = "noTitle" | "noDesc" | "noCrit" | "noMenu" | "mustUnplanned";
export const GAPS: { key: GapKey; label: string; hint: string }[] = [
  { key: "noTitle", label: "Ohne Titel", hint: "Anforderungen, die noch keinen Titel haben." },
  { key: "noDesc", label: "Ohne Beschreibung", hint: "Weder Beschreibung noch User Story. Won’t-Anforderungen zählen nicht mit." },
  { key: "noCrit", label: "Ohne Akzeptanzkriterien", hint: "Es ist nicht festgelegt, wann die Anforderung als erfüllt gilt. Won’t-Anforderungen zählen nicht mit." },
  { key: "noMenu", label: "Ohne Menüpunkt", hint: "Keinem Punkt der Menüstruktur zugeordnet." },
  { key: "mustUnplanned", label: "Must, nicht eingeplant", hint: "Must-Anforderungen ohne Version." },
];

export function gapPred(p: Project, key: GapKey): (r: Req) => boolean {
  const menuIds = new Set(p.menu.map((m) => m.id));
  const verIds = new Set(p.versions.map((v) => v.id));
  switch (key) {
    case "noTitle":
      return (r) => !r.title.trim();
    case "noDesc":
      return (r) => r.prio !== "W" && !r.desc.trim() && !(r.story.role.trim() || r.story.goal.trim());
    case "noCrit":
      return (r) => r.prio !== "W" && r.criteria.length === 0;
    case "noMenu":
      return (r) => !r.menuId || !menuIds.has(r.menuId);
    case "mustUnplanned":
      return (r) => r.prio === "M" && (!r.versionId || !verIds.has(r.versionId));
  }
}

// ---------------------------------------------------------------- Filter

export interface Filters {
  menuId: string | null;
  prio: Prio | "";
  status: Status | "";
  search: string;
  gap: GapKey | null;
}

export function filterReqs(p: Project, ix: MenuIndex, f: Filters): Req[] {
  const scope = f.menuId && ix.byId.has(f.menuId) ? ix.subOf(f.menuId) : null;
  const q = f.search.trim().toLowerCase();
  const gap = f.gap ? gapPred(p, f.gap) : null;
  return liveReqs(p).filter(
    (r) =>
      (!scope || (r.menuId !== null && scope.has(r.menuId))) &&
      (!f.prio || r.prio === f.prio) &&
      (!f.status || r.status === f.status) &&
      (!gap || gap(r)) &&
      (!q || (r.key + " " + r.title + " " + r.desc).toLowerCase().includes(q)),
  );
}

export const byPrio = (a: Req, b: Req) => PRIO[a.prio].rank - PRIO[b.prio].rank || a.key.localeCompare(b.key);

// ---------------------------------------------------------------- Angaben je Anforderung

export interface ReqInfo {
  r: Req;
  path: string;
  version: Version | null;
  phase: Phase | null;
  links: Prereq[];
  preOpen: number;
  /** kurze Angabe „v1.0 · Phase 1“ */
  vp: string;
}

export function reqInfo(p: Project, ix: MenuIndex, r: Req): ReqInfo {
  const version = p.versions.find((v) => v.id === r.versionId) ?? null;
  const phase = version?.phases.find((x) => x.id === r.phaseId) ?? null;
  const links = r.prereqIds.map((i) => p.prereqs.find((q) => q.id === i)).filter((q): q is Prereq => !!q);
  return {
    r,
    path: r.menuId && ix.byId.has(r.menuId) ? ix.pathOf(r.menuId) : "Ohne Menüpunkt",
    version,
    phase,
    links,
    preOpen: links.filter((q) => !q.done).length,
    vp: version ? version.name + (phase ? " · " + phase.name.split(" · ")[0] : "") : "—",
  };
}

// ---------------------------------------------------------------- Liste

export interface Group {
  id: string;
  name: string;
  parentPath: string;
  items: Req[];
}

export function groupByMenu(ix: MenuIndex, reqs: Req[]): Group[] {
  const map = new Map<string, Req[]>();
  for (const r of reqs) {
    const k = r.menuId && ix.byId.has(r.menuId) ? r.menuId : "__none";
    (map.get(k) ?? map.set(k, []).get(k)!).push(r);
  }
  const pos = (k: string) => (k === "__none" ? 1e9 : (ix.order.get(k) ?? 1e9));
  return [...map.keys()]
    .sort((a, b) => pos(a) - pos(b))
    .map((k) => {
      const m = ix.byId.get(k);
      return { id: k, name: m ? m.name : "Ohne Menüpunkt", parentPath: m && m.parent ? ix.pathOf(m.parent) : "", items: map.get(k)!.sort(byPrio) };
    });
}

// ---------------------------------------------------------------- Board

export interface Column {
  id: string;
  name: string;
  versionId: string | null;
  phaseId: string | null;
  backlog: boolean;
  items: Req[];
}

export function boardColumns(p: Project, reqs: Req[], versionId: string | null): Column[] {
  const verIds = new Set(p.versions.map((v) => v.id));
  const cols: Column[] = [
    { id: "__backlog", name: "Nicht eingeplant", versionId: null, phaseId: null, backlog: true, items: reqs.filter((r) => !r.versionId || !verIds.has(r.versionId)).sort(byPrio) },
  ];
  const v = p.versions.find((x) => x.id === versionId);
  if (v) {
    const orphan = reqs.filter((r) => r.versionId === v.id && !v.phases.some((ph) => ph.id === r.phaseId));
    if (orphan.length) cols.push({ id: "__nophase", name: "Ohne Phase", versionId: v.id, phaseId: null, backlog: false, items: orphan.sort(byPrio) });
    for (const ph of v.phases)
      cols.push({ id: ph.id, name: ph.name, versionId: v.id, phaseId: ph.id, backlog: false, items: reqs.filter((r) => r.versionId === v.id && r.phaseId === ph.id).sort(byPrio) });
  }
  return cols;
}

// ---------------------------------------------------------------- Tabelle

export type SortKey = "key" | "title" | "prio" | "status" | "path" | "ver" | "phase" | "pre";
export const TABLE_HEADERS: [SortKey, string][] = [
  ["key", "ID"],
  ["title", "Titel"],
  ["prio", "Prio"],
  ["status", "Status"],
  ["path", "Menüpunkt"],
  ["ver", "Version"],
  ["phase", "Phase"],
  ["pre", "Vorauss."],
];

export function sortTable(p: Project, ix: MenuIndex, reqs: Req[], key: SortKey, dir: 1 | -1): Req[] {
  const done = new Map(p.prereqs.map((q) => [q.id, q.done]));
  const val: Record<SortKey, (r: Req) => string | number> = {
    key: (r) => r.key,
    title: (r) => r.title.toLowerCase(),
    prio: (r) => PRIO[r.prio].rank,
    status: (r) => STATUS[r.status].rank,
    path: (r) => (r.menuId ? (ix.order.get(r.menuId) ?? 1e9) : 1e9),
    ver: (r) => {
      const i = p.versions.findIndex((v) => v.id === r.versionId);
      return i < 0 ? 1e9 : i;
    },
    phase: (r) => {
      const v = p.versions.find((x) => x.id === r.versionId);
      const i = v ? v.phases.findIndex((ph) => ph.id === r.phaseId) : -1;
      return i < 0 ? 1e9 : i;
    },
    pre: (r) => -r.prereqIds.filter((i) => done.get(i) === false).length,
  };
  return [...reqs].sort((a, b) => {
    const x = val[key](a),
      y = val[key](b);
    return (x < y ? -1 : x > y ? 1 : a.key.localeCompare(b.key)) * dir;
  });
}

// ---------------------------------------------------------------- Übersicht

export interface Progress {
  total: number;
  open: number;
  wip: number;
  done: number;
  critTotal: number;
  critDone: number;
  preOpen: number;
}

function progress(p: Project, reqs: Req[]): Progress {
  const done = new Map(p.prereqs.map((q) => [q.id, q.done]));
  const openPre = new Set<string>();
  const out: Progress = { total: reqs.length, open: 0, wip: 0, done: 0, critTotal: 0, critDone: 0, preOpen: 0 };
  for (const r of reqs) {
    out[r.status] += 1;
    out.critTotal += r.criteria.length;
    out.critDone += r.criteria.filter((c) => c.done).length;
    for (const i of r.prereqIds) if (done.get(i) === false) openPre.add(i);
  }
  out.preOpen = openPre.size;
  return out;
}

export interface Overview {
  /** ohne Won’t */
  all: Progress;
  wont: number;
  versions: { id: string; name: string; p: Progress; phases: { id: string; name: string; p: Progress }[] }[];
  unplanned: Progress;
  gaps: { key: GapKey; label: string; hint: string; count: number }[];
  prereqs: { total: number; done: number };
}

/** Fortschritt je Version und Phase sowie Lücken im Katalog. Won’t-Anforderungen zählen beim Fortschritt nicht mit. */
export function overview(p: Project): Overview {
  const live = liveReqs(p);
  const scope = live.filter((r) => r.prio !== "W");
  const verIds = new Set(p.versions.map((v) => v.id));
  return {
    all: progress(p, scope),
    wont: live.length - scope.length,
    versions: p.versions.map((v) => {
      const inV = scope.filter((r) => r.versionId === v.id);
      const phases = v.phases.map((ph) => ({ id: ph.id, name: ph.name, p: progress(p, inV.filter((r) => r.phaseId === ph.id)) }));
      const orphan = inV.filter((r) => !v.phases.some((ph) => ph.id === r.phaseId));
      if (orphan.length) phases.push({ id: "__nophase", name: "Ohne Phase", p: progress(p, orphan) });
      return { id: v.id, name: v.name, p: progress(p, inV), phases };
    }),
    unplanned: progress(p, scope.filter((r) => !r.versionId || !verIds.has(r.versionId))),
    gaps: GAPS.map((g) => ({ ...g, count: live.filter(gapPred(p, g.key)).length })),
    prereqs: { total: p.prereqs.length, done: p.prereqs.filter((q) => q.done).length },
  };
}

// ---------------------------------------------------------------- Lastenheft

export interface ReportItem {
  info: ReqInfo;
  storyText: string;
  preList: string;
}
export interface Report {
  version: string;
  total: number;
  must: number;
  done: number;
  preOpen: number;
  phases: { name: string; items: ReportItem[] }[];
  pre: Prereq[];
}

export function storyText(r: Req): string {
  const s = r.story;
  if (!s.role.trim() && !s.goal.trim()) return "";
  return "Als " + (s.role || "…") + " möchte ich " + (s.goal || "…") + (s.benefit ? ", damit " + s.benefit : "") + ".";
}

export function report(p: Project, ix: MenuIndex, versionId: string): Report | null {
  const v = p.versions.find((x) => x.id === versionId);
  if (!v) return null;
  const all = liveReqs(p).filter((r) => r.versionId === v.id);
  const item = (r: Req): ReportItem => {
    const info = reqInfo(p, ix, r);
    return { info, storyText: storyText(r), preList: info.links.map((q) => q.title + (q.done ? " (erfüllt)" : " (offen)")).join(" · ") };
  };
  const phases = v.phases
    .map((ph) => ({ name: ph.name, items: all.filter((r) => r.phaseId === ph.id).sort(byPrio).map(item) }))
    .concat([{ name: "Ohne Phase", items: all.filter((r) => !v.phases.some((ph) => ph.id === r.phaseId)).sort(byPrio).map(item) }])
    .filter((x) => x.items.length);
  const preIds = [...new Set(all.flatMap((r) => r.prereqIds))];
  const pre = preIds.map((i) => p.prereqs.find((q) => q.id === i)).filter((q): q is Prereq => !!q);
  return {
    version: v.name,
    total: all.length,
    must: all.filter((r) => r.prio === "M").length,
    done: all.filter((r) => r.status === "done").length,
    preOpen: pre.filter((q) => !q.done).length,
    phases,
    pre,
  };
}
