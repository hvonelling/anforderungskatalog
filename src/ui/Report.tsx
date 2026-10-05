// Lastenheft je Version und wahlweise je Frontend: helle Druckansicht, über den Browser als PDF speicherbar.

import type { Store } from "../app/store";
import { PRE_TYPE, PRIO, STATUS, type Project } from "../domain/types";
import { report, type MenuIndex, type ReportItem } from "../domain/view";
import { Chip } from "./parts";

function Item({ it }: { it: ReportItem }) {
  const { info, storyText, preList } = it;
  const r = info.r;
  return (
    <div class={"item" + (it.part ? " part" : "")}>
      <div class="item-head">
        <span class="k">{r.key}</span>
        <b style="font-size:11.5pt">{r.title || "Ohne Titel"}</b>
        <span class="r">
          {PRIO[r.prio].label} · {STATUS[r.status].label}
        </span>
      </div>
      <div style="font-size:9pt;color:#6b7978">
        {info.path}
        {info.also.length > 0 && " · betrifft auch: " + info.also.join(", ")}
        {info.parent && !it.part && " · Teil von " + info.parent.key}
      </div>
      {r.desc.trim() && <div style="text-wrap:pretty;white-space:pre-wrap">{r.desc}</div>}
      {storyText && <div style="font-style:italic;color:#3d4d4c">{storyText}</div>}
      {r.criteria.length > 0 && (
        <ul>
          {r.criteria.map((c) => (
            <li key={c.id}>{c.text}</li>
          ))}
        </ul>
      )}
      {preList && <div style="font-size:9.5pt;color:#3d4d4c">Voraussetzungen: {preList}</div>}
    </div>
  );
}

export function Report({ s, p, ix, versionId }: { s: Store; p: Project; ix: MenuIndex; versionId: string }) {
  const feId = p.frontends.some((f) => f.id === s.ui.reportFe) ? s.ui.reportFe : null;
  const rep = report(p, ix, versionId, feId);
  return (
    <div class="report">
      <div class="report-bar">
        <span style="font-weight:600;margin-right:10px">Lastenheft</span>
        {p.versions.map((v) => (
          <Chip key={v.id} mono on={v.id === versionId} onClick={() => s.set({ report: v.id })}>
            {v.name}
          </Chip>
        ))}
        {ix.multi && (
          <>
            <span class="tiny dim" style="margin-left:14px">
              Frontend
            </span>
            <Chip on={!feId} onClick={() => s.set({ reportFe: null })}>
              Alle
            </Chip>
            {p.frontends.map((f) => (
              <Chip key={f.id} on={feId === f.id} onClick={() => s.set({ reportFe: f.id })}>
                {f.name}
              </Chip>
            ))}
          </>
        )}
        <button type="button" class="btn primary" style="margin-left:auto" onClick={() => window.print()}>
          Drucken / als PDF speichern
        </button>
        <button type="button" class="btn" onClick={() => s.set({ report: null })}>
          Schließen
        </button>
      </div>
      {rep && (
        <article class="paper">
          <div class="kicker">Lastenheft · {new Date().toLocaleDateString("de-DE")}</div>
          <h1>{p.name}</h1>
          <div class="sub">
            Version {rep.version}
            {rep.frontend && " · " + rep.frontend}
          </div>
          <div class="facts">
            <span>
              <b>{rep.total}</b> Anforderungen
            </span>
            <span>
              <b>{rep.must}</b> Must
            </span>
            <span>
              <b>{rep.done}</b> erledigt
            </span>
            <span>
              <b>{rep.preOpen}</b> offene Voraussetzungen
            </span>
          </div>
          {rep.sections.map((sec) => (
            <div key={sec.name}>
              {sec.name && <div class="fe-title">{sec.name}</div>}
              {sec.phases.map((ph) => (
                <section key={ph.name} style="margin-top:28px">
                  <h2>
                    {ph.name} <small>· {ph.items.length}</small>
                  </h2>
                  {ph.items.map((it) => (
                    <Item key={it.info.r.id} it={it} />
                  ))}
                </section>
              ))}
            </div>
          ))}
          {rep.total === 0 && <p style="color:#6b7978;margin-top:24px">{rep.frontend ? "Für dieses Frontend sind in dieser Version noch keine Anforderungen eingeplant." : "Dieser Version sind noch keine Anforderungen zugeordnet."}</p>}
          {rep.pre.length > 0 && (
            <section style="margin-top:36px">
              <h2>Voraussetzungen</h2>
              {rep.pre.map((q) => (
                <div key={q.id} class="pre-line">
                  <span>{q.title}</span>
                  <span style="color:#6b7978">{PRE_TYPE[q.type]}</span>
                  <span style={{ color: q.done ? "#0f6e6a" : "#a3611a" }}>{q.done ? "erfüllt" : "offen"}</span>
                </div>
              ))}
            </section>
          )}
        </article>
      )}
    </div>
  );
}
