import { describe, expect, it } from 'vitest';
import { renderMarkdownToHtml } from '../src/index.js';

describe('renderMarkdownToHtml — core constructs', () => {
  it('renders headings, emphasis, lists, and code', () => {
    const html = renderMarkdownToHtml('# H1\n\n**bold** _it_ `code`\n\n- a\n- b\n');
    expect(html).toContain('<h1>H1</h1>');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<em>it</em>');
    expect(html).toContain('<code>code</code>');
    expect(html).toContain('<li>a</li>');
  });

  it('renders GFM tables and task lists', () => {
    const html = renderMarkdownToHtml(
      '| a | b |\n| --- | --- |\n| 1 | 2 |\n\n- [x] done\n- [ ] todo\n',
    );
    expect(html).toContain('<table>');
    expect(html).toContain('<th>a</th>');
    expect(html).toContain('type="checkbox"');
  });

  it('renders Markdown links with normalized safe attributes', () => {
    const html = renderMarkdownToHtml('[site](https://example.com)');
    expect(html).toContain('<a href="https://example.com"');
  });

  it('renders blockquotes and nested structure', () => {
    const html = renderMarkdownToHtml('> quoted\n\n1. one\n2. two\n');
    expect(html).toContain('<blockquote>');
    expect(html).toContain('<ol>');
  });
});

describe('renderMarkdownToHtml — security', () => {
  it('drops raw HTML script blocks entirely', () => {
    const html = renderMarkdownToHtml('# ok\n\n<script>alert(1)</script>\n\ntext');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('alert(1)');
    expect(html).toContain('<h1>ok</h1>');
  });

  it('drops inline HTML with event handlers', () => {
    const html = renderMarkdownToHtml('hello <img src="x" onerror="alert(1)"> world');
    expect(html).not.toContain('onerror');
    expect(html).not.toContain('alert(1)');
  });

  it('blocks javascript: URLs in links', () => {
    const html = renderMarkdownToHtml('[click](javascript:alert(1))');
    expect(html).not.toContain('javascript:');
    expect(html).not.toMatch(/href="javascript[^"]*"/);
  });

  it('blocks data: URLs except inline images', () => {
    const html = renderMarkdownToHtml('[x](data:text/html,<script>)');
    expect(html).not.toContain('data:text/html');
  });

  it('does not execute raw iframes', () => {
    const html = renderMarkdownToHtml('<iframe src="https://evil.example"></iframe>');
    expect(html).not.toContain('<iframe');
  });

  it('renders Markdown images (legitimate use stays functional)', () => {
    const html = renderMarkdownToHtml('![alt text](attachments/logo.png "title")');
    expect(html).toContain('<img src="attachments/logo.png"');
    expect(html).toContain('alt="alt text"');
  });
});

describe('renderMarkdownToHtml — unicode', () => {
  it('renders Persian content without mangling', () => {
    const html = renderMarkdownToHtml('# سلام دنیا\n\nمتن **مهم** با یونیکد کامل');
    expect(html).toContain('<h1>سلام دنیا</h1>');
    expect(html).toContain('<strong>مهم</strong>');
  });
});
