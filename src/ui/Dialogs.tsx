// Dialoge: Versionen & Phasen, Projekte, Papierkorb, Einstellungen (Darstellung und Abgleich).

import { useRef, useState } from "preact/hooks";
import type { Store } from "../app/store";
import type { Project } from "../domain/types";
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
