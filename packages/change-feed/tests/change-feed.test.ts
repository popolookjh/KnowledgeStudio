import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { Vault } from '@knowledge-studio/vault';
import { ChangeFeedStore } from '../src/index.js';
async function feed(retention = 10) { const root = await mkdtemp(path.join(tmpdir(), 'ks-feed-')); const opened = await Vault.create(root); if (!opened.ok) throw opened.error; return { root, store: new ChangeFeedStore(opened.value, retention), vault: opened.value }; }
describe('change feed', () => {
 it('persists ordered opaque cursor changes without note content', async () => { const { root, store } = await feed(); await store.append({ type: 'document_created', path: 'فارسی.md', documentId: 'doc-1' }); await store.append({ type: 'document_updated', path: 'فارسی.md', documentId: 'doc-1' }); const first = await store.changesSince(); expect(first.ok && first.value.changes.map((event) => event.sequence)).toEqual([1,2]); const resumed = await store.changesSince(first.ok ? first.value.cursor : ''); expect(resumed.ok && resumed.value.changes).toEqual([]); await rm(root,{recursive:true,force:true}); });
 it('reports cursor expiry and foreign/malformed cursors', async () => { const { root, store } = await feed(1); await store.append({type:'document_created',path:'a.md'}); const old = await store.getCurrentCursor(); await store.append({type:'document_updated',path:'a.md'}); await store.append({type:'document_deleted',path:'a.md'}); const expired = await store.changesSince(old); expect(expired.ok ? '' : expired.error.code).toBe('CURSOR_EXPIRED'); expect((await store.changesSince('bad')).ok).toBe(false); await rm(root,{recursive:true,force:true}); });
 it('retains tombstones and restart-safe sequences', async () => { const { root, store, vault } = await feed(); await store.append({type:'document_deleted',path:'gone.md',documentId:'old',metadata:{tombstone:true}}); const reopened = new ChangeFeedStore(vault); const page = await reopened.changesSince(); expect(page.ok && page.value.changes[0]).toMatchObject({type:'document_deleted',path:'gone.md'}); await rm(root,{recursive:true,force:true}); });
});
