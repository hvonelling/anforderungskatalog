// Menüstruktur: Baum der Menüpunkte mit Anlegen, Umbenennen und Löschen.

import { useEffect, useRef } from "preact/hooks";
import type { Store } from "../app/store";
import type { Project } from "../domain/types";
import { liveReqs, trashedReqs, type MenuIndex } from "../domain/view";
import { stop, val } from "./parts";

function EditInput({ s }: { s: Store }) {
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
        if (e.key === "Enter") s.commitMenu();
        if (e.key === "Escape") {
          e.stopPropagation();
          s.set({ editMenu: null });
        }
      }}
      onBlur={s.commitMenu}
      onClick={stop}
    />
  );
}

export function Sidebar({ s, p, ix }: { s: Store; p: Project; ix: MenuIndex }) {
  const ui = s.ui;
  const live = liveReqs(p);
  const countIn = (id: string) => {
    const set = ix.subOf(id);
    return live.filter((r) => r.menuId && set.has(r.menuId)).length;
  };
  const pick = (id: string | null) => s.set({ selMenu: id, navOpen: false, view: s.view === "uebersicht" || s.view === "pre" ? "liste" : ui.view });
  const rows: preact.JSX.Element[] = [];
  const walk = (parent: string | null, depth: number) =>
    ix.kids(parent).forEach((m) => {
      const has = ix.kids(m.id).length > 0;
      const col = !!ui.collapsed[m.id];
      const act = ui.selMenu === m.id;
      const ed = ui.editMenu === m.id;
      rows.push(
        <div key={m.id} class={"node" + (act ? " on" : "")} style={{ paddingLeft: 6 + depth * 16 + "px" }} onClick={() => pick(m.id)}>
          <span
            class="chev"
            onClick={(e) => {
              if (!has) return;
              e.stopPropagation();
              s.toggleCollapsed(m.id);
            }}
          >
            {has ? (col ? "▸" : "▾") : ""}
          </span>
          {ed ? (
            <EditInput s={s} />
          ) : (
            <span
              class="grow cut"
              onDblClick={(e) => {
                e.stopPropagation();
                s.set({ editMenu: m.id, editName: m.name });
              }}
            >
              {m.name}
            </span>
          )}
          {act && !ed && (
            <span style="display:flex;gap:2px">
              <button
                type="button"
                class="act"
                title="Untermenü hinzufügen"
                onClick={(e) => {
                  e.stopPropagation();
                  s.addMenu(m.id);
                }}
              >
                +
              </button>
              <button
                type="button"
                class="act tiny"
                title="Umbenennen"
                onClick={(e) => {
                  e.stopPropagation();
                  s.set({ editMenu: m.id, editName: m.name });
                }}
              >
                ✎
              </button>
              <button
                type="button"
                class="act"
                title="Löschen"
                onClick={(e) => {
                  e.stopPropagation();
                  s.removeMenu(m.id);
                }}
              >
                ×
              </button>
            </span>
          )}
          <span class="mono count">{countIn(m.id)}</span>
        </div>,
      );
      if (has && !col) walk(m.id, depth + 1);
    });
  walk(null, 0);
  const trash = trashedReqs(p).length;

  return (
    <>
      {ui.mobile && ui.navOpen && <div class="side-veil" onClick={() => s.set({ navOpen: false })} />}
      <aside class={"side" + (ui.navOpen ? " open" : "")}>
        <div class="side-head">
          <span class="label">Menüstruktur</span>
          <button type="button" class="btn sm" style="padding:2px 8px;border-color:var(--line);color:var(--muted)" title="Hauptmenüpunkt hinzufügen" onClick={() => s.addMenu(null)}>
            + Menü
          </button>
        </div>
        <div class="tree">
          <div class={"node all" + (ui.selMenu ? "" : " on")} onClick={() => pick(null)}>
            <span class="grow">Alle Anforderungen</span>
            <span class="mono count">{live.length}</span>
          </div>
          {rows}
        </div>
        <div class="side-foot">
          <span class="grow only-desk">Doppelklick zum Umbenennen</span>
          <button type="button" class="btn sm" style="border-color:var(--line);color:var(--muted)" onClick={() => s.set({ dialog: "trash", navOpen: false })}>
            Papierkorb{trash ? " · " + trash : ""}
          </button>
        </div>
      </aside>
    </>
  );
}
