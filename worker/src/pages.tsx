import { Hono } from "hono";
import { serveFile } from "./files";

export const pages = new Hono<{ Bindings: Env }>();

pages.get("/", (c) => c.html("<h1>EELS Data Base</h1>"));
pages.get("/wp-content/uploads/*", serveFile);
