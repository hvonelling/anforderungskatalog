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
});
