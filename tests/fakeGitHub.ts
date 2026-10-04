// Nachbau der GitHub-Contents-Schnittstelle im Arbeitsspeicher.

export function fakeGitHub(repo = "ich/katalog") {
  const files = new Map<string, { bytes: Uint8Array; sha: string }>();
  let n = 0;
  const calls: string[] = [];
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  /** Wird vor jedem Schreiben aufgerufen (um gleichzeitige Änderungen nachzustellen). */
  let beforePut: ((path: string) => void) | null = null;

  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const headers = (init?.headers ?? {}) as Record<string, string>;
    calls.push(method + " " + url.replace("https://api.github.com", ""));
    if (headers.Authorization !== "Bearer token") return json(401, { message: "Bad credentials" });
    const base = `https://api.github.com/repos/${repo}`;
    if (url === base) return json(200, { full_name: repo });
    if (!url.startsWith(base + "/contents/")) return json(404, { message: "Not Found" });
    const path = decodeURIComponent(url.slice((base + "/contents/").length));
    if (method === "GET") {
      const file = files.get(path);
      if (file) {
        if (headers.Accept === "application/vnd.github.raw+json") return new Response(file.bytes.slice().buffer as ArrayBuffer, { status: 200 });
        return json(200, { type: "file", name: path.split("/").pop(), sha: file.sha });
      }
      const dir = [...files.entries()].filter(([k]) => k.startsWith(path + "/") && !k.slice(path.length + 1).includes("/"));
      if (dir.length) return json(200, dir.map(([k, v]) => ({ type: "file", name: k.split("/").pop(), sha: v.sha })));
      return json(404, { message: "Not Found" });
    }
    const body = JSON.parse(String(init?.body ?? "{}"));
    if (method === "PUT") {
      beforePut?.(path);
      const old = files.get(path);
      if (old && body.sha !== old.sha) return json(old && !body.sha ? 422 : 409, { message: "sha mismatch" });
      if (!old && body.sha) return json(409, { message: "sha mismatch" });
      const sha = "sha" + ++n;
      files.set(path, { bytes: unb64(body.content), sha });
      return json(old ? 200 : 201, { content: { sha } });
    }
    if (method === "DELETE") {
      const old = files.get(path);
      if (!old) return json(404, { message: "Not Found" });
      if (body.sha !== old.sha) return json(409, { message: "sha mismatch" });
      files.delete(path);
      return json(200, {});
    }
    return json(405, {});
  }) as typeof fetch;

  return {
    fetch: fetchFn,
    files,
    calls,
    cfg: { repo, token: "token", password: "geheim-geheim" },
    onPut(fn: ((path: string) => void) | null) {
      beforePut = fn;
    },
    writes: () => calls.filter((c) => c.startsWith("PUT") || c.startsWith("DELETE")).length,
  };
}
