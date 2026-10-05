// Menüstruktur: Frontends als Reiter, darunter der Menübaum mit Anlegen, Umbenennen, Färben und Löschen.

import type { JSX } from "preact";
import { useEffect, useRef } from "preact/hooks";
import type { Store } from "../app/store";
import { COLOR_LABEL, COLORS, type MenuNode, type Project } from "../domain/types";
import { inFrontend, liveReqs, trashedReqs, type MenuIndex } from "../domain/view";
import { stop, val } from "./parts";

function EditInput({ s, onCommit, onCancel }: { s: Store; onCommit: () => void; onCancel: () => void }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  return (
    <input
      ref={ref}
      class="field grow"
      style="padding:2px 6px;border-color:var(--accent)"
      value={s.ui.editName}
      onInput={(e) => s.set({ editName: val(e) })}
      onKeyDown={(e) => {
        if (e.key === "Enter") onCommit();
        if (e.key === "Escape") {
          e.stopPropagation();
          onCancel();
        }
      }}
      onBlur={onCommit}
      onClick={stop}
    />
  );
}

export function Sidebar({ s, p, ix }: { s: Store; p: Project; ix: MenuIndex }) {
  const ui = s.ui;
  const selFe = s.selFe;
  const live = liveReqs(p);
  const countIn = (id: string) => {
    const set = ix.subOf(id);
    return live.filter((r) => r.menuId && set.has(r.menuId)).length;
  };
  const toList = s.view === "uebersicht" || s.view === "pre" ? "liste" : ui.view;
  const pick = (id: string | null) => s.set({ selMenu: id, navOpen: false, view: toList, colorMenu: null });
  const act = (fn: () => void) => (e: Event) => {
    e.stopPropagation();
    fn();
  };

  const rows: JSX.Element[] = [];
  const walk = (list: MenuNode[], depth: number) =>
    list.forEach((m) => {
      const has = ix.kids(m.id).length > 0;
      const col = !!ui.collapsed[m.id];
      const on = ui.selMenu === m.id;
      const ed = ui.editMenu === m.id;
      rows.push(
        <div key={m.id} class={"node" + (on ? " on" : "")} style={{ paddingLeft: 6 + depth * 16 + "px" }} onClick={() => pick(m.id)}>
          <span class="chev" onClick={has ? act(() => s.toggleCollapsed(m.id)) : undefined}>
            {has ? (col ? "▸" : "▾") : ""}
          </span>
          {m.color && <i class={"cdot c-" + m.color} title={COLOR_LABEL[m.color]} />}
          {ed ? (
            <EditInput s={s} onCommit={s.commitMenu} onCancel={() => s.set({ editMenu: null })} />
          ) : (
            <span class="grow cut" onDblClick={act(() => s.set({ editMenu: m.id, editName: m.name }))}>
              {m.name}
            </span>
          )}
          {on && !ed && (
            <span style="display:flex;gap:2px">
              <button type="button" class="act" title="Untermenü hinzufügen" onClick={act(() => s.addMenu(m.id))}>
                +
              </button>
              <button type="button" class="act tiny" title="Farbe wählen" onClick={act(() => s.set({ colorMenu: ui.colorMenu === m.id ? null : m.id }))}>
                ●
              </button>
              <button type="button" class="act tiny" title="Umbenennen" onClick={act(() => s.set({ editMenu: m.id, editName: m.name }))}>
                ✎
              </button>
              <button type="button" class="act" title="Löschen" onClick={act(() => s.removeMenu(m.id))}>
                ×
              </button>
            </span>
          )}
          <span class="mono count">{countIn(m.id)}</span>
        </div>,
      );
      if (ui.colorMenu === m.id)
        rows.push(
          <div key={m.id + ":farbe"} class="palette" style={{ paddingLeft: 28 + depth * 16 + "px" }} role="group" aria-label={"Farbe für " + m.name}>
            {COLORS.map((c) => (
              <button key={c} type="button" class={"swatch c-" + c + (m.color === c ? " on" : "")} title={COLOR_LABEL[c]} aria-label={COLOR_LABEL[c]} onClick={() => s.setMenuColor(m.id, c)} />
            ))}
            <button type="button" class="swatch none" title="Keine Farbe" aria-label="Keine Farbe" onClick={() => s.setMenuColor(m.id, null)}>
              ×
            </button>
          </div>,
        );
      if (has && !col) walk(ix.kids(m.id), depth + 1);
    });

  if (selFe) walk(ix.roots(selFe), 0);
  else
    for (const f of p.frontends) {
      // Unter „Alle“ steht jedes Frontend als Überschrift über seinem Baum.
      if (ix.multi)
        rows.push(
          <div key={"fe:" + f.id} class="fe-head" onClick={() => s.selectFe(f.id)} title={"Nur " + f.name + " zeigen"}>
            <span class="grow cut">{f.name}</span>
            <span class="mono count">{live.filter((r) => r.fe === f.id).length}</span>
          </div>,
        );
      walk(ix.roots(f.id), 0);
    }

  const trash = trashedReqs(p).length;
  const fe = p.frontends.find((f) => f.id === selFe) ?? null;
  const total = fe ? live.filter((r) => inFrontend(r, fe.id)).length : live.length;

  return (
    <>
      {ui.mobile && ui.navOpen && <div class="side-veil" onClick={() => s.set({ navOpen: false })} />}
      <aside class={"side" + (ui.navOpen ? " open" : "")}>
        <div class="side-head">
          <span class="label">Menüstruktur</span>
          <button type="button" class="btn sm quiet" style="padding:2px 8px" title={"Hauptmenüpunkt hinzufügen" + (ix.multi ? " in " + (fe ?? p.frontends[0]).name : "")} onClick={() => s.addMenu(null)}>
            + Menü
          </button>
        </div>
        <div class="fe-tabs" role="tablist" aria-label="Frontends">
          {ix.multi && (
            <button type="button" role="tab" aria-selected={!selFe} class={"chip" + (selFe ? "" : " on")} onClick={() => s.selectFe(null)}>
              Alle
            </button>
          )}
          {p.frontends.map((f) =>
            ui.editFe === f.id ? (
              <EditInput key={f.id} s={s} onCommit={s.commitFe} onCancel={() => s.set({ editFe: null })} />
            ) : (
              <button
                key={f.id}
                type="button"
                role="tab"
                aria-selected={selFe === f.id}
                class={"chip" + (selFe === f.id ? " on" : "")}
                title="Doppelklick zum Umbenennen"
                onClick={() => s.selectFe(f.id)}
                onDblClick={() => s.set({ editFe: f.id, editName: f.name })}
              >
                {f.name}
              </button>
            ),
          )}
          <button type="button" class="chip" title="Frontend hinzufügen" aria-label="Frontend hinzufügen" onClick={() => s.addFrontend()}>
            +
          </button>
        </div>
        {fe && ui.editFe !== fe.id && (
          <div class="fe-actions">
            <button type="button" class="btn sm quiet" onClick={() => s.set({ editFe: fe.id, editName: fe.name })}>
              Umbenennen
            </button>
            {ix.multi && (
              <button
                type="button"
                class="btn sm quiet"
                onClick={() => {
                  if (confirm("Frontend „" + fe.name + "“ löschen? Menüpunkte und Anforderungen bleiben erhalten und wandern in ein anderes Frontend.")) s.deleteFrontend(fe.id);
                }}
              >
                Löschen
              </button>
            )}
          </div>
        )}
        <div class="tree">
          <div class={"node all" + (ui.selMenu ? "" : " on")} onClick={() => pick(null)}>
            <span class="grow cut">{fe ? "Alles in " + fe.name : "Alle Anforderungen"}</span>
            <span class="mono count">{total}</span>
          </div>
          {rows}
        </div>
        <div class="side-foot">
          <span class="grow only-desk">Doppelklick zum Umbenennen</span>
          <button type="button" class="btn sm quiet" onClick={() => s.set({ dialog: "trash", navOpen: false })}>
            Papierkorb{trash ? " · " + trash : ""}
          </button>
        </div>
      </aside>
    </>
  );
}
