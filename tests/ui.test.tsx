// @vitest-environment jsdom
// Die Oberfläche als Ganzes: zeichnen, klicken, tippen und prüfen, was ankommt.

import { render } from "preact";
import { act } from "preact/test-utils";
import { beforeAll, describe, expect, it } from "vitest";
import { Store, store } from "../src/app/store";
import { memoryBlobs } from "../src/storage/blobs";
import { App } from "../src/ui/App";

const root = document.createElement("div");
document.body.appendChild(root);
const $ = (sel: string) => root.querySelector(sel) as HTMLElement | null;
const $$ = (sel: string) => [...root.querySelectorAll(sel)] as HTMLElement[];
const text = () => root.textContent ?? "";
const byText = (sel: string, t: string) => $$(sel).find((e) => (e.textContent ?? "").includes(t))!;
const click = (el: Element) =>
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
const type = (el: HTMLInputElement | HTMLTextAreaElement, v: string) =>
  act(() => {
    el.value = v;
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
const req = (key: string) => store.project!.reqs.find((r) => r.key === key)!;

beforeAll(async () => {
  store.blobs = memoryBlobs();
  await act(() => render(<App />, root));
});

describe("Oberfläche", () => {
  it("begrüßt ohne Projekt und lädt das Beispiel", async () => {
    expect(text()).toContain("Anforderungskatalog");
    expect(text()).toContain("Abgleich einrichten");
    await click(byText("button", "Beispielprojekt laden"));
    expect(store.project!.name).toBe("Kundenportal (Beispiel)");
    expect(text()).toContain("Fortschritt je Version und Phase");
    expect(text()).toContain("Lücken im Katalog");
    expect($$(".prog.head").length).toBe(3); // v1.0, v1.1, nicht eingeplant
  });

  it("führt von einer Lücke zur gefilterten Liste", async () => {
    await click(byText(".gap-row", "Ohne Beschreibung"));
    expect(store.view).toBe("liste");
    expect($$(".row").length).toBe(3);
    expect(text()).toContain("Ohne Beschreibung ×");
    await click(byText(".chip", "Ohne Beschreibung ×"));
    expect($$(".row").length).toBe(11);
  });

  it("filtert über Menübaum, Priorität und Suche", async () => {
    await click(byText(".node", "Konto"));
    expect($$(".row").length).toBe(5);
    await click(byText(".filters .chip", "M"));
    expect($$(".row").length).toBe(2);
    await click($$(".filters .set")[0].querySelector(".chip")!);
    await click($(".node.all")!);
    await type($(".search input") as HTMLInputElement, "pdf");
    expect($$(".row").length).toBe(1);
    await type($(".search input") as HTMLInputElement, "");
  });

  it("öffnet das Detail und speichert Eingaben", async () => {
    await click(byText(".row", "REQ-008"));
    expect($(".drawer")).not.toBeNull();
    await type($(".title-input") as HTMLTextAreaElement, "Bestellung als PDF laden");
    expect(req("REQ-008").title).toBe("Bestellung als PDF laden");
    await click(byText(".drawer .seg button", "Erledigt"));
    expect(req("REQ-008").status).toBe("done");
    await click(byText(".drawer .prio-seg button", "M"));
    expect(req("REQ-008").prio).toBe("M");
    const crit = $(".drawer input[placeholder^='Neues Kriterium']") as HTMLInputElement;
    await type(crit, "PDF enthält Bestellnummer");
    await act(() => void crit.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    expect(req("REQ-008").criteria.map((c) => c.text)).toEqual(["PDF enthält Bestellnummer"]);
    // Version wechseln schreibt in den Verlauf
    const selects = $$(".drawer select") as HTMLSelectElement[];
    const v2 = store.project!.versions[1];
    await act(() => {
      selects[1].value = v2.id;
      selects[1].dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(req("REQ-008").versionId).toBe(v2.id);
    expect(req("REQ-008").history[0].to).toBe("v1.1 · Phase 1");
    expect($(".drawer")!.textContent).toContain("→ v1.1 · Phase 1");
    expect(req("REQ-008").u).toBeGreaterThan(req("REQ-001").u);
  });

  it("legt Voraussetzungen aus dem Detail an und verknüpft sie", async () => {
    const pre = $(".drawer input[placeholder='Neue Voraussetzung anlegen']") as HTMLInputElement;
    await type(pre, "PDF-Dienst lizenziert");
    await click(byText(".drawer .chip", "Anwender"));
    const q = store.project!.prereqs.find((x) => x.title === "PDF-Dienst lizenziert")!;
    expect(q.type).toBe("user");
    expect(req("REQ-008").prereqIds).toContain(q.id);
    expect($(".drawer")!.textContent).toContain("0/1 erfüllt");
  });

  it("legt Anhänge ab und entfernt sie wieder", async () => {
    const file = new File([new Uint8Array([1, 2, 3])], "skizze.png", { type: "image/png" });
    Object.defineProperty(file, "arrayBuffer", { value: async () => new Uint8Array([1, 2, 3]).buffer });
    await act(() => store.addFiles(req("REQ-008").id, [file]));
    const a = req("REQ-008").attachments[0];
    expect(a).toMatchObject({ name: "skizze.png", size: 3 });
    expect(await store.blobs.has(a.id)).toBe(true);
    await act(async () => store.removeAttachment(req("REQ-008").id, a.id));
    expect(req("REQ-008").attachments).toEqual([]);
    expect(await store.blobs.has(a.id)).toBe(false);
  });

  it("legt in den Papierkorb und stellt wieder her", async () => {
    await click(byText(".drawer button", "In den Papierkorb"));
    expect($(".drawer")).toBeNull();
    expect($$(".row").length).toBe(10);
    expect(text()).toContain("Papierkorb · 1");
    await click(byText(".side-foot button", "Papierkorb"));
    expect($(".dialog")!.textContent).toContain("REQ-008");
    await click(byText(".dialog button", "Wiederherstellen"));
    expect($$(".row").length).toBe(11);
    await click($(".dialog .icon-btn")!);
  });

  it("verschiebt Karten auf dem Board", async () => {
    await click(byText(".tab", "Board"));
    expect($$(".col .col-head").map((c) => c.firstElementChild!.textContent)).toEqual(["Nicht eingeplant", "Phase 1 · Grundgerüst", "Phase 2 · Kernfunktionen", "Phase 3 · Feinschliff"]);
    const r = req("REQ-009");
    const target = $$(".col")[2];
    await act(() => {
      store.set({ dragId: r.id });
      const ev = new Event("drop", { bubbles: true, cancelable: true });
      target.dispatchEvent(ev);
    });
    expect(req("REQ-009").phaseId).toBe(store.project!.versions[0].phases[1].id);
    expect(req("REQ-009").history[0]).toMatchObject({ from: "Nicht eingeplant", to: "v1.0 · Phase 2 · Kernfunktionen" });
    expect($$(".col")[2].querySelectorAll(".card").length).toBe(3);
  });

  it("sortiert die Tabelle per Klick auf die Spalte", async () => {
    await click(byText(".tab", "Tabelle"));
    expect($$("table.t tbody tr").length).toBe(11);
    await click(byText("table.t th", "ID"));
    expect($$("table.t tbody tr")[0].textContent).toContain("REQ-011");
  });

  it("pflegt Versionen, Phasen und Menüpunkte", async () => {
    await click(byText(".actions button", "Versionen"));
    await click(byText(".dialog button", "+ Version"));
    expect(store.project!.versions.length).toBe(3);
    const v1 = store.project!.versions[0];
    const before = store.project!.reqs.filter((r) => r.versionId === v1.id && r.phaseId === v1.phases[0].id).length;
    await click($$(".dialog .vbox")[0].querySelectorAll(".icon-btn")[0]);
    expect(store.project!.versions[0].phases.length).toBe(2);
    expect(store.project!.reqs.filter((r) => r.history[0]?.to === "Nicht eingeplant").length).toBe(before);
    await click($(".dialog-head .icon-btn")!);

    await click(byText(".side-head button", "+ Menü"));
    const input = $(".tree input") as HTMLInputElement;
    await type(input, "Hilfe");
    await act(() => void input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    expect(store.project!.menu.at(-1)!.name).toBe("Hilfe");
    const konto = store.project!.menu.find((m) => m.name === "Konto")!;
    await act(() => store.removeMenu(konto.id));
    expect(store.project!.menu.some((m) => m.name === "Profil")).toBe(false);
    expect(req("REQ-002").menuId).toBe(null);
  });

  it("zeigt das Lastenheft der Version", async () => {
    await click(byText(".actions button", "Lastenheft"));
    const paper = $(".paper")!;
    expect(paper.textContent).toContain("Kundenportal (Beispiel)");
    expect(paper.textContent).toContain("Version v1.0");
    expect(paper.textContent).toContain("Als Kundin möchte ich");
    await click(byText(".report-bar button", "Schließen"));
    expect($(".report")).toBeNull();
  });

  it("zeigt am Handy statt Board und Tabelle die Liste", async () => {
    await act(() => store.set({ mobile: true, view: "board" }));
    expect($(".board")).toBeNull();
    expect($(".list")).not.toBeNull();
    await act(() => store.set({ mobile: false, view: "liste" }));
  });

  it("verwaltet mehrere Projekte und behält alles nach dem Neustart", async () => {
    await act(() => store.createProject("Zweites Projekt"));
    expect(store.visible().map((p) => p.name)).toEqual(["Kundenportal (Beispiel)", "Zweites Projekt"]);
    await click(byText(".actions button", "+ Anforderung"));
    await type($(".title-input") as HTMLTextAreaElement, "Erste Anforderung");
    expect(store.project!.reqs[0]).toMatchObject({ key: "REQ-001", title: "Erste Anforderung" });

    const again = new Store();
    expect(again.visible().length).toBe(2);
    expect(again.project!.name).toBe("Zweites Projekt");
    expect(again.project!.reqs[0].title).toBe("Erste Anforderung");
    const demo = again.visible()[0];
    expect(demo.reqs.find((r) => r.key === "REQ-008")!.title).toBe("Bestellung als PDF laden");
    expect(again.meta.dirty.sort()).toEqual(again.visible().map((p) => p.id).sort());

    const id = store.project!.id;
    await act(() => store.deleteProject(id));
    expect(store.visible().length).toBe(1);
    expect(store.project!.name).toBe("Kundenportal (Beispiel)");
    expect(new Store().visible().length).toBe(1);
  });

  it("fragt bei einem Projekt aus der Zeit vor dem Update einmal nach Frontends", async () => {
    // Ein Stand, wie ihn die App vor dem Update gespeichert hat: ohne Frontends, Farben und Teile.
    const req = (n: number, title: string, menuId: string) => ({
      id: "r" + n, key: "REQ-00" + n, title, menuId, prio: "M", status: "open", versionId: "v1", phaseId: "p1", prereqIds: [], desc: "", story: { role: "", goal: "", benefit: "" },
      criteria: [], attachments: [], history: [], createdAt: 1000 + n, deletedAt: null, u: 2000 + n,
    });
    const old = {
      format: 1, id: "jalt", name: "Energieportal", seq: 3,
      menu: [
        { id: "mA", name: "Admin", parent: null, o: 0, u: 1 },
        { id: "mK", name: "Kunde", parent: null, o: 1, u: 1 },
        { id: "mA1", name: "Benutzer", parent: "mA", o: 2, u: 1 },
        { id: "mK1", name: "Verträge", parent: "mK", o: 3, u: 1 },
      ],
      versions: [{ id: "v1", name: "v1.0", o: 0, u: 1, phases: [{ id: "p1", name: "Phase 1", o: 0, u: 1 }] }],
      prereqs: [], reqs: [req(1, "Benutzer anlegen", "mA1"), req(2, "Vertrag ansehen", "mK1"), req(3, "Vertrag kündigen", "mK1")],
      gone: {}, createdAt: 1, deletedAt: null, u: 1,
    };
    const file = new File(["x"], "alt.json");
    Object.defineProperty(file, "text", { value: async () => JSON.stringify(old) });
    await act(() => store.importFile(file));
    expect(store.project!.name).toBe("Energieportal");
    expect(store.project!.reqs.length).toBe(3);
    expect($(".dialog")!.textContent).toContain("Neu: Frontends");
    expect($(".dialog")!.textContent).toContain("Admin · Kunde");
    await click(byText(".dialog button", "Ja, als Frontends übernehmen"));
    expect($(".dialog")).toBeNull();
    expect(store.project!.frontends.map((f) => f.name)).toEqual(["Admin", "Kunde"]);
    expect($$(".fe-tabs .chip").map((c) => c.textContent)).toEqual(["Alle", "Admin", "Kunde", "+"]);
    expect($$(".fe-head").map((c) => c.firstElementChild!.textContent)).toEqual(["Admin", "Kunde"]);
    expect($$(".row").length).toBe(3);
    // Die Frage kommt nach einem Neustart nicht wieder.
    expect(new Store().project!.feAsked).toBe(true);
  });

  it("filtert über die Frontend-Reiter und pflegt Frontends", async () => {
    await click(byText(".fe-tabs .chip", "Kunde"));
    expect($$(".row").length).toBe(2);
    expect($(".filters .scope b")!.textContent).toContain("Kunde");
    expect($$(".tree .node").map((n) => n.querySelector(".grow")!.textContent)).toEqual(["Alles in Kunde", "Verträge"]);
    // Neue Anforderung landet im gewählten Frontend.
    await click(byText(".actions button", "+ Anforderung"));
    const kunde = store.project!.frontends[1].id;
    expect(store.project!.reqs.at(-1)!.fe).toBe(kunde);
    // „Betrifft auch“ zeigt sie zusätzlich im anderen Frontend.
    await type($(".title-input") as HTMLTextAreaElement, "Ticket melden");
    await click(byText(".drawer .hrow .chip", "Admin"));
    expect(store.project!.reqs.at(-1)!.also).toEqual([store.project!.frontends[0].id]);
    await click($(".drawer-head .icon-btn")!);
    await click(byText(".fe-tabs .chip", "Admin"));
    expect($$(".row").map((r) => r.querySelector(".title")!.textContent)).toEqual(["Benutzer anlegen", "Ticket melden"]);
    // Frontend anlegen, benennen, löschen
    await click(byText(".fe-tabs .chip", "+"));
    const input = $(".fe-tabs input") as HTMLInputElement;
    await type(input, "Dienstleister 1");
    await act(() => void input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    expect(store.project!.frontends.map((f) => f.name)).toEqual(["Admin", "Kunde", "Dienstleister 1"]);
    await click(byText(".side-head button", "+ Menü"));
    const neu = store.project!.menu.at(-1)!;
    expect(neu.fe).toBe(store.project!.frontends[2].id);
    await act(() => store.commitMenu());
    const orig = globalThis.confirm;
    globalThis.confirm = () => true;
    await click(byText(".fe-actions button", "Löschen"));
    globalThis.confirm = orig;
    expect(store.project!.frontends.map((f) => f.name)).toEqual(["Admin", "Kunde"]);
    // Der Menüpunkt des gelöschten Frontends hängt jetzt unter „Dienstleister 1“ im ersten Frontend.
    const host = store.project!.menu.find((m) => m.name === "Dienstleister 1")!;
    expect(host.fe).toBe(store.project!.frontends[0].id);
    expect(store.project!.menu.find((m) => m.id === neu.id)!.parent).toBe(host.id);
  });

  it("färbt Menüpunkte und zeigt die Farbe in Liste, Board und Tabelle", async () => {
    await click(byText(".fe-tabs .chip", "Alle"));
    await click(byText(".tree .node", "Verträge"));
    await click($(".node.on button[title='Farbe wählen']")!);
    expect($$(".palette .swatch").length).toBe(9);
    await click($(".palette .swatch.c-blau")!);
    expect(store.project!.menu.find((m) => m.name === "Verträge")!.color).toBe("blau");
    expect($(".palette")).toBeNull();
    expect($(".node.on .cdot.c-blau")).not.toBeNull();
    expect($(".group-head.colored.c-blau")).not.toBeNull();
    expect($$(".row.colored.c-blau").length).toBe(2);
    await click(byText(".tab", "Board"));
    expect($$(".card.colored.c-blau").length).toBe(2);
    await click(byText(".tab", "Tabelle"));
    expect($$("table.t .cdot.c-blau").length).toBe(2);
    expect($$("table.t th").map((h) => h.textContent!.trim().replace(/ .*/, ""))).toContain("Frontend");
    await click(byText(".tab", "Liste"));
    // Farbe wieder entfernen
    await click($(".node.on button[title='Farbe wählen']")!);
    await click($(".palette .swatch.none")!);
    expect(store.project!.menu.find((m) => m.name === "Verträge")!.color).toBe(null);
    await click($(".node.on button[title='Farbe wählen']")!);
    await click($(".palette .swatch.c-rot")!);
    await click($(".node.all")!);
  });

  it("bildet Teilanforderungen und warnt bei Erledigt trotz offener Teile", async () => {
    await click(byText(".row", "Vertrag ansehen"));
    const part = $(".drawer input[placeholder^='Neue Teilanforderung']") as HTMLInputElement;
    for (const name of ["Vertragsdaten zeigen", "PDF herunterladen"]) {
      await type(part, name);
      await act(() => void part.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    }
    const big = store.project!.reqs.find((r) => r.title === "Vertrag ansehen")!;
    const parts = store.project!.reqs.filter((r) => r.parentId === big.id);
    expect(parts.map((r) => r.key)).toEqual(["REQ-002.1", "REQ-002.2"]);
    expect(parts.every((r) => r.menuId === big.menuId && r.fe === big.fe)).toBe(true);
    expect($$(".drawer .part-row").length).toBe(2);
    expect($$(".row.part").length).toBe(2);
    expect(byText(".row", "Vertrag ansehen").textContent).toContain("0/2 Teile");
    // Status der großen Anforderung bleibt von Hand, mit Warnung.
    await click(byText(".drawer .seg button", "Erledigt"));
    expect($(".drawer .err-box")!.textContent).toContain("Teilanforderungen noch offen");
    expect(byText(".row", "Vertrag ansehen").textContent).toContain("⚠ 0/2 Teile");
    // In den Teil springen: Ort ist gesperrt, Herauslösen möglich.
    await click($$(".drawer .part-row")[1]);
    expect($(".drawer .part-of")!.textContent).toContain("REQ-002");
    expect(($$(".drawer select")[0] as HTMLSelectElement).disabled).toBe(true);
    await click(byText(".drawer .part-of button", "Herauslösen"));
    const freed = store.project!.reqs.find((r) => r.title === "PDF herunterladen")!;
    expect(freed.parentId).toBe(null);
    expect(freed.key).toMatch(/^REQ-\d+$/);
    expect($$(".row.part").length).toBe(1);
    // Papierkorb nimmt die große Anforderung mit ihrem Teil, Wiederherstellen bringt beide zurück.
    await click(byText(".row", "Vertrag ansehen"));
    await click(byText(".drawer button", "Mit 1 Teilen in den Papierkorb"));
    expect(store.project!.reqs.filter((r) => r.deletedAt).map((r) => r.key).sort()).toEqual(["REQ-002", "REQ-002.1"]);
    await act(() => store.restoreReq(big.id));
    expect(store.project!.reqs.filter((r) => r.deletedAt).length).toBe(0);
  });

  it("zeigt die User Story verständlich und das Lastenheft je Frontend", async () => {
    await click(byText(".row", "Benutzer anlegen"));
    const story = $(".drawer .story")!;
    expect(story.textContent).toContain("Wer?");
    expect(story.textContent).toContain("Was will die Person tun?");
    expect(story.textContent).toContain("Wozu?");
    const inputs = [...story.querySelectorAll("input")] as HTMLInputElement[];
    await type(inputs[0], "Admin");
    await type(inputs[1], "Benutzer anlegen");
    await type(inputs[2], "neue Kollegen sofort arbeiten können");
    expect($(".drawer .story-out")!.textContent).toBe("Als Admin möchte ich Benutzer anlegen, damit neue Kollegen sofort arbeiten können.");
    await click(byText(".actions button", "Lastenheft"));
    expect($$(".paper .fe-title").map((e) => e.textContent)).toEqual(["Admin", "Kunde"]);
    await click(byText(".report-bar .chip", "Kunde"));
    expect($$(".paper .fe-title").length).toBe(0);
    expect($(".paper .sub")!.textContent).toBe("Version v1.0 · Kunde");
    expect($(".paper")!.textContent).not.toContain("Benutzer anlegen");
    expect($$(".paper .item.part").length).toBe(1);
    await click(byText(".report-bar button", "Schließen"));
  });

  it("pflegt den Steckbrief und stellt einen Auftrag als ZIP zusammen", async () => {
    await click(byText(".actions button", "Umsetzung"));
    expect($(".dialog")!.textContent).toContain("Umsetzung mit Claude");
    expect($(".dialog")!.textContent).toContain("Im Steckbrief fehlen 9 von 9 Angaben");
    await click(byText(".dialog .hrow button", "Steckbrief"));
    const fields = $$(".dialog textarea") as HTMLTextAreaElement[];
    expect(fields.length).toBe(9);
    await type(fields[0], "Portal für Energiekunden");
    await type(fields[7], "C:\\Code\\Energieportal");
    expect(store.project!.brief).toMatchObject({ purpose: "Portal für Energiekunden", codePath: "C:\\Code\\Energieportal" });
    await click(byText(".dialog button", "Zur Umsetzung"));
    expect($(".dialog")!.textContent).toContain("Im Steckbrief fehlen 7 von 9 Angaben");

    const p = store.project!;
    const v = p.versions[0];
    const admin = p.reqs.find((r) => r.title === "Benutzer anlegen")!;
    const bytes = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);
    Object.defineProperty(bytes, "arrayBuffer", { value: async () => bytes.buffer });
    await store.blobs.put("abild", bytes);
    await act(() => store.upd(admin.id, (r) => r.attachments.push({ id: "abild", name: "maske.png", type: "image/png", size: 7 })));
    const z = (await store.buildOrderZip(v.id, v.phases[0].id))!;
    expect(z.name).toMatch(/^Energieportal-auftrag-\d{4}-\d\d-\d\d-[a-z0-9]{5}\.zip$/);
    expect(z.missing).toBe(0);
    expect(z.count).toBeGreaterThan(0);
    const text = new TextDecoder("latin1").decode(z.bytes);
    for (const name of ["auftrag.json", "AUFTRAG.md", "anhaenge/" + admin.key + "/01-maske.png"]) expect(text).toContain(name);
    // Für die Gegenprobe mit einem echten Entpacker
    if (process.env.AK_ZIP_OUT) (await import("node:fs")).writeFileSync(process.env.AK_ZIP_OUT, z.bytes);
  });

  it("liest eine Rückmeldung mit Vorschau ein und erkennt spätere Änderungen", async () => {
    const p = store.project!;
    const admin = p.reqs.find((r) => r.title === "Benutzer anlegen")!;
    await act(() => store.upd(admin.id, (r) => r.criteria.push({ id: "ck1", text: "Pflichtfelder geprüft", done: false })));
    const fb = { format: "anforderungskatalog-rueckmeldung-v1", orderId: "auftrag-2026-10-09-test1", projectId: p.id, summary: "Phase 1 gebaut.", items: [{ id: admin.id, key: admin.key, status: "done", note: "Maske und Speichern fertig.", criteriaDone: ["ck1"] }] };
    const file = new File(["x"], "rueckmeldung.json");
    Object.defineProperty(file, "text", { configurable: true, value: async () => JSON.stringify(fb) });
    await act(() => store.loadFeedback(file));
    const dlg = $(".dialog")!;
    expect(dlg.textContent).toContain("Vorschau der Rückmeldung");
    expect(dlg.textContent).toContain("Phase 1 gebaut.");
    expect(dlg.textContent).toContain("Status: Offen → Zu prüfen");
    expect(dlg.textContent).toContain("Kriterium erfüllt: Pflichtfelder geprüft");
    // Noch ist nichts geändert.
    expect(store.project!.reqs.find((r) => r.id === admin.id)!.status).toBe("open");
    await click(byText(".dialog button", "Übernehmen"));
    const after = store.project!.reqs.find((r) => r.id === admin.id)!;
    expect(after.status).toBe("review");
    expect(after.criteria.find((c) => c.id === "ck1")!.done).toBe(true);
    expect(after.impl!.note).toBe("Maske und Speichern fertig.");
    await click($(".dialog-head .icon-btn")!);

    await click(byText(".row", "Benutzer anlegen"));
    expect($(".drawer .impl")!.textContent).toContain("Umgesetzt");
    expect($(".drawer .impl")!.textContent).toContain("Maske und Speichern fertig.");
    expect($$(".drawer .seg:not(.prio-seg) button").map((b) => b.textContent)).toEqual(["Offen", "In Arbeit", "Zu prüfen", "Erledigt"]);
    await type($(".title-input") as HTMLTextAreaElement, "Benutzer anlegen und einladen");
    expect($(".drawer .impl.changed")!.textContent).toContain("Geändert seit der Umsetzung");
    expect(byText(".row", "Benutzer anlegen und einladen").textContent).toContain("geändert");
    // Der nächste Auftrag der Phase nimmt sie wieder auf.
    const v = store.project!.versions[0];
    const z = (await store.buildOrderZip(v.id, v.phases[0].id))!;
    expect(new TextDecoder().decode(z.bytes)).toContain("Geändert seit der Umsetzung");
    // Falsches Projekt wird abgewiesen.
    Object.defineProperty(file, "text", { value: async () => JSON.stringify({ ...fb, projectId: "anderes" }) });
    await click($(".drawer-head .icon-btn")!);
    await click(byText(".actions button", "Umsetzung"));
    await act(() => store.loadFeedback(file));
    expect($(".dialog .err-box")!.textContent).toContain("anderen Projekt");
    expect((byText(".dialog button", "Übernehmen") as HTMLButtonElement).disabled).toBe(true);
    await click(byText(".dialog button", "Verwerfen"));
    await click($(".dialog-head .icon-btn")!);
  });
});
