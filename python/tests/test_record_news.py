from record_news import extract

PAGE = """<html><body><div class="container">menu</div>
<div class="single_post_content"><h1>Title</h1><p><span class="post_date">May 18, 2020</span> <span class="post_category">Categories: x</span></p>
<p class="wp-block-paragraph" onclick="evil()">Hello <a href="https://hyperspy.org" target="_blank">HyperSpy</a> <a href="javascript:alert(1)">bad</a></p>
<script>alert(1)</script><img src="x.png"><p></p><ul><li>One</li></ul>
</div><div class="footer">footer</div></body></html>"""


def test_extract_keeps_simple_html_only():
    out = extract(PAGE)
    assert out == '<p>Hello <a href="https://hyperspy.org">HyperSpy</a> <a>bad</a></p>\n<ul><li>One</li></ul>'
