// Lastenheft je Version: helle Druckansicht, über den Browser als PDF speicherbar.

import type { Store } from "../app/store";
import { PRE_TYPE, PRIO, STATUS, type Project } from "../domain/types";
import { report, type MenuIndex } from "../domain/view";
import { Chip } from "./parts";

export function Report({ s, p, ix, versionId }: { s: Store; p: Project; ix: MenuIndex; versionId: string }) {
  const rep = report(p, ix, versionId);
  return (
    <div class="report">
      <div class="report-bar">
        <span style="font-weight:600;margin-right:10px">Lastenheft</span>
        {p.versions.map((v) => (
          <Chip key={v.id} mono on={v.id === versionId} onClick={() => s.set({ report: v.id })}>
            {v.name}
          </Chip>
        ))}
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
          <div class="sub">Version {rep.version}</div>
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
          {rep.phases.map((ph) => (
            <section key={ph.name} style="margin-top:28px">
              <h2>
                {ph.name} <small>· {ph.items.length}</small>
              </h2>
              {ph.items.map(({ info, storyText, preList }) => {
                const r = info.r;
                return (
                  <div key={r.id} class="item">
                    <div class="item-head">
                      <span class="k">{r.key}</span>
                      <b style="font-size:11.5pt">{r.title || "Ohne Titel"}</b>
                      <span class="r">
                        {PRIO[r.prio].label} · {STATUS[r.status].label}
                      </span>
                    </div>
                    <div style="font-size:9pt;color:#6b7978">{info.path}</div>
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
              })}
            </section>
          ))}
          {rep.total === 0 && <p style="color:#6b7978;margin-top:24px">Dieser Version sind noch keine Anforderungen zugeordnet.</p>}
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
