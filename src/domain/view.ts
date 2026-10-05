// Abgeleitete Sichten auf ein Projekt: Baum, Filter, Gruppen, Board, Tabelle, Übersicht, Lastenheft.
// Reine Funktionen ohne Oberfläche, damit sie sich einzeln prüfen lassen.

import { cmpKey } from "./model";
import type { Color, Frontend, MenuNode, Phase, Prereq, Prio, Project, Req, Status, Version } from "./types";
import { PRIO, STATUS } from "./types";

export interface MenuIndex {
  byId: Map<string, MenuNode>;
  kids(parent: string | null): MenuNode[];
  /** Hauptmenüpunkte eines Frontends */
  roots(fe: string): MenuNode[];
  pathOf(id: string | null): string;
  subOf(id: string): Set<string>;
  /** Baum in Anzeige-Reihenfolge: Frontend für Frontend */
  dfs: { m: MenuNode; depth: number }[];
  order: Map<string, number>;
  frontends: Frontend[];
  /** true = Projekt hat mehrere Frontends; dann erscheint das Frontend in Pfaden und Spalten */
  multi: boolean;
  feName(id: string | null): string;
}

export function menuIndex(p: Project): MenuIndex {
  const byId = new Map(p.menu.map((m) => [m.id, m]));
  const children = new Map<string | null, MenuNode[]>();
  for (const m of p.menu) {
    const k = m.parent && byId.has(m.parent) ? m.parent : null;
    (children.get(k) ?? children.set(k, []).get(k)!).push(m);
  }
  const kids = (parent: string | null) => children.get(parent) ?? [];
  const roots = (fe: string) => kids(null).filter((m) => m.fe === fe);
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
  const walk = (list: MenuNode[], depth: number) =>
    list.forEach((m) => {
      if (depth > 50) return;
      dfs.push({ m, depth });
      walk(kids(m.id), depth + 1);
    });
  for (const f of p.frontends) walk(roots(f.id), 0);
  const feById = new Map(p.frontends.map((f) => [f.id, f]));
  return {
    byId,
    kids,
    roots,
    pathOf,
    subOf,
    dfs,
    order: new Map(dfs.map((x, i) => [x.m.id, i])),
    frontends: p.frontends,
    multi: p.frontends.length > 1,
    feName: (id) => (id ? (feById.get(id)?.name ?? "") : ""),
  };
}

export const liveReqs = (p: Project) => p.reqs.filter((r) => !r.deletedAt);
export const trashedReqs = (p: Project) => p.reqs.filter((r) => r.deletedAt).sort((a, b) => (b.deletedAt ?? 0) - (a.deletedAt ?? 0) || cmpKey(a.key, b.key));
/** Teilanforderungen einer Anforderung (ohne Papierkorb), nach Nummer. */
export const partsOf = (p: Project, id: string) => p.reqs.filter((r) => r.parentId === id && !r.deletedAt).sort((a, b) => cmpKey(a.key, b.key));
/** Gehört die Anforderung zu diesem Frontend, direkt oder über „betrifft auch“? */
export const inFrontend = (r: Req, fe: string) => r.fe === fe || r.also.includes(fe);

// ---------------------------------------------------------------- Lücken

export type GapKey = "noTitle" | "noDesc" | "noCrit" | "noMenu" | "mustUnplanned" | "doneOpenParts";
export const GAPS: { key: GapKey; label: string; hint: string }[] = [
  { key: "noTitle", label: "Ohne Titel", hint: "Anforderungen, die noch keinen Titel haben." },
  { key: "noDesc", label: "Ohne Beschreibung", hint: "Weder Beschreibung noch User Story. Won’t-Anforderungen zählen nicht mit." },
  { key: "noCrit", label: "Ohne Akzeptanzkriterien", hint: "Es ist nicht festgelegt, wann die Anforderung als erfüllt gilt. Won’t-Anforderungen zählen nicht mit." },
  { key: "noMenu", label: "Ohne Menüpunkt", hint: "Keinem Punkt der Menüstruktur zugeordnet." },
  { key: "mustUnplanned", label: "Must, nicht eingeplant", hint: "Must-Anforderungen ohne Version." },
  { key: "doneOpenParts", label: "Erledigt, aber Teile offen", hint: "Die Anforderung steht auf Erledigt, obwohl Teilanforderungen noch nicht erledigt sind. Won’t-Teile zählen nicht mit." },
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
    case "doneOpenParts": {
      const open = new Set(p.reqs.filter((r) => r.parentId && !r.deletedAt && r.prio !== "W" && r.status !== "done").map((r) => r.parentId!));
      return (r) => r.status === "done" && open.has(r.id);
    }
  }
}

// ---------------------------------------------------------------- Filter

export interface Filters {
  /** null = alle Frontends */
  feId?: string | null;
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
  const fe = f.feId && p.frontends.some((x) => x.id === f.feId) ? f.feId : null;
  return liveReqs(p).filter(
    (r) =>
      (!fe || inFrontend(r, fe)) &&
      (!scope || (r.menuId !== null && scope.has(r.menuId))) &&
      (!f.prio || r.prio === f.prio) &&
      (!f.status || r.status === f.status) &&
      (!gap || gap(r)) &&
      (!q || (r.key + " " + r.title + " " + r.desc).toLowerCase().includes(q)),
  );
}

export const byPrio = (a: Req, b: Req) => PRIO[a.prio].rank - PRIO[b.prio].rank || cmpKey(a.key, b.key);

/**
 * Reihenfolge für Liste und Lastenheft: nach Priorität, Teilanforderungen direkt unter ihrer
 * großen Anforderung (nach Nummer). Ein Teil ohne seine große Anforderung in der Auswahl steht für sich.
 */
export function withParts(reqs: Req[]): { r: Req; part: boolean }[] {
  const ids = new Set(reqs.map((r) => r.id));
  const out: { r: Req; part: boolean }[] = [];
  for (const r of reqs.filter((x) => !x.parentId || !ids.has(x.parentId)).sort(byPrio)) {
    out.push({ r, part: false });
    for (const c of reqs.filter((x) => x.parentId === r.id).sort((a, b) => cmpKey(a.key, b.key))) out.push({ r: c, part: true });
  }
  return out;
}

// ---------------------------------------------------------------- Angaben je Anforderung

export interface ReqInfo {
  r: Req;
  /** Menüpfad, bei mehreren Frontends mit dem Frontend davor */
  path: string;
  feName: string;
  /** Namen der zusätzlich betroffenen Frontends */
  also: string[];
  /** Farbe des eigenen Menüpunkts */
  color: Color | null;
  version: Version | null;
  phase: Phase | null;
  links: Prereq[];
  preOpen: number;
  /** kurze Angabe „v1.0 · Phase 1“ */
  vp: string;
  parent: Req | null;
  /** Teilanforderungen ohne Papierkorb */
  parts: Req[];
  partsDone: number;
  /** Erledigt gesetzt, obwohl Teile (außer Won’t) noch offen sind */
  partsWarn: boolean;
}

export function reqInfo(p: Project, ix: MenuIndex, r: Req): ReqInfo {
  const version = p.versions.find((v) => v.id === r.versionId) ?? null;
  const phase = version?.phases.find((x) => x.id === r.phaseId) ?? null;
  const links = r.prereqIds.map((i) => p.prereqs.find((q) => q.id === i)).filter((q): q is Prereq => !!q);
  const m = r.menuId ? ix.byId.get(r.menuId) : undefined;
  const menuPath = m ? ix.pathOf(m.id) : "Ohne Menüpunkt";
  const feName = ix.feName(r.fe);
  const parts = partsOf(p, r.id);
  return {
    r,
    path: ix.multi && feName ? feName + " › " + menuPath : menuPath,
    feName,
    also: r.also.map((f) => ix.feName(f)).filter(Boolean),
    color: m?.color ?? null,
    version,
    phase,
    links,
    preOpen: links.filter((q) => !q.done).length,
    vp: version ? version.name + (phase ? " · " + phase.name.split(" · ")[0] : "") : "—",
    parent: r.parentId ? (p.reqs.find((x) => x.id === r.parentId) ?? null) : null,
    parts,
    partsDone: parts.filter((x) => x.status === "done").length,
    partsWarn: r.status === "done" && parts.some((x) => x.prio !== "W" && x.status !== "done"),
  };
}

// ---------------------------------------------------------------- Liste

export interface Group {
  id: string;
  name: string;
  parentPath: string;
  color: Color | null;
  items: { r: Req; part: boolean }[];
}

export function groupByMenu(ix: MenuIndex, reqs: Req[]): Group[] {
  const map = new Map<string, Req[]>();
  const feOrder = new Map(ix.frontends.map((f, i) => [f.id, i]));
  for (const r of reqs) {
    const k = r.menuId && ix.byId.has(r.menuId) ? r.menuId : "__none:" + (r.fe ?? "");
    (map.get(k) ?? map.set(k, []).get(k)!).push(r);
  }
  // Je Frontend erst der Baum, dann „Ohne Menüpunkt“.
  const pos = (k: string): [number, number] => {
    if (k.startsWith("__none:")) return [feOrder.get(k.slice(7)) ?? 1e9, 1e9];
    return [feOrder.get(ix.byId.get(k)!.fe ?? "") ?? 1e9, ix.order.get(k) ?? 1e9];
  };
  return [...map.keys()]
    .sort((a, b) => pos(a)[0] - pos(b)[0] || pos(a)[1] - pos(b)[1])
    .map((k) => {
      const m = ix.byId.get(k);
      const fe = ix.multi ? ix.feName(m ? m.fe : k.slice(7)) : "";
      const parent = m && m.parent ? ix.pathOf(m.parent) : "";
      return { id: k, name: m ? m.name : "Ohne Menüpunkt", parentPath: [fe, parent].filter(Boolean).join(" › "), color: m?.color ?? null, items: withParts(map.get(k)!) };
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

export type SortKey = "key" | "title" | "prio" | "status" | "fe" | "path" | "ver" | "phase" | "pre";
/** Spalten der Tabelle. Die Spalte Frontend gibt es nur bei mehreren Frontends. */
export function tableHeaders(multi: boolean): [SortKey, string][] {
  const all: [SortKey, string][] = [
    ["key", "ID"],
    ["title", "Titel"],
    ["prio", "Prio"],
    ["status", "Status"],
    ["fe", "Frontend"],
    ["path", "Menüpunkt"],
    ["ver", "Version"],
    ["phase", "Phase"],
    ["pre", "Vorauss."],
  ];
  return multi ? all : all.filter(([k]) => k !== "fe");
}

export function sortTable(p: Project, ix: MenuIndex, reqs: Req[], key: SortKey, dir: 1 | -1): Req[] {
  const done = new Map(p.prereqs.map((q) => [q.id, q.done]));
  const feOrder = new Map(p.frontends.map((f, i) => [f.id, i]));
  const val: Record<SortKey, (r: Req) => string | number> = {
    key: () => 0, // die Nummer entscheidet unten
    title: (r) => r.title.toLowerCase(),
    prio: (r) => PRIO[r.prio].rank,
    status: (r) => STATUS[r.status].rank,
    fe: (r) => feOrder.get(r.fe ?? "") ?? 1e9,
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
    return (x < y ? -1 : x > y ? 1 : cmpKey(a.key, b.key)) * dir;
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
  /** je Frontend die Anforderungen, die dort liegen (ohne „betrifft auch“) */
  frontends: { id: string; name: string; p: Progress }[];
  versions: { id: string; name: string; p: Progress; phases: { id: string; name: string; p: Progress }[] }[];
  unplanned: Progress;
  gaps: { key: GapKey; label: string; hint: string; count: number }[];
  prereqs: { total: number; done: number };
}

/**
 * Fortschritt je Frontend, Version und Phase sowie Lücken im Katalog.
 * Won’t-Anforderungen zählen beim Fortschritt nicht mit. Große Anforderungen und ihre Teile zählen jeweils einzeln.
 */
export function overview(p: Project): Overview {
  const live = liveReqs(p);
  const scope = live.filter((r) => r.prio !== "W");
  const verIds = new Set(p.versions.map((v) => v.id));
  return {
    all: progress(p, scope),
    wont: live.length - scope.length,
    frontends: p.frontends.map((f) => ({ id: f.id, name: f.name, p: progress(p, scope.filter((r) => r.fe === f.id)) })),
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
  /** steht eingerückt unter seiner großen Anforderung */
  part: boolean;
  storyText: string;
  preList: string;
}
export interface Report {
  version: string;
  /** Name des gewählten Frontends, leer = alle */
  frontend: string;
  total: number;
  must: number;
  done: number;
  preOpen: number;
  /** Abschnitte je Frontend. Bei einem gewählten oder nur einem Frontend genau ein Abschnitt ohne Namen. */
  sections: { name: string; phases: { name: string; items: ReportItem[] }[] }[];
  pre: Prereq[];
}

export function storyText(r: Req): string {
  const s = r.story;
  if (!s.role.trim() && !s.goal.trim()) return "";
  return "Als " + (s.role || "…") + " möchte ich " + (s.goal || "…") + (s.benefit ? ", damit " + s.benefit : "") + ".";
}

/** feId = nur dieses Frontend (samt „betrifft auch“), null = alle, dann nach Frontend gegliedert. */
export function report(p: Project, ix: MenuIndex, versionId: string, feId: string | null = null): Report | null {
  const v = p.versions.find((x) => x.id === versionId);
  if (!v) return null;
  const fe = feId ? (p.frontends.find((f) => f.id === feId) ?? null) : null;
  const all = liveReqs(p).filter((r) => r.versionId === v.id && (!fe || inFrontend(r, fe.id)));
  const item = ({ r, part }: { r: Req; part: boolean }): ReportItem => {
    const info = reqInfo(p, ix, r);
    return { info, part, storyText: storyText(r), preList: info.links.map((q) => q.title + (q.done ? " (erfüllt)" : " (offen)")).join(" · ") };
  };
  const phasesOf = (reqs: Req[]) =>
    v.phases
      .map((ph) => ({ name: ph.name, items: withParts(reqs.filter((r) => r.phaseId === ph.id)).map(item) }))
      .concat([{ name: "Ohne Phase", items: withParts(reqs.filter((r) => !v.phases.some((ph) => ph.id === r.phaseId))).map(item) }])
      .filter((x) => x.items.length);
  const sections = fe || !ix.multi ? [{ name: "", phases: phasesOf(all) }] : p.frontends.map((f) => ({ name: f.name, phases: phasesOf(all.filter((r) => r.fe === f.id)) })).filter((s) => s.phases.length);
  const preIds = [...new Set(all.flatMap((r) => r.prereqIds))];
  const pre = preIds.map((i) => p.prereqs.find((q) => q.id === i)).filter((q): q is Prereq => !!q);
  return {
    version: v.name,
    frontend: fe ? fe.name : "",
    total: all.length,
    must: all.filter((r) => r.prio === "M").length,
    done: all.filter((r) => r.status === "done").length,
    preOpen: pre.filter((q) => !q.done).length,
    sections,
    pre,
  };
}
