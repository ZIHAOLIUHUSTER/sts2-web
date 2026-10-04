// Run-end analytics through the real browser rule/bridge path; all Tianji requests are intercepted.
// Usage: CHROME=<path> [URL=http://127.0.0.1:47173/] node tools/e2e/analytics.mjs
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { startRun, viewport } from './start.mjs';

const localUrl = new URL(process.env.URL ?? 'http://127.0.0.1:47173/');
const deployedUrl = new URL(localUrl);
deployedUrl.hostname = 'analytics.localhost';
const browser = await chromium.launch({
  executablePath: process.env.CHROME,
  args: ['--host-resolver-rules=MAP analytics.localhost 127.0.0.1'],
});
try {
  for (const mode of ['deployed', 'blocked', 'local']) {
    const context = await browser.newContext({ viewport, serviceWorkers: 'block' });
    const page = await context.newPage();
    const events = [], errors = [], requests = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await context.route('https://app.tianji.dev/**', async (route) => {
      const request = route.request();
      requests.push(request.url());
      if (mode === 'blocked') return route.abort();
      if (request.url().endsWith('/tracker.js')) {
        return route.fulfill({ contentType: 'application/javascript', body: '' });
      }
      if (request.method() === 'OPTIONS') return route.fulfill({
        headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type' },
      });
      const body = request.postDataJSON();
      events.push(...(body.events ?? [body]));
      return route.fulfill({ contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: '{}' });
    });
    await page.goto(`${mode === 'local' ? localUrl : deployedUrl}?seed=ANALYTICS1&unlock=all&tutorials=off`);
    await page.waitForFunction(() => window.ui?.screen === 'menu', null, { timeout: 60000 });
    const trackerCount = await page.locator('script[data-website-id="cmupjzwk6wm425xc7qmgk89dy"]').count();
    assert.equal(trackerCount, mode === 'local' ? 0 : 1, `${mode}: tracker initialization`);
    await page.evaluate(() => { window.G.SaveManager.Instance.PrefsSave.FastMode = window.G.FastModeType.Instant; });

    for (const result of mode === 'deployed' ? ['defeat', 'victory'] : ['defeat']) {
      await startRun(page);
      assert.equal(events.filter((e) => e.payload?.name === 'run_end').length, result === 'victory' ? 1 : 0);
      await page.evaluate(async (result) => {
        const G = window.G, rm = G.RunManager.Instance;
        if (result === 'victory') {
          await rm.EnterRoom(new G.EventRoom().$ctor_EventRoom$EventModel(G.ModelDb.Event(G.TheArchitect)));
          await rm.WinRun();
        } else {
          await G.CreatureCmd.Kill$Creature_Boolean(rm.State.Players[0].Creature, true);
        }
      }, result);
      await page.waitForSelector('.gameover', { timeout: 30000 });
      // Reopening/rerendering the same result must not report a second completion.
      await page.evaluate(() => {
        window.G.$.ext('MegaCrit.Sts2.Core.Nodes.NRun').Instance.ShowGameOverScreen(window.ui.gameOver.serializableRun);
        window.invalidate();
      });
      await page.waitForTimeout(1500); // SDK batch interval is 1s
      const runEvents = events.filter((e) => e.payload?.name === 'run_end');
      if (mode === 'deployed') {
        assert.deepEqual(runEvents.map((e) => e.payload.data), result === 'victory'
          ? [{ result: 'defeat' }, { result: 'victory' }] : [{ result: 'defeat' }]);
        assert.ok(runEvents.every((e) => e.payload.website === 'cmupjzwk6wm425xc7qmgk89dy'));
      }
      console.log('OK', mode, result);
      if (result === 'defeat' && mode === 'deployed') {
        // Use the game's return path to skip unrelated summary/unlock animations.
        await page.evaluate(() => window.G.$.ext('MegaCrit.Sts2.Core.Nodes.NGame').Instance.ReturnToMainMenuAfterRun());
        await page.waitForFunction(() => window.ui?.screen === 'menu', null, { timeout: 30000 });
      }
    }
    if (mode === 'local') assert.equal(requests.length, 0, 'local runs must not send analytics');
    assert.deepEqual(errors, [], `${mode}: browser errors`);
    console.log('OK', mode, events.filter((e) => e.payload?.name === 'run_end').map((e) => e.payload.data));
    await context.close();
  }
} finally {
  await browser.close();
}
