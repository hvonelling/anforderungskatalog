import { describe, expect, it } from "vitest";
import { demoProject } from "../src/domain/model";
import { boardColumns, filterReqs, groupByMenu, liveReqs, menuIndex, overview, report, reqInfo, sortTable, type Filters } from "../src/domain/view";

const none: Filters = { menuId: null, prio: "", status: "", search: "", gap: null };
const p = demoProject(1000);
const ix = menuIndex(p);
const menu = (name: string) => p.menu.find((m) => m.name === name)!.id;
const keys = (rs: { key: string }[]) => rs.map((r) => r.key);

describe("Menübaum und Filter", () => {
  it("baut Pfade und Teilbäume", () => {
    expect(ix.pathOf(menu("Passwort ändern"))).toBe("Konto / Sicherheit / Passwort ändern");
    expect(ix.subOf(menu("Konto")).size).toBe(5);
    expect(ix.dfs.map((x) => x.m.name).slice(0, 4)).toEqual(["Dashboard", "Konto", "Profil", "Sicherheit"]);
  });
  it("filtert nach Bereich samt Untermenüs", () => {
    expect(keys(filterReqs(p, ix, { ...none, menuId: menu("Konto") })).sort()).toEqual(["REQ-002", "REQ-003", "REQ-004", "REQ-005", "REQ-006"]);
  });
  it("filtert nach Priorität, Status und Suchtext", () => {
    expect(keys(filterReqs(p, ix, { ...none, prio: "M", status: "wip" }))).toEqual(["REQ-001", "REQ-007"]);
    expect(keys(filterReqs(p, ix, { ...none, search: "pdf" }))).toEqual(["REQ-008"]);
    expect(keys(filterReqs(p, ix, { ...none, search: "req-01" }))).toEqual(["REQ-010", "REQ-011"]);
  });
  it("blendet den Papierkorb aus", () => {
    const q = demoProject(1000);
    q.reqs[0].deletedAt = 5;
    expect(liveReqs(q).length).toBe(10);
    expect(filterReqs(q, menuIndex(q), none).length).toBe(10);
  });
});

describe("Liste, Board, Tabelle", () => {
  it("gruppiert nach Menüpunkt in Baumreihenfolge, Must zuerst", () => {
    const g = groupByMenu(ix, liveReqs(p));
    expect(g.map((x) => x.name)).toEqual(["Dashboard", "Konto", "Profil", "Passwort ändern", "Zwei-Faktor-Anmeldung", "Übersicht", "Bestelldetail", "Einstellungen"]);
    expect(g.find((x) => x.name === "Passwort ändern")!.parentPath).toBe("Konto / Sicherheit");
    expect(keys(g.find((x) => x.name === "Einstellungen")!.items.map((i) => i.r))).toEqual(["REQ-011", "REQ-010"]);
  });
  it("bildet Spalten je Phase und eine für nicht Eingeplantes", () => {
    const cols = boardColumns(p, liveReqs(p), p.versions[0].id);
    expect(cols.map((c) => c.name)).toEqual(["Nicht eingeplant", "Phase 1 · Grundgerüst", "Phase 2 · Kernfunktionen", "Phase 3 · Feinschliff"]);
    expect(cols.map((c) => c.items.length)).toEqual([2, 2, 2, 2]);
  });
  it("zeigt Anforderungen einer gelöschten Phase unter „Ohne Phase“", () => {
    const q = demoProject(1000);
    q.versions[0].phases.pop();
    const cols = boardColumns(q, liveReqs(q), q.versions[0].id);
    expect(cols[1].name).toBe("Ohne Phase");
    expect(cols[1].items.length).toBe(2);
  });
  it("sortiert die Tabelle", () => {
    expect(keys(sortTable(p, ix, liveReqs(p), "prio", 1)).slice(0, 4)).toEqual(["REQ-001", "REQ-002", "REQ-004", "REQ-007"]);
    expect(keys(sortTable(p, ix, liveReqs(p), "key", -1))[0]).toBe("REQ-011");
    expect(keys(sortTable(p, ix, liveReqs(p), "pre", 1))[0]).toBe("REQ-005");
  });
  it("liefert Angaben zu Voraussetzungen", () => {
    const i = reqInfo(p, ix, p.reqs.find((r) => r.key === "REQ-002")!);
    expect(i.links.length).toBe(2);
    expect(i.preOpen).toBe(1);
    expect(i.vp).toBe("v1.0 · Phase 1");
    expect(i.path).toBe("Konto");
  });
});

describe("Übersicht", () => {
  const o = overview(p);
  it("zählt Fortschritt je Version und Phase ohne Won’t", () => {
    expect(o.all.total).toBe(10);
    expect(o.wont).toBe(1);
    expect(o.all).toMatchObject({ open: 7, wip: 2, done: 1 });
    expect(o.versions[0].p).toMatchObject({ total: 6, done: 1, wip: 2, open: 3 });
    expect(o.versions[0].phases.map((x) => x.p.total)).toEqual([2, 2, 2]);
    expect(o.versions[1].p.total).toBe(3);
    expect(o.unplanned.total).toBe(1);
    expect(o.versions[0].p.preOpen).toBe(1);
  });
  it("findet Lücken", () => {
    const g = Object.fromEntries(o.gaps.map((x) => [x.key, x.count]));
    expect(g.noTitle).toBe(0);
    expect(g.noDesc).toBe(3); // REQ-003, REQ-008, REQ-011
    expect(g.noCrit).toBe(4); // REQ-005, REQ-006, REQ-008, REQ-009
    expect(g.noMenu).toBe(0);
    expect(g.mustUnplanned).toBe(0);
    expect(keys(filterReqs(p, ix, { ...none, gap: "noDesc" })).sort()).toEqual(["REQ-003", "REQ-008", "REQ-011"]);
  });
});

describe("Lastenheft", () => {
  it("stellt eine Version nach Phasen zusammen", () => {
    const r = report(p, ix, p.versions[0].id)!;
    expect(r).toMatchObject({ version: "v1.0", total: 6, must: 4, done: 1, preOpen: 1 });
    expect(r.sections[0].phases.map((x) => x.name)).toEqual(["Phase 1 · Grundgerüst", "Phase 2 · Kernfunktionen", "Phase 3 · Feinschliff"]);
    expect(r.sections[0].phases[0].items[0].storyText).toBe("Als Mitarbeiter eines Firmenkunden möchte ich mich mit meinem Firmenkonto anmelden, damit ich kein separates Passwort brauche.");
    expect(r.sections[0].phases[0].items[0].preList).toBe("SSO-Schnittstelle zum Identity Provider (offen) · Datenschutzfreigabe durch DSB (erfüllt)");
    expect(r.pre.length).toBe(3);
    expect(report(p, ix, "gibtsnicht")).toBe(null);
  });
});
