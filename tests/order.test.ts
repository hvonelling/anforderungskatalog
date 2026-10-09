// Umsetzungsauftrag, Rückmeldung, Steckbrief, Status „Zu prüfen“ und Änderungserkennung.

import { describe, expect, it } from "vitest";
import { changedSinceImpl, clone, demoProject, mergeProject, newPart, normalizeProject, sameProject, stamp, tidy } from "../src/domain/model";
import { applyFeedback, buildOrder, FEEDBACK_FORMAT, orderMarkdown, parseFeedback, planOrder, previewFeedback, type Feedback } from "../src/domain/order";
import type { Project } from "../src/domain/types";
import { filterReqs, menuIndex, overview, reqInfo } from "../src/domain/view";
import { crc32, textBytes, zip } from "../src/storage/zip";

function edit(p: Project, now: number, fn: (d: Project) => void): Project {
  const d = clone(p);
  fn(d);
  tidy(d);
  stamp(p, d, now);
  return d;
}
const req = (p: Project, key: string) => p.reqs.find((r) => r.key === key)!;
/** Beispielprojekt; Phase 1 von v1.0 enthält REQ-002 (offen) und REQ-004 (erledigt). */
function setup() {
  const p = demoProject(1000);
  const v = p.versions[0];
  return { p, v, ph1: v.phases[0], ph2: v.phases[1] };
}

describe("Auftrag", () => {
  it("nimmt Offenes und In Arbeit auf, lässt Erledigtes und Won’t als Einordnung", () => {
    const { p, v, ph1, ph2 } = setup();
    req(p, "REQ-010").versionId = v.id;
    req(p, "REQ-010").phaseId = ph1.id; // Won’t
    const plan = planOrder(p, v.id, ph1.id);
    expect(plan.todo.map((r) => r.key)).toEqual(["REQ-002"]);
    expect(plan.done.map((r) => r.key)).toEqual(["REQ-004"]);
    expect(plan.wont.map((r) => r.key)).toEqual(["REQ-010"]);
    expect(planOrder(p, v.id, ph2.id).todo.map((r) => r.key).sort()).toEqual(["REQ-001", "REQ-007"]);
  });

  it("löst alle Verweise auf, sodass der Auftrag ohne das Tool verständlich ist", () => {
    const { p, v, ph1 } = setup();
    p.brief.tech = "TypeScript, Preact";
    p.brief.codePath = "C:\\Code\\Portal";
    req(p, "REQ-002").attachments.push({ id: "a1", name: "Skizze: Login?.png", type: "image/png", size: 3 });
    newPart(p, req(p, "REQ-002").id, "Login-Knopf");
    const o = buildOrder(p, v.id, ph1.id, Date.UTC(2026, 9, 9))!;
    expect(o.format).toBe("anforderungskatalog-auftrag-v1");
    expect(o.id).toMatch(/^auftrag-2026-10-09-[a-z0-9]{5}$/);
    expect(o.project).toEqual({ id: p.id, name: "Kundenportal (Beispiel)" });
    expect([o.version.name, o.phase.name]).toEqual(["v1.0", "Phase 1 · Grundgerüst"]);
    expect(o.brief.Technik).toBe("TypeScript, Preact");
    expect(o.briefMissing).toContain("Zweck");
    expect(o.briefMissing).not.toContain("Technik");
    expect(o.requirements.map((r) => r.key)).toEqual(["REQ-002", "REQ-002.1"]);
    const r = o.requirements[0];
    expect(r).toMatchObject({
      id: req(p, "REQ-002").id,
      title: "Anmeldung mit Firmenkonto (SSO)",
      frontend: "Kundenfrontend",
      menuPath: "Konto",
      priority: "Must",
      status: "Offen",
      userStory: "Als Mitarbeiter eines Firmenkunden möchte ich mich mit meinem Firmenkonto anmelden, damit ich kein separates Passwort brauche.",
      partOf: null,
      parts: ["REQ-002.1"],
      changedSince: null,
    });
    expect(r.criteria.map((c) => c.text)).toEqual(["Login-Button „Mit Firmenkonto anmelden“", "Abmeldung beendet auch die SSO-Sitzung"]);
    expect(r.criteria.every((c) => c.id)).toBe(true);
    expect(r.prerequisites).toEqual([
      { title: "SSO-Schnittstelle zum Identity Provider", type: "Technisch", done: false },
      { title: "Datenschutzfreigabe durch DSB", type: "Anwenderbezogen", done: true },
    ]);
    expect(r.attachments).toEqual([{ file: "anhaenge/REQ-002/01-Skizze_ Login_.png", name: "Skizze: Login?.png", type: "image/png" }]);
    expect(o.requirements[1].partOf).toBe("REQ-002");
    expect(o.context.alreadyImplemented).toEqual([{ key: "REQ-004", title: "Passwort ändern mit Stärkeanzeige", status: "Erledigt" }]);
    expect(o.context.otherPhases.map((x) => x.key)).toEqual(["REQ-001", "REQ-003", "REQ-007", "REQ-008"]);
    expect(buildOrder(p, v.id, "gibtsnicht")).toBe(null);
    // Papierkorb bleibt draußen.
    req(p, "REQ-002").deletedAt = 5;
    expect(buildOrder(p, v.id, ph1.id)!.requirements.map((x) => x.key)).toEqual(["REQ-002.1"]);
  });

  it("weist auf dünne Anforderungen hin", () => {
    const { p, v } = setup();
    const ph3 = v.phases[2];
    // REQ-003: Kriterium, aber keine Beschreibung. REQ-008: weder noch.
    expect(planOrder(p, v.id, ph3.id).thin).toEqual([
      { key: "REQ-003", missing: ["Beschreibung"] },
      { key: "REQ-008", missing: ["Beschreibung", "Akzeptanzkriterien"] },
    ]);
  });

  it("gibt es auch als lesbaren Text", () => {
    const { p, v, ph1 } = setup();
    const md = orderMarkdown(buildOrder(p, v.id, ph1.id)!);
    expect(md).toContain("# Umsetzungsauftrag: Kundenportal (Beispiel)");
    expect(md).toContain("### REQ-002 Anmeldung mit Firmenkonto (SSO)");
    expect(md).toContain("- [ ] Abmeldung beendet auch die SSO-Sitzung");
    expect(md).toContain("- SSO-Schnittstelle zum Identity Provider (Technisch, offen)");
    expect(md).toContain("**Technik:** _nicht angegeben_");
    expect(md).toContain("- REQ-004 Passwort ändern mit Stärkeanzeige (Erledigt)");
  });
});

describe("ZIP", () => {
  it("schreibt eine gültige, unkomprimierte ZIP-Datei", () => {
    expect(crc32(textBytes("123456789"))).toBe(0xcbf43926);
    const a = textBytes("{\"ä\":1}"),
      b = new Uint8Array([0, 255, 7]);
    const z = zip([{ path: "auftrag.json", bytes: a }, { path: "anhaenge/REQ-001/01-bild.png", bytes: b }], new Date(2026, 9, 9, 12, 0, 0));
    const dv = new DataView(z.buffer);
    expect(dv.getUint32(0, true)).toBe(0x04034b50);
    const end = z.length - 22;
    expect(dv.getUint32(end, true)).toBe(0x06054b50);
    expect(dv.getUint16(end + 10, true)).toBe(2);
    const cdOffset = dv.getUint32(end + 16, true);
    expect(dv.getUint32(cdOffset, true)).toBe(0x02014b50);
    expect(dv.getUint32(cdOffset + 16, true)).toBe(crc32(a));
    // Inhalt der ersten Datei steht unverändert hinter Kopf und Namen.
    expect([...z.subarray(30 + 12, 30 + 12 + a.length)]).toEqual([...a]);
    expect(z.length).toBe(30 + 12 + a.length + 30 + 28 + b.length + 46 + 12 + 46 + 28 + 22);
  });
});

describe("Rückmeldung", () => {
  const feedback = (p: Project, items: Feedback["items"]): Feedback => ({ format: FEEDBACK_FORMAT, orderId: "auftrag-2026-10-09-abcde", projectId: p.id, items });

  it("zeigt erst eine Vorschau und ändert dabei nichts", () => {
    const { p } = setup();
    const r = req(p, "REQ-002");
    const before = JSON.stringify(p);
    const f = feedback(p, [
      { id: r.id, status: "review", note: "SSO über OIDC gebaut.", criteriaDone: [r.criteria[0].id], update: { addCriteria: ["Fehlermeldung bei abgelaufener Sitzung"] } },
      { id: "gibtsnicht", key: "REQ-099", status: "review" },
    ]);
    const pre = previewFeedback(p, f);
    expect(JSON.stringify(p)).toBe(before);
    expect(pre.projectOk).toBe(true);
    expect(pre.unknown).toEqual(["REQ-099"]);
    expect(pre.changes).toEqual([
      { id: r.id, key: "REQ-002", title: r.title, statusFrom: "open", statusTo: "review", criteriaTicked: ["Login-Button „Mit Firmenkonto anmelden“"], criteriaAdded: ["Fehlermeldung bei abgelaufener Sitzung"], descChanged: false, note: "SSO über OIDC gebaut." },
    ]);
    expect(previewFeedback(demoProject(), f).projectOk).toBe(false);
  });

  it("überträgt Status, Kriterien, Ergänzungen und Notiz", () => {
    const { p } = setup();
    const r = req(p, "REQ-002");
    const n = applyFeedback(p, feedback(p, [{ id: r.id, status: "review", note: "Gebaut.", criteriaDone: [r.criteria[0].id], update: { description: "Anmeldung über OIDC.", addCriteria: ["Neu geklärt"] } }, { id: "weg" }]), 7000);
    expect(n).toBe(1);
    expect(r.status).toBe("review");
    expect(r.desc).toBe("Anmeldung über OIDC.");
    expect(r.criteria.map((c) => [c.text, c.done])).toEqual([["Login-Button „Mit Firmenkonto anmelden“", true], ["Abmeldung beendet auch die SSO-Sitzung", false], ["Neu geklärt", false]]);
    expect(r.impl).toMatchObject({ at: 7000, order: "auftrag-2026-10-09-abcde", note: "Gebaut." });
    expect(r.impl!.snap.criteria.length).toBe(3);
    expect(r.history[0]).toMatchObject({ from: "Rückmeldung", to: "Zu prüfen: Gebaut." });
    expect(changedSinceImpl(r)).toBe(false);
  });

  it("setzt nie selbst auf Erledigt und vermerkt Teilweises ohne Umsetzungsstand", () => {
    const { p } = setup();
    const a = req(p, "REQ-002"),
      b = req(p, "REQ-001");
    const f = parseFeedback({ format: FEEDBACK_FORMAT, orderId: "x", projectId: p.id, items: [{ id: a.id, status: "done" }, { id: b.id, status: "wip", note: "Kachel 3 fehlt noch." }, { id: 5 }, "quatsch"] });
    expect(f.items.length).toBe(2);
    expect(f.items[0].status).toBe("review");
    applyFeedback(p, f, 8000);
    expect(a.status).toBe("review");
    expect(b.status).toBe("wip");
    expect(b.impl).toBe(null);
    expect(b.history[0].to).toBe("In Arbeit: Kachel 3 fehlt noch.");
    expect(() => parseFeedback({ format: "anders", items: [] })).toThrow("keine Rückmeldung");
    expect(() => parseFeedback(null)).toThrow();
  });
});

describe("Geändert seit Umsetzung", () => {
  it("erkennt inhaltliche Änderungen, nicht aber Status oder Planung", () => {
    const { p, v, ph1 } = setup();
    const r = req(p, "REQ-002");
    applyFeedback(p, { format: FEEDBACK_FORMAT, orderId: "o1", projectId: p.id, items: [{ id: r.id, status: "review", note: "fertig" }] }, 7000);
    expect(planOrder(p, v.id, ph1.id).todo).toEqual([]);
    r.status = "done";
    r.prio = "S";
    r.criteria[0].done = true;
    expect(changedSinceImpl(r)).toBe(false);
    r.criteria.push({ id: "cneu", text: "Auch mit Passkey", done: false });
    expect(changedSinceImpl(r)).toBe(true);
    const ix = menuIndex(p);
    expect(reqInfo(p, ix, r).changed).toBe(true);
    expect(overview(p).gaps.find((g) => g.key === "changed")!.count).toBe(1);
    expect(filterReqs(p, ix, { menuId: null, prio: "", status: "", search: "", gap: "changed" }).map((x) => x.key)).toEqual(["REQ-002"]);
    // Der nächste Auftrag nimmt sie wieder auf und stellt den alten Stand daneben.
    const o = buildOrder(p, v.id, ph1.id)!;
    expect(o.requirements.map((x) => x.key)).toEqual(["REQ-002"]);
    expect(o.requirements[0].changedSince).toMatchObject({ implementedAt: "1970-01-01T00:00:07.000Z", note: "fertig" });
    expect(o.requirements[0].changedSince!.before.criteria.length).toBe(2);
    expect(orderMarkdown(o)).toContain("Geändert seit der Umsetzung vom 1970-01-01");
    // Nach erneuter Umsetzung gilt der neue Stand.
    applyFeedback(p, { format: FEEDBACK_FORMAT, orderId: "o2", projectId: p.id, items: [{ id: r.id, status: "review" }] }, 9000);
    expect(changedSinceImpl(r)).toBe(false);
    expect(r.impl!.order).toBe("o2");
  });
});

describe("Steckbrief und neuer Status im Abgleich", () => {
  it("führt den Steckbrief als Ganzes zusammen, der jüngere gewinnt", () => {
    const base = demoProject(1000);
    const a = edit(base, 2000, (p) => (p.brief.tech = "A"));
    const b = edit(base, 3000, (p) => (p.brief.hosting = "B"));
    expect(a.brief.u).toBe(2000);
    expect(a.reqs.every((r) => r.u < 2000)).toBe(true);
    const m = mergeProject(a, b);
    expect(sameProject(m, mergeProject(b, a))).toBe(true);
    expect([m.brief.tech, m.brief.hosting]).toEqual(["", "B"]);
  });

  it("zählt „Zu prüfen“ getrennt und hält es über Speichern und Laden", () => {
    const p = demoProject(1000);
    req(p, "REQ-002").status = "review";
    expect(overview(p).all).toMatchObject({ open: 6, wip: 2, review: 1, done: 1 });
    const again = normalizeProject(JSON.parse(JSON.stringify(p)));
    expect(req(again, "REQ-002").status).toBe("review");
    expect(sameProject(again, p)).toBe(true);
  });

  it("ergänzt Stände ohne Steckbrief und Umsetzungsvermerk beim Laden", () => {
    const raw = JSON.parse(JSON.stringify(demoProject(1000)));
    delete raw.brief;
    raw.reqs.forEach((r: Record<string, unknown>) => delete r.impl);
    const p = normalizeProject(raw);
    expect(p.brief).toMatchObject({ purpose: "", codePath: "", u: 0 });
    expect(p.reqs.every((r) => r.impl === null)).toBe(true);
    expect(p.reqs.length).toBe(11);
  });
});
