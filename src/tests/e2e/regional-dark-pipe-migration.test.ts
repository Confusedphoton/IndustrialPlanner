import { expect, test, SCREEN_PROFILES } from "./harness/fixture";
import { normalizeBlueprintDocument } from "@/shared/blueprints/blueprint-document-codec";
import fixtureJson from "../fixtures/blueprints/editor-regional-dark-pipe/scene.schema7.json" with { type: "json" };

import { WORLD_DOCUMENT_SCHEMA_VERSION, type WorldDocument } from "@/domain/document/world-document";


interface MigrationSnapshot {
  documents: WorldDocument[];
  asset: { data: { darkPipeLinks: unknown[] } };
  complete: boolean;
  failures: number;
  documentWrites: number;
  hostCreated: boolean;
}

for (const profile of SCREEN_PROFILES.filter(profile => profile.name === "desktop")) {
  test(`启动时旧资产只迁入出口文档；失败原子回滚，刷新重试不复制链接 [${profile.name}]`, async ({ browserSession, baseURL }, testInfo) => {
    test.setTimeout(150_000);
    const cli = await browserSession.openCli(profile);
    const result = await cli.runJson(`async page => {
      const ready = () => page.waitForFunction(() => {
        const state = window.__test__?.readiness();
        return state?.assembled && state.canvasAttached && state.viewportValid;
      });
      await page.goto(${JSON.stringify(baseURL)});
      await ready();
      const prepared = await page.evaluate(async blueprint => {
        const app = window.__industrialPlannerAppHost;
        const editor = app.workspace.editor;
        const storage = await import('/src/shared/storage/browser-storage.ts');
        const world = await import('/src/editor/document-storage.ts');
        const links = await import('/src/shared/dark-pipe-link.ts');
        const migration = await import('/src/shared/storage/data-migration-state.ts');
        await editor.queries.listBaseDocumentSummaries();
        const inlet = editor.document.getSnapshot().baseId;
        const region = app.workspace.registry.baseDefinitions.find(base => base.id === inlet).tag;
        const outlet = app.workspace.registry.baseDefinitions.find(base => base.tag === region && base.id !== inlet).id;
        const baseIds = [inlet, outlet];
        for (const before of await editor.queries.readLatestBaseDocuments(baseIds)) {
          await editor.actions.applySynchronizedDocument({
            ...before, entities: {...before.entities, ...blueprint.entities},
            entityOrder: [...before.entityOrder, ...blueprint.entityOrder], slotLinks: [],
          });
        }
        await world.flushEditorDocumentStorage(editor);
        const valid = links.createRegionalDarkPipeLink({inlet:{baseId:inlet,entityId:'inlet'},outlet:{baseId:outlet,entityId:'outlet'}});
        const missing = links.createRegionalDarkPipeLink({inlet:{baseId:inlet,entityId:'missing-inlet'},outlet:{baseId:outlet,entityId:'missing-outlet'}});
        await app.regionalSettings.createSyncSource().writeLocal({
          id:'default',value:{...app.regionalSettings.asset,darkPipeLinks:[valid,missing]},deletedAt:null,
        });
        const documents = await editor.queries.readLatestBaseDocuments(baseIds);
        const completion = await storage.readFromIndexedDb(migration.DATA_MIGRATION_LOCATION, {strict:true});
        // 仅布置待启动迁移的数据与失效标记；被测转换由下一次页面启动执行。
        await migration.writeDataMigrationCompletion(completion.version, false);
        sessionStorage.setItem('e2e-regional-migration-fail', 'true');
        return {documentKeys:documents.map(document => document.documentKey),valid,missing};
      }, ${JSON.stringify(normalizeBlueprintDocument(fixtureJson)!)});
      const readStored = () => page.evaluate(async documentKeys => {
        const storage = await import('/src/shared/storage/browser-storage.ts');
        const world = await import('/src/shared/storage/world-document-storage.ts');
        const legacy = await import('/src/shared/legacy-regional-dark-pipe.ts');
        const migration = await import('/src/shared/storage/data-migration-state.ts');
        const documents = await Promise.all(documentKeys.map(key => storage.readFromIndexedDb({
          ...world.WORLD_DOCUMENT_DATABASE_LOCATION,key,
        }, {strict:true})));
        const asset = await storage.readFromIndexedDb(legacy.LEGACY_REGIONAL_SETTINGS_LOCATION, {strict:true});
        const completion = await storage.readFromIndexedDb(migration.DATA_MIGRATION_LOCATION, {strict:true});
        return {documents,asset,complete:completion.complete,
          failures:Number(sessionStorage.getItem('e2e-regional-migration-failures') || 0),
          documentWrites:Number(sessionStorage.getItem('e2e-regional-migration-document-writes') || 0),
          hostCreated:!!window.__industrialPlannerAppHost};
      }, prepared.documentKeys);
      const beforeFailure = await readStored();
      await page.addInitScript(() => {
        if (sessionStorage.getItem('e2e-regional-migration-fail') !== 'true') return;
        const originalPut = IDBObjectStore.prototype.put;
        // 文档 put 之后、旧资产清理之前失败，必须撤销整笔真实 IndexedDB 事务。
        IDBObjectStore.prototype.put = function(value, key) {
          const stores = this.transaction.objectStoreNames;
          if (stores.contains('worddocument') && stores.contains('regional-settings')) {
            if (this.name === 'worddocument') sessionStorage.setItem('e2e-regional-migration-document-writes',
              String(Number(sessionStorage.getItem('e2e-regional-migration-document-writes') || 0) + 1));
            if (this.name === 'regional-settings' && typeof value === 'string'
              && JSON.parse(value).data?.darkPipeLinks?.length === 1) {
              sessionStorage.setItem('e2e-regional-migration-failures',
                String(Number(sessionStorage.getItem('e2e-regional-migration-failures') || 0) + 1));
              throw new DOMException('Injected legacy cleanup failure', 'QuotaExceededError');
            }
          }
          return originalPut.call(this, value, key);
        };
      });
      await page.reload();
      const failureDialog = page.getByRole('dialog', {name:'部分数据暂时无法升级',exact:true});
      await failureDialog.waitFor({state:'visible'});
      const failed = await readStored();
      await page.evaluate(() => sessionStorage.removeItem('e2e-regional-migration-fail'));
      await Promise.all([
        page.waitForEvent('domcontentloaded'),
        failureDialog.getByRole('button', {name:'重新加载',exact:true}).click(),
      ]);
      await ready();
      const migrated = await readStored();
      await page.reload();
      await ready();
      const repeated = await readStored();
      return {beforeFailure,failed,migrated,repeated,valid:prepared.valid,missing:prepared.missing};
    }`, "startup-migration.log") as {
      beforeFailure: MigrationSnapshot;
      failed: MigrationSnapshot;
      migrated: MigrationSnapshot;
      repeated: MigrationSnapshot;
      valid: { id: string; inlet: { baseId: string } };
      missing: unknown;
    };

    expect(result.failed.failures).toBeGreaterThan(0);
    expect(result.failed.documentWrites).toBeGreaterThan(0);
    expect(result.failed.hostCreated).toBe(false);
    expect(result.failed.complete).toBe(false);
    expect(result.failed.documents).toEqual(result.beforeFailure.documents);
    expect(result.failed.asset).toEqual(result.beforeFailure.asset);
    expect(result.failed.asset.data.darkPipeLinks).toHaveLength(2);
    expect(result.migrated.documents.map(document => document.slotLinks.length)).toEqual([0, 1]);
    expect(result.migrated.documents.map(document => document.schemaVersion)).toEqual([
      WORLD_DOCUMENT_SCHEMA_VERSION, WORLD_DOCUMENT_SCHEMA_VERSION,
    ]);
    expect(result.migrated.documents[1]!.slotLinks[0]).toMatchObject({
      id: result.valid.id, source: {entityId:"outlet"}, target: {entityId:"inlet",baseId:result.valid.inlet.baseId},
    });
    expect(result.migrated.complete).toBe(true);
    expect(result.migrated.hostCreated).toBe(true);
    expect(result.migrated.asset.data.darkPipeLinks).toEqual([result.missing]);
    expect(result.repeated).toEqual(result.migrated);
    await testInfo.attach("migration-state.json", {body:JSON.stringify(result,null,2),contentType:"application/json"});
  });
}
