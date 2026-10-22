# /// script
# requires-python = ">=3.12"
# dependencies = []
# ///
"""Record the full text of the news posts from eelsdb.eu into data/fixtures/news/{slug}.html (read-only).

Only the post body is kept, and only simple tags (paragraphs, links, lists, emphasis, headings) with
href attributes, so the archive pages can show it as-is.
"""

import html
import json
import re
from html.parser import HTMLParser

from record_api import OUT as API_FIXTURES, ROOT, get

OUT = ROOT / "data" / "fixtures" / "news"
ALLOWED = {"p", "a", "ul", "ol", "li", "strong", "em", "b", "i", "br", "h2", "h3", "h4", "blockquote", "sub", "sup", "code", "pre"}
VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"}
SKIP = {"script", "style", "form", "iframe", "noscript", "svg", "h1"}
# The theme's post body, and the date and category line inside it (shown separately on the new site).
CONTENT_CLASS = "single_post_content"
SKIP_CLASSES = {"post_date", "post_category"}


class BodyExtractor(HTMLParser):
    """Keeps the allowed tags inside the post body element."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.depth = 0  # depth inside entry-content; 0 = outside
        self.skip = 0
        self.skipping = []  # depths of the skipped elements still open
        self.out = []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if self.depth == 0:
            if CONTENT_CLASS in (attrs.get("class") or "").split():
                self.depth = 1
            return
        if tag not in VOID:
            self.depth += 1
        if tag in SKIP or SKIP_CLASSES & set((attrs.get("class") or "").split()):
            self.skip += 1
            self.skipping.append(self.depth)
        if self.skip or tag not in ALLOWED:
            return
        href = attrs.get("href")
        if tag == "a" and href and href.startswith(("http://", "https://", "/", "mailto:")):
            self.out.append(f'<a href="{html.escape(href)}">')
        else:
            self.out.append(f"<{tag}>")

    def handle_endtag(self, tag):
        if self.depth == 0 or tag in VOID:
            return
        if self.skipping and self.skipping[-1] == self.depth:
            self.skipping.pop()
            self.skip -= 1
            self.depth -= 1
            return
        self.depth -= 1
        if not self.skip and tag in ALLOWED and self.depth > 0:
            self.out.append(f"</{tag}>")

    def handle_data(self, data):
        if self.depth and not self.skip:
            self.out.append(html.escape(data))


def extract(page_html):
    p = BodyExtractor()
    p.feed(page_html)
    text = "".join(p.out)
    while re.search(r"<(p|li|em|strong)>\s*</\1>", text):
        text = re.sub(r"<(p|li|em|strong)>\s*</\1>", "", text)
    return re.sub(r"\n{2,}", "\n", text).strip()


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    posts = json.loads((API_FIXTURES / "news" / "list-page-1.json").read_text())["body"]
    for post in posts:
        slug = post["permalink"].rstrip("/").rsplit("/", 1)[1]
        status, _, body, _ = get(post["permalink"])
        if status != 200:
            print(f"{status} {slug}")
            continue
        text = extract(body.decode("utf-8", errors="replace"))
        (OUT / f"{slug}.html").write_text(text + "\n")
        print(f"{status} {slug}: {len(text)} characters")


if __name__ == "__main__":
    main()
