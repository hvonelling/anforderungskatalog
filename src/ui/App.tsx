// Gerüst der App: Kopf mit Projektwahl, Reitern und Suche, links die Menüstruktur, rechts die Ansicht.

import { useEffect } from "preact/hooks";
import { useStore, type Store, type View } from "../app/store";
import { filterReqs, menuIndex } from "../domain/view";
import type { Theme } from "../storage/local";
import { Detail } from "./Detail";
import { NewProject, ProjectsDialog, SettingsDialog, TrashDialog, VersionsDialog } from "./Dialogs";
import { Dialog, fmtDateTime, val } from "./parts";
import { Report } from "./Report";
import { Sidebar } from "./Sidebar";
import { BoardView, Filters, ListView, OverviewView, PrereqView, TableView } from "./Views";

const TABS: [View, string, boolean][] = [
  ["uebersicht", "Übersicht", true],
  ["liste", "Liste", true],
  ["board", "Board", false],
  ["tabelle", "Tabelle", false],
  ["pre", "Voraussetzungen", true],
];
const NEXT_THEME: Record<Theme, Theme> = { auto: "light", light: "dark", dark: "auto" };
const THEME_LABEL: Record<Theme, string> = { auto: "Darstellung: wie das Gerät", light: "Darstellung: hell", dark: "Darstellung: dunkel" };
const THEME_ICON: Record<Theme, string> = { auto: "◐", light: "○", dark: "●" };

function SyncButton({ s }: { s: Store }) {
  const ui = s.ui;
  const cls = !s.cfg ? "" : ui.syncBusy ? "busy" : ui.syncErr ? "err" : "ok";
  const text = !s.cfg ? "Nur lokal" : ui.syncBusy ? "Abgleich …" : ui.syncErr ? "Abgleich fehlgeschlagen" : s.meta.dirty.length ? "Änderungen offen" : "Abgeglichen";
  const title = !s.cfg ? "Abgleich einrichten" : ui.syncErr ? ui.syncErr : s.meta.lastSync ? "Letzter Abgleich: " + fmtDateTime(s.meta.lastSync) + ". Klick gleicht jetzt ab." : "Jetzt abgleichen";
  return (
    <button
      type="button"
      class={"btn sync " + cls}
      title={title}
      onClick={() => {
        if (!s.cfg || ui.syncErr) s.set({ dialog: "settings" });
        else void s.syncNow();
      }}
    >
      <i />
      <span class="only-desk">{text}</span>
    </button>
  );
}

function Welcome({ s }: { s: Store }) {
  return (
    <div class="shell" style="display:block;overflow:auto">
      <div class="welcome">
        <div class="brand">
          <span class="logo">REQ</span>
          <h1>Anforderungskatalog</h1>
        </div>
        <span class="muted">Anforderungen je Menüpunkt erfassen, nach MoSCoW priorisieren, in Versionen und Phasen einplanen und den Fortschritt verfolgen. Lege ein Projekt an oder sieh dir das Beispiel an.</span>
        <NewProject s={s} />
        <div class="vbox">
          <span style="font-weight:600">Schon auf einem anderen Gerät im Einsatz?</span>
          <span class="small muted">Richte den Abgleich ein, dann erscheinen deine Projekte hier.</span>
          <div class="hrow">
            <button type="button" class="btn" onClick={() => s.set({ dialog: "settings" })}>
              Abgleich einrichten
            </button>
            {s.ui.syncBusy && <span class="small dim">Abgleich läuft …</span>}
          </div>
        </div>
      </div>
      {s.ui.dialog === "settings" && <SettingsDialog s={s} />}
      {s.ui.toast && <div class="toast">{s.ui.toast}</div>}
    </div>
  );
}

export function App() {
  const s = useStore();
  const ui = s.ui;
  const p = s.project;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const u = s.ui;
      if (u.report) s.set({ report: null });
      else if (u.dialog) s.set({ dialog: null });
      else if (u.selReq) s.set({ selReq: null });
      else if (u.navOpen) s.set({ navOpen: false });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!p) return <Welcome s={s} />;

  const ix = menuIndex(p);
  const view = s.view;
  const reqs = filterReqs(p, ix, { feId: s.selFe, menuId: ui.selMenu, prio: ui.fPrio, status: ui.fStatus, search: ui.search, gap: ui.gap });
  // Projekte aus der Zeit vor den Frontends: einmal fragen, ob die Hauptmenüpunkte Frontends sind.
  const askFrontends = !p.feAsked && !ui.dialog && !ui.report;
  const rootNames = askFrontends ? p.menu.filter((m) => !m.parent).map((m) => m.name) : [];
  const sel = p.reqs.find((r) => r.id === ui.selReq && !r.deletedAt) ?? null;
  const theme = s.prefs.theme ?? "auto";
  const listy = view === "liste" || view === "board" || view === "tabelle";
  const openReport = () => {
    const v = s.curVersion();
    if (!v) s.flash("Zuerst eine Version anlegen");
    else s.set({ report: v, selReq: null });
  };

  return (
    <>
      <div class="shell">
        <header class="top">
          <div class="brand">
            <button type="button" class="btn only-mobile" style="padding:6px 10px" title="Menüstruktur" onClick={() => s.set({ navOpen: !ui.navOpen })}>
              ☰
            </button>
            <span class="logo only-desk">REQ</span>
            <select
              class="project-pick"
              value={p.id}
              title="Projekt wechseln"
              onChange={(e) => {
                const v = val(e);
                if (v === "__manage") {
                  (e.target as HTMLSelectElement).value = p.id;
                  s.set({ dialog: "projects" });
                } else s.selectProject(v);
              }}
            >
              {s.visible().map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
              <option value="__manage">Projekte verwalten …</option>
            </select>
          </div>
          <nav class="tabs">
            {TABS.map(([k, l, mobile]) => (
              <button key={k} type="button" class={"tab" + (view === k ? " on" : "") + (mobile ? "" : " only-desk")} onClick={() => s.set({ view: k })}>
                {l}
              </button>
            ))}
          </nav>
          <div class="search">
            <input class="field" value={ui.search} placeholder="Suchen (ID, Titel, Text)" onInput={(e) => s.set({ search: val(e), view: listy ? ui.view : "liste" })} />
          </div>
          <div class="actions">
            <SyncButton s={s} />
            <button type="button" class="btn" title={THEME_LABEL[theme]} aria-label={THEME_LABEL[theme]} onClick={() => s.setTheme(NEXT_THEME[theme])}>
              {THEME_ICON[theme]}
            </button>
            <button type="button" class="btn only-desk" onClick={() => s.set({ dialog: "versions" })}>
              Versionen &amp; Phasen
            </button>
            <button type="button" class="btn only-desk" onClick={openReport}>
              Lastenheft
            </button>
            <button type="button" class="btn only-desk" onClick={() => s.set({ dialog: "projects" })}>
              Projekte
            </button>
            <button type="button" class="btn" title="Einstellungen" aria-label="Einstellungen" onClick={() => s.set({ dialog: "settings" })}>
              ⚙
            </button>
            <button type="button" class="btn primary only-desk" onClick={s.newReq}>
              + Anforderung
            </button>
          </div>
        </header>

        <div class="body">
          <Sidebar s={s} p={p} ix={ix} />
          <main class="main">
            {listy && <Filters s={s} ix={ix} count={reqs.length} />}
            <div class="scroll">
              {view === "uebersicht" && <OverviewView s={s} p={p} />}
              {view === "liste" && <ListView s={s} p={p} ix={ix} reqs={reqs} />}
              {view === "board" && <BoardView s={s} p={p} ix={ix} reqs={reqs} />}
              {view === "tabelle" && <TableView s={s} p={p} ix={ix} reqs={reqs} />}
              {view === "pre" && <PrereqView s={s} p={p} />}
            </div>
            {!sel && (
              <button type="button" class="btn primary fab only-mobile" onClick={s.newReq}>
                + Anforderung
              </button>
            )}
            {sel && <Detail s={s} p={p} ix={ix} r={sel} />}
          </main>
        </div>

        {ui.dialog === "versions" && <VersionsDialog s={s} p={p} />}
        {ui.dialog === "projects" && <ProjectsDialog s={s} />}
        {ui.dialog === "trash" && <TrashDialog s={s} p={p} />}
        {ui.dialog === "settings" && <SettingsDialog s={s} />}
        {askFrontends && (
          <Dialog title="Neu: Frontends" onClose={() => s.answerFrontends(false)}>
            <span>
              Ein Projekt kann jetzt mehrere Frontends haben, etwa Admin, Kunde und Dienstleister, jedes mit eigenem Menübaum. Sind die Hauptmenüpunkte dieses Projekts solche Frontends?
            </span>
            <div class="vbox">
              <span class="label">Hauptmenüpunkte von „{p.name}“</span>
              <span>{rootNames.join(" · ")}</span>
            </div>
            <div class="hrow">
              <button type="button" class="btn primary" onClick={() => s.answerFrontends(true)}>
                Ja, als Frontends übernehmen
              </button>
              <button type="button" class="btn" onClick={() => s.answerFrontends(false)}>
                Nein, als Menüpunkte lassen
              </button>
            </div>
            <span class="note">
              Bei Ja wird jeder Hauptmenüpunkt ein Frontend, seine Unterpunkte werden dessen Hauptmenü. Alle Anforderungen bleiben erhalten. Bei Nein liegt alles in einem Frontend „Allgemein“. Du kannst Frontends später jederzeit anlegen, umbenennen und löschen. Diese Frage erscheint je Projekt nur einmal.
            </span>
          </Dialog>
        )}
      </div>
      {ui.report && <Report s={s} p={p} ix={ix} versionId={ui.report} />}
      {ui.toast && <div class="toast">{ui.toast}</div>}
    </>
  );
}
