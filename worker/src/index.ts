import { api } from "./api/index";
import { pages } from "./pages/index";

// No full Content-Security-Policy yet: Pyodide (wasm) and Turnstile need careful allowances.
const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Content-Security-Policy": "frame-ancestors 'none'",
};

export default {
  async fetch(req, env, ctx) {
    const host = new URL(req.url).hostname;
    const app = host.startsWith("api.") || host.startsWith("www.api.") ? api : pages;
    const res = await app.fetch(req, env, ctx);
    const out = new Response(res.body, res);
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) if (!out.headers.has(k)) out.headers.set(k, v);
    return out;
  },
} satisfies ExportedHandler<Env>;
