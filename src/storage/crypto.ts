// Verschlüsselung für die Ablage in einem privaten Git-Repo.
// Läuft im Browser und in Node gleich (Web Crypto + CompressionStream).
//
// Verfahren: Passwort → Schlüssel per PBKDF2-SHA-256 (600.000 Runden, zufälliges Salz),
// Inhalt mit AES-256-GCM verschlüsselt (zufälliger IV je Datei). Texte werden vorher gzip-komprimiert.
// GCM erkennt jede Veränderung der Datei und ein falsches Passwort.
//
// Die Schlüsselableitung ist absichtlich langsam. Deshalb wird je Sitzung ein Salz verwendet
// und der abgeleitete Schlüssel im Arbeitsspeicher gemerkt; der IV ist für jede Datei neu.

export const ENC_FORMAT = "anforderungskatalog-enc-v1";
const ITERATIONS = 600_000;
const MAGIC = [0x41, 0x4b, 0x41, 0x31]; // "AKA1" – Kennung verschlüsselter Anhänge

export interface EncryptedFile {
  app: "anforderungskatalog";
  format: typeof ENC_FORMAT;
  kdf: { name: "PBKDF2"; hash: "SHA-256"; iterations: number; salt: string };
  cipher: { name: "AES-GCM"; iv: string };
  compression: "gzip";
  data: string;
}

const subtle = () => globalThis.crypto.subtle;

export function b64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
export function unb64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const res = new Response(new Blob([bytes as BlobPart]).stream().pipeThrough(stream));
  return new Uint8Array(await res.arrayBuffer());
}

const keys = new Map<string, Promise<CryptoKey>>();
const sessionSalt = new Map<string, Uint8Array>();

function deriveKey(password: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const id = iterations + "|" + b64(salt) + "|" + password;
  let k = keys.get(id);
  if (!k) {
    k = (async () => {
      const base = await subtle().importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]);
      return subtle().deriveKey({ name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
    })();
    keys.set(id, k);
    k.catch(() => keys.delete(id));
  }
  return k;
}

function saltFor(password: string): Uint8Array {
  let s = sessionSalt.get(password);
  if (!s) sessionSalt.set(password, (s = globalThis.crypto.getRandomValues(new Uint8Array(16))));
  return s;
}

/** Nur für Tests: gemerkte Schlüssel verwerfen. */
export function forgetKeys() {
  keys.clear();
  sessionSalt.clear();
}

async function seal(plain: Uint8Array, password: string) {
  if (!password) throw new Error("Kein Passwort angegeben.");
  const salt = saltFor(password);
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt, ITERATIONS);
  const ct = new Uint8Array(await subtle().encrypt({ name: "AES-GCM", iv: iv as BufferSource }, key, plain as BufferSource));
  return { salt, iv, ct };
}

async function open(ct: Uint8Array, salt: Uint8Array, iv: Uint8Array, iterations: number, password: string): Promise<Uint8Array> {
  const key = await deriveKey(password, salt, iterations);
  try {
    return new Uint8Array(await subtle().decrypt({ name: "AES-GCM", iv: iv as BufferSource }, key, ct as BufferSource));
  } catch {
    throw new Error("Falsches Passwort oder beschädigte Datei.");
  }
}

/** Text (ein Projekt als JSON) verschlüsseln. */
export async function encryptText(plain: string, password: string): Promise<EncryptedFile> {
  const packed = await pipe(new TextEncoder().encode(plain), new CompressionStream("gzip"));
  const { salt, iv, ct } = await seal(packed, password);
  return {
    app: "anforderungskatalog",
    format: ENC_FORMAT,
    kdf: { name: "PBKDF2", hash: "SHA-256", iterations: ITERATIONS, salt: b64(salt) },
    cipher: { name: "AES-GCM", iv: b64(iv) },
    compression: "gzip",
    data: b64(ct),
  };
}

export function isEncrypted(j: unknown): j is EncryptedFile {
  return !!j && typeof j === "object" && (j as EncryptedFile).format === ENC_FORMAT;
}

/** Verschlüsselten Text entschlüsseln. Wirft bei falschem Passwort oder veränderter Datei. */
export async function decryptText(file: EncryptedFile, password: string): Promise<string> {
  if (!isEncrypted(file)) throw new Error("Keine verschlüsselte Katalogdatei.");
  const packed = await open(unb64(file.data), unb64(file.kdf.salt), unb64(file.cipher.iv), file.kdf.iterations, password);
  return new TextDecoder().decode(await pipe(packed, new DecompressionStream("gzip")));
}

/** Anhang verschlüsseln. Aufbau: Kennung (4) + Salz (16) + IV (12) + Geheimtext. */
export async function encryptBytes(plain: Uint8Array, password: string): Promise<Uint8Array> {
  const { salt, iv, ct } = await seal(plain, password);
  const out = new Uint8Array(4 + 16 + 12 + ct.length);
  out.set(MAGIC, 0);
  out.set(salt, 4);
  out.set(iv, 20);
  out.set(ct, 32);
  return out;
}

export async function decryptBytes(file: Uint8Array, password: string): Promise<Uint8Array> {
  if (file.length < 48 || MAGIC.some((b, i) => file[i] !== b)) throw new Error("Keine verschlüsselte Anhang-Datei.");
  return open(file.subarray(32), file.subarray(4, 20), file.subarray(20, 32), ITERATIONS, password);
}

/** Zufälliges, gut tippbares Passwort (5 Vierergruppen, ca. 99 Bit). */
export function randomPassword(): string {
  const abc = "abcdefghjkmnpqrstuvwxyz23456789"; // ohne leicht verwechselbare Zeichen
  const out: string[] = [];
  const buf = new Uint32Array(20);
  globalThis.crypto.getRandomValues(buf);
  for (let g = 0; g < 5; g++) {
    let s = "";
    for (let i = 0; i < 4; i++) s += abc[buf[g * 4 + i] % abc.length];
    out.push(s);
  }
  return out.join("-");
}
