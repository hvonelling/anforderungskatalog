// Die fünf Ansichten: Übersicht, Liste, Board, Tabelle, Voraussetzungen. Dazu die Filterleiste.

import { useState } from "preact/hooks";
import type { Store } from "../app/store";
import { PRIO, PRIOS, STATUS, STATUSES, type PreType, type Project, type Req } from "../domain/types";
import { boardColumns, GAPS, groupByMenu, liveReqs, overview, reqInfo, sortTable, TABLE_HEADERS, type MenuIndex, type Progress } from "../domain/view";
import { Check, Chip, PrioBadge, StatusDot, val } from "./parts";

interface Props {
  s: Store;
  p: Project;
  ix: MenuIndex;
  reqs: Req[];
}

const open = (s: Store, id: string) => () => s.set({ selReq: id });

function PreNote({ links, openN }: { links: number; openN: number }) {
  if (!links) return null;
  return <span class={"mono " + (openN ? "warn" : "dim")}>{openN ? "⚠ " + openN + " offen" : "✓ " + links + "/" + links}</span>;
}

// ---------------------------------------------------------------- Filter

export function Filters({ s, ix, count }: { s: Store; ix: MenuIndex; count: number }) {
  const ui = s.ui;
  const scoped = ui.selMenu && ix.byId.has(ui.selMenu);
  const gap = GAPS.find((g) => g.key === ui.gap);
  return (
    <div class="filters">
      <div class="scope">
        <span class="label">Bereich</span>
        <b>
          {scoped ? ix.pathOf(ui.selMenu) : "Alle Menüpunkte"} <span class="mono dim" style="font-size:12px;font-weight:400">· {count} Anforderungen</span>
        </b>
      </div>
      {gap && (
        <div class="set">
          <span class="tiny dim" style="margin-right:4px">
            Lücke
          </span>
          <Chip on onClick={() => s.set({ gap: null })} title="Filter aufheben">
            {gap.label} ×
          </Chip>
        </div>
      )}
      <div class="set">
        <span class="tiny dim" style="margin-right:4px">
          Priorität
        </span>
        <Chip mono on={ui.fPrio === ""} onClick={() => s.set({ fPrio: "" })}>
          Alle
        </Chip>
        {PRIOS.map((k) => (
          <Chip key={k} mono on={ui.fPrio === k} onClick={() => s.set({ fPrio: k })} title={PRIO[k].label}>
            {k}
          </Chip>
        ))}
      </div>
      <div class="set">
        <span class="tiny dim" style="margin-right:4px">
          Status
        </span>
        <Chip on={ui.fStatus === ""} onClick={() => s.set({ fStatus: "" })}>
          Alle
        </Chip>
        {STATUSES.map((k) => (
          <Chip key={k} on={ui.fStatus === k} onClick={() => s.set({ fStatus: k })}>
            {STATUS[k].label}
          </Chip>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Liste

export function ListView({ s, p, ix, reqs }: Props) {
  const groups = groupByMenu(ix, reqs);
  return (
    <div class="list">
      {groups.map((g) => (
        <section key={g.id}>
          <div class="group-head">
            <span style="font-weight:600">{g.name}</span>
            <span class="mono dim">{g.parentPath}</span>
            <span class="mono dim" style="margin-left:auto">
              {g.items.length}
            </span>
          </div>
          {g.items.map((r) => {
            const i = reqInfo(p, ix, r);
            return (
              <div key={r.id} class={"row" + (s.ui.selReq === r.id ? " on" : "")} onClick={open(s, r.id)}>
                <span class="mono muted key">{r.key}</span>
                <PrioBadge prio={r.prio} />
                <span class={"cut title" + (r.title ? "" : " untitled")}>{r.title || "Ohne Titel"}</span>
                <div class="meta">
                  <PreNote links={i.links.length} openN={i.preOpen} />
                  <span class="mono muted vp" style="white-space:nowrap">
                    {i.vp}
                  </span>
                  <span class="st">
                    <StatusDot status={r.status} />
                    <span>{STATUS[r.status].label}</span>
                  </span>
                </div>
              </div>
            );
          })}
        </section>
      ))}
      {reqs.length === 0 && (
        <div class="empty">
          <span>Keine Anforderungen in diesem Bereich.</span>
          <button type="button" class="btn" onClick={s.newReq}>
            + Anforderung anlegen
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Board

export function BoardView({ s, p, ix, reqs }: Props) {
  const ui = s.ui;
  const bv = s.curVersion();
  const cols = boardColumns(p, reqs, bv);
  return (
    <>
      <div class="board-bar">
        <span class="tiny dim" style="margin-right:6px">
          Version
        </span>
        {p.versions.map((v) => (
          <Chip key={v.id} mono on={v.id === bv} onClick={() => s.set({ boardVersion: v.id })}>
            {v.name}
          </Chip>
        ))}
        {p.versions.length === 0 && (
          <button type="button" class="btn sm" onClick={() => s.set({ dialog: "versions" })}>
            Version anlegen
          </button>
        )}
        <span class="small dim" style="margin-left:auto">
          Karten zwischen Phasen ziehen. Jede Verschiebung wird im Verlauf protokolliert.
        </span>
      </div>
      <div class="board">
        {cols.map((c) => (
          <div
            key={c.id}
            class={"col" + (ui.dragOver === c.id ? " over" : "")}
            onDragOver={(e) => {
              e.preventDefault();
              if (s.ui.dragOver !== c.id) s.set({ dragOver: c.id });
            }}
            onDrop={(e) => {
              e.preventDefault();
              const id = e.dataTransfer?.getData("text/plain") || s.ui.dragId;
              s.set({ dragOver: null, dragId: null });
              if (id) s.move(id, c.versionId, c.phaseId);
            }}
          >
            <div class="col-head">
              <span class={c.backlog ? "muted" : ""}>{c.name}</span>
              <span class="mono dim" style="margin-left:auto;font-weight:400">
                {c.items.length}
              </span>
            </div>
            {c.items.map((r) => {
              const i = reqInfo(p, ix, r);
              return (
                <div
                  key={r.id}
                  class={"card" + (i.preOpen ? " blocked" : "") + (ui.dragId === r.id ? " dragging" : "")}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer?.setData("text/plain", r.id);
                    if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
                    s.set({ dragId: r.id });
                  }}
                  onDragEnd={() => s.set({ dragId: null, dragOver: null })}
                  onClick={open(s, r.id)}
                >
                  <div style="display:flex;align-items:center;gap:8px">
                    <PrioBadge prio={r.prio} />
                    <span class="mono muted">{r.key}</span>
                    <span style="margin-left:auto;display:flex">
                      <StatusDot status={r.status} />
                    </span>
                  </div>
                  <span class={r.title ? "" : "untitled"} style="text-wrap:pretty">
                    {r.title || "Ohne Titel"}
                  </span>
                  <div class="tiny dim" style="display:flex;gap:8px;align-items:center">
                    <span class="cut">{i.path}</span>
                    <span style="margin-left:auto;flex:none">
                      <PreNote links={i.links.length} openN={i.preOpen} />
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        ))}
        <button
          type="button"
          class="btn dashed add-col"
          onClick={() => {
            if (bv) s.addPhase(bv);
            else s.set({ dialog: "versions" });
          }}
        >
          + Phase
        </button>
      </div>
    </>
  );
}

// ---------------------------------------------------------------- Tabelle

export function TableView({ s, p, ix, reqs }: Props) {
  const ui = s.ui;
  const rows = sortTable(p, ix, reqs, ui.sortKey, ui.sortDir);
  return (
    <div class="table-wrap">
      <table class="t">
        <thead>
          <tr>
            {TABLE_HEADERS.map(([k, l]) => (
              <th key={k} class={ui.sortKey === k ? "on" : ""} onClick={() => s.set({ sortKey: k, sortDir: ui.sortKey === k ? (-ui.sortDir as 1 | -1) : 1 })}>
                {l} {ui.sortKey === k ? (ui.sortDir > 0 ? "↑" : "↓") : ""}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const i = reqInfo(p, ix, r);
            return (
              <tr key={r.id} class={ui.selReq === r.id ? "on" : ""} onClick={open(s, r.id)}>
                <td class="mono muted" style="white-space:nowrap">
                  {r.key}
                </td>
                <td class={r.title ? "" : "untitled"}>{r.title || "Ohne Titel"}</td>
                <td>
                  <PrioBadge prio={r.prio} />
                </td>
                <td style="white-space:nowrap;color:var(--text-2)">
                  <span style="display:inline-flex;align-items:center;gap:6px">
                    <StatusDot status={r.status} />
                    {STATUS[r.status].label}
                  </span>
                </td>
                <td class="muted small">{i.path}</td>
                <td class="mono muted" style="white-space:nowrap">
                  {i.version ? i.version.name : "—"}
                </td>
                <td class="muted small" style="white-space:nowrap">
                  {i.phase ? i.phase.name : "—"}
                </td>
                <td class={"mono " + (i.preOpen ? "warn" : "dim")} style="white-space:nowrap">
                  {i.links.length ? i.links.length - i.preOpen + "/" + i.links.length + (i.preOpen ? " ⚠" : "") : "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {reqs.length === 0 && (
        <div class="dim" style="padding:40px 10px">
          Keine Anforderungen gefunden.
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Voraussetzungen

function PreSection({ s, p, type }: { s: Store; p: Project; type: PreType }) {
  const [draft, setDraft] = useState("");
  const items = p.prereqs.filter((q) => q.type === type);
  const live = liveReqs(p);
  const add = () => {
    const t = draft.trim();
    if (!t) return;
    s.addPrereq(t, type);
    setDraft("");
  };
  return (
    <section class="box">
      <div class="box-head">
        <b>{type === "tech" ? "Technische Voraussetzungen" : "Anwenderbezogene Voraussetzungen"}</b>
        <span class="mono dim" style="margin-left:auto">
          {items.filter((q) => q.done).length}/{items.length} erfüllt
        </span>
      </div>
      {items.map((q) => {
        const linked = live.filter((r) => r.prereqIds.includes(q.id));
        return (
          <div key={q.id} class="pre-row">
            <Check done={q.done} title="Erfüllt umschalten" onToggle={() => s.editPre(q.id, (x) => (x.done = !x.done))} />
            <input class={"ghost" + (q.done ? " done-text" : "")} value={q.title} onInput={(e) => s.editPre(q.id, (x) => (x.title = val(e)))} />
            <span class="mono dim" style="white-space:nowrap" title={linked.map((r) => r.key).join(", ")}>
              {linked.length ? linked.length + "× verknüpft" : "nicht verknüpft"}
            </span>
            <div style="display:flex;gap:2px">
              <button type="button" class="btn sm" style="padding:2px 7px;border-color:var(--line);color:var(--muted)" title="Typ wechseln" onClick={() => s.editPre(q.id, (x) => (x.type = x.type === "tech" ? "user" : "tech"))}>
                ⇄
              </button>
              <button type="button" class="btn sm danger" style="padding:2px 7px;border-color:var(--line);color:var(--muted)" title="Löschen" onClick={() => s.removePre(q.id)}>
                ×
              </button>
            </div>
          </div>
        );
      })}
      <div style="display:flex;gap:8px;padding:12px 16px">
        <input
          class="field grow"
          value={draft}
          placeholder={type === "tech" ? "z. B. API-Zugang bereitgestellt" : "z. B. Anwenderschulung durchgeführt"}
          onInput={(e) => setDraft(val(e))}
          onKeyDown={(e) => {
            if (e.key === "Enter") add();
          }}
        />
        <button type="button" class="btn" onClick={add}>
          Hinzufügen
        </button>
      </div>
    </section>
  );
}

export function PrereqView({ s, p }: { s: Store; p: Project }) {
  return (
    <div class="pre-grid">
      <PreSection s={s} p={p} type="tech" />
      <PreSection s={s} p={p} type="user" />
    </div>
  );
}

// ---------------------------------------------------------------- Übersicht

const pct = (n: number, total: number) => (total ? Math.round((n / total) * 100) : 0);

function ProgRow({ name, g, sub, head }: { name: string; g: Progress; sub?: boolean; head?: boolean }) {
  return (
    <div class={"prog" + (sub ? " sub" : "") + (head ? " head" : "")}>
      <span class="cut" style={head ? "font-weight:600" : ""} title={name}>
        {name}
      </span>
      <div class="bar" role="img" aria-label={g.done + " erledigt, " + g.wip + " in Arbeit, " + g.open + " offen"}>
        <div class="d" style={{ width: pct(g.done, g.total) + "%" }} />
        <div class="w" style={{ width: pct(g.wip, g.total) + "%" }} />
      </div>
      <span class="mono muted" style="white-space:nowrap;text-align:right">
        {g.total ? g.done + "/" + g.total + " · " + pct(g.done, g.total) + " %" : "leer"}
        {g.critTotal ? " · Kriterien " + g.critDone + "/" + g.critTotal : ""}
        {g.preOpen ? <span class="warn"> · ⚠ {g.preOpen}</span> : null}
      </span>
    </div>
  );
}

export function OverviewView({ s, p }: { s: Store; p: Project }) {
  const o = overview(p);
  return (
    <div class="overview">
      <div class="kpis">
        <div class="kpi">
          <span class="label">Anforderungen</span>
          <b>{o.all.total}</b>
          <span class="small dim">{o.wont ? "ohne " + o.wont + " Won’t" : "im Umfang"}</span>
        </div>
        <div class="kpi">
          <span class="label">Erledigt</span>
          <b>{pct(o.all.done, o.all.total)} %</b>
          <span class="small dim">
            {o.all.done} von {o.all.total}
          </span>
        </div>
        <div class="kpi">
          <span class="label">In Arbeit</span>
          <b>{o.all.wip}</b>
          <span class="small dim">{o.all.open} offen</span>
        </div>
        <div class="kpi">
          <span class="label">Akzeptanzkriterien</span>
          <b>{o.all.critTotal ? pct(o.all.critDone, o.all.critTotal) + " %" : "—"}</b>
          <span class="small dim">
            {o.all.critDone} von {o.all.critTotal} erfüllt
          </span>
        </div>
        <div class="kpi">
          <span class="label">Voraussetzungen</span>
          <b>
            {o.prereqs.done}/{o.prereqs.total}
          </b>
          <span class="small dim">erfüllt</span>
        </div>
      </div>

      <section class="box">
        <div class="box-head">
          <b>Fortschritt je Version und Phase</b>
          <span class="legend small muted" style="margin-left:auto">
            <span>
              <i class="d" /> erledigt
            </span>
            <span>
              <i class="w" /> in Arbeit
            </span>
            <span>
              <i /> offen
            </span>
          </span>
        </div>
        {o.versions.map((v) => (
          <div key={v.id}>
            <ProgRow name={v.name} g={v.p} head />
            {v.phases.map((ph) => (
              <ProgRow key={ph.id} name={ph.name} g={ph.p} sub />
            ))}
          </div>
        ))}
        {o.unplanned.total > 0 && <ProgRow name="Nicht eingeplant" g={o.unplanned} head />}
        {o.versions.length === 0 && o.unplanned.total === 0 && (
          <div class="dim" style="padding:16px">
            Noch keine Anforderungen und Versionen.
          </div>
        )}
        <div class="note" style="padding:10px 16px">
          Won’t-Anforderungen zählen nicht mit. ⚠ zeigt die Zahl offener Voraussetzungen.
        </div>
      </section>

      <section class="box">
        <div class="box-head">
          <b>Lücken im Katalog</b>
          <span class="small dim" style="margin-left:auto">
            Antippen zeigt die betroffenen Anforderungen
          </span>
        </div>
        {o.gaps.map((g) => (
          <button
            key={g.key}
            type="button"
            class={"gap-row" + (g.count ? "" : " zero")}
            disabled={!g.count}
            onClick={() => s.set({ gap: g.key, view: "liste", selMenu: null, fPrio: "", fStatus: "", search: "" })}
          >
            <b class={g.count ? "warn" : ""}>{g.count}</b>
            <span>
              {g.label}
              <br />
              <span class="small dim">{g.hint}</span>
            </span>
            <span class="dim">{g.count ? "›" : "✓"}</span>
          </button>
        ))}
      </section>
    </div>
  );
}
