import { describe, expect, it } from "vitest";
import { escapeHtml, plainTextToHtml } from "@/lib/email/plainTextToHtml";

describe("escapeHtml", () => {
  it("escapes &, <, >, \", ' without double-escaping", () => {
    expect(escapeHtml(`<script>alert("x") & 'y'</script>`)).toBe("&lt;script&gt;alert(&quot;x&quot;) &amp; &#39;y&#39;&lt;/script&gt;");
  });
});

describe("plainTextToHtml", () => {
  it("escapes a script tag so it never becomes a real element", () => {
    const html = plainTextToHtml("1階です<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain("<script>");
  });

  it("converts newlines to <br>", () => {
    expect(plainTextToHtml("line1\nline2")).toBe("line1<br>\nline2");
  });

  it("turns a bare Google Maps URL into a clickable link", () => {
    const html = plainTextToHtml("Googleマップ\nhttps://maps.app.goo.gl/ZtDx6qirtUtmZJ9F8?g_st=ic");
    expect(html).toContain('<a href="https://maps.app.goo.gl/ZtDx6qirtUtmZJ9F8?g_st=ic" target="_blank" rel="noopener noreferrer">');
  });

  it("keeps a & inside a URL safely escaped in the href while the link stays intact", () => {
    const html = plainTextToHtml("https://example.com/?a=1&b=2");
    expect(html).toContain('href="https://example.com/?a=1&amp;b=2"');
  });

  it("does not let a following <br> get swallowed into the linkified URL", () => {
    const html = plainTextToHtml("https://example.com/\n次の行");
    expect(html).toContain('<a href="https://example.com/" target="_blank" rel="noopener noreferrer">https://example.com/</a><br>\n次の行');
  });
});
