import { Hono } from "hono";

export const pages = new Hono<{ Bindings: Env }>();

pages.get("/", (c) => c.html("<h1>EELS Data Base</h1>"));
