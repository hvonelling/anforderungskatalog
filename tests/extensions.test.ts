// Frontends, Farben, Teilanforderungen und die Übernahme von Ständen aus der Zeit davor.

import { describe, expect, it } from "vitest";
import { clone, demoProject, emptyProject, importProject, MAIN_FE, mergeProject, newPart, newReq, normalizeProject, removeFrontend, rootsToFrontends, sameProject, setParent, stamp, tidy } from "../src/domain/model";
import type { Project } from "../src/domain/types";
import { filterReqs, groupByMenu, liveReqs, menuIndex, overview, report, reqInfo, sortTable, tableHeaders, withParts, type Filters } from "../src/domain/view";

const none: Filters = { feId: null, menuId: null, prio: "", status: "", search: "", gap: null };
function edit(p: Project, now: number, fn: (d: Project) => void): Project {
  const d = clone(p);
  fn(d);
  tidy(d);
  stamp(p, d, now);
  return d;
}
const keys = (rs: { key: string }[]) => rs.map((r) => r.key);

/** Ein Projekt genau so, wie es die App vor diesem Update gespeichert und abgeglichen hat. */
function legacy() {
  const req = (n: number, title: string, menuId: string | null, extra: object = {}) => ({
    id: "r" + n, key: "REQ-00" + n, title, menuId, prio: "M", status: "open", versionId: "v1", phaseId: "p1", prereqIds: [], desc: "Text " + n,
    story: { role: "Kunde", goal: "etwas tun", benefit: "" }, criteria: [{ id: "c" + n, text: "Kriterium", done: true }],
    attachments: [{ id: "a" + n, name: "bild.png", type: "image/png", size: 10 }], history: [{ date: "2026-10-04T10:00:00.000Z", from: "Nicht eingeplant", to: "v1.0 · Phase 1" }],
    createdAt: 1000 + n, deletedAt: null, u: 2000 + n, ...extra,
  });
  return {
    format: 1, id: "jalt", name: "Energieportal", seq: 5,
    menu: [
      { id: "mA", name: "Admin", parent: null, o: 0, u: 100 },
      { id: "mK", name: "Kunde", parent: null, o: 1, u: 100 },
      { id: "mD", name: "Dienstleister 1", parent: null, o: 2, u: 100 },
      { id: "mA1", name: "Benutzer", parent: "mA", o: 3, u: 100 },
      { id: "mA2", name: "Rollen", parent: "mA1", o: 4, u: 100 },
      { id: "mK1", name: "Verträge", parent: "mK", o: 5, u: 100 },
    ],
    versions: [{ id: "v1", name: "v1.0", o: 0, u: 100, phases: [{ id: "p1", name: "Phase 1", o: 0, u: 100 }] }],
    prereqs: [{ id: "q1", title: "API", type: "tech", done: false, o: 0, u: 100 }],
    reqs: [req(1, "Benutzer anlegen", "mA1"), req(2, "Rollen vergeben", "mA2"), req(3, "Vertrag ansehen", "mK1"), req(4, "Direkt am Kundenmenü", "mK"), req(5, "Im Papierkorb", "mD", { deletedAt: 5000 })],
    gone: { rweg: 900 }, createdAt: 500, deletedAt: null, u: 600,
  };
}

describe("Stände aus der Zeit vor dem Update", () => {
  it("bleiben vollständig erhalten und bekommen ein Frontend „Allgemein“", () => {
    const old = legacy();
    const p = normalizeProject(old);
    expect(p.frontends).toEqual([{ id: MAIN_FE, name: "Allgemein", o: 0, u: 0 }]);
    expect(p.feAsked).toBe(false);
    expect(p.reqs.length).toBe(5);
    for (const [i, o] of old.reqs.entries()) {
      const r = p.reqs.find((x) => x.id === o.id)!;
      // Alle bisherigen Angaben unverändert, auch Zeitstempel und Nummer.
      expect(r).toMatchObject(o);
      expect(r).toMatchObject({ fe: MAIN_FE, also: [], parentId: null });
      expect(i).toBeGreaterThanOrEqual(0);
    }
    expect(p.menu.map((m) => [m.id, m.parent, m.u])).toEqual(old.menu.map((m) => [m.id, m.parent, m.u]));
    expect(p.menu.every((m) => m.fe === MAIN_FE && m.color === null)).toBe(true);
    expect(p.gone).toEqual({ rweg: 900 });
    expect(p.seq).toBe(5);
    // Ansichten arbeiten wie vorher.
    const ix = menuIndex(p);
    expect(ix.multi).toBe(false);
    expect(reqInfo(p, ix, p.reqs[1]).path).toBe("Admin / Benutzer / Rollen");
    expect(liveReqs(p).length).toBe(4);
  });

  it("werden auf zwei Geräten gleich umgestellt und führen sich ohne Verlust zusammen", () => {
    const a = normalizeProject(legacy()),
      b = normalizeProject(legacy());
    expect(sameProject(a, b)).toBe(true);
    // Erneutes Laden ändert nichts mehr.
    expect(sameProject(normalizeProject(clone(a)), a)).toBe(true);
    // Gerät A stellt um, Gerät B bearbeitet noch im alten Stand.
    const a2 = edit(a, 9000, (p) => rootsToFrontends(p));
    const b2 = edit(b, 9500, (p) => (p.reqs.find((r) => r.id === "r1")!.title = "Benutzer anlegen (neu)"));
    const m = mergeProject(a2, b2);
    expect(sameProject(m, mergeProject(b2, a2))).toBe(true);
    expect(m.feAsked).toBe(true);
    expect(m.frontends.map((f) => f.name)).toEqual(["Admin", "Kunde", "Dienstleister 1"]);
    expect(m.reqs.length).toBe(5);
    const r1 = m.reqs.find((r) => r.id === "r1")!;
    expect(r1.title).toBe("Benutzer anlegen (neu)");
    expect(m.frontends.find((f) => f.id === r1.fe)!.name).toBe("Admin");
  });

  it("lassen sich mit einem Klick auf Frontends umstellen", () => {
    const p = normalizeProject(legacy());
    rootsToFrontends(p);
    expect(p.feAsked).toBe(true);
    expect(p.frontends.map((f) => f.name)).toEqual(["Admin", "Kunde", "Dienstleister 1"]);
    const fe = (name: string) => p.frontends.find((f) => f.name === name)!.id;
    const ix = menuIndex(p);
    // Unterpunkte sind jetzt Hauptmenü ihres Frontends, tiefere Ebenen bleiben darunter.
    expect(ix.roots(fe("Admin")).map((m) => m.name)).toEqual(["Benutzer"]);
    expect(ix.kids("mA1").map((m) => m.name)).toEqual(["Rollen"]);
    expect(p.menu.find((m) => m.id === "mA2")!.fe).toBe(fe("Admin"));
    expect(ix.roots(fe("Kunde")).map((m) => m.name)).toEqual(["Verträge"]);
    expect(p.menu.some((m) => ["mA", "mK", "mD"].includes(m.id))).toBe(false);
    // Anforderungen: Menüpunkt bleibt, Frontend stimmt; direkt am Hauptpunkt = ohne Menüpunkt im neuen Frontend.
    const r = (id: string) => p.reqs.find((x) => x.id === id)!;
    expect([r("r1").menuId, r("r1").fe]).toEqual(["mA1", fe("Admin")]);
    expect([r("r2").menuId, r("r2").fe]).toEqual(["mA2", fe("Admin")]);
    expect([r("r3").menuId, r("r3").fe]).toEqual(["mK1", fe("Kunde")]);
    expect([r("r4").menuId, r("r4").fe]).toEqual([null, fe("Kunde")]);
    expect([r("r5").menuId, r("r5").fe, r("r5").deletedAt]).toEqual([null, fe("Dienstleister 1"), 5000]);
    expect(reqInfo(p, ix, r("r2")).path).toBe("Admin › Benutzer / Rollen");
    expect(keys(filterReqs(p, ix, { ...none, feId: fe("Kunde") }))).toEqual(["REQ-003", "REQ-004"]);
    expect(p.reqs.map((x) => x.key)).toEqual(["REQ-001", "REQ-002", "REQ-003", "REQ-004", "REQ-005"]);
  });

  it("fragen nicht nach, wenn es nichts umzustellen gibt, und auch nicht bei neuen Projekten", () => {
    const old = legacy();
    old.menu = [];
    old.reqs.forEach((r) => (r.menuId = null));
    expect(normalizeProject(old).feAsked).toBe(true);
    expect(emptyProject("Neu").feAsked).toBe(true);
    expect(demoProject().feAsked).toBe(true);
  });

  it("lassen sich auch als alte Exportdatei einlesen", () => {
    const old = legacy();
    const exp = { format: "anforderungskatalog-export-v1", exportedAt: "2026-10-04T12:00:00.000Z", project: old, files: { a1: "data:image/png;base64,AAECAw==" } };
    const { project: p, files } = importProject(exp, 7000);
    expect(p.reqs.length).toBe(5);
    expect(p.frontends.length).toBe(1);
    expect(p.menu.every((m) => m.fe === p.frontends[0].id)).toBe(true);
    expect(p.reqs.every((r) => r.fe === p.frontends[0].id)).toBe(true);
    expect(Object.keys(files).length).toBe(1);
    expect(p.reqs.find((r) => r.title === "Rollen vergeben")!.key).toBe("REQ-002");
  });
});

describe("Frontends", () => {
  const base = () => {
    const p = normalizeProject(legacy());
    rootsToFrontends(p);
    return p;
  };
  it("gliedern Liste, Tabelle und Übersicht", () => {
    const p = base();
    const ix = menuIndex(p);
    const g = groupByMenu(ix, liveReqs(p));
    expect(g.map((x) => [x.name, x.parentPath])).toEqual([
      ["Benutzer", "Admin"],
      ["Rollen", "Admin › Benutzer"],
      ["Verträge", "Kunde"],
      ["Ohne Menüpunkt", "Kunde"],
    ]);
    expect(tableHeaders(true).map((h) => h[1])).toContain("Frontend");
    expect(tableHeaders(false).map((h) => h[1])).not.toContain("Frontend");
    expect(keys(sortTable(p, ix, liveReqs(p), "fe", 1))).toEqual(["REQ-001", "REQ-002", "REQ-003", "REQ-004"]);
    expect(overview(p).frontends.map((f) => [f.name, f.p.total])).toEqual([["Admin", 2], ["Kunde", 2], ["Dienstleister 1", 0]]);
  });

  it("zeigen Anforderungen auch dort, wo sie zusätzlich betreffen", () => {
    const p = base();
    const [admin, kunde] = p.frontends;
    p.reqs.find((r) => r.id === "r1")!.also = [kunde.id, admin.id, "gibtsnicht"];
    tidy(p);
    const r1 = p.reqs.find((r) => r.id === "r1")!;
    expect(r1.also).toEqual([kunde.id]); // eigenes und unbekanntes Frontend fallen weg
    const ix = menuIndex(p);
    expect(keys(filterReqs(p, ix, { ...none, feId: kunde.id }))).toEqual(["REQ-001", "REQ-003", "REQ-004"]);
    expect(reqInfo(p, ix, r1).also).toEqual(["Kunde"]);
    // Im Fortschritt zählt sie nur in ihrem eigenen Frontend.
    expect(overview(p).frontends.map((f) => f.p.total)).toEqual([2, 2, 0]);
  });

  it("gliedern das Lastenheft oder grenzen es auf ein Frontend ein", () => {
    const p = base();
    const [admin, kunde] = p.frontends;
    p.reqs.find((r) => r.id === "r1")!.also = [kunde.id];
    const ix = menuIndex(p);
    const all = report(p, ix, "v1")!;
    expect(all.frontend).toBe("");
    expect(all.sections.map((s) => [s.name, s.phases[0].items.map((i) => i.info.r.key)])).toEqual([
      ["Admin", ["REQ-001", "REQ-002"]],
      ["Kunde", ["REQ-003", "REQ-004"]],
    ]);
    const k = report(p, ix, "v1", kunde.id)!;
    expect(k.frontend).toBe("Kunde");
    expect(k.total).toBe(3);
    expect(k.sections.length).toBe(1);
    expect(k.sections[0].phases[0].items.map((i) => i.info.r.key)).toEqual(["REQ-001", "REQ-003", "REQ-004"]);
    expect(report(p, ix, "v1", admin.id)!.total).toBe(2);
  });

  it("verlieren beim Löschen nichts", () => {
    const p = base();
    const [admin, kunde] = p.frontends;
    removeFrontend(p, kunde.id);
    expect(p.frontends.map((f) => f.name)).toEqual(["Admin", "Dienstleister 1"]);
    const ix = menuIndex(p);
    const node = ix.roots(admin.id).find((m) => m.name === "Kunde")!;
    expect(ix.kids(node.id).map((m) => m.name)).toEqual(["Verträge"]);
    expect(p.reqs.find((r) => r.id === "r4")!.menuId).toBe(node.id);
    expect(p.reqs.every((r) => p.frontends.some((f) => f.id === r.fe))).toBe(true);
    // Das letzte Frontend bleibt immer.
    removeFrontend(p, p.frontends[1].id);
    removeFrontend(p, p.frontends[0].id);
    expect(p.frontends.length).toBe(1);
  });

  it("werden zwischen Geräten abgeglichen, auch Farben", () => {
    const start = base();
    const a = edit(start, 9000, (p) => {
      p.frontends.push({ id: "fneu", name: "Dienstleister 2", o: 9, u: 0 });
      p.menu.find((m) => m.id === "mA1")!.color = "blau";
    });
    const b = edit(start, 9100, (p) => {
      p.frontends[0].name = "Admin-Frontend";
      p.menu.find((m) => m.id === "mK1")!.color = "rot";
    });
    const m = mergeProject(a, b);
    expect(sameProject(m, mergeProject(b, a))).toBe(true);
    expect(m.frontends.map((f) => f.name)).toEqual(["Admin-Frontend", "Kunde", "Dienstleister 1", "Dienstleister 2"]);
    expect(m.menu.find((x) => x.id === "mA1")!.color).toBe("blau");
    expect(m.menu.find((x) => x.id === "mK1")!.color).toBe("rot");
    const ix = menuIndex(m);
    expect(reqInfo(m, ix, m.reqs.find((r) => r.id === "r1")!).color).toBe("blau");
    expect(reqInfo(m, ix, m.reqs.find((r) => r.id === "r2")!).color).toBe(null); // keine Vererbung
    expect(groupByMenu(ix, liveReqs(m))[0].color).toBe("blau");
    // Unbekannte Farbwerte werden beim Laden verworfen.
    const raw = clone(m) as unknown as { menu: { color: string }[] };
    raw.menu[0].color = "neonbunt";
    expect(normalizeProject(raw).menu[0].color).toBe(null);
  });

  it("geben neuen Anforderungen ohne Menüpunkt das gewählte Frontend", () => {
    const p = base();
    const kunde = p.frontends[1];
    const r = newReq(p, null, kunde.id);
    tidy(p);
    expect(r.fe).toBe(kunde.id);
    const viaMenu = newReq(p, "mA1", kunde.id);
    tidy(p);
    expect(viaMenu.fe).toBe(p.frontends[0].id); // der Menüpunkt entscheidet
  });
});

describe("Teilanforderungen", () => {
  const withPartsProject = () => {
    const p = demoProject(1000);
    const big = p.reqs.find((r) => r.key === "REQ-007")!;
    const a = newPart(p, big.id, "Filter nach Zeitraum", 2000)!;
    const b = newPart(p, big.id, "Filter nach Status", 2001)!;
    return { p, big, a, b };
  };

  it("bekommen Unternummern und folgen dem Ort der großen Anforderung", () => {
    const { p, big, a, b } = withPartsProject();
    expect([a.key, b.key]).toEqual(["REQ-007.1", "REQ-007.2"]);
    expect([a.menuId, a.fe, a.prio, a.versionId, a.phaseId]).toEqual([big.menuId, big.fe, big.prio, big.versionId, big.phaseId]);
    expect(p.seq).toBe(11); // Teile verbrauchen keine laufende Nummer
    // Eigene Planung bleibt, der Ort folgt.
    a.versionId = null;
    a.phaseId = null;
    big.menuId = p.menu.find((m) => m.name === "Dashboard")!.id;
    tidy(p);
    expect(a.menuId).toBe(big.menuId);
    expect(a.versionId).toBe(null);
    expect(b.versionId).toBe(big.versionId);
  });

  it("erlauben nur eine Ebene", () => {
    const { p, big, a } = withPartsProject();
    expect(newPart(p, a.id, "Teil vom Teil")).toBe(null);
    const other = p.reqs.find((r) => r.key === "REQ-001")!;
    setParent(p, big.id, other.id); // hat selbst Teile
    expect(big.parentId).toBe(null);
    setParent(p, other.id, a.id); // Ziel ist selbst ein Teil
    expect(other.parentId).toBe(null);
    setParent(p, other.id, other.id);
    expect(other.parentId).toBe(null);
  });

  it("lassen sich nachträglich bilden und wieder herauslösen", () => {
    const { p, big } = withPartsProject();
    const pdf = p.reqs.find((r) => r.key === "REQ-008")!;
    setParent(p, pdf.id, big.id);
    expect(pdf.key).toBe("REQ-007.3");
    expect(pdf.menuId).toBe(big.menuId);
    setParent(p, pdf.id, null);
    expect(pdf.parentId).toBe(null);
    expect(pdf.key).toBe("REQ-012"); // neue eigene Nummer
    expect(new Set(p.reqs.map((r) => r.key)).size).toBe(p.reqs.length);
  });

  it("stehen in Liste und Lastenheft unter ihrer großen Anforderung", () => {
    const { p, big, a } = withPartsProject();
    a.prio = "C";
    const ix = menuIndex(p);
    const g = groupByMenu(ix, liveReqs(p)).find((x) => x.name === "Übersicht")!;
    expect(g.items.map((i) => [i.r.key, i.part])).toEqual([["REQ-007", false], ["REQ-007.1", true], ["REQ-007.2", true]]);
    // Ist die große Anforderung ausgefiltert, steht der Teil für sich.
    expect(withParts([a]).map((i) => [i.r.key, i.part])).toEqual([["REQ-007.1", false]]);
    const rep = report(p, ix, big.versionId!)!;
    const phase = rep.sections[0].phases.find((x) => x.items.some((i) => i.info.r.id === big.id))!;
    expect(phase.items.map((i) => [i.info.r.key, i.part])).toEqual([["REQ-001", false], ["REQ-007", false], ["REQ-007.1", true], ["REQ-007.2", true]]);
    // Nummern sortieren als Zahlen.
    for (let i = 0; i < 9; i++) newPart(p, big.id, "Teil " + i);
    expect(keys(sortTable(p, menuIndex(p), p.reqs.filter((r) => r.parentId === big.id), "key", 1)).slice(0, 3)).toEqual(["REQ-007.1", "REQ-007.2", "REQ-007.3"]);
    expect(keys(sortTable(p, menuIndex(p), p.reqs.filter((r) => r.parentId === big.id), "key", 1)).at(-1)).toBe("REQ-007.11");
  });

  it("zeigen Fortschritt und warnen bei „Erledigt“ trotz offener Teile", () => {
    const { p, big, a, b } = withPartsProject();
    const ix = menuIndex(p);
    a.status = "done";
    expect(reqInfo(p, ix, big)).toMatchObject({ partsDone: 1, partsWarn: false });
    big.status = "done";
    expect(reqInfo(p, ix, big).partsWarn).toBe(true);
    expect(overview(p).gaps.find((g) => g.key === "doneOpenParts")!.count).toBe(1);
    expect(keys(filterReqs(p, ix, { ...none, gap: "doneOpenParts" }))).toEqual(["REQ-007"]);
    b.prio = "W"; // Won’t-Teile halten nicht auf
    expect(reqInfo(p, ix, big).partsWarn).toBe(false);
    expect(overview(p).gaps.find((g) => g.key === "doneOpenParts")!.count).toBe(0);
    // Große Anforderung und Teile zählen einzeln.
    expect(overview(p).all.total).toBe(11);
  });

  it("werden beim Abgleich eindeutig nummeriert", () => {
    const { p, big } = withPartsProject();
    const a = edit(p, 3000, (d) => {
      newPart(d, big.id, "Von A", 3000);
    });
    const b = edit(p, 3100, (d) => {
      newPart(d, big.id, "Von B", 3100);
    });
    expect(a.reqs.find((r) => r.title === "Von A")!.key).toBe("REQ-007.3");
    expect(b.reqs.find((r) => r.title === "Von B")!.key).toBe("REQ-007.3");
    const m = mergeProject(a, b);
    expect(sameProject(m, mergeProject(b, a))).toBe(true);
    expect(m.reqs.find((r) => r.title === "Von A")!.key).toBe("REQ-007.3");
    expect(m.reqs.find((r) => r.title === "Von B")!.key).toBe("REQ-007.4");
    expect(sameProject(mergeProject(m, a), m)).toBe(true);
    // Wird die große Anforderung auf dem anderen Gerät endgültig gelöscht, werden die Teile eigenständig.
    const del = edit(m, 4000, (d) => {
      d.reqs = d.reqs.filter((r) => r.id !== big.id);
    });
    const orphans = del.reqs.filter((r) => r.title.startsWith("Filter") || r.title.startsWith("Von"));
    expect(orphans.every((r) => r.parentId === null && /^REQ-\d+$/.test(r.key))).toBe(true);
    expect(new Set(del.reqs.map((r) => r.key)).size).toBe(del.reqs.length);
  });
});
