import { resolve } from "node:path";
import { expect, SCREEN_PROFILES, test } from "./harness/fixture";
import fixture from "../fixtures/blueprints/collections/req048/orchestrator-device.schema7.json" with { type: "json" };

test("双视图独立时间、WebGL 恢复与资源释放", async ({ browserSession, baseURL }) => {
  test.setTimeout(120_000);
  const cli = await browserSession.openCli(SCREEN_PROFILES.find(profile => profile.name === "desktop")!);
  const result = await cli.runJson(`async page => {
    const require = (condition, message) => { if (!condition) throw Error(message); };
    await page.addLocatorHandler(page.locator('[data-dialog-key="help"]'), async dialog => {
      await dialog.getByRole('button', {name:'关闭',exact:true}).click();
    }, {times:1});
    await page.goto(${JSON.stringify(baseURL)});
    await page.waitForFunction(() => window.__test__?.readiness().viewportValid);
    await page.evaluate(document => window.__test__.loadBlueprint(document), ${JSON.stringify(fixture)});
    try {
      await page.evaluate(async () => {
        const { createReadonlyCanvasScene } = await import('/src/app/canvas/index.ts');
        const app = window.__industrialPlannerAppHost, renderer = app.workspace.render;
        const root = document.createElement('div');
        Object.assign(root.style, {position:'fixed',left:'12px',top:'12px',display:'flex',zIndex:'100000'});
        document.body.append(root);
        const state = window.__sceneLifecycle = {root,scenes:[],handles:[],resume:app.mainCanvas.suspend()};
        for (let i=0;i<2;i++) {
          const scene=createReadonlyCanvasScene({appHost:app,id:'e2e-owned-view-'+i,document:window.__test__.document()});
          state.scenes.push(scene);scene.resize({left:0,top:0,width:460,height:300});
          const handle=await renderer.actions.mountView({input:scene.input,time:{kind:'advancing',clockId:'driver-'+i,initialTimeMs:0}});
          state.handles.push(handle);
          const element=renderer.queries.getViewContainer(handle);element.id='e2e-owned-view-'+i;root.append(element);
        }
      });
      const times=await page.evaluate(() => {
        const renderer=window.__industrialPlannerAppHost.workspace.render, [a,b]=window.__sceneLifecycle.handles;
        const send=(handle,clockId,timeMs)=>renderer.actions.updateViews([{handle,sample:{clockId,timeMs}}]);
        const sample=()=>[a,b].map(handle=>renderer.queries.getViewStatus(handle).sampleTimeMs);
        send(a,'driver-0',100);send(b,'driver-1',200);
        send(a,'driver-0',120);send(b,'driver-1',260);
        const before=sample(), resume=renderer.actions.suspendView(a);
        send(a,'driver-0',1120);send(b,'driver-1',300);
        const paused=sample();resume();send(a,'driver-0',1120);send(a,'driver-0',1130);send(b,'driver-1',310);
        const after=sample();
        for(const handle of [a,b])renderer.actions.setViewTimePolicy(handle,{kind:'fixed',sampleTimeMs:0});
        renderer.actions.updateViews([{handle:a},{handle:b}]);
        return {before,paused,after};
      });
      require(JSON.stringify(times)===JSON.stringify({before:[20,60],paused:[20,100],after:[30,110]}),'独立时间或挂起恢复错误');
      const survivor=page.locator('#e2e-owned-view-1 canvas');
      const pixels=await survivor.screenshot({scale:'css'});
      await survivor.evaluate(canvas=>new Promise((resolve,reject)=>{
        const gl=canvas.getContext('webgl2')||canvas.getContext('webgl');
        const extension=gl?.getExtension('WEBGL_lose_context');
        if(!extension){reject(Error('WebGL context loss unavailable'));return;}
        const timeout=setTimeout(()=>reject(Error('WebGL restore timeout')),5000);
        canvas.addEventListener('webglcontextrestored',()=>{clearTimeout(timeout);resolve(true);},{once:true});
        canvas.addEventListener('webglcontextlost',()=>setTimeout(()=>extension.restoreContext(),100),{once:true});
        extension.loseContext();
      }));
      await page.evaluate(() => {
        const renderer=window.__industrialPlannerAppHost.workspace.render;
        renderer.actions.updateViews([{handle:window.__sceneLifecycle.handles[1]}]);
      });
      require(pixels.equals(await survivor.screenshot({path:${JSON.stringify(resolve(cli.directory, "context-restored.png"))},scale:'css'})), 'WebGL 恢复后静态画面变化');
      await page.evaluate(() => {
        const renderer=window.__industrialPlannerAppHost.workspace.render, [a,b]=window.__sceneLifecycle.handles;
        renderer.actions.disposeView(a);renderer.actions.disposeView(a);
        renderer.actions.invalidateView(b);renderer.actions.updateViews([{handle:b}]);
      });
      require(pixels.equals(await survivor.screenshot({path:${JSON.stringify(resolve(cli.directory, "surviving-view.png"))},scale:'css'})), '释放另一视图破坏共享资源');
      const cancelled=await page.evaluate(async () => {
        const renderer=window.__industrialPlannerAppHost.workspace.render, state=window.__sceneLifecycle;
        const abort=new AbortController();
        const pending=renderer.actions.mountView({input:{...state.scenes[1].input,id:'cancelled-view'},time:{kind:'fixed',sampleTimeMs:0},signal:abort.signal});
        const result=pending.then(handle=>{renderer.actions.disposeView(handle);return 'unexpected-ready';},error=>error.name);
        abort.abort();return await result;
      });
      require(cancelled==='AbortError','初始化取消后仍交付视图');
      return {passed:true};
    } finally {
      await page.evaluate(() => {
        const state=window.__sceneLifecycle;if(!state)return;
        const renderer=window.__industrialPlannerAppHost.workspace.render;
        try {for(const handle of state.handles)renderer.actions.disposeView(handle);}
        finally {for(const scene of state.scenes)scene.dispose();state.root.remove();state.resume();delete window.__sceneLifecycle;}
      });
    }
  }`);
  expect(result).toEqual({ passed: true });
});
