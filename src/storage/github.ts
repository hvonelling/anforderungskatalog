// Zugriff auf Dateien in einem privaten GitHub-Repo über die Contents-Schnittstelle.

import { b64 } from "./crypto";

export interface GitHubConfig {
  /** "besitzer/repo" */
  repo: string;
  /** Fine-grained Token mit Contents: Read and write, nur für dieses Repo */
  token: string;
  /** Passwort der verschlüsselten Dateien */
  password: string;
  /** Unterordner im Repo (leer = Wurzel). Für Selbsttests. */
  prefix?: string;
}

export const DEFAULT_REPO = "hvonelling/Anforderungskatalog-Datei";

export class ConflictError extends Error {}

export type Fetch = typeof fetch;

const enc = (path: string) => path.split("/").filter(Boolean).map(encodeURIComponent).join("/");
const full = (cfg: GitHubConfig, path: string) => enc((cfg.prefix ? cfg.prefix.replace(/\/+$/, "") + "/" : "") + path);

function call(cfg: GitHubConfig, f: Fetch, method: string, url: string, body?: unknown, accept = "application/vnd.github+json") {
  return f(url, {
    method,
    cache: "no-store",
    headers: {
      Accept: accept,
      Authorization: "Bearer " + cfg.token.trim(),
      "X-GitHub-Api-Version": "2022-11-28",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}
const contents = (cfg: GitHubConfig, path: string) => `https://api.github.com/repos/${cfg.repo.trim()}/contents/${full(cfg, path)}`;

async function errorFor(r: Response): Promise<Error> {
  if (r.status === 401) return new Error("Zugangsschlüssel ungültig oder abgelaufen.");
  if (r.status === 403) return new Error("Zugangsschlüssel darf dieses Repo nicht lesen oder schreiben (Contents: Read and write nötig).");
  if (r.status === 404) return new Error("Repo nicht gefunden oder der Zugangsschlüssel hat keinen Zugriff darauf.");
  if (r.status === 409 || r.status === 422) return new ConflictError("Datei wurde zwischendurch geändert.");
  const j = await r.json().catch(() => ({}));
  return new Error("GitHub: " + (j.message || "Fehler " + r.status));
}

/** Prüfen, ob das Repo erreichbar ist. Wirft mit verständlicher Meldung, wenn nicht. */
export async function checkRepo(cfg: GitHubConfig, f: Fetch = fetch): Promise<void> {
  const r = await call(cfg, f, "GET", `https://api.github.com/repos/${cfg.repo.trim()}`);
  if (!r.ok) throw await errorFor(r);
}

/** Dateien eines Ordners auflisten. Fehlt der Ordner, ist die Liste leer. */
export async function listDir(cfg: GitHubConfig, dir: string, f: Fetch = fetch): Promise<{ name: string; sha: string }[]> {
  const r = await call(cfg, f, "GET", contents(cfg, dir));
  if (r.status === 404) {
    await checkRepo(cfg, f); // fehlt der Ordner oder das ganze Repo?
    return [];
  }
  if (!r.ok) throw await errorFor(r);
  const j = await r.json();
  if (!Array.isArray(j)) return [];
  return j.filter((x) => x.type === "file").map((x) => ({ name: String(x.name), sha: String(x.sha) }));
}

/** Dateiinhalt als Bytes. null = Datei existiert nicht. */
export async function getRaw(cfg: GitHubConfig, path: string, f: Fetch = fetch): Promise<Uint8Array | null> {
  const r = await call(cfg, f, "GET", contents(cfg, path), undefined, "application/vnd.github.raw+json");
  if (r.status === 404) return null;
  if (!r.ok) throw await errorFor(r);
  return new Uint8Array(await r.arrayBuffer());
}

/** Kennung (sha) einer Datei. null = Datei existiert nicht. */
export async function getSha(cfg: GitHubConfig, path: string, f: Fetch = fetch): Promise<string | null> {
  const r = await call(cfg, f, "GET", contents(cfg, path));
  if (r.status === 404) return null;
  if (!r.ok) throw await errorFor(r);
  return String((await r.json()).sha);
}

/** Datei schreiben. sha = Stand, auf dem die Änderung beruht (null = neu anlegen). Liefert die neue Kennung. */
export async function putFile(cfg: GitHubConfig, path: string, bytes: Uint8Array, sha: string | null, message: string, f: Fetch = fetch): Promise<string> {
  const r = await call(cfg, f, "PUT", contents(cfg, path), { message, content: b64(bytes), ...(sha ? { sha } : {}) });
  if (!r.ok) throw await errorFor(r);
  return String((await r.json()).content.sha);
}

export async function deleteFile(cfg: GitHubConfig, path: string, sha: string, message: string, f: Fetch = fetch): Promise<void> {
  const r = await call(cfg, f, "DELETE", contents(cfg, path), { message, sha });
  if (!r.ok && r.status !== 404) throw await errorFor(r);
}
