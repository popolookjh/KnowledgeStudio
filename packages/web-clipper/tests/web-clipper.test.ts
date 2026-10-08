import { describe, expect, it } from 'vitest';
import { readMetadata } from '@knowledge-studio/metadata';
import { buildClipNote, clipNotePath, extractClip, htmlToMarkdown, parseClipInput } from '../src/index.js';

const page = `<!doctype html><html><head><title>Example &amp; Co</title>
<meta property="og:site_name" content="Example Site"><link rel="canonical" href="https://example.com/post">
<style>body{color:red}</style><script>alert('x')</script></head>
<body><nav>Menu Home</nav><article><h1>Heading</h1><p>Hello <strong>bold</strong> and <em>it</em> with <a href="/rel">relative</a>,
<a href="javascript:alert(1)">evil</a>, and <a href="https://ok.test/a(b)">ok</a>.</p>
<ul><li>One</li><li>Two<ol><li>Nested</li></ol></li></ul>
<blockquote><p>Quoted</p></blockquote><pre><code>const x = 1 &lt; 2;</code></pre>
<img src="https://img.test/a.png" alt="Alt text"><img src="data:image/png;base64,AAA" alt="inline">
<p onclick="steal()">متن فارسی&zwnj;ها &lt;script&gt;</p><iframe src="https://evil.test"></iframe>
<table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table></article><footer>Footer</footer></body></html>`;

describe('htmlToMarkdown', () => {
  const result = htmlToMarkdown(page, 'https://example.com/post');
  it('extracts title, canonical URL, and site name', () => {
    expect(result.title).toBe('Example & Co');
    expect(result.canonicalUrl).toBe('https://example.com/post');
    expect(result.siteName).toBe('Example Site');
  });
  it('converts structure to Markdown', () => {
    expect(result.markdown).toContain('# Heading');
    expect(result.markdown).toContain('**bold**');
    expect(result.markdown).toContain('*it*');
    expect(result.markdown).toContain('[relative](https://example.com/rel)');
    expect(result.markdown).toContain('[ok](https://ok.test/a%28b%29)');
    expect(result.markdown).toMatch(/- One\n- Two\n {2}1\. Nested/);
    expect(result.markdown).toContain('> Quoted');
    expect(result.markdown).toContain('```\nconst x = 1 < 2;\n```');
    expect(result.markdown).toContain('| A | B |\n| --- | --- |\n| 1 | 2 |');
    expect(result.markdown).toContain('[Image: Alt text](https://img.test/a.png)');
  });
  it('drops active content, unsafe schemes, chrome, and raw HTML', () => {
    expect(result.markdown).not.toMatch(/alert|steal|color:red|Menu Home|Footer|evil\.test|data:image|javascript/);
    expect(result.markdown).toContain('evil');
    expect(result.markdown).toContain('متن فارسی‌ها \\<script\\>');
    expect(result.markdown).not.toMatch(/(?<!\\)<(?!https?:)[a-z]/i);
  });
});

describe('clip ingestion', () => {
  it('validates renderer input', () => {
    expect(parseClipInput({ html: '<p>x</p>', url: 'https://a.test' }).ok).toBe(true);
    expect(parseClipInput({ html: '<p>x</p>', url: 'file:///etc/passwd' }).ok).toBe(false);
    expect(parseClipInput({ html: 5 }).ok).toBe(false);
    expect(parseClipInput({ html: 'x', tags: ['bad tag!'] }).ok).toBe(false);
    expect(parseClipInput({ html: 'x'.repeat(5 * 1024 * 1024 + 1) }).ok).toBe(false);
  });
  it('builds a note with provenance metadata and keeps plain text', () => {
    const clip = extractClip({ html: page, url: 'https://example.com/post', tags: ['research'] });
    if (!clip.ok) throw new Error(clip.error.message);
    const note = buildClipNote(clip.value, new Date('2026-09-29T00:00:00Z'));
    if (!note.ok) throw new Error(note.error.message);
    const metadata = readMetadata(note.value).data;
    expect(metadata).toMatchObject({ title: 'Example & Co', type: 'web-clip', source: 'https://example.com/post', site: 'Example Site', tags: ['clipping', 'research'], clipped: '2026-09-29T00:00:00.000Z' });
    expect(note.value).toContain('> Clipped from <https://example.com/post>');
    const text = extractClip({ html: 'Plain *text* line\nسطر دوم' });
    expect(text.ok && text.value.markdown).toBe('Plain \\*text\\* line\nسطر دوم');
    expect(text.ok && text.value.title).toBe('Plain \\*text\\* line');
    expect(extractClip({ html: '<script>x</script>' }).ok).toBe(false);
  });
  it('creates safe unique clip paths', () => {
    const taken = new Set(['Clippings/A b.md']);
    expect(clipNotePath('A: b', (candidate) => taken.has(candidate))).toBe('Clippings/A b 2.md');
    expect(clipNotePath('CON', () => false)).toBe('Clippings/CON clip.md');
    expect(clipNotePath('../../etc/passwd', () => false)).toBe('Clippings/.. .. etc passwd.md');
    expect(clipNotePath('مقاله', () => false)).toBe('Clippings/مقاله.md');
  });
});
