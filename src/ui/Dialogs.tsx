// Dialoge: Versionen & Phasen, Projekte, Papierkorb, Einstellungen (Darstellung und Abgleich).

import { useRef, useState } from "preact/hooks";
import type { Store } from "../app/store";
import { planOrder, previewFeedback } from "../domain/order";
import { BRIEF_FIELDS, STATUS, type Project } from "../domain/types";
import { liveReqs, trashedReqs } from "../domain/view";
import { randomPassword } from "../storage/crypto";
import { DEFAULT_REPO } from "../storage/github";
import type { Theme } from "../storage/local";
import { Chip, Dialog, fmtDateTime, PrioBadge, val } from "./parts";

const close = (s: Store) => () => s.set({ dialog: null });

// ---------------------------------------------------------------- Versionen & Phasen

export function VersionsDialog({ s, p }: { s: Store; p: Project }) {
  const live = liveReqs(p);
  return (
    <Dialog title="Versionen & Phasen" onClose={close(s)}>
      {p.versions.map((v) => (
        <div key={v.id} class="vbox">
          <div class="hrow">
            <input
              class="field mono"
              style="width:140px;font-size:13px;color:var(--accent);padding:6px 8px"
              value={v.name}
              onInput={(e) => s.edit((d) => d.versions.forEach((x) => x.id === v.id && (x.name = val(e))))}
            />
            <span class="small dim">{live.filter((r) => r.versionId === v.id).length} Anforderungen</span>
            <button type="button" class="btn sm danger" style="margin-left:auto;padding:4px 9px;border-color:var(--line);color:var(--muted)" onClick={() => s.removeVersion(v.id)}>
              Version löschen
            </button>
          </div>
          {v.phases.map((ph, i) => (
            <div key={ph.id} class="hrow" style="padding-left:16px;flex-wrap:nowrap">
              <span class="mono dim" style="width:18px">
                {i + 1}
              </span>
              <input
                class="field grow"
                style="padding:5px 8px"
                value={ph.name}
                onInput={(e) => s.edit((d) => d.versions.forEach((x) => x.id === v.id && x.phases.forEach((y) => y.id === ph.id && (y.name = val(e)))))}
              />
              <span class="mono dim" style="width:22px;text-align:right">
                {live.filter((r) => r.versionId === v.id && r.phaseId === ph.id).length}
              </span>
              <button type="button" class="icon-btn" title="Phase löschen" onClick={() => s.removePhase(v.id, ph.id)}>
                ×
              </button>
            </div>
          ))}
          <button type="button" class="btn sm dashed" style="align-self:flex-start;margin-left:42px;padding:4px 10px" onClick={() => s.addPhase(v.id)}>
            + Phase
          </button>
        </div>
      ))}
      <button type="button" class="btn primary" style="align-self:flex-start" onClick={() => s.addVersion()}>
        + Version
      </button>
      <span class="note">Beim Löschen einer Phase oder Version werden die betroffenen Anforderungen auf „nicht eingeplant“ gesetzt und im Verlauf vermerkt.</span>
    </Dialog>
  );
}

// ---------------------------------------------------------------- Projekte

export function NewProject({ s }: { s: Store }) {
  const [name, setName] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const create = () => {
    s.createProject(name);
    setName("");
  };
  return (
    <>
      <div class="hrow" style="flex-wrap:nowrap">
        <input
          class="field grow"
          placeholder="Name des neuen Projekts, z. B. Kundenportal"
          value={name}
          onInput={(e) => setName(val(e))}
          onKeyDown={(e) => {
            if (e.key === "Enter") create();
          }}
        />
        <button type="button" class="btn primary" onClick={create}>
          Anlegen
        </button>
      </div>
      <div class="hrow">
        <button type="button" class="btn" onClick={() => s.loadDemo()}>
          Beispielprojekt laden
        </button>
        <button type="button" class="btn" onClick={() => fileRef.current?.click()}>
          Aus Datei importieren
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          style="display:none"
          onChange={(e) => {
            const input = e.target as HTMLInputElement;
            const f = input.files?.[0];
            input.value = "";
            if (f) void s.importFile(f);
          }}
        />
      </div>
    </>
  );
}

export function ProjectsDialog({ s }: { s: Store }) {
  const list = s.visible();
  return (
    <Dialog title="Projekte" onClose={close(s)}>
      {list.map((p) => (
        <div key={p.id} class="vbox">
          <div class="hrow" style="flex-wrap:nowrap">
            <input class="field grow" style="font-weight:600" value={p.name} onInput={(e) => s.editProject(p.id, (d) => (d.name = val(e)))} />
            {p.id === s.ui.projectId ? (
              <span class="tag">geöffnet</span>
            ) : (
              <button
                type="button"
                class="btn sm"
                onClick={() => {
                  s.selectProject(p.id);
                  s.set({ dialog: null });
                }}
              >
                Öffnen
              </button>
            )}
          </div>
          <div class="hrow">
            <span class="small dim grow">
              {liveReqs(p).length} Anforderungen · {p.versions.length} Versionen
            </span>
            <button
              type="button"
              class="btn sm"
              onClick={() => {
                s.selectProject(p.id);
                s.set({ dialog: "brief" });
              }}
            >
              Steckbrief
            </button>
            <button type="button" class="btn sm" onClick={() => void s.exportProject(p.id)}>
              Export
            </button>
            <button
              type="button"
              class="btn sm danger"
              onClick={() => {
                if (confirm("Projekt „" + p.name + "“ mit allen Anforderungen und Anhängen löschen? Das gilt für alle Geräte und lässt sich nicht rückgängig machen.")) s.deleteProject(p.id);
              }}
            >
              Löschen
            </button>
          </div>
        </div>
      ))}
      {list.length === 0 && <span class="dim">Noch kein Projekt vorhanden.</span>}
      <span class="label" style="margin-top:6px">
        Neues Projekt
      </span>
      <NewProject s={s} />
      <span class="note">Der Export enthält das Projekt samt Anhängen als lesbare JSON-Datei. Ein Import legt immer ein neues Projekt an.</span>
    </Dialog>
  );
}

// ---------------------------------------------------------------- Papierkorb

export function TrashDialog({ s, p }: { s: Store; p: Project }) {
  const list = trashedReqs(p);
  return (
    <Dialog title="Papierkorb" onClose={close(s)}>
      {list.map((r) => (
        <div key={r.id} class="hrow" style="border-bottom:1px solid var(--line-soft);padding-bottom:10px">
          <PrioBadge prio={r.prio} />
          <span class="mono muted">{r.key}</span>
          <span class={"grow" + (r.title ? "" : " untitled")} style="min-width:140px">
            {r.title || "Ohne Titel"}
            <br />
            <span class="tiny dim">gelöscht am {fmtDateTime(r.deletedAt ?? 0)}</span>
          </span>
          <button type="button" class="btn sm" onClick={() => s.restoreReq(r.id)}>
            Wiederherstellen
          </button>
          <button
            type="button"
            class="btn sm danger"
            onClick={() => {
              if (confirm(r.key + " endgültig löschen?")) s.purgeReqs([r.id]);
            }}
          >
            Endgültig löschen
          </button>
        </div>
      ))}
      {list.length === 0 && <span class="dim">Der Papierkorb ist leer.</span>}
      {list.length > 0 && (
        <button
          type="button"
          class="btn danger"
          style="align-self:flex-start"
          onClick={() => {
            if (confirm(list.length + " Anforderungen endgültig löschen?")) s.purgeReqs(list.map((r) => r.id));
          }}
        >
          Papierkorb leeren
        </button>
      )}
      <span class="note">Gelöschte Anforderungen bleiben hier, bis du sie endgültig löschst. Ihre Nummer wird nicht neu vergeben.</span>
    </Dialog>
  );
}

// ---------------------------------------------------------------- Einstellungen

const THEMES: [Theme, string][] = [
  ["auto", "Wie das Gerät"],
  ["light", "Hell"],
  ["dark", "Dunkel"],
];

export function SettingsDialog({ s }: { s: Store }) {
  const [repo, setRepo] = useState(s.cfg?.repo ?? DEFAULT_REPO);
  const [token, setToken] = useState(s.cfg?.token ?? "");
  const [password, setPassword] = useState(s.cfg?.password ?? "");
  const [msg, setMsg] = useState<string | null>(null);
  const theme = s.prefs.theme ?? "auto";
  const connected = !!s.cfg;

  const connect = async () => {
    setMsg(null);
    if (!/^[^/\s]+\/[^/\s]+$/.test(repo.trim())) return setMsg("Repo bitte als besitzer/name angeben.");
    if (!token.trim()) return setMsg("Bitte den Zugangsschlüssel eintragen.");
    if (password.length < 12) return setMsg("Das Passwort braucht mindestens 12 Zeichen.");
    const before = s.cfg;
    s.saveGitHub({ repo: repo.trim(), token: token.trim(), password });
    const ok = await s.syncNow();
    if (ok) s.flash("Abgleich eingerichtet");
    else if (!before) {
      // Erste Einrichtung fehlgeschlagen: nicht als verbunden merken.
      const err = s.ui.syncErr;
      s.saveGitHub(null);
      setMsg(err ?? "Abgleich fehlgeschlagen.");
    }
  };

  return (
    <Dialog title="Einstellungen" onClose={close(s)}>
      <span class="label">Darstellung</span>
      <div class="hrow">
        {THEMES.map(([k, l]) => (
          <Chip key={k} on={theme === k} onClick={() => s.setTheme(k)}>
            {l}
          </Chip>
        ))}
      </div>

      <span class="label" style="margin-top:8px">
        Abgleich zwischen Geräten
      </span>
      <span class="small muted">
        {connected
          ? s.ui.syncBusy
            ? "Abgleich läuft …"
            : s.meta.lastSync
              ? "Verbunden. Letzter Abgleich: " + fmtDateTime(s.meta.lastSync) + "."
              : "Verbunden, noch nicht abgeglichen."
          : "Nicht eingerichtet. Die Daten liegen nur in diesem Browser."}
      </span>
      {(msg || (connected && s.ui.syncErr)) && <div class="err-box">{msg || s.ui.syncErr}</div>}

      <label class="fld">
        <span>Privates GitHub-Repo für die Daten</span>
        <input class="field" value={repo} onInput={(e) => setRepo(val(e))} autocomplete="off" spellcheck={false} />
      </label>
      <label class="fld">
        <span>Zugangsschlüssel (Fine-grained Token)</span>
        <input class="field mono" style="font-size:12px" type="password" value={token} onInput={(e) => setToken(val(e))} autocomplete="off" placeholder="github_pat_…" />
      </label>
      <label class="fld">
        <span>Passwort der Verschlüsselung (auf allen Geräten gleich)</span>
        <div class="hrow" style="flex-wrap:nowrap">
          <input class="field mono grow" style="font-size:12px" value={password} onInput={(e) => setPassword(val(e))} autocomplete="off" spellcheck={false} />
          <button type="button" class="btn sm" title="Nur auf dem ersten Gerät: zufälliges Passwort erzeugen" onClick={() => setPassword(randomPassword())}>
            Erzeugen
          </button>
        </div>
      </label>
      <div class="hrow">
        <button type="button" class="btn primary" disabled={s.ui.syncBusy} onClick={() => void connect()}>
          {connected ? "Speichern und abgleichen" : "Verbinden und abgleichen"}
        </button>
        {connected && (
          <button
            type="button"
            class="btn danger"
            onClick={() => {
              if (!confirm("Abgleich auf diesem Gerät trennen? Die Daten bleiben hier und im Repo erhalten.")) return;
              s.saveGitHub(null);
              setToken("");
              setPassword("");
              s.flash("Abgleich getrennt");
            }}
          >
            Trennen
          </button>
        )}
      </div>
      <ol class="steps">
        <li>Auf github.com unter Settings → Developer settings → Fine-grained tokens einen Token erzeugen.</li>
        <li>Repository access: „Only select repositories“ und nur das Daten-Repo wählen.</li>
        <li>Permissions → Repository → Contents: „Read and write“.</li>
        <li>Auf dem ersten Gerät ein Passwort erzeugen und im Passwort-Manager ablegen. Auf jedem weiteren Gerät dasselbe Passwort eintragen.</li>
      </ol>
      <span class="note">
        Projekte und Anhänge werden vor dem Hochladen mit dem Passwort verschlüsselt. Ohne das Passwort sind die Dateien im Repo nicht lesbar, auch nicht für dich. Schlüssel und Passwort bleiben nur in diesem Browser gespeichert.
      </span>
    </Dialog>
  );
}

// ---------------------------------------------------------------- Steckbrief

export function BriefDialog({ s, p }: { s: Store; p: Project }) {
  const filled = BRIEF_FIELDS.filter((f) => p.brief[f.key].trim()).length;
  return (
    <Dialog title={"Steckbrief: " + p.name} onClose={close(s)}>
      <span class="small muted">
        Rahmenbedingungen für die Umsetzung, die in keiner einzelnen Anforderung stehen. Der Steckbrief liegt jedem Auftrag bei. Leere Felder kläre ich vor dem Bau mit dir. {filled} von {BRIEF_FIELDS.length} ausgefüllt.
      </span>
      {BRIEF_FIELDS.map((f) => (
        <label key={f.key} class="fld">
          <span>{f.label}</span>
          <textarea class="field" rows={f.key === "codePath" ? 1 : 2} style="resize:vertical" placeholder={f.hint} value={p.brief[f.key]} onInput={(e) => s.setBrief(f.key, val(e))} />
        </label>
      ))}
      <div class="hrow">
        <button type="button" class="btn" onClick={() => s.set({ dialog: "order" })}>
          Zur Umsetzung
        </button>
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------- Umsetzung: Auftrag und Rückmeldung

function FeedbackPreviewBox({ s, p }: { s: Store; p: Project }) {
  const f = s.ui.feedback!;
  const pre = previewFeedback(p, f);
  const nothing = pre.changes.every((c) => !c.statusTo && !c.criteriaTicked.length && !c.criteriaAdded.length && !c.descChanged && !c.note);
  return (
    <div class="vbox">
      <span style="font-weight:600">Vorschau der Rückmeldung {f.orderId && <span class="mono dim">{f.orderId}</span>}</span>
      {!pre.projectOk && <div class="err-box">Diese Rückmeldung gehört zu einem anderen Projekt. Bitte das passende Projekt öffnen.</div>}
      {f.summary && <span class="small muted" style="white-space:pre-wrap">{f.summary}</span>}
      {pre.changes.map((c) => (
        <div key={c.id} class="fb-row">
          <span>
            <span class="mono muted">{c.key}</span> {c.title || "Ohne Titel"}
          </span>
          <ul class="small">
            {c.statusTo && (
              <li>
                Status: {STATUS[c.statusFrom].label} → <b>{STATUS[c.statusTo].label}</b>
              </li>
            )}
            {c.criteriaTicked.map((t) => (
              <li key={"t" + t}>Kriterium erfüllt: {t}</li>
            ))}
            {c.criteriaAdded.map((t) => (
              <li key={"a" + t}>Neues Kriterium: {t}</li>
            ))}
            {c.descChanged && <li>Beschreibung wird ergänzt</li>}
            {c.note && <li class="muted">Notiz: {c.note}</li>}
            {!c.statusTo && !c.criteriaTicked.length && !c.criteriaAdded.length && !c.descChanged && !c.note && <li class="dim">keine Änderung</li>}
          </ul>
        </div>
      ))}
      {pre.unknown.length > 0 && <span class="small warn">Nicht gefunden und übersprungen: {pre.unknown.join(", ")}</span>}
      <div class="hrow">
        <button type="button" class="btn primary" disabled={!pre.projectOk || nothing} onClick={() => s.applyFeedback()}>
          Übernehmen
        </button>
        <button type="button" class="btn" onClick={() => s.set({ feedback: null })}>
          Verwerfen
        </button>
      </div>
      <span class="note">Umgesetzte Anforderungen bekommen den Status „Zu prüfen“. „Erledigt“ setzt du selbst nach deiner Abnahme.</span>
    </div>
  );
}

export function OrderDialog({ s, p }: { s: Store; p: Project }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const vId = s.curVersion();
  const v = p.versions.find((x) => x.id === vId) ?? null;
  const ph = v ? (v.phases.find((x) => x.id === s.ui.orderPhase) ?? v.phases[0] ?? null) : null;
  const plan = v && ph ? planOrder(p, v.id, ph.id) : null;
  const briefMissing = BRIEF_FIELDS.filter((f) => !p.brief[f.key].trim()).length;
  return (
    <Dialog title="Umsetzung mit Claude" onClose={close(s)} wide>
      <span class="small muted">Eine Phase als Auftrag exportieren, in Claude Code mit dem Befehl /umsetzen bauen lassen und danach die Rückmeldung hier einlesen.</span>

      <span class="label">1 · Auftrag exportieren</span>
      {!v && <span class="dim">Lege zuerst eine Version mit Phasen an und plane Anforderungen ein.</span>}
      {v && (
        <>
          <div class="hrow">
            <span class="tiny dim">Version</span>
            {p.versions.map((x) => (
              <Chip key={x.id} mono on={x.id === v.id} onClick={() => s.set({ boardVersion: x.id, orderPhase: null })}>
                {x.name}
              </Chip>
            ))}
          </div>
          <div class="hrow">
            <span class="tiny dim">Phase</span>
            {v.phases.map((x) => (
              <Chip key={x.id} on={x.id === ph?.id} onClick={() => s.set({ orderPhase: x.id })}>
                {x.name}
              </Chip>
            ))}
            {v.phases.length === 0 && <span class="dim">Diese Version hat noch keine Phase.</span>}
          </div>
        </>
      )}
      {plan && ph && v && (
        <div class="vbox">
          <span>
            <b>{plan.todo.length}</b> umzusetzen · {plan.done.length} schon umgesetzt · {plan.wont.length} Won’t
          </span>
          {plan.todo.some((r) => r.impl) && <span class="small warn">Darunter {plan.todo.filter((r) => r.impl).length} seit der Umsetzung geänderte Anforderungen. Der Auftrag stellt alt und neu gegenüber.</span>}
          {plan.thin.length > 0 && (
            <span class="small warn">
              Für die Umsetzung noch dünn: {plan.thin.map((t) => t.key + " (" + t.missing.join(", ") + ")").join(" · ")}. Der Export geht trotzdem, ich frage dann vor dem Bau nach.
            </span>
          )}
          {briefMissing > 0 && (
            <span class="small warn">
              Im Steckbrief fehlen {briefMissing} von {BRIEF_FIELDS.length} Angaben.{" "}
              <button type="button" class="linklike" onClick={() => s.set({ dialog: "brief" })}>
                Steckbrief öffnen
              </button>
            </span>
          )}
          <div class="hrow">
            <button
              type="button"
              class="btn primary"
              disabled={busy || plan.todo.length === 0}
              onClick={async () => {
                setBusy(true);
                await s.exportOrder(v.id, ph.id).catch(() => s.flash("Export fehlgeschlagen"));
                setBusy(false);
              }}
            >
              {busy ? "Stelle zusammen …" : "Auftrag exportieren (ZIP)"}
            </button>
            <button type="button" class="btn" onClick={() => s.set({ dialog: "brief" })}>
              Steckbrief
            </button>
          </div>
          <span class="note">Die ZIP-Datei enthält auftrag.json, eine lesbare AUFTRAG.md und die Anhänge der Anforderungen. Lass sie im Ordner Downloads liegen, der Befehl /umsetzen nimmt die neueste.</span>
        </div>
      )}

      <span class="label" style="margin-top:6px">
        2 · Rückmeldung einlesen
      </span>
      {s.ui.feedback ? (
        <FeedbackPreviewBox s={s} p={p} />
      ) : (
        <div class="hrow">
          <button type="button" class="btn" onClick={() => fileRef.current?.click()}>
            Rückmeldung wählen (rueckmeldung.json)
          </button>
          <span class="small dim">Du siehst erst eine Vorschau, geändert wird nichts ohne deine Bestätigung.</span>
        </div>
      )}
      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        style="display:none"
        onChange={(e) => {
          const input = e.target as HTMLInputElement;
          const f = input.files?.[0];
          input.value = "";
          if (f) void s.loadFeedback(f);
        }}
      />
    </Dialog>
  );
}
