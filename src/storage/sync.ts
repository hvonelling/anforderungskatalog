// Automatischer Abgleich mit einem privaten GitHub-Repo.
//
// Ablage im Repo:
//   projekte/<Name>--<Projekt-ID>.enc.json  je Projekt eine verschlüsselte Datei (der Name dient nur der Lesbarkeit)
//   anhaenge/<Projekt-ID>/<Anhang-ID>.bin   je Anhang eine verschlüsselte Datei
//
// Ablauf je Projekt: Datei holen → entschlüsseln → mit dem Stand dieses Geräts zusammenführen →
// nur wenn sich etwas geändert hat, verschlüsselt zurückschreiben. Hat ein anderes Gerät
// zwischendurch geschrieben, lehnt GitHub ab (veraltete Kennung); dann beginnt der Ablauf von vorn.

import { mergeProject, normalizeProject, sameProject } from "../domain/model";
import type { Project } from "../domain/types";
import type { BlobStore } from "./blobs";
import { decryptBytes, decryptText, encryptBytes, encryptText, isEncrypted } from "./crypto";
import { ConflictError, deleteFile, getRaw, getSha, listDir, putFile, type Fetch, type GitHubConfig } from "./github";

export const PROJECT_DIR = "projekte";
export const ATT_DIR = "anhaenge";
export const MAX_ATTACHMENT = 10 * 1024 * 1024;

/** Was sich dieses Gerät über den Stand im Repo merkt. */
export interface SyncState {
  /** Projekt-ID → Kennung der zuletzt gesehenen Datei im Repo */
  shas: Record<string, string>;
  /** Anhänge, die sicher im Repo liegen */
  attRemote: string[];
  /** Anhänge, die im Repo noch gelöscht werden müssen */
  attDel: { pid: string; id: string }[];
}
export const emptySyncState = (): SyncState => ({ shas: {}, attRemote: [], attDel: [] });

export interface SyncResult {
  projects: Project[];
  state: SyncState;
  /** Projekte, die ins Repo geschrieben wurden */
  pushed: number;
  /** Projekte, bei denen Änderungen von anderen Geräten ankamen */
  pulled: number;
  uploaded: number;
}

const EXT = ".enc.json";

/** Lesbarer Namensteil für die Datei im Repo: nur Buchstaben, Ziffern und einzelne Bindestriche. */
export function fileSlug(name: string): string {
  const map: Record<string, string> = { ä: "ae", ö: "oe", ü: "ue", Ä: "Ae", Ö: "Oe", Ü: "Ue", ß: "ss" };
  return name
    .replace(/[äöüÄÖÜß]/g, (ch) => map[ch])
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "");
}
/** Dateiname eines Projekts: "<Name>--<Kennung>.enc.json". Maßgeblich ist allein die Kennung. */
export function projectFile(p: { id: string; name: string }): string {
  const slug = fileSlug(p.name);
  return (slug ? slug + "--" : "") + p.id + EXT;
}
/** Kennung aus dem Dateinamen lesen. Versteht auch die frühere Form "<Kennung>.enc.json". */
export function idFromFile(file: string): string {
  const base = file.slice(0, -EXT.length);
  const i = base.lastIndexOf("--");
  return i < 0 ? base : base.slice(i + 2);
}
const projectPath = (file: string) => `${PROJECT_DIR}/${file}`;
export const attPath = (pid: string, id: string) => `${ATT_DIR}/${pid}/${id}.bin`;
const stampText = (now: number) => new Date(now).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

async function pack(p: Project, cfg: GitHubConfig): Promise<Uint8Array> {
  return new TextEncoder().encode(JSON.stringify(await encryptText(JSON.stringify(p), cfg.password), null, 1) + "\n");
}

async function unpack(bytes: Uint8Array, cfg: GitHubConfig): Promise<Project> {
  let j: unknown;
  try {
    j = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error("Eine Datei im Repo ist keine gültige Katalogdatei.");
  }
  if (!isEncrypted(j)) throw new Error("Eine Datei im Repo ist nicht verschlüsselt. Bitte nur verschlüsselte Dateien ablegen.");
  return normalizeProject(JSON.parse(await decryptText(j, cfg.password)));
}

/**
 * Ein Abgleich-Durchgang über alle Projekte.
 * dirty = Projekte, die auf diesem Gerät seit dem letzten Abgleich geändert wurden.
 * Wirft ConflictError, wenn ein anderes Gerät gerade geschrieben hat.
 */
export async function syncOnce(local: Project[], dirty: Set<string>, state: SyncState, cfg: GitHubConfig, blobs: BlobStore, f: Fetch = fetch, now = Date.now()): Promise<SyncResult> {
  const st: SyncState = { shas: { ...state.shas }, attRemote: [...state.attRemote], attDel: [...state.attDel] };
  const out = new Map(local.map((p) => [p.id, p]));
  let pushed = 0,
    pulled = 0,
    uploaded = 0;
  const msg = "Abgleich " + stampText(now);

  const remote = (await listDir(cfg, PROJECT_DIR, f)).filter((x) => x.name.endsWith(EXT));
  // Nach Kennung gruppieren: Nach einer Umbenennung können kurzzeitig zwei Dateien zu einem Projekt gehören.
  const byId = new Map<string, { name: string; sha: string }[]>();
  for (const file of remote) {
    const id = idFromFile(file.name);
    (byId.get(id) ?? byId.set(id, []).get(id)!).push(file);
  }
  for (const [id, files] of byId) {
    const mine = out.get(id);
    // Weder hier noch dort geändert, und die Datei heißt schon richtig.
    if (mine && files.length === 1 && files[0].name === projectFile(mine) && st.shas[id] === files[0].sha && !dirty.has(id)) continue;
    let merged: Project | null = mine ?? null;
    const contents = new Map<string, Project>();
    for (const file of files) {
      const bytes = await getRaw(cfg, projectPath(file.name), f);
      if (!bytes) continue; // zwischen Auflisten und Holen gelöscht
      const theirs = await unpack(bytes, cfg);
      theirs.id = id;
      contents.set(file.name, theirs);
      merged = merged ? mergeProject(merged, theirs) : theirs;
    }
    if (!merged) continue;
    if (!mine || !sameProject(merged, mine)) pulled++;
    const want = projectFile(merged);
    const cur = files.find((x) => x.name === want);
    const curContent = contents.get(want);
    if (cur && curContent && sameProject(merged, curContent)) st.shas[id] = cur.sha;
    else {
      st.shas[id] = await putFile(cfg, projectPath(want), await pack(merged, cfg), cur && curContent ? cur.sha : null, msg, f);
      pushed++;
    }
    // Dateien unter altem Namen entfernen (Projekt umbenannt oder frühere Benennung ohne Namen).
    for (const file of files) if (file.name !== want) await deleteFile(cfg, projectPath(file.name), file.sha, "Projektdatei umbenannt " + stampText(now), f);
    out.set(id, merged);
  }
  for (const p of local) {
    if (byId.has(p.id)) continue;
    if (p.deletedAt) {
      // Gelöschtes Projekt, das im Repo nie ankam oder dort schon entfernt ist: Marke nicht mehr nötig.
      delete st.shas[p.id];
      out.delete(p.id);
      continue;
    }
    st.shas[p.id] = await putFile(cfg, projectPath(projectFile(p)), await pack(p, cfg), null, msg, f);
    pushed++;
  }

  // Anhänge hochladen, die nur auf diesem Gerät liegen.
  const known = new Set(st.attRemote);
  for (const p of out.values()) {
    if (p.deletedAt) continue;
    for (const r of p.reqs)
      for (const a of r.attachments) {
        if (known.has(a.id)) continue;
        const bytes = await blobs.get(a.id);
        if (!bytes) continue; // liegt nicht hier, also von einem anderen Gerät
        try {
          await putFile(cfg, attPath(p.id, a.id), await encryptBytes(bytes, cfg.password), null, "Anhang " + stampText(now), f);
          uploaded++;
        } catch (e) {
          if (!(e instanceof ConflictError)) throw e; // schon vorhanden
        }
        known.add(a.id);
      }
  }
  st.attRemote = [...known];

  // Entfernte Anhänge auch im Repo löschen.
  const rest: SyncState["attDel"] = [];
  for (const d of st.attDel) {
    try {
      const sha = await getSha(cfg, attPath(d.pid, d.id), f);
      if (sha) await deleteFile(cfg, attPath(d.pid, d.id), sha, "Anhang entfernt " + stampText(now), f);
      st.attRemote = st.attRemote.filter((x) => x !== d.id);
    } catch {
      rest.push(d); // beim nächsten Abgleich erneut versuchen
    }
  }
  st.attDel = rest;

  return { projects: [...out.values()], state: st, pushed, pulled, uploaded };
}

/** Abgleich mit bis zu drei Versuchen bei gleichzeitigen Änderungen. */
export async function sync(local: Project[], dirty: Set<string>, state: SyncState, cfg: GitHubConfig, blobs: BlobStore, f: Fetch = fetch): Promise<SyncResult> {
  for (let i = 0; ; i++) {
    try {
      return await syncOnce(local, dirty, state, cfg, blobs, f);
    } catch (e) {
      if (!(e instanceof ConflictError) || i >= 2) throw e;
    }
  }
}

/** Anhang aus dem Repo holen und entschlüsseln. null = liegt dort nicht. */
export async function fetchAttachment(cfg: GitHubConfig, pid: string, id: string, f: Fetch = fetch): Promise<Uint8Array | null> {
  const bytes = await getRaw(cfg, attPath(pid, id), f);
  return bytes ? decryptBytes(bytes, cfg.password) : null;
}
