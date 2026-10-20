import { Hono } from "hono";

export const api = new Hono<{ Bindings: Env }>();

api.get("/", (c) => c.json({ api_documentation: { url: "https://eelsdb.eu/api/" } }));
