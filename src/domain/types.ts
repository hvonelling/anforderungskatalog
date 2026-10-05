// Datenmodell des Anforderungskatalogs.
//
// Jeder abgleichbare Datensatz trägt "u" (letzte Änderung in ms). Beim Zusammenführen
// zweier Stände gewinnt je Datensatz der neuere. Gelöschte Datensätze stehen mit
// Löschzeitpunkt in "gone", damit sie auf anderen Geräten nicht wieder auftauchen.

export type Prio = "M" | "S" | "C" | "W";
export type Status = "open" | "wip" | "done";
export type PreType = "tech" | "user";

/** Farben für Menüpunkte. Die Farbwerte stehen je Design in styles.css (--c-<Schlüssel>). */
export const COLORS = ["rot", "orange", "gelb", "gruen", "tuerkis", "blau", "violett", "pink"] as const;
export type Color = (typeof COLORS)[number];
export const COLOR_LABEL: Record<Color, string> = { rot: "Rot", orange: "Orange", gelb: "Gelb", gruen: "Grün", tuerkis: "Türkis", blau: "Blau", violett: "Violett", pink: "Pink" };

/** Ein Frontend des Produkts (Admin, Kunde, Dienstleister …) mit eigenem Menübaum. */
export interface Frontend {
  id: string;
  name: string;
  o: number;
  u: number;
}
export interface MenuNode {
  id: string;
  name: string;
  parent: string | null;
  /** Frontend, zu dem der Baum gehört. Maßgeblich ist der Hauptmenüpunkt; Unterpunkte führen den Wert nur mit. */
  fe: string | null;
  color: Color | null;
  /** Reihenfolge unter Geschwistern */
  o: number;
  u: number;
}
export interface Phase {
  id: string;
  name: string;
  o: number;
  u: number;
}
export interface Version {
  id: string;
  name: string;
  phases: Phase[];
  o: number;
  u: number;
}
export interface Prereq {
  id: string;
  title: string;
  type: PreType;
  done: boolean;
  o: number;
  u: number;
}
export interface Criterion {
  id: string;
  text: string;
  done: boolean;
}
/** Nur die Beschreibung des Anhangs. Der Inhalt liegt getrennt (IndexedDB bzw. eigene Datei im Repo). */
export interface Attachment {
  id: string;
  name: string;
  type: string;
  size: number;
}
export interface HistoryEntry {
  date: string;
  from: string;
  to: string;
}
export interface Story {
  role: string;
  goal: string;
  benefit: string;
}
export interface Req {
  id: string;
  /** REQ-012, Teilanforderungen REQ-012.1 */
  key: string;
  title: string;
  menuId: string | null;
  /** Frontend. Mit Menüpunkt folgt es dessen Baum, ohne Menüpunkt gilt dieser Wert. */
  fe: string | null;
  /** Weitere Frontends, die diese Anforderung betrifft */
  also: string[];
  /** gesetzt = Teilanforderung dieser Anforderung (nur eine Ebene). Ort (Menüpunkt, Frontend) folgt dann der großen Anforderung. */
  parentId: string | null;
  prio: Prio;
  status: Status;
  versionId: string | null;
  phaseId: string | null;
  prereqIds: string[];
  desc: string;
  story: Story;
  criteria: Criterion[];
  attachments: Attachment[];
  history: HistoryEntry[];
  createdAt: number;
  /** gesetzt = liegt im Papierkorb */
  deletedAt: number | null;
  u: number;
}
export interface Project {
  format: 1;
  id: string;
  name: string;
  /** höchste vergebene laufende Nummer (REQ-007 → 7) */
  seq: number;
  /** nie leer (außer bei gelöschten Projekten) */
  frontends: Frontend[];
  /** false = Projekt aus der Zeit vor den Frontends; die App fragt einmal, ob die Hauptmenüpunkte Frontends werden sollen */
  feAsked: boolean;
  menu: MenuNode[];
  versions: Version[];
  prereqs: Prereq[];
  reqs: Req[];
  /** Löschmarken: Datensatz-ID → Löschzeitpunkt */
  gone: Record<string, number>;
  createdAt: number;
  /** gesetzt = Projekt gelöscht (bleibt als leere Marke für den Abgleich) */
  deletedAt: number | null;
  /** letzte Änderung an Name oder Löschzustand */
  u: number;
}

export const PRIO: Record<Prio, { label: string; rank: number }> = {
  M: { label: "Must", rank: 0 },
  S: { label: "Should", rank: 1 },
  C: { label: "Could", rank: 2 },
  W: { label: "Won’t", rank: 3 },
};
export const PRIOS: Prio[] = ["M", "S", "C", "W"];
export const STATUS: Record<Status, { label: string; rank: number }> = {
  open: { label: "Offen", rank: 0 },
  wip: { label: "In Arbeit", rank: 1 },
  done: { label: "Erledigt", rank: 2 },
};
export const STATUSES: Status[] = ["open", "wip", "done"];
export const PRE_TYPE: Record<PreType, string> = { tech: "Technisch", user: "Anwenderbezogen" };
