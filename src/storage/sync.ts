// Automatischer Abgleich mit einem privaten GitHub-Repo.
//
// Ablage im Repo:
//   projekte/<Projekt-ID>.enc.json          je Projekt eine verschlüsselte Datei
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

const projectPath = (id: string) => `${PROJECT_DIR}/${id}.enc.json`;
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

  const remote = (await listDir(cfg, PROJECT_DIR, f)).filter((x) => x.name.endsWith(".enc.json"));
  const remoteIds = new Set<string>();
  for (const file of remote) {
    const id = file.name.slice(0, -".enc.json".length);
    remoteIds.add(id);
    const mine = out.get(id);
    if (mine && st.shas[id] === file.sha && !dirty.has(id)) continue; // weder hier noch dort geändert
    const bytes = await getRaw(cfg, projectPath(id), f);
    if (!bytes) continue; // zwischen Auflisten und Holen gelöscht
    const theirs = await unpack(bytes, cfg);
    if (theirs.id !== id) theirs.id = id;
    const merged = mine ? mergeProject(mine, theirs) : theirs;
    if (!mine || !sameProject(merged, mine)) pulled++;
    if (sameProject(merged, theirs)) st.shas[id] = file.sha;
    else {
      st.shas[id] = await putFile(cfg, projectPath(id), await pack(merged, cfg), file.sha, msg, f);
      pushed++;
    }
    out.set(id, merged);
  }
  for (const p of local) {
    if (remoteIds.has(p.id)) continue;
    if (p.deletedAt) {
      // Gelöschtes Projekt, das im Repo nie ankam oder dort schon entfernt ist: Marke nicht mehr nötig.
      delete st.shas[p.id];
      out.delete(p.id);
      continue;
    }
    st.shas[p.id] = await putFile(cfg, projectPath(p.id), await pack(p, cfg), null, msg, f);
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
