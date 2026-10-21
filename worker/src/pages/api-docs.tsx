import type { Context } from "hono";
import type { Child } from "hono/jsx";
import type { AppEnv } from "../auth";
import { Layout } from "./layout";

type Doc = { info: { title: string; description: string }; servers: { url: string }[]; paths: Record<string, any> };

const plain = (s: string | undefined) => (s ?? "").replaceAll("`", "");

/** An API reference page rendered from an OpenAPI file. */
export function apiDocs(c: Context<AppEnv>, doc: Doc, opts: { path: string; file: string; intro: Child; examples: [string, string][] }) {
  const base = doc.servers[0].url;
  return c.html(
    <Layout user={c.get("user")} title={doc.info.title.replace("EELS Data Base ", "")} path={opts.path}>
      <div class="prose api-docs">
        <h1>{doc.info.title}</h1>
        <p>{plain(doc.info.description)}</p>
        <p>
          The full description is an <a href={opts.file}>OpenAPI file</a>. Base address: <code>{base}</code>.
        </p>
        {opts.intro}
        <h2>Examples</h2>
        <ul>
          {opts.examples.map(([label, url]) => (
            <li>
              {label}: <a href={url}><code>{url.replace(/^https:\/\/api\.eelsdb\.eu/, "")}</code></a>
            </li>
          ))}
        </ul>
      </div>
      {Object.entries(doc.paths).map(([path, ops]) => {
        const op = ops.get;
        const query = (op.parameters ?? []).filter((p: any) => p.in === "query");
        return (
          <section class="endpoint prose">
            <h2>
              <span class="method">GET</span>
              <code class="path">{path}</code>
            </h2>
            <p>
              <strong>{op.summary}.</strong> {plain(op.description)}
            </p>
            {query.length > 0 && (
              <div class="table-scroll">
                <table>
                  <thead>
                    <tr><th>Parameter</th><th>Values</th><th>Meaning</th></tr>
                  </thead>
                  <tbody>
                    {query.map((p: any) => (
                      <tr>
                        <td><code>{p.name}</code></td>
                        <td>{p.schema.enum ? p.schema.enum.join(", ") : p.schema.type}</td>
                        <td>{plain(p.description)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        );
      })}
    </Layout>,
  );
}
