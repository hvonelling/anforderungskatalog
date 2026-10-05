import { describe, expect, it } from "vitest";
import { clone, demoProject, emptyProject, importProject, mergeProject, moveReq, newReq, nextOrder, normalizeProject, sameProject, stamp, uid, unplan } from "../src/domain/model";
import type { Project } from "../src/domain/types";

/** Änderung wie in der App: kopieren, ändern, stempeln. */
function edit(p: Project, now: number, fn: (d: Project) => void): Project {
  const d = clone(p);
  fn(d);
  stamp(p, d, now);
  return d;
}

describe("Stempeln", () => {
  it("stempelt nur geänderte Datensätze", () => {
    const p = demoProject(1000);
    const d = edit(p, 2000, (x) => {
      x.reqs[0].title = "Neu";
    });
    expect(d.reqs[0].u).toBe(2000);
    expect(d.reqs[1].u).toBe(1000);
    expect(d.menu.every((m) => m.u === 1000)).toBe(true);
    expect(d.u).toBe(1000);
  });
  it("vermerkt gelöschte Datensätze und Phasen", () => {
    const p = demoProject(1000);
    const phase = p.versions[0].phases[0].id;
    const d = edit(p, 2000, (x) => {
      x.versions[0].phases.shift();
      x.prereqs.pop();
    });
    expect(d.gone[phase]).toBe(2000);
    expect(d.gone[p.prereqs[p.prereqs.length - 1].id]).toBe(2000);
    expect(d.versions[0].u).toBe(1000); // die Version selbst ist unverändert
  });
  it("stempelt das Projekt bei Umbenennung", () => {
    const p = demoProject(1000);
    expect(edit(p, 2000, (x) => (x.name = "Anders")).u).toBe(2000);
  });
});

describe("Zusammenführen", () => {
  it("übernimmt je Datensatz den neueren Stand, in beiden Richtungen gleich", () => {
    const base = demoProject(1000);
    const a = edit(base, 2000, (x) => {
      x.reqs[0].title = "A-Titel";
      x.reqs[1].status = "done";
    });
    const b = edit(base, 3000, (x) => {
      x.reqs[0].title = "B-Titel";
      x.prereqs[0].done = true;
    });
    const ab = mergeProject(a, b),
      ba = mergeProject(b, a);
    expect(sameProject(ab, ba)).toBe(true);
    expect(ab.reqs.find((r) => r.id === base.reqs[0].id)!.title).toBe("B-Titel");
    expect(ab.reqs.find((r) => r.id === base.reqs[1].id)!.status).toBe("done");
    expect(ab.prereqs.find((q) => q.id === base.prereqs[0].id)!.done).toBe(true);
  });
  it("ist stabil: Zusammenführen mit sich selbst ändert nichts", () => {
    const p = demoProject(1000);
    expect(sameProject(mergeProject(p, p), p)).toBe(true);
    const m = mergeProject(p, edit(p, 2000, (x) => (x.reqs[2].desc = "x")));
    expect(sameProject(mergeProject(m, p), m)).toBe(true);
  });
  it("lässt Gelöschtes gelöscht, auch wenn das andere Gerät den alten Stand hat", () => {
    const base = demoProject(1000);
    const victim = base.reqs[3].id;
    const a = edit(base, 2000, (x) => {
      x.reqs = x.reqs.filter((r) => r.id !== victim);
    });
    const m = mergeProject(base, a);
    expect(m.reqs.some((r) => r.id === victim)).toBe(false);
    expect(sameProject(mergeProject(a, base), m)).toBe(true);
  });
  it("behält einen Datensatz, der nach der Löschung noch geändert wurde", () => {
    const base = demoProject(1000);
    const id = base.prereqs[0].id;
    const a = edit(base, 2000, (x) => {
      x.prereqs = x.prereqs.filter((q) => q.id !== id);
    });
    const b = edit(base, 3000, (x) => {
      x.prereqs[0].title = "Später geändert";
    });
    expect(mergeProject(a, b).prereqs.find((q) => q.id === id)?.title).toBe("Später geändert");
  });
  it("führt neue Datensätze beider Geräte in fester Reihenfolge zusammen", () => {
    const base = demoProject(1000);
    const a = edit(base, 2000, (x) => x.menu.push({ id: "mA", name: "Von A", parent: null, fe: null, color: null, o: nextOrder(x.menu), u: 0 }));
    const b = edit(base, 2100, (x) => x.menu.push({ id: "mB", name: "Von B", parent: null, fe: null, color: null, o: nextOrder(x.menu), u: 0 }));
    const ab = mergeProject(a, b),
      ba = mergeProject(b, a);
    expect(ab.menu.map((m) => m.id)).toEqual(ba.menu.map((m) => m.id));
    expect(ab.menu.slice(-2).map((m) => m.id)).toEqual(["mA", "mB"]);
  });
  it("führt Phasen einer Version zusammen", () => {
    const base = demoProject(1000);
    const a = edit(base, 2000, (x) => x.versions[0].phases.push({ id: "pA", name: "Phase A", o: nextOrder(x.versions[0].phases), u: 0 }));
    const b = edit(base, 2100, (x) => {
      x.versions[0].name = "v1.0 final";
      x.versions[0].phases[0].name = "Umbenannt";
    });
    const m = mergeProject(a, b);
    expect(m.versions[0].name).toBe("v1.0 final");
    expect(m.versions[0].phases.map((p) => p.name)).toEqual(["Umbenannt", "Phase 2 · Kernfunktionen", "Phase 3 · Feinschliff", "Phase A"]);
  });
  it("vergibt bei doppelter Nummer eine neue für die jüngere Anforderung", () => {
    const base = demoProject(1000);
    const a = edit(base, 2000, (x) => {
      newReq(x, null, null, 2000).title = "Von A";
    });
    const b = edit(base, 3000, (x) => {
      newReq(x, null, null, 3000).title = "Von B";
    });
    expect(a.reqs.at(-1)!.key).toBe("REQ-012");
    expect(b.reqs.at(-1)!.key).toBe("REQ-012");
    const ab = mergeProject(a, b),
      ba = mergeProject(b, a);
    const keys = (p: Project) => Object.fromEntries(p.reqs.map((r) => [r.title, r.key]));
    expect(keys(ab)["Von A"]).toBe("REQ-012");
    expect(keys(ab)["Von B"]).toBe("REQ-013");
    expect(new Set(ab.reqs.map((r) => r.key)).size).toBe(ab.reqs.length);
    expect(sameProject(ab, ba)).toBe(true);
    expect(ab.seq).toBe(13);
    // Ein weiterer Abgleich ändert daran nichts mehr.
    expect(sameProject(mergeProject(ab, b), ab)).toBe(true);
  });
  it("hängt Menüpunkte ohne Elternknoten an die Wurzel", () => {
    const base = demoProject(1000);
    const konto = base.menu.find((m) => m.name === "Konto")!;
    const a = edit(base, 2000, (x) => {
      x.menu = x.menu.filter((m) => m.id !== konto.id);
    });
    const m = mergeProject(base, a);
    expect(m.menu.find((x) => x.name === "Profil")!.parent).toBe(null);
  });
  it("übernimmt Papierkorb und Projektlöschung", () => {
    const base = demoProject(1000);
    const a = edit(base, 2000, (x) => (x.reqs[0].deletedAt = 2000));
    expect(mergeProject(base, a).reqs.find((r) => r.id === base.reqs[0].id)!.deletedAt).toBe(2000);
    const del = edit(base, 5000, (x) => (x.deletedAt = 5000));
    const m = mergeProject(a, del);
    expect(m.deletedAt).toBe(5000);
    expect(m.reqs).toEqual([]);
  });
});

describe("Verschieben", () => {
  it("vermerkt jede Verschiebung im Verlauf", () => {
    const p = demoProject(1000);
    const r = p.reqs.find((x) => x.key === "REQ-009")!;
    const v = p.versions[0];
    moveReq(p, r.id, v.id, v.phases[1].id, Date.UTC(2026, 9, 4));
    expect(r.versionId).toBe(v.id);
    expect(r.history[0]).toMatchObject({ from: "Nicht eingeplant", to: "v1.0 · Phase 2 · Kernfunktionen" });
    moveReq(p, r.id, v.id, v.phases[1].id);
    expect(r.history.length).toBe(1);
  });
  it("setzt beim Löschen einer Phase auf nicht eingeplant", () => {
    const p = demoProject(1000);
    const v = p.versions[0];
    const n = p.reqs.filter((r) => r.phaseId === v.phases[0].id).length;
    unplan(p, (r) => r.versionId === v.id && r.phaseId === v.phases[0].id);
    expect(n).toBeGreaterThan(0);
    expect(p.reqs.filter((r) => r.history[0]?.to === "Nicht eingeplant" && r.versionId === null).length).toBe(n);
  });
});

describe("Import", () => {
  it("liest den Export des Prototyps samt Anhang und vergibt neue Kennungen", () => {
    const proto = {
      product: "Kundenportal",
      seq: 2,
      menu: [{ id: "m1", name: "Dashboard", parent: null }, { id: "m2", name: "Kacheln", parent: "m1" }],
      versions: [{ id: "v1", name: "v1.0", phases: [{ id: "p1", name: "Phase 1" }] }],
      prereqs: [{ id: "q1", title: "API", type: "tech", done: true }],
      reqs: [
        { id: "r1", key: "REQ-001", title: "Eins", menuId: "m2", prio: "M", status: "wip", versionId: "v1", phaseId: "p1", prereqIds: ["q1"], desc: "", story: { role: "", goal: "", benefit: "" }, criteria: [{ id: "c1", text: "ok", done: true }], attachments: [{ id: "a1", name: "bild.png", type: "image/png", url: "data:image/png;base64,AAECAw==" }], history: [] },
        { id: "r2", key: "REQ-002", title: "Zwei", menuId: null, prio: "X", status: "?", versionId: null, phaseId: null, prereqIds: [], desc: "", criteria: [], attachments: [], history: [] },
      ],
    };
    const { project: p, files } = importProject(proto, 5000);
    expect(p.name).toBe("Kundenportal");
    expect(p.reqs.map((r) => r.key)).toEqual(["REQ-001", "REQ-002"]);
    const r = p.reqs[0];
    expect(r.id).not.toBe("r1");
    expect(p.menu.find((m) => m.id === r.menuId)!.name).toBe("Kacheln");
    expect(p.menu.find((m) => m.name === "Kacheln")!.parent).toBe(p.menu.find((m) => m.name === "Dashboard")!.id);
    expect(p.versions[0].phases[0].id).toBe(r.phaseId);
    expect(p.prereqs[0].id).toBe(r.prereqIds[0]);
    expect(r.attachments[0]).toMatchObject({ name: "bild.png", size: 4 });
    expect(files[r.attachments[0].id]).toBe("data:image/png;base64,AAECAw==");
    expect(p.reqs[1].prio).toBe("S");
    expect(p.reqs[1].status).toBe("open");
    // Ein zweiter Import derselben Datei ergibt ein eigenes Projekt.
    expect(importProject(proto, 6000).project.id).not.toBe(p.id);
  });
  it("lehnt fremde Dateien ab", () => {
    expect(() => importProject({ tx: [] })).toThrow();
    expect(() => normalizeProject(null)).toThrow();
  });
  it("erzeugt eindeutige Kennungen", () => {
    expect(new Set(Array.from({ length: 500 }, () => uid("r"))).size).toBe(500);
    expect(emptyProject("X").reqs).toEqual([]);
  });
});
