import { raw } from "hono/html";

// Wires the copy button of the code block just before this script.
const COPY_SCRIPT = `;(function(){var b=document.currentScript.previousElementSibling,t=b.querySelector(".code-copied"),h;b.querySelector(".code-copy button").addEventListener("click",function(){navigator.clipboard.writeText(b.querySelector("pre").textContent).then(function(){t.textContent="Copied!";t.classList.add("show");clearTimeout(h);h=setTimeout(function(){t.classList.remove("show")},1500)},function(){getSelection().selectAllChildren(b.querySelector("code"))})})})()`;

const tok = (c: string, text: string) => <span class={`t-${c}`}>{text}</span>;
const str = (text: string) => (
  <>
    {tok("p", '"')}
    {tok("s", text)}
    {tok("p", '"')}
  </>
);

/** Load one MSA file in HyperSpy, highlighted token for token as the docs' Expressive Code (Night Owl) does it. */
export function HyperSpySnippet(props: { url: string; file: string }) {
  return (
    <>
      <div class="code-block">
        <pre><code>
          {tok("k", "import")} hyperspy.api {tok("k", "as")} hs{"\n"}
          {tok("k", "from")} urllib.request {tok("k", "import")} urlretrieve{"\n\n"}
          url {tok("k", "=")} {str(props.url)}{"\n"}
          path, _ {tok("k", "=")} {tok("f", "urlretrieve")}({tok("v", "url")}{tok("p", ",")} {str(props.file)}){"\n"}
          s {tok("k", "=")} hs.{tok("f", "load")}({tok("v", "path")}{tok("p", ",")} {tok("a", "signal_type")}{tok("k", "=")}{str("EELS")}){"\n"}
          s.{tok("f", "plot")}()
        </code></pre>
        <div class="code-copy">
          <span class="code-copied" role="status"></span>
          <button type="button" aria-label="Copy to clipboard"></button>
        </div>
      </div>
      <script>{raw(COPY_SCRIPT)}</script>
    </>
  );
}
