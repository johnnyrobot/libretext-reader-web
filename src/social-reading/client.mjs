export class ApiError extends Error {
  constructor(status, body) {
    super(body.error ?? "Request failed.");
    this.status = status;
    this.code = body.code;
    this.body = body;
  }
}

export function createClient({
  baseURL = "/social-reading/api",
  fetch: transport = globalThis.fetch,
} = {}) {
  if (!/^\/[^/]/.test(baseURL) || /[\x00-\x1f\x7f?#\\]/.test(baseURL))
    throw new Error("A same-origin API path is required.");
  const base = baseURL.replace(/\/$/, "");
  async function request(path, body, query) {
    const suffix = query ? "?" + new URLSearchParams(query) : "";
    const response = await transport(base + path + suffix, {
      method: body === undefined ? "GET" : "POST",
      credentials: "same-origin",
      mode: "same-origin",
      cache: "no-store",
      redirect: "error",
      ...(body === undefined
        ? {}
        : {
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          }),
    });
    const value = await response.json();
    if (!response.ok) throw new ApiError(response.status, value);
    return value;
  }
  return Object.freeze({
    session: () => request("/session"),
    extendSession: (actor) => request("/session/extend", { actor }),
    login: (username, password) => request("/login", { username, password }),
    logout: () => request("/logout", {}),
    books: () => request("/books"),
    pages: (book) => request("/pages", undefined, { book }),
    page: (book, page) => request("/page", undefined, { book, page }),
    passage: (context) => request("/passage", undefined, context),
    threads: (context) => request("/threads", undefined, context),
    command: (command) => request("/commands", command),
    receipt: (key, context) =>
      request("/receipts/" + encodeURIComponent(key), undefined, context),
  });
}
