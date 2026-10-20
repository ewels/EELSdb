import { api } from "./api";
import { pages } from "./pages";

export default {
  fetch(req, env, ctx) {
    const host = new URL(req.url).hostname;
    const app = host.startsWith("api.") || host.startsWith("www.api.") ? api : pages;
    return app.fetch(req, env, ctx);
  },
} satisfies ExportedHandler<Env>;
