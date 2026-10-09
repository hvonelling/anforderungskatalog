// Umsetzungsauftrag („Für Claude“) und Rückmeldung.
//
// Ein Auftrag fasst die Anforderungen einer Phase so zusammen, dass sie ohne das Tool verständlich sind:
// Verweise sind aufgelöst, der Steckbrief liegt bei. Nach der Umsetzung kommt eine Rückmeldung zurück,
// die Status, erfüllte Kriterien, Notizen und geklärte Ergänzungen in den Katalog überträgt.

import { changedSinceImpl, cmpKey, implSnap, storySentence, uid } from "./model";
import { BRIEF_FIELDS, PRE_TYPE, PRIO, STATUS, type Attachment, type ImplSnap, type Project, type Req, type Status } from "./types";
import { liveReqs, menuIndex, partsOf, withParts } from "./view";

export const ORDER_FORMAT = "anforderungskatalog-auftrag-v1";
export const FEEDBACK_FORMAT = "anforderungskatalog-rueckmeldung-v1";

export interface OrderReq {
  id: string;
  key: string;
  title: string;
  frontend: string;
  alsoFrontends: string[];
  menuPath: string;
  priority: string;
  status: string;
  description: string;
  userStory: string;
  criteria: { id: string; text: string; done: boolean }[];
  prerequisites: { title: string; type: string; done: boolean }[];
  /** Kennung der großen Anforderung, zu der diese gehört */
  partOf: string | null;
  parts: string[];
  /** Pfade der Anhänge innerhalb der ZIP-Datei */
  attachments: { file: string; name: string; type: string }[];
  /** gesetzt, wenn die Anforderung schon einmal umgesetzt und danach geändert wurde */
  changedSince: { implementedAt: string; note: string; before: ImplSnap } | null;
}
export interface Order {
  format: typeof ORDER_FORMAT;
  id: string;
  createdAt: string;
  project: { id: string; name: string };
  version: { id: string; name: string };
  phase: { id: string; name: string };
  frontends: string[];
  brief: Record<string, string>;
  /** Steckbrief-Felder, die noch leer sind */
  briefMissing: string[];
  /** umzusetzen in diesem Auftrag */
  requirements: OrderReq[];
  /** zur Einordnung, nicht umzusetzen */
  context: {
    alreadyImplemented: { key: string; title: string; status: string }[];
    wont: { key: string; title: string }[];
    otherPhases: { phase: string; key: string; title: string; status: string }[];
  };
}

export interface OrderPlan {
  /** umzusetzen: offen, in Arbeit, oder geändert seit Umsetzung */
  todo: Req[];
  /** schon umgesetzt und unverändert */
  done: Req[];
  wont: Req[];
  /** Hinweise auf dünne Anforderungen (Kennung → was fehlt) */
  thin: { key: string; missing: string[] }[];
}

/** Welche Anforderungen einer Phase kämen in den Auftrag? */
export function planOrder(p: Project, versionId: string, phaseId: string): OrderPlan {
  const inPhase = liveReqs(p).filter((r) => r.versionId === versionId && r.phaseId === phaseId);
  const wont = inPhase.filter((r) => r.prio === "W");
  const rest = inPhase.filter((r) => r.prio !== "W");
  const todo = rest.filter((r) => r.status === "open" || r.status === "wip" || changedSinceImpl(r));
  const thin = todo
    .map((r) => ({ key: r.key, missing: [!r.title.trim() && "Titel", !r.desc.trim() && !storySentence(r) && "Beschreibung", r.criteria.length === 0 && "Akzeptanzkriterien"].filter((x): x is string => !!x) }))
    .filter((x) => x.missing.length)
    .sort((a, b) => cmpKey(a.key, b.key));
  return { todo, done: rest.filter((r) => !todo.includes(r)), wont, thin };
}

const safeName = (s: string) => s.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "_").replace(/^\.+/, "_").slice(0, 80) || "datei";
/** Pfad eines Anhangs in der ZIP-Datei. Eindeutig, auch wenn zwei Anhänge gleich heißen. */
export const attachmentFile = (r: Req, a: Attachment, i: number) => `anhaenge/${r.key}/${String(i + 1).padStart(2, "0")}-${safeName(a.name)}`;

export function buildOrder(p: Project, versionId: string, phaseId: string, now = Date.now()): Order | null {
  const v = p.versions.find((x) => x.id === versionId);
  const ph = v?.phases.find((x) => x.id === phaseId);
  if (!v || !ph) return null;
  const ix = menuIndex(p);
  const plan = planOrder(p, versionId, phaseId);
  const keyOf = (id: string | null) => p.reqs.find((x) => x.id === id)?.key ?? null;
  const one = (r: Req): OrderReq => ({
    id: r.id,
    key: r.key,
    title: r.title,
    frontend: ix.feName(r.fe),
    alsoFrontends: r.also.map((f) => ix.feName(f)).filter(Boolean),
    menuPath: r.menuId && ix.byId.has(r.menuId) ? ix.pathOf(r.menuId) : "",
    priority: PRIO[r.prio].label,
    status: STATUS[r.status].label,
    description: r.desc,
    userStory: storySentence(r),
    criteria: r.criteria.map((c) => ({ id: c.id, text: c.text, done: c.done })),
    prerequisites: r.prereqIds
      .map((i) => p.prereqs.find((q) => q.id === i))
      .filter((q): q is NonNullable<typeof q> => !!q)
      .map((q) => ({ title: q.title, type: PRE_TYPE[q.type], done: q.done })),
    partOf: keyOf(r.parentId),
    parts: partsOf(p, r.id).map((x) => x.key),
    attachments: r.attachments.map((a, i) => ({ file: attachmentFile(r, a, i), name: a.name, type: a.type })),
    changedSince: r.impl && changedSinceImpl(r) ? { implementedAt: new Date(r.impl.at).toISOString(), note: r.impl.note, before: r.impl.snap } : null,
  });
  const brief: Record<string, string> = {};
  for (const f of BRIEF_FIELDS) brief[f.label] = p.brief[f.key].trim();
  const stamp = new Date(now).toISOString();
  return {
    format: ORDER_FORMAT,
    id: "auftrag-" + stamp.slice(0, 10) + "-" + uid().slice(0, 5),
    createdAt: stamp,
    project: { id: p.id, name: p.name },
    version: { id: v.id, name: v.name },
    phase: { id: ph.id, name: ph.name },
    frontends: p.frontends.map((f) => f.name),
    brief,
    briefMissing: BRIEF_FIELDS.filter((f) => !p.brief[f.key].trim()).map((f) => f.label),
    requirements: withParts(plan.todo).map((x) => one(x.r)),
    context: {
      alreadyImplemented: plan.done.sort((a, b) => cmpKey(a.key, b.key)).map((r) => ({ key: r.key, title: r.title, status: STATUS[r.status].label })),
      wont: plan.wont.sort((a, b) => cmpKey(a.key, b.key)).map((r) => ({ key: r.key, title: r.title })),
      otherPhases: liveReqs(p)
        .filter((r) => r.versionId === v.id && r.phaseId !== ph.id && r.prio !== "W")
        .sort((a, b) => cmpKey(a.key, b.key))
        .map((r) => ({ phase: v.phases.find((x) => x.id === r.phaseId)?.name ?? "Ohne Phase", key: r.key, title: r.title, status: STATUS[r.status].label })),
    },
  };
}

/** Der Auftrag als lesbarer Text (liegt als AUFTRAG.md neben der JSON-Datei). */
export function orderMarkdown(o: Order): string {
  const L: string[] = [];
  L.push(`# Umsetzungsauftrag: ${o.project.name}`, "", `${o.version.name} · ${o.phase.name} · erstellt ${o.createdAt.slice(0, 10)} · Kennung ${o.id}`, "");
  L.push("Maßgeblich ist `auftrag.json`. Diese Datei zeigt denselben Inhalt in lesbarer Form.", "");
  L.push("## Steckbrief", "");
  for (const [k, v] of Object.entries(o.brief)) L.push(`**${k}:** ${v || "_nicht angegeben_"}`, "");
  if (o.frontends.length > 1) L.push(`**Frontends:** ${o.frontends.join(", ")}`, "");
  L.push(`## Umzusetzen (${o.requirements.length})`, "");
  for (const r of o.requirements) {
    L.push(`### ${r.key} ${r.title || "Ohne Titel"}`, "");
    const place = [r.frontend, r.menuPath].filter(Boolean).join(" › ");
    L.push(`- Priorität: ${r.priority} · Status: ${r.status}` + (place ? ` · Ort: ${place}` : ""));
    if (r.alsoFrontends.length) L.push(`- Betrifft auch: ${r.alsoFrontends.join(", ")}`);
    if (r.partOf) L.push(`- Teil von ${r.partOf}`);
    if (r.parts.length) L.push(`- Teilanforderungen: ${r.parts.join(", ")}`);
    L.push("");
    if (r.description.trim()) L.push(r.description.trim(), "");
    if (r.userStory) L.push(`_${r.userStory}_`, "");
    if (r.criteria.length) {
      L.push("Akzeptanzkriterien:", "");
      for (const c of r.criteria) L.push(`- [${c.done ? "x" : " "}] ${c.text}`);
      L.push("");
    }
    if (r.prerequisites.length) {
      L.push("Voraussetzungen:", "");
      for (const q of r.prerequisites) L.push(`- ${q.title} (${q.type}, ${q.done ? "erfüllt" : "offen"})`);
      L.push("");
    }
    if (r.attachments.length) {
      L.push("Anhänge:", "");
      for (const a of r.attachments) L.push(`- ${a.file}`);
      L.push("");
    }
    if (r.changedSince) {
      const b = r.changedSince.before;
      L.push(`**Geändert seit der Umsetzung vom ${r.changedSince.implementedAt.slice(0, 10)}.** Umgesetzt war:`, "");
      L.push(`- Titel: ${b.title}`);
      if (b.desc) L.push(`- Beschreibung: ${b.desc.replace(/\n/g, " ")}`);
      if (b.story) L.push(`- User Story: ${b.story}`);
      for (const c of b.criteria) L.push(`- Kriterium: ${c}`);
      if (r.changedSince.note) L.push(`- Notiz von damals: ${r.changedSince.note.replace(/\n/g, " ")}`);
      L.push("");
    }
  }
  if (!o.requirements.length) L.push("_In dieser Phase ist nichts offen._", "");
  const c = o.context;
  if (c.alreadyImplemented.length || c.wont.length || c.otherPhases.length) {
    L.push("## Zur Einordnung (nicht umzusetzen)", "");
    if (c.alreadyImplemented.length) L.push("Schon umgesetzt in dieser Phase:", "", ...c.alreadyImplemented.map((r) => `- ${r.key} ${r.title} (${r.status})`), "");
    if (c.wont.length) L.push("Ausdrücklich nicht (Won’t):", "", ...c.wont.map((r) => `- ${r.key} ${r.title}`), "");
    if (c.otherPhases.length) L.push("Andere Phasen dieser Version:", "", ...c.otherPhases.map((r) => `- ${r.phase}: ${r.key} ${r.title} (${r.status})`), "");
  }
  return L.join("\n");
}

// ---------------------------------------------------------------- Rückmeldung

export interface FeedbackItem {
  /** interne Kennung der Anforderung aus dem Auftrag */
  id: string;
  key?: string;
  /** neuer Status: review (umgesetzt, zu prüfen), wip (teilweise), open (nicht begonnen) */
  status?: Status;
  note?: string;
  /** Kennungen der Kriterien, deren Test grün ist */
  criteriaDone?: string[];
  /** geklärte Ergänzungen aus den Rückfragen */
  update?: { description?: string; addCriteria?: string[] };
}
export interface Feedback {
  format: typeof FEEDBACK_FORMAT;
  orderId: string;
  projectId: string;
  createdAt?: string;
  summary?: string;
  items: FeedbackItem[];
}

export function parseFeedback(raw: unknown): Feedback {
  const j = raw as Record<string, unknown>;
  if (!j || typeof j !== "object" || j.format !== FEEDBACK_FORMAT || !Array.isArray(j.items)) throw new Error("Datei ist keine Rückmeldung.");
  const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  return {
    format: FEEDBACK_FORMAT,
    orderId: typeof j.orderId === "string" ? j.orderId : "",
    projectId: typeof j.projectId === "string" ? j.projectId : "",
    createdAt: typeof j.createdAt === "string" ? j.createdAt : undefined,
    summary: typeof j.summary === "string" ? j.summary : undefined,
    items: (j.items as Record<string, unknown>[])
      .filter((x) => x && typeof x === "object" && typeof x.id === "string")
      .map((x) => {
        const u = (x.update && typeof x.update === "object" ? x.update : {}) as Record<string, unknown>;
        // „Erledigt“ setzt nur der Mensch nach seiner Abnahme: aus done wird review.
        const st = x.status === "done" ? "review" : x.status;
        return {
          id: x.id as string,
          key: typeof x.key === "string" ? x.key : undefined,
          status: st === "open" || st === "wip" || st === "review" ? st : undefined,
          note: typeof x.note === "string" ? x.note : undefined,
          criteriaDone: strs(x.criteriaDone),
          update: { description: typeof u.description === "string" ? u.description : undefined, addCriteria: strs(u.addCriteria).map((t) => t.trim()).filter(Boolean) },
        };
      }),
  };
}

export interface FeedbackChange {
  id: string;
  key: string;
  title: string;
  /** null = Status bleibt */
  statusFrom: Status;
  statusTo: Status | null;
  criteriaTicked: string[];
  criteriaAdded: string[];
  descChanged: boolean;
  note: string;
}
export interface FeedbackPreview {
  /** passt die Rückmeldung zu diesem Projekt? */
  projectOk: boolean;
  changes: FeedbackChange[];
  /** Einträge, deren Anforderung es nicht (mehr) gibt */
  unknown: string[];
}

/** Was würde die Rückmeldung ändern? Ändert nichts am Projekt. */
export function previewFeedback(p: Project, f: Feedback): FeedbackPreview {
  const changes: FeedbackChange[] = [];
  const unknown: string[] = [];
  for (const it of f.items) {
    const r = p.reqs.find((x) => x.id === it.id && !x.deletedAt);
    if (!r) {
      unknown.push(it.key || it.id);
      continue;
    }
    const tick = new Set(it.criteriaDone);
    const add = (it.update?.addCriteria ?? []).filter((t) => !r.criteria.some((c) => c.text.trim() === t));
    changes.push({
      id: r.id,
      key: r.key,
      title: r.title,
      statusFrom: r.status,
      statusTo: it.status && it.status !== r.status ? it.status : null,
      criteriaTicked: r.criteria.filter((c) => tick.has(c.id) && !c.done).map((c) => c.text),
      criteriaAdded: add,
      descChanged: it.update?.description !== undefined && it.update.description.trim() !== r.desc.trim(),
      note: (it.note ?? "").trim(),
    });
  }
  changes.sort((a, b) => cmpKey(a.key, b.key));
  return { projectOk: f.projectId === p.id, changes, unknown };
}

/**
 * Rückmeldung in das Projekt übertragen (das Projekt wird verändert; Aufrufer stempelt und speichert).
 * Der danach geltende Inhalt wird als umgesetzter Stand vermerkt, sobald eine Anforderung als umgesetzt gemeldet ist.
 */
export function applyFeedback(p: Project, f: Feedback, now = Date.now()): number {
  let n = 0;
  for (const it of f.items) {
    const r = p.reqs.find((x) => x.id === it.id && !x.deletedAt);
    if (!r) continue;
    n++;
    if (it.update?.description !== undefined && it.update.description.trim()) r.desc = it.update.description;
    for (const t of it.update?.addCriteria ?? []) if (!r.criteria.some((c) => c.text.trim() === t)) r.criteria.push({ id: uid("c"), text: t, done: false });
    const tick = new Set(it.criteriaDone);
    for (const c of r.criteria) if (tick.has(c.id)) c.done = true;
    if (it.status) r.status = it.status;
    const note = (it.note ?? "").trim();
    if (it.status === "review") r.impl = { at: now, order: f.orderId, note, snap: implSnap(r) };
    // Die Notiz steht zusätzlich im Verlauf, damit sie auch bei „teilweise“ oder „nicht begonnen“ sichtbar bleibt.
    if (note) r.history.unshift({ date: new Date(now).toISOString(), from: "Rückmeldung", to: STATUS[r.status].label + ": " + note });
  }
  return n;
}
