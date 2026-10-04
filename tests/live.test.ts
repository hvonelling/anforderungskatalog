// Probe gegen das echte GitHub. Läuft nur, wenn AK_LIVE_TOKEN gesetzt ist:
//   AK_LIVE_TOKEN=$(gh auth token) npx vitest run tests/live.test.ts
// Arbeitet in einem eigenen Unterordner des Daten-Repos und räumt ihn danach wieder auf.

import { afterAll, describe, expect, it } from "vitest";
import { clone, demoProject, sameProject, stamp } from "../src/domain/model";
import { memoryBlobs } from "../src/storage/blobs";
import { DEFAULT_REPO, deleteFile, getSha, listDir, type GitHubConfig } from "../src/storage/github";
import { attPath, emptySyncState, fetchAttachment, sync } from "../src/storage/sync";

const token = process.env.AK_LIVE_TOKEN ?? "";
const cfg: GitHubConfig = { repo: process.env.AK_LIVE_REPO ?? DEFAULT_REPO, token, password: "selbsttest-passwort-123", prefix: "selbsttest-" + Date.now() };

describe.skipIf(!token)("Abgleich gegen GitHub", () => {
  const created: string[] = [];
  afterAll(async () => {
    for (const path of created) {
      const sha = await getSha(cfg, path).catch(() => null);
      if (sha) await deleteFile(cfg, path, sha, "Selbsttest aufgeräumt");
    }
  }, 60_000);

  it("gleicht zwei Geräte samt Anhang über das echte Repo ab", async () => {
    const a = { projects: [demoProject()], state: emptySyncState(), blobs: memoryBlobs() };
    const pid = a.projects[0].id;
    created.push(`projekte/${pid}.enc.json`, attPath(pid, "att1"));
    const content = new Uint8Array(300_000).map((_, i) => (i * 7) % 256);
    await a.blobs.put("att1", content);
    const edited = clone(a.projects[0]);
    edited.reqs[0].attachments.push({ id: "att1", name: "bild.png", type: "image/png", size: content.length });
    stamp(a.projects[0], edited);
    a.projects = [edited];

    const r1 = await sync(a.projects, new Set([pid]), a.state, cfg, a.blobs);
    expect(r1.pushed).toBe(1);
    expect(r1.uploaded).toBe(1);
    expect((await listDir(cfg, "projekte")).map((f) => f.name)).toEqual([pid + ".enc.json"]);

    // Zweites Gerät: holt alles, ändert etwas, schreibt zurück.
    const b = { blobs: memoryBlobs() };
    const r2 = await sync([], new Set(), emptySyncState(), cfg, b.blobs);
    expect(r2.pulled).toBe(1);
    expect(sameProject(r2.projects[0], r1.projects[0])).toBe(true);
    const got = await fetchAttachment(cfg, pid, "att1");
    expect(got!.length).toBe(content.length);
    expect(got![12345]).toBe(content[12345]);

    const changed = clone(r2.projects[0]);
    changed.reqs[1].status = "done";
    stamp(r2.projects[0], changed);
    const r3 = await sync([changed], new Set([pid]), r2.state, cfg, b.blobs);
    expect(r3.pushed).toBe(1);

    // Erstes Gerät sieht die Änderung, ein weiterer Durchgang schreibt nichts mehr.
    const r4 = await sync(r1.projects, new Set(), r1.state, cfg, a.blobs);
    expect(r4.pulled).toBe(1);
    expect(r4.pushed).toBe(0);
    expect(r4.projects[0].reqs[1].status).toBe("done");
    const r5 = await sync(r4.projects, new Set(), r4.state, cfg, a.blobs);
    expect(r5.pushed + r5.pulled + r5.uploaded).toBe(0);

    // Anhang im Repo löschen.
    const r6 = await sync(r5.projects, new Set(), { ...r5.state, attDel: [{ pid, id: "att1" }] }, cfg, a.blobs);
    expect(r6.state.attDel).toEqual([]);
    expect(await getSha(cfg, attPath(pid, "att1"))).toBe(null);

    // Falsches Passwort wird erkannt, bevor etwas geschrieben wird.
    await expect(sync([], new Set(), emptySyncState(), { ...cfg, password: "falsches-passwort" }, memoryBlobs())).rejects.toThrow("Falsches Passwort");
  }, 120_000);
});
