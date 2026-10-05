// Detailansicht einer Anforderung (rechts als Spalte, am Handy als ganze Seite).

import { useEffect, useRef, useState } from "preact/hooks";
import type { Store } from "../app/store";
import { cmpKey, uid } from "../domain/model";
import { PRE_TYPE, PRIO, PRIOS, STATUS, STATUSES, type Attachment, type PreType, type Project, type Req } from "../domain/types";
import { liveReqs, reqInfo, storyText, type MenuIndex } from "../domain/view";
import { Check, Chip, fmtDateTime, fmtSize, PrioBadge, StatusDot, val } from "./parts";

function AttachmentTile({ s, pid, reqId, a }: { s: Store; pid: string; reqId: string; a: Attachment }) {
  const [url, setUrl] = useState<string | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "missing">("loading");
  useEffect(() => {
    let alive = true;
    setState("loading");
    s.attachmentUrl(pid, a)
      .then((u) => {
        if (!alive) return;
        setUrl(u);
        setState(u ? "ok" : "missing");
      })
      .catch(() => alive && setState("missing"));
    return () => {
      alive = false;
    };
  }, [a.id, s.cfg]);
  const isImg = /^image\//.test(a.type);
  const ext = (a.name.split(".").pop() || "").toUpperCase();
  return (
    <div class="att">
      {state === "ok" && url ? (
        <a class="thumb" href={url} download={a.name} target="_blank" rel="noopener" title="Öffnen oder herunterladen">
          {isImg ? <img src={url} alt={a.name} /> : <span class="mono" style="font-size:12px">{ext}</span>}
        </a>
      ) : (
        <span class="thumb tiny" style="cursor:default;padding:6px">
          {state === "loading" ? "lädt …" : s.cfg ? "nicht verfügbar" : "liegt auf einem anderen Gerät"}
        </span>
      )}
      <div class="cap">
        <span class="grow cut tiny muted" title={a.name + " · " + fmtSize(a.size)}>
          {a.name}
        </span>
        <button type="button" class="icon-btn" style="font-size:13px;padding:0 2px" title="Anhang entfernen" onClick={() => s.removeAttachment(reqId, a.id)}>
          ×
        </button>
      </div>
    </div>
  );
}

export function Detail({ s, p, ix, r }: { s: Store; p: Project; ix: MenuIndex; r: Req }) {
  const id = r.id;
  const info = reqInfo(p, ix, r);
  const [newCrit, setNewCrit] = useState("");
  const [newPre, setNewPre] = useState("");
  const [newPart, setNewPart] = useState("");
  const [newPreType, setNewPreType] = useState<PreType>("tech");
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    setNewCrit("");
    setNewPre("");
    setNewPart("");
  }, [id]);

  const version = info.version;
  const isPart = !!info.parent;
  const fe = r.fe ?? p.frontends[0].id;
  const menuOptions = ix.dfs.filter((x) => x.m.fe === fe);
  const addCrit = () => {
    const t = newCrit.trim();
    if (!t) return;
    s.upd(id, (x) => x.criteria.push({ id: uid("c"), text: t, done: false }));
    setNewCrit("");
  };
  const addPre = (type: PreType) => {
    const t = newPre.trim();
    if (!t) return;
    const qid = s.addPrereq(t, type);
    s.upd(id, (x) => x.prereqIds.push(qid));
    setNewPre("");
  };
  // Der Text kommt beim Bestätigen direkt aus dem Feld, damit auch sehr schnelles Tippen plus Enter ankommt.
  const addPart = (text = newPart) => {
    const t = text.trim();
    if (!t) return;
    s.addPart(id, t);
    setNewPart("");
  };
  const unlinked = p.prereqs.filter((q) => !r.prereqIds.includes(q.id));
  const critDone = r.criteria.filter((c) => c.done).length;
  const sentence = storyText(r);
  // Mögliche große Anforderungen: eigenständig, nicht diese selbst.
  const hosts = !isPart && info.parts.length === 0 ? liveReqs(p).filter((x) => !x.parentId && x.id !== id).sort((a, b) => cmpKey(a.key, b.key)) : [];

  return (
    <div class="drawer">
      <div class="drawer-head">
        <span class="mono" style="font-size:12px;color:var(--accent)">
          {r.key}
        </span>
        <span class="tiny dim cut">{info.path}</span>
        <button type="button" class="icon-btn plain" style="margin-left:auto;font-size:18px;padding:2px 6px" title="Schließen (Esc)" onClick={() => s.set({ selReq: null })}>
          ×
        </button>
      </div>
      <div class="drawer-body">
        {info.parent && (
          <div class="part-of">
            <span class="dim">Teil von</span>
            <button type="button" class="linklike cut" onClick={() => s.set({ selReq: info.parent!.id })}>
              <span class="mono">{info.parent.key}</span> {info.parent.title || "Ohne Titel"}
            </button>
            <button type="button" class="btn sm quiet" style="margin-left:auto" title="Wird wieder eine eigenständige Anforderung mit eigener Nummer" onClick={() => s.setParent(id, null)}>
              Herauslösen
            </button>
          </div>
        )}
        <textarea class="ghost title-input" rows={2} placeholder="Titel der Anforderung" value={r.title} onInput={(e) => s.upd(id, (x) => (x.title = val(e).replace(/\n/g, " ")))} />

        <div class="two">
          <div class="fld">
            <span>Priorität (MoSCoW)</span>
            <div class="seg prio-seg">
              {PRIOS.map((k) => (
                <button key={k} type="button" class={(r.prio === k ? "on " : "") + k} title={PRIO[k].label} onClick={() => s.upd(id, (x) => (x.prio = k))}>
                  {k}
                </button>
              ))}
            </div>
          </div>
          <div class="fld">
            <span>Status</span>
            <div class="seg">
              {STATUSES.map((k) => (
                <button key={k} type="button" class={r.status === k ? "on" : ""} onClick={() => s.upd(id, (x) => (x.status = k))}>
                  {STATUS[k].label}
                </button>
              ))}
            </div>
          </div>
          {info.partsWarn && <div class="err-box wide">Steht auf Erledigt, obwohl Teilanforderungen noch offen sind.</div>}
          {ix.multi && (
            <label class="fld wide">
              <span>Frontend{isPart ? " (folgt " + info.parent!.key + ")" : ""}</span>
              <select
                class="field"
                disabled={isPart}
                value={fe}
                onChange={(e) => {
                  const v = val(e);
                  s.upd(id, (x, d) => {
                    x.fe = v;
                    // Der bisherige Menüpunkt gehört zu einem anderen Frontend.
                    if (d.menu.find((m) => m.id === x.menuId)?.fe !== v) x.menuId = null;
                  });
                }}
              >
                {p.frontends.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label class="fld wide">
            <span>Menüpunkt{isPart ? " (folgt " + info.parent!.key + ")" : ""}</span>
            <select class="field" disabled={isPart} value={r.menuId && ix.byId.has(r.menuId) ? r.menuId : ""} onChange={(e) => s.upd(id, (x) => (x.menuId = val(e) || null))}>
              <option value="">— Ohne Menüpunkt —</option>
              {menuOptions.map((x) => (
                <option key={x.m.id} value={x.m.id}>
                  {"   ".repeat(x.depth) + x.m.name}
                </option>
              ))}
            </select>
          </label>
          {ix.multi && (
            <div class="fld wide">
              <span>Betrifft auch</span>
              <div class="hrow">
                {p.frontends
                  .filter((f) => f.id !== fe)
                  .map((f) => (
                    <Chip key={f.id} on={r.also.includes(f.id)} onClick={() => s.upd(id, (x) => (x.also = x.also.includes(f.id) ? x.also.filter((y) => y !== f.id) : [...x.also, f.id]))}>
                      {f.name}
                    </Chip>
                  ))}
              </div>
            </div>
          )}
          <label class="fld">
            <span>Version</span>
            <select
              class="field"
              value={version ? version.id : ""}
              onChange={(e) => {
                const v = p.versions.find((x) => x.id === val(e)) ?? null;
                s.move(id, v ? v.id : null, v?.phases[0]?.id ?? null);
              }}
            >
              <option value="">Nicht eingeplant</option>
              {p.versions.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
          </label>
          <label class="fld">
            <span>Phase</span>
            <select class="field" disabled={!version} value={info.phase ? info.phase.id : ""} onChange={(e) => s.move(id, r.versionId, val(e) || null)}>
              <option value="">{version ? "— ohne Phase —" : "—"}</option>
              {version?.phases.map((ph) => (
                <option key={ph.id} value={ph.id}>
                  {ph.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div class="fld">
          <span>Beschreibung</span>
          <textarea class="field" rows={3} style="resize:vertical" placeholder="Was soll umgesetzt werden?" value={r.desc} onInput={(e) => s.upd(id, (x) => (x.desc = val(e)))} />
        </div>

        {!isPart && (
          <div class="sec">
            <div class="sec-head">
              <span class="label">Teilanforderungen</span>
              <span class={"mono " + (info.partsWarn ? "warn" : "dim")} style="margin-left:auto">
                {info.parts.length ? info.partsDone + " von " + info.parts.length + " erledigt" : ""}
              </span>
            </div>
            {info.parts.map((c) => (
              <button key={c.id} type="button" class="part-row" onClick={() => s.set({ selReq: c.id })} title="Teilanforderung öffnen">
                <StatusDot status={c.status} />
                <span class="mono muted">{c.key}</span>
                <PrioBadge prio={c.prio} />
                <span class={"cut grow" + (c.title ? "" : " untitled")}>{c.title || "Ohne Titel"}</span>
                <span class="dim">›</span>
              </button>
            ))}
            <input
              class="field dashed"
              style="padding:6px 8px"
              placeholder="Neue Teilanforderung + Enter"
              value={newPart}
              onInput={(e) => setNewPart(val(e))}
              onKeyDown={(e) => {
                if (e.key === "Enter") addPart((e.target as HTMLInputElement).value);
              }}
            />
            {info.parts.length === 0 && hosts.length > 0 && (
              <select
                class="field dashed muted"
                style="padding:6px 8px"
                value=""
                onChange={(e) => {
                  const v = val(e);
                  (e.target as HTMLSelectElement).value = "";
                  if (v) s.setParent(id, v);
                }}
              >
                <option value="">Diese Anforderung zu einem Teil machen von …</option>
                {hosts.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.key} {h.title || "Ohne Titel"}
                  </option>
                ))}
              </select>
            )}
            <span class="small dim">
              Teile liegen im selben Menüpunkt und Frontend, haben aber eigene Priorität, Version und Phase. Den Status dieser Anforderung setzt du weiter selbst.
            </span>
          </div>
        )}

        <div class="sec" style="gap:8px">
          <span class="label">User Story</span>
          <span class="small dim">
            Freiwillig. Beschreibt die Anforderung aus Sicht der Person, die sie nutzt. Beispiel: Als <i>Kundin</i> möchte ich <i>meine Bestellungen filtern</i>, damit <i>ich eine alte Rechnung schnell finde</i>.
          </span>
          <div class="story">
            <span>Wer?</span>
            <input class="field" style="padding:6px 8px" placeholder={"Rolle, z. B. " + (ix.multi && info.feName ? info.feName : "Kundin")} value={r.story.role} onInput={(e) => s.upd(id, (x) => (x.story.role = val(e)))} />
            <span>Was will die Person tun?</span>
            <input class="field" style="padding:6px 8px" placeholder="z. B. meine Bestellungen filtern" value={r.story.goal} onInput={(e) => s.upd(id, (x) => (x.story.goal = val(e)))} />
            <span>Wozu?</span>
            <input class="field" style="padding:6px 8px" placeholder="z. B. ich eine alte Rechnung schnell finde" value={r.story.benefit} onInput={(e) => s.upd(id, (x) => (x.story.benefit = val(e)))} />
          </div>
          {sentence && <div class="story-out">{sentence}</div>}
        </div>

        <div class="sec">
          <div class="sec-head">
            <span class="label">Akzeptanzkriterien</span>
            <span class="mono dim" style="margin-left:auto">
              {r.criteria.length ? critDone + "/" + r.criteria.length + " erfüllt" : ""}
            </span>
          </div>
          {r.criteria.map((c) => (
            <div key={c.id} class="crit">
              <Check done={c.done} onToggle={() => s.upd(id, (x) => x.criteria.forEach((y) => y.id === c.id && (y.done = !y.done)))} />
              <input class={"ghost" + (c.done ? " done-text" : "")} value={c.text} onInput={(e) => s.upd(id, (x) => x.criteria.forEach((y) => y.id === c.id && (y.text = val(e))))} />
              <button type="button" class="icon-btn" title="Kriterium entfernen" onClick={() => s.upd(id, (x) => (x.criteria = x.criteria.filter((y) => y.id !== c.id)))}>
                ×
              </button>
            </div>
          ))}
          <input
            class="field dashed"
            style="padding:6px 8px"
            placeholder="Neues Kriterium + Enter"
            value={newCrit}
            onInput={(e) => setNewCrit(val(e))}
            onKeyDown={(e) => {
              if (e.key === "Enter") addCrit();
            }}
            onBlur={addCrit}
          />
        </div>

        <div class="sec">
          <div class="sec-head">
            <span class="label">Voraussetzungen</span>
            <span class={"mono " + (info.preOpen ? "warn" : "dim")} style="margin-left:auto">
              {info.links.length ? info.links.length - info.preOpen + "/" + info.links.length + " erfüllt" : ""}
            </span>
          </div>
          {info.links.map((q) => (
            <div key={q.id} class="link-row">
              <Check done={q.done} title="Erfüllt umschalten" onToggle={() => s.editPre(q.id, (x) => (x.done = !x.done))} />
              <span class={q.done ? "done-text" : ""}>{q.title}</span>
              <span class="tag">{PRE_TYPE[q.type]}</span>
              <button type="button" class="icon-btn" title="Verknüpfung lösen" onClick={() => s.upd(id, (x) => (x.prereqIds = x.prereqIds.filter((i) => i !== q.id)))}>
                ×
              </button>
            </div>
          ))}
          {unlinked.length > 0 && (
            <select
              class="field dashed muted"
              style="padding:6px 8px"
              value=""
              onChange={(e) => {
                const v = val(e);
                (e.target as HTMLSelectElement).value = "";
                if (v) s.upd(id, (x) => !x.prereqIds.includes(v) && x.prereqIds.push(v));
              }}
            >
              <option value="">Vorhandene Voraussetzung verknüpfen …</option>
              {unlinked.map((q) => (
                <option key={q.id} value={q.id}>
                  {q.title} ({PRE_TYPE[q.type]})
                </option>
              ))}
            </select>
          )}
          <div style="display:flex;gap:6px;flex-wrap:wrap">
            <input
              class="field dashed grow"
              style="padding:6px 8px;min-width:140px"
              placeholder="Neue Voraussetzung anlegen"
              value={newPre}
              onInput={(e) => setNewPre(val(e))}
              onKeyDown={(e) => {
                if (e.key === "Enter") addPre(newPreType);
              }}
            />
            {(["tech", "user"] as PreType[]).map((k) => (
              <Chip
                key={k}
                on={newPreType === k}
                title={newPre.trim() ? "Als " + PRE_TYPE[k] + " anlegen" : PRE_TYPE[k]}
                onClick={() => {
                  setNewPreType(k);
                  addPre(k);
                }}
              >
                {k === "tech" ? "Techn." : "Anwender"}
              </Chip>
            ))}
          </div>
        </div>

        <div class="sec" style="gap:8px">
          <div style="display:flex;align-items:center">
            <span class="label">Anhänge</span>
            <button type="button" class="btn sm" style="margin-left:auto" onClick={() => fileRef.current?.click()}>
              + Datei
            </button>
            <input
              ref={fileRef}
              type="file"
              multiple
              accept="image/*,application/pdf"
              style="display:none"
              onChange={(e) => {
                const input = e.target as HTMLInputElement;
                if (input.files) void s.addFiles(id, Array.from(input.files));
                input.value = "";
              }}
            />
          </div>
          {r.attachments.length > 0 && (
            <div class="atts">
              {r.attachments.map((a) => (
                <AttachmentTile key={a.id} s={s} pid={p.id} reqId={id} a={a} />
              ))}
            </div>
          )}
          {r.attachments.length === 0 && <span class="small dim">Screenshots oder PDFs bis 10 MB. {s.cfg ? "Sie werden verschlüsselt mit abgeglichen." : "Ohne Abgleich bleiben sie auf diesem Gerät."}</span>}
        </div>

        <div class="sec">
          <span class="label">Verlauf</span>
          {r.history.map((h, i) => (
            <div key={i} class="hist">
              <span class="mono dim">{fmtDateTime(h.date)}</span>
              <span style="color:var(--text-2)">
                <span class="muted">{h.from}</span> → {h.to}
              </span>
            </div>
          ))}
          {r.history.length === 0 && <span class="small dim">Noch nicht verschoben.</span>}
        </div>

        <div class="sec" style="padding-top:16px">
          <div>
            <button type="button" class="btn sm danger" style="padding:6px 11px" onClick={() => s.trashReq(id)}>
              {info.parts.length ? "Mit " + info.parts.length + " Teilen in den Papierkorb" : "In den Papierkorb"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
