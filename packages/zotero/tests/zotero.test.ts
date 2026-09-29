import { describe, expect, it } from 'vitest';
import { readMetadata } from '@knowledge-studio/metadata';
import { fetchLocalZoteroItems, formatCitation, literatureNote, literatureNotePath, parseBibtex, parseCslJson, parseZoteroApiItems, type FetchLike } from '../src/index.js';

const csl = JSON.stringify([
  { id: 'rahimi2024', type: 'article-journal', title: 'Urban  trees', author: [{ family: 'Rahimi', given: 'Sara' }, { family: 'Lee', given: 'Min' }], issued: { 'date-parts': [[2024, 3]] }, DOI: '10.1/x', URL: 'https://doi.org/10.1/x', 'container-title': 'Forest Journal', abstract: 'We study <b>trees</b>.', keyword: 'ecology, urban planning' },
  { id: 'bad', title: '' },
  { id: 'js', title: 'Evil', URL: 'javascript:alert(1)' },
]);

const bib = `@comment{ignored}
@article{karimi2023,
  title = {Persian {Manuscripts} and Paper},
  author = {Karimi, Ali and Smith, Jo and Doe, Ann},
  year = 2023,
  journal = "Studies \\& Notes",
  keywords = {history; paper},
}
@book{nokey, author = {X}}`;

describe('parsers', () => {
  it('parses CSL JSON and drops invalid items and unsafe URLs', () => {
    const items = parseCslJson(csl);
    if (!items.ok) throw new Error(items.error.message);
    expect(items.value).toHaveLength(2);
    expect(items.value[0]).toMatchObject({ key: 'rahimi2024', title: 'Urban trees', authors: ['Sara Rahimi', 'Min Lee'], year: 2024, doi: '10.1/x', container: 'Forest Journal', tags: ['ecology', 'urban-planning'] });
    expect(items.value[1]!.url).toBeUndefined();
    expect(parseCslJson('{nope').ok).toBe(false);
  });
  it('parses BibTeX without evaluating anything', () => {
    const items = parseBibtex(bib);
    if (!items.ok) throw new Error(items.error.message);
    expect(items.value).toEqual([expect.objectContaining({ key: 'karimi2023', citationKey: 'karimi2023', title: 'Persian Manuscripts and Paper', authors: ['Ali Karimi', 'Jo Smith', 'Ann Doe'], year: 2023, container: 'Studies & Notes', tags: ['history', 'paper'] })]);
  });
  it('parses Zotero API items, skipping attachments and notes', () => {
    const items = parseZoteroApiItems([
      { key: 'ABCD1234', library: { id: 1 }, data: { itemType: 'journalArticle', title: 'API item', creators: [{ firstName: 'N', lastName: 'Ahmadi' }], date: '2021-05-01', extra: 'Citation Key: ahmadi2021', tags: [{ tag: 'api' }] } },
      { key: 'ATTACH01', data: { itemType: 'attachment', title: 'file.pdf' } },
    ]);
    expect(items.ok && items.value).toEqual([expect.objectContaining({ key: '1:ABCD1234', citationKey: 'ahmadi2021', year: 2021, authors: ['N Ahmadi'], tags: ['api'] })]);
    expect(parseZoteroApiItems({}).ok).toBe(false);
  });
});

describe('literature notes', () => {
  const item = { key: 'k', itemType: 'book', title: 'کتاب: <تاریخ>', authors: ['A B', 'C D', 'E F'], year: 2020, citationKey: 'CON', tags: ['t'] };
  it('formats citations and safe paths', () => {
    expect(formatCitation(item)).toBe('B et al., 2020');
    expect(formatCitation({ ...item, authors: [] , year: undefined })).toBe('Anon., n.d.');
    expect(literatureNotePath(item, () => false)).toBe('Literature/CON ref.md');
    expect(literatureNotePath({ ...item, citationKey: undefined }, (candidate) => candidate === 'Literature/کتاب  تاریخ.md' || candidate === 'Literature/کتاب تاریخ.md')).toBe('Literature/کتاب تاریخ 2.md');
  });
  it('writes typed frontmatter and escaped body', () => {
    const note = literatureNote({ ...item, abstract: 'Uses *markdown* <script>' });
    if (!note.ok) throw new Error(note.error.message);
    expect(readMetadata(note.value).data).toMatchObject({ title: 'کتاب: <تاریخ>', type: 'literature', authors: ['A B', 'C D', 'E F'], zotero_key: 'k', citekey: 'CON', tags: ['literature', 't'] });
    expect(note.value).toContain('Uses \\*markdown\\* \\<script\\>');
  });
});

describe('local API', () => {
  it('contacts only 127.0.0.1 with a read-only GET and reports availability', async () => {
    const calls: string[] = [];
    const fake: FetchLike = (url) => { calls.push(url); return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(JSON.stringify([{ key: 'K1', data: { itemType: 'book', title: 'T' } }])) }); };
    const result = await fetchLocalZoteroItems(23119, fake);
    expect(result.ok && result.value[0]!.key).toBe('0:K1');
    expect(calls).toEqual(['http://127.0.0.1:23119/api/users/0/items/top?format=json&limit=100']);
    expect((await fetchLocalZoteroItems(80, fake)).ok).toBe(false);
    const down: FetchLike = () => Promise.reject(new Error('ECONNREFUSED'));
    const unavailable = await fetchLocalZoteroItems(23119, down);
    expect(!unavailable.ok && unavailable.error.code).toBe('ZOTERO_UNAVAILABLE');
    const forbidden: FetchLike = () => Promise.resolve({ ok: false, status: 403, text: () => Promise.resolve('') });
    expect((await fetchLocalZoteroItems(23119, forbidden)).ok).toBe(false);
  });
});
