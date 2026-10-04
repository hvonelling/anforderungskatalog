// Speicherung auf diesem Gerät (localStorage des Browsers): Projekte, Abgleich-Zustand und Einstellungen.
// Zugangsschlüssel und Passwort liegen nur hier, nie in den Projektdaten.

import { normalizeProject } from "../domain/model";
import type { Project } from "../domain/types";
import type { GitHubConfig } from "./github";
import { emptySyncState, type SyncState } from "./sync";

const K_INDEX = "ak-projekte";
const K_PROJECT = "ak-projekt-";
const K_SYNC = "ak-abgleich";
const K_GITHUB = "ak-github";
const K_UI = "ak-ui";

export type Theme = "auto" | "light" | "dark";
export interface UiPrefs {
  theme?: Theme;
  projectId?: string | null;
  collapsed?: Record<string, boolean>;
}
export interface SyncMeta extends SyncState {
  /** lokal geänderte, noch nicht abgeglichene Projekte */
  dirty: string[];
  lastSync?: number;
}

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function write(key: string, value: unknown): boolean {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export const local = {
  loadProjects(): Project[] {
    const out: Project[] = [];
    for (const id of read<string[]>(K_INDEX, [])) {
      try {
        const raw = localStorage.getItem(K_PROJECT + id);
        if (raw) out.push(normalizeProject(JSON.parse(raw)));
      } catch {
        /* beschädigter Stand: Projekt überspringen */
      }
    }
    return out;
  },
  /** false = Speicher voll oder nicht verfügbar */
  saveProject(p: Project): boolean {
    const ids = read<string[]>(K_INDEX, []);
    if (!ids.includes(p.id) && !write(K_INDEX, [...ids, p.id])) return false;
    return write(K_PROJECT + p.id, p);
  },
  removeProject(id: string) {
    write(K_INDEX, read<string[]>(K_INDEX, []).filter((x) => x !== id));
    write(K_PROJECT + id, null);
  },
  loadSync(): SyncMeta {
    return { ...emptySyncState(), dirty: [], ...read<Partial<SyncMeta>>(K_SYNC, {}) };
  },
  saveSync(m: SyncMeta) {
    write(K_SYNC, m);
  },
  loadGitHub(): GitHubConfig | null {
    return read<GitHubConfig | null>(K_GITHUB, null);
  },
  saveGitHub(c: GitHubConfig | null) {
    write(K_GITHUB, c);
  },
  loadUi(): UiPrefs {
    return read<UiPrefs>(K_UI, {});
  },
  saveUi(p: UiPrefs) {
    write(K_UI, p);
  },
};
