import { describe, expect, it } from "vitest";
import { clone, demoProject, sameProject, stamp } from "../src/domain/model";
import type { Project } from "../src/domain/types";
import { memoryBlobs } from "../src/storage/blobs";
import { decryptBytes, decryptText, encryptBytes, encryptText, forgetKeys, isEncrypted, randomPassword } from "../src/storage/crypto";
import { attPath, emptySyncState, fetchAttachment, fileSlug, idFromFile, projectFile, sync, syncOnce, type SyncState } from "../src/storage/sync";
import { fakeGitHub } from "./fakeGitHub";

function edit(p: Project, now: number, fn: (d: Project) => void): Project {
  const d = clone(p);
  fn(d);
  stamp(p, d, now);
  return d;
}

/** Ein Gerät mit eigenem Stand. */
function device(gh: ReturnType<typeof fakeGitHub>) {
  const dev = {
    projects: [] as Project[],
    dirty: new Set<string>(),
    state: emptySyncState() as SyncState,
    blobs: memoryBlobs(),
    async sync() {
      const r = await sync(dev.projects, dev.dirty, dev.state, gh.cfg, dev.blobs, gh.fetch);
      dev.projects = r.projects;
      dev.state = r.state;
      dev.dirty.clear();
      return r;
    },
    edit(i: number, now: number, fn: (d: Project) => void) {
      dev.projects[i] = edit(dev.projects[i], now, fn);
      dev.dirty.add(dev.projects[i].id);
    },
  };
  return dev;
}

describe("Verschlüsselung", () => {
  it("ver- und entschlüsselt Text und Bytes", async () => {
    const enc = await encryptText("Größe: 12 €", "pw");
    expect(isEncrypted(enc)).toBe(true);
    expect(JSON.stringify(enc)).not.toContain("Größe");
    expect(await decryptText(enc, "pw")).toBe("Größe: 12 €");
    const bytes = new Uint8Array([0, 1, 2, 250, 255]);
    const sealed = await encryptBytes(bytes, "pw");
    expect([...(await decryptBytes(sealed, "pw"))]).toEqual([...bytes]);
    forgetKeys(); // auch ohne gemerkten Schlüssel lesbar (anderes Gerät)
    expect(await decryptText(enc, "pw")).toBe("Größe: 12 €");
  });
  it("erkennt falsches Passwort und veränderte Dateien", async () => {
    const enc = await encryptText("geheim", "pw");
    await expect(decryptText(enc, "falsch")).rejects.toThrow("Falsches Passwort");
    const sealed = await encryptBytes(new Uint8Array(100), "pw");
    sealed[60] ^= 1;
    await expect(decryptBytes(sealed, "pw")).rejects.toThrow();
    await expect(decryptBytes(new Uint8Array(10), "pw")).rejects.toThrow("Keine verschlüsselte");
  });
  it("nutzt für jede Datei einen neuen IV", async () => {
    const a = await encryptText("x", "pw"),
      b = await encryptText("x", "pw");
    expect(a.cipher.iv).not.toBe(b.cipher.iv);
    expect(a.data).not.toBe(b.data);
    expect(randomPassword()).toMatch(/^([a-z2-9]{4}-){4}[a-z2-9]{4}$/);
  });
});

describe("Abgleich", () => {
  it("legt Projekte verschlüsselt ab und schreibt beim zweiten Mal nichts", async () => {
    const gh = fakeGitHub();
    const a = device(gh);
    a.projects = [demoProject(1000)];
    a.dirty.add(a.projects[0].id);
    const r = await a.sync();
    expect(r.pushed).toBe(1);
    const file = gh.files.get(`projekte/${projectFile(a.projects[0])}`)!;
    const text = new TextDecoder().decode(file.bytes);
    expect(text).toContain("anforderungskatalog-enc-v1");
    expect(text).not.toContain("Kundenportal");
    const writes = gh.writes();
    const calls = gh.calls.length;
    const r2 = await a.sync();
    expect(r2.pushed).toBe(0);
    expect(gh.writes()).toBe(writes);
    expect(gh.calls.length).toBe(calls + 1); // nur die Ordnerliste, keine Datei geholt
  });

  it("bringt ein neues Gerät auf den Stand und führt Änderungen beider Geräte zusammen", async () => {
    const gh = fakeGitHub();
    const a = device(gh),
      b = device(gh);
    a.projects = [demoProject(1000)];
    await a.sync();
    const rb = await b.sync();
    expect(rb.pulled).toBe(1);
    expect(sameProject(a.projects[0], b.projects[0])).toBe(true);

    a.edit(0, 2000, (p) => (p.reqs[0].title = "Von A geändert"));
    b.edit(0, 3000, (p) => (p.reqs[1].status = "done"));
    await a.sync();
    const r = await b.sync();
    expect(r.pulled).toBe(1);
    expect(r.pushed).toBe(1);
    await a.sync();
    expect(sameProject(a.projects[0], b.projects[0])).toBe(true);
    expect(a.projects[0].reqs[0].title).toBe("Von A geändert");
    expect(a.projects[0].reqs[1].status).toBe("done");
    // Danach herrscht Ruhe.
    const w = gh.writes();
    await a.sync();
    await b.sync();
    expect(gh.writes()).toBe(w);
  });

  it("wiederholt den Durchgang, wenn ein anderes Gerät dazwischen schreibt", async () => {
    const gh = fakeGitHub();
    const a = device(gh),
      b = device(gh);
    a.projects = [demoProject(1000)];
    await a.sync();
    await b.sync();
    a.edit(0, 2000, (p) => (p.reqs[0].title = "A"));
    b.edit(0, 2500, (p) => (p.reqs[2].title = "B"));
    let once = true;
    gh.onPut(() => {
      if (!once) return;
      once = false;
      gh.onPut(null);
      // B schreibt genau in dem Moment, in dem A schreiben will.
      const path = `projekte/${projectFile(b.projects[0])}`;
      const old = gh.files.get(path)!;
      gh.files.set(path, { bytes: old.bytes, sha: "fremd" });
    });
    await expect(syncOnce(a.projects, a.dirty, a.state, gh.cfg, a.blobs, gh.fetch)).rejects.toThrow("zwischendurch");
    await a.sync(); // der Wiederholungsweg
    await b.sync();
    await a.sync();
    expect(a.projects[0].reqs[0].title).toBe("A");
    expect(a.projects[0].reqs[2].title).toBe("B");
    expect(sameProject(a.projects[0], b.projects[0])).toBe(true);
  });

  it("überträgt Anhänge als eigene verschlüsselte Dateien und löscht sie wieder", async () => {
    const gh = fakeGitHub();
    const a = device(gh),
      b = device(gh);
    a.projects = [demoProject(1000)];
    const pid = a.projects[0].id;
    const content = new TextEncoder().encode("Bildinhalt 123");
    await a.blobs.put("att1", content);
    a.edit(0, 2000, (p) => p.reqs[0].attachments.push({ id: "att1", name: "bild.png", type: "image/png", size: content.length }));
    const r = await a.sync();
    expect(r.uploaded).toBe(1);
    const stored = gh.files.get(attPath(pid, "att1"))!;
    expect(new TextDecoder().decode(stored.bytes)).not.toContain("Bildinhalt");
    expect((await a.sync()).uploaded).toBe(0);

    await b.sync();
    expect(b.projects[0].reqs[0].attachments[0].name).toBe("bild.png");
    expect(await b.blobs.has("att1")).toBe(false); // wird erst bei Bedarf geholt
    const got = await fetchAttachment(gh.cfg, pid, "att1", gh.fetch);
    expect(new TextDecoder().decode(got!)).toBe("Bildinhalt 123");
    expect((await b.sync()).uploaded).toBe(0); // B lädt nichts hoch, was es nicht hat

    a.edit(0, 3000, (p) => (p.reqs[0].attachments = []));
    a.state.attDel.push({ pid, id: "att1" });
    await a.sync();
    expect(gh.files.has(attPath(pid, "att1"))).toBe(false);
    expect(a.state.attDel).toEqual([]);
    expect(await fetchAttachment(gh.cfg, pid, "att1", gh.fetch)).toBe(null);
  });

  it("gibt gelöschte Projekte an andere Geräte weiter", async () => {
    const gh = fakeGitHub();
    const a = device(gh),
      b = device(gh);
    a.projects = [demoProject(1000)];
    await a.sync();
    await b.sync();
    a.edit(0, 9000, (p) => (p.deletedAt = 9000));
    await a.sync();
    await b.sync();
    expect(b.projects[0].deletedAt).toBe(9000);
    expect(b.projects[0].reqs).toEqual([]);
  });

  it("meldet falsches Passwort, falschen Schlüssel und fehlendes Repo verständlich", async () => {
    const gh = fakeGitHub();
    const a = device(gh);
    a.projects = [demoProject(1000)];
    await a.sync();
    const b = device(gh);
    await expect(sync([], new Set(), emptySyncState(), { ...gh.cfg, password: "falsch" }, b.blobs, gh.fetch)).rejects.toThrow("Falsches Passwort");
    await expect(sync([], new Set(), emptySyncState(), { ...gh.cfg, token: "x" }, b.blobs, gh.fetch)).rejects.toThrow("Zugangsschlüssel ungültig");
    const empty = fakeGitHub("ich/leer");
    await expect(sync([], new Set(), emptySyncState(), { ...empty.cfg, repo: "ich/anders" }, b.blobs, empty.fetch)).rejects.toThrow("Repo nicht gefunden");
    expect((await sync([], new Set(), emptySyncState(), empty.cfg, b.blobs, empty.fetch)).projects).toEqual([]);
  });

  it("benennt die Datei nach Projektname und Kennung", async () => {
    expect(fileSlug("Kundenportal (Beispiel)")).toBe("Kundenportal-Beispiel");
    expect(fileSlug("  Größe & Maße – v2.0!  ")).toBe("Groesse-Masse-v2-0");
    expect(fileSlug("a--b")).toBe("a-b");
    expect(fileSlug("§§§")).toBe("");
    expect(fileSlug("x".repeat(80)).length).toBe(40);
    expect(projectFile({ id: "jabc123", name: "Mein Projekt" })).toBe("Mein-Projekt--jabc123.enc.json");
    expect(projectFile({ id: "jabc123", name: "!!!" })).toBe("jabc123.enc.json");
    expect(idFromFile("Mein-Projekt--jabc123.enc.json")).toBe("jabc123");
    expect(idFromFile("jabc123.enc.json")).toBe("jabc123");
    const gh = fakeGitHub();
    const a = device(gh);
    a.projects = [demoProject(1000)];
    await a.sync();
    expect([...gh.files.keys()]).toEqual(["projekte/Kundenportal-Beispiel--" + a.projects[0].id + ".enc.json"]);
  });

  it("verschiebt die Datei beim Umbenennen und andere Geräte folgen", async () => {
    const gh = fakeGitHub();
    const a = device(gh),
      b = device(gh);
    a.projects = [demoProject(1000)];
    const id = a.projects[0].id;
    await a.sync();
    await b.sync();
    a.edit(0, 2000, (p) => (p.name = "Händlerportal"));
    await a.sync();
    expect([...gh.files.keys()]).toEqual(["projekte/Haendlerportal--" + id + ".enc.json"]);
    b.edit(0, 3000, (p) => (p.reqs[0].title = "Von B"));
    const r = await b.sync();
    expect(r.projects.length).toBe(1);
    expect(b.projects[0].name).toBe("Händlerportal");
    expect([...gh.files.keys()]).toEqual(["projekte/Haendlerportal--" + id + ".enc.json"]);
    await a.sync();
    expect(a.projects[0].reqs[0].title).toBe("Von B");
    expect(sameProject(a.projects[0], b.projects[0])).toBe(true);
    const w = gh.writes();
    await a.sync();
    await b.sync();
    expect(gh.writes()).toBe(w);
  });

  it("stellt Dateien der früheren Benennung einmalig um", async () => {
    const gh = fakeGitHub();
    const a = device(gh);
    a.projects = [demoProject(1000)];
    const id = a.projects[0].id;
    await a.sync();
    // Zustand wie vor dem Update: Datei heißt nur nach der Kennung.
    const neu = "projekte/" + projectFile(a.projects[0]);
    const alt = "projekte/" + id + ".enc.json";
    gh.files.set(alt, gh.files.get(neu)!);
    gh.files.delete(neu);
    const b = device(gh);
    const r = await b.sync();
    expect(r.pulled).toBe(1);
    expect([...gh.files.keys()]).toEqual([neu]);
    // Gerät A hatte die Datei unter altem Namen im Blick und kommt ohne Verlust mit.
    await a.sync();
    expect(a.projects.length).toBe(1);
    expect(sameProject(a.projects[0], b.projects[0])).toBe(true);
    expect([...gh.files.keys()]).toEqual([neu]);
  });

  it("führt zwei Dateien desselben Projekts zusammen", async () => {
    const gh = fakeGitHub();
    const a = device(gh),
      b = device(gh);
    a.projects = [demoProject(1000)];
    const id = a.projects[0].id;
    await a.sync();
    await b.sync();
    // Eine alte App-Fassung schreibt parallel noch unter dem alten Namen.
    const stale = gh.files.get("projekte/" + projectFile(a.projects[0]))!;
    a.edit(0, 2000, (p) => (p.reqs[0].title = "Neuer Stand"));
    await a.sync();
    gh.files.set("projekte/" + id + ".enc.json", { bytes: stale.bytes, sha: "alt1" });
    await b.sync();
    expect([...gh.files.keys()]).toEqual(["projekte/" + projectFile(a.projects[0])]);
    expect(b.projects.length).toBe(1);
    expect(b.projects[0].reqs[0].title).toBe("Neuer Stand");
  });
});
