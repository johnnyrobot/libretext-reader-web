import { createClient, ApiError } from "../social-reading/client.mjs";

// Annotation-only extension of the existing same-origin headless adapter.
export function createAnnotationClient(options = {}) {
  const core = createClient(options);
  const transport = options.fetch ?? globalThis.fetch;
  const base = (options.baseURL ?? "/social-reading/api").replace(/\/$/, "");
  async function request(path, body, query) {
    const params = new URLSearchParams();
    for (const [name,value] of Object.entries(query ?? {}))
      if (value !== undefined && value !== null) params.set(name,String(value));
    const suffix = params.size ? `?${params}` : "";
    const response = await transport(base + path + suffix, {
      method: body === undefined ? "GET" : "POST", credentials: "same-origin",
      mode: "same-origin", cache: "no-store", redirect: "error",
      ...(body === undefined ? {} : { headers: {"Content-Type":"application/json"}, body: JSON.stringify(body) }),
    });
    const value = await response.json();
    if (!response.ok) throw new ApiError(response.status,value);
    return value;
  }
  return Object.freeze({ ...core,
    highlights: (context, filters) => request("/highlights",undefined,{...context,...filters}),
    highlightCommand: command => request("/highlights",command),
    highlightReceipt: (key,context) => request(`/highlight-receipts/${encodeURIComponent(key)}`,undefined,context),
    annotationSearch: filters => request("/annotation-search",undefined,filters),
    exportAnnotations: filters => request("/annotation-export",undefined,filters),
  });
}
