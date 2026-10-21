// End-to-end verification of the integrated AI Agent upgrade.
//
// It drives the PREVIEW app with a REAL Supabase session for the authorised
// reviewer account, so every check runs against the live backend with the
// permissions that account actually has. Nothing is mocked.
//
//   node tests/agent-upgrade.browser.mjs --url http://127.0.0.1:8899/
//
// The session file is written by the reviewer session helper; see
// docs/agent-upgrade-integrated.md.
import fs from 'node:fs';
import path from 'node:path';

// playwright-core is not a dependency of this static site. It is looked up in
// the workspace, and the reviewer's machine can point at it explicitly.
let pw;
try {
  pw = await import('playwright-core');
} catch (e) {
  const candidates = [
    process.env.PLAYWRIGHT_CORE,
    path.join(process.env.HOME || '/root', 'ai-agent-digitivia-production/node_modules/playwright-core/index.js'),
    '/root/ai-agent-digitivia-production/node_modules/playwright-core/index.js',
  ].filter(Boolean);
  for (const c of candidates) {
    try { pw = (await import(c)).default || await import(c); break; } catch (_) { /* try the next one */ }
  }
  if (!pw) { console.error('playwright-core not found. Set PLAYWRIGHT_CORE=/path/to/playwright-core'); process.exit(2); }
}
const { chromium } = pw;
const EXEC = process.env.CHROME_PATH || '/root/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome';
const args = process.argv.slice(2);
const argOf = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const URL_ = argOf('--url', 'http://127.0.0.1:8899/');
const SESSION_FILE = argOf('--session', path.join(process.env.HOME || '/root', '.digitivia-review-session.json'));
const ORG = argOf('--org', '47347636-0bd6-42d9-97bd-202f1ce7a7bd');
const AGENT = argOf('--agent', 'telegram');
const SESSION = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'));
const STORAGE_KEY = 'sb-xrycghxaxqzvkmzqzzkx-auth-token';

const ok = [], bad = [];
const check = (name, cond, extra = '') => { (cond ? ok : bad).push(name + (extra ? ' :: ' + extra : '')); };

const browser = await chromium.launch({ executablePath: EXEC, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

const consoleErrors = [];
const fnCalls = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 200)); });
page.on('pageerror', (e) => consoleErrors.push('PAGEERROR: ' + String(e).slice(0, 200)));
page.on('request', (r) => { const u = r.url(); if (u.includes('/functions/v1/')) fnCalls.push(u.split('/functions/v1/')[1].split('?')[0]); });

await page.addInitScript(([k, s]) => {
  try {
    localStorage.setItem(k, JSON.stringify(s));
    // The first-run tour is not part of what we verify, and it would cover the UI.
    localStorage.setItem('tour_completed', '1');
    localStorage.setItem('tour_dismissed', '1');
  } catch (e) { /* ignore */ }
}, [STORAGE_KEY, SESSION]);

await page.goto(URL_, { waitUntil: 'domcontentloaded', timeout: 90000 });
await page.waitForFunction(() => !!window.AgentStudioReady, null, { timeout: 60000 });

const rpc = (fn, a) => page.evaluate(([f, x]) => window.supabaseClient.rpc(f, x), [fn, a]);
const gotoTab = async (id) => {
  await page.evaluate((t) => { if (typeof window.switchTab === 'function') window.switchTab(t); }, id);
  await page.waitForFunction((t) => {
    const el = document.querySelector('.tab-content.active');
    return el && el.id === t;
  }, id, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(400);
};
const cfg = async () => {
  const r = await page.evaluate(([org, agent]) => window.supabaseClient
    .from('agent_configs').select('*').eq('org_id', org).eq('agent', agent).single(), [ORG, AGENT]);
  return r.data;
};

await gotoTab(AGENT);

// ---------------------------------------------------------------- 1. the surface
const surface = await page.evaluate(() => ({
  enabled: !!(window.AgentStudio && window.AgentStudio.enabled),
  asx: document.querySelectorAll('.asx').length,
  roleCards: document.querySelectorAll('.ar-card').length,
  compareRows: document.querySelectorAll('.pb-compare-toggle').length,
  studioSection: !!document.querySelector('.asx-sec-' + document.querySelector('.asx').dataset.agent),
  effHost: !!document.querySelector('.asx-eff-host'),
  effLayers: document.querySelectorAll('.asx-layer').length,
}));
check('Studio is enabled for the authorised account', surface.enabled);
check('Capabilities panel mounted for every agent', surface.asx === 5, 'asx=' + surface.asx);
check('The old role picker does not also render (no duplicate screen)', surface.roleCards === 0);
check('The duplicated Compare Models controls are gone', surface.compareRows === 0, 'rows=' + surface.compareRows);
check('The studio has its own section in the agent tab', surface.studioSection);
check('The effective prompt panel is present', surface.effHost);
check('The effective prompt panel has content', surface.effLayers >= 1, 'layers=' + surface.effLayers);
await page.waitForFunction(() => typeof (window.DigitiviaCompareModels && window.DigitiviaCompareModels.run) === 'function', null, { timeout: 15000 }).catch(() => {});
const compareType = await page.evaluate(() => typeof (window.DigitiviaCompareModels && window.DigitiviaCompareModels.run));
check('The comparison itself is still available', compareType === 'function', 'type=' + compareType);
check('The comparison leaves no duplicate hosts behind', (await page.locator('[id^="pb-bench-host-"]').count()) === 5,
  'hosts=' + (await page.locator('[id^="pb-bench-host-"]').count()));

// ---------------------------------------------------------------- 2. a real save
const before = await cfg();
const beforeVersion = before ? before.config_version : 0;

await page.click(`#${AGENT} .asx [data-primary="support"]`);
await page.waitForTimeout(400);
const dirtyChip = await page.textContent(`#${AGENT} .asx [data-kind="dirty"]`).catch(() => '');
check('Unsaved state is shown after an edit', /unsaved/i.test(dirtyChip || ''), dirtyChip);
const saveBtnText = await page.textContent(`#${AGENT} .save-btn`).catch(() => '');
check('The app Save button lights up for a layer-only edit', /save changes/i.test(saveBtnText || ''), saveBtnText);

await page.click(`#${AGENT} .asx [data-act="save"]`);
await page.waitForFunction((a) => !!document.querySelector(`#${a} .asx [data-kind="saved"]`), AGENT, { timeout: 25000 }).catch(() => {});
await page.waitForTimeout(600);
const after = await cfg();
check('Save wrote to the real backend', !!(after && after.persona && after.persona.layers), JSON.stringify(after && after.persona));
check('Save moved the version forward', after && after.config_version > beforeVersion, `${beforeVersion} -> ${after && after.config_version}`);
check('Save stored the chosen main job', after && after.persona.layers.primary === 'support');
check('Save kept the top-level role in step with it', after && after.persona.role === 'support', after && after.persona.role);
const savedChip = await page.textContent(`#${AGENT} .asx [data-kind="saved"]`).catch(() => '(none)');
check('Saved state is shown with the version', /saved/i.test(savedChip || ''), savedChip);
const layerRows = await page.evaluate((a) => [...document.querySelectorAll(`#${a} .asx-layer`)]
  .map((n) => n.querySelector('.asx-layer-k') && n.querySelector('.asx-layer-k').textContent), AGENT);
check('The layered agent shows every layer with its origin', layerRows.length >= 3, JSON.stringify(layerRows));

// ---------------------------------------------------------------- 3. version history
const versions = await rpc('list_agent_versions', { p_org_id: ORG, p_agent: AGENT, p_limit: 5 });
check('Version history lists the new save', !!(versions.data && versions.data[0] && versions.data[0].version === after.config_version));
check('The version records who and when', !!(versions.data && versions.data[0] && versions.data[0].created_by && versions.data[0].created_at));

await page.click(`#${AGENT} .asx [data-act="versions"]`);
await page.waitForTimeout(1200);
check('Version history drawer lists versions', (await page.locator('.asx-ver').count()) > 0);
await page.keyboard.press('Escape');
await page.waitForTimeout(400);

const restoreTarget = (versions.data || []).find((v) => v.version < after.config_version);
if (restoreTarget) {
  await page.click(`#${AGENT} .asx [data-act="versions"]`);
  await page.waitForTimeout(1000);
  await page.locator(`[data-act="restore"][data-version="${restoreTarget.version}"]`).first().click();
  await page.waitForTimeout(500);
  await page.locator('[data-x="go"]').click();
  await page.waitForTimeout(2500);
  const restored = await cfg();
  check('Restore wrote a new version (the old one is kept)', restored && restored.config_version > after.config_version, `${after.config_version} -> ${restored && restored.config_version}`);
  const v2 = await rpc('list_agent_versions', { p_org_id: ORG, p_agent: AGENT, p_limit: 3 });
  check('The restore is recorded in the history', !!(v2.data && v2.data[0] && v2.data[0].restored_from));
  await page.keyboard.press('Escape');
} else {
  bad.push('Restore test could not run (no earlier version)');
}

// ---------------------------------------------------------------- 4. a stale browser is refused
const errorsBeforeStale = consoleErrors.length;
const stale = await rpc('save_agent_studio', {
  p_org_id: ORG, p_agent: AGENT, p_changes: { tone: 'Balanced' }, p_expected_version: 1,
});
check('A stale browser cannot overwrite a newer version', !!(stale.error && stale.error.code === 'P0001'), JSON.stringify(stale.error));
const staleErrors = consoleErrors.slice(errorsBeforeStale);
check('The stale refusal is the only thing that was logged', staleErrors.every((e) => /400/.test(e)), JSON.stringify(staleErrors));
consoleErrors.length = errorsBeforeStale;

// ---------------------------------------------------------------- 5. free text keeps the layers
const PROMPT_MARK = 'Always greet the customer by name. [' + Date.now() + ']';
await page.evaluate(([a, mark]) => {
  const ta = document.getElementById('prompt-' + a);
  ta.readOnly = false;
  ta.value = mark;
  ta.dispatchEvent(new Event('input', { bubbles: true }));
}, [AGENT, PROMPT_MARK]);
await page.waitForTimeout(400);
await page.click(`#${AGENT} .asx [data-act="save"]`);
await page.waitForTimeout(2500);
const withPrompt = await cfg();
check('Free text (layer 5) is saved', !!(withPrompt && withPrompt.system_prompt && withPrompt.system_prompt.indexOf(PROMPT_MARK) >= 0), withPrompt && withPrompt.system_prompt);
const panelText = await page.textContent(`#${AGENT} .asx-eff-host`).catch(() => '');
check('The effective prompt panel shows the owner\'s instructions', (panelText || '').indexOf(PROMPT_MARK) >= 0);
const eff = await rpc('resolve_agent_prompt', { p_org_id: ORG, p_agent: AGENT, p_include_guards: true });
check('The effective prompt is composed by the server, not the page', !!(eff.data && eff.data.source), JSON.stringify({ source: eff.data && eff.data.source }));

// ---------------------------------------------------------------- 6. test chat: simulation and real AI
await gotoTab(AGENT);
check('Test Chat offers Simulation and Real AI', (await page.locator(`#${AGENT} .tc2-mode-btn`).count()) === 2);

await page.click(`#${AGENT} .tc2-mode-btn[data-mode="sim"]`);
await page.waitForTimeout(400);
const beforeCalls = fnCalls.length;
await page.fill(`#chat-input-${AGENT}`, 'do you have salmon?');
await page.click(`#${AGENT} .tc2-send`);
await page.waitForTimeout(2000);
const simBubbles = await page.locator(`#chat-history-${AGENT} .message`).allInnerTexts();
check('Simulation answers with prepared text', simBubbles.length >= 2, JSON.stringify(simBubbles).slice(0, 160));
check('Simulation calls no AI provider', fnCalls.length === beforeCalls, fnCalls.slice(beforeCalls).join(','));
const simNote = await page.textContent(`#${AGENT} .tc2-note`).catch(() => '');
check('Simulation says plainly that nothing is sent or charged', /nothing is sent|simulation/i.test(simNote || ''), (simNote || '').slice(0, 90));

await page.click(`#${AGENT} .tc2-mode-btn[data-mode="ai"]`);
await page.waitForTimeout(400);
const beforeAi = fnCalls.length;
await page.fill(`#chat-input-${AGENT}`, 'hello');
await page.click(`#${AGENT} .tc2-send`);
await page.waitForTimeout(9000);
check('Real AI calls the agent test function', fnCalls.slice(beforeAi).indexOf('agent-test-chat') >= 0, fnCalls.slice(beforeAi).join(','));

// ---------------------------------------------------------------- 7. follow-ups
await gotoTab('followups');
await page.waitForTimeout(2500);
const fu = await page.evaluate(() => ({
  boxes: document.querySelectorAll('.fuai-box').length,
  modeButtons: document.querySelectorAll('.fuai-box .fuai-mode').length,
  betaBanner: !!document.querySelector('#followups [data-feature-notice="followup-ai"]'),
}));
check('Every follow-up step offers Fixed / AI-written', fu.boxes > 0 && fu.modeButtons >= 2, JSON.stringify(fu));
check('No beta banner is pushed on the Follow-ups page', !fu.betaBanner);
await page.locator('#fu-step-card-0 .fuai-mode[data-mode="ai"]').first().click();
await page.waitForTimeout(900);
const fu2 = await page.evaluate(() => ({
  goal: document.querySelectorAll('#fu-step-card-0 .fuai-goal').length,
  lang: document.querySelectorAll('#fu-step-card-0 select[id^="fuai-lang-"]').length,
  note: (document.querySelector('#fu-step-card-0 .fuai-note') || {}).innerText || '',
  stops: !!document.querySelector('#fu-step-card-0 .fuai-stops'),
}));
check('An AI-written step has an objective', fu2.goal === 1, JSON.stringify(fu2));
check('An AI-written step has a language choice', fu2.lang === 1);
check('The step explains when the AI stops', fu2.stops);
check('The step says the AI is not switched on for sending', /not switched on/i.test(fu2.note || ''), (fu2.note || '').slice(0, 100));
const fuStatus = await rpc('followup_ai_status', { p_org_id: ORG });
check('The server still reports AI follow-ups OFF', fuStatus.data && fuStatus.data.enabled === false, JSON.stringify(fuStatus.data));

// ---------------------------------------------------------------- 8. Arabic
await page.evaluate(() => { try { localStorage.setItem('app_language', 'ar'); } catch (e) { /* ignore */ } });
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => !!window.AgentStudioReady, null, { timeout: 60000 });
await gotoTab(AGENT);
const ar = await page.evaluate(() => {
  const root = document.querySelector('.asx');
  return {
    dir: document.documentElement.dir,
    lang: document.documentElement.lang,
    title: root ? root.querySelector('.asx-title').textContent.trim() : '',
    caps: root ? root.querySelectorAll('.asx-cap').length : 0,
  };
});
check('The studio works in Arabic with a right-to-left page', ar.dir === 'rtl' && ar.lang === 'ar', JSON.stringify(ar));
check('The studio still shows every capability in Arabic', ar.caps === 6, JSON.stringify(ar));
await page.evaluate(() => { try { localStorage.setItem('app_language', 'en'); } catch (e) { /* ignore */ } });

// ---------------------------------------------------------------- 9. a small phone
await page.setViewportSize({ width: 390, height: 844 });
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => !!window.AgentStudioReady, null, { timeout: 60000 });
await gotoTab(AGENT);
const mobile = await page.evaluate(() => {
  const root = document.querySelector('.asx');
  const caps = root ? root.querySelector('.asx-caps') : null;
  return {
    docW: document.documentElement.scrollWidth,
    winW: window.innerWidth,
    capsCols: caps ? getComputedStyle(caps).gridTemplateColumns.split(' ').length : 0,
    hasSave: !!root && !!root.querySelector('[data-kind]'),
  };
});
check('No horizontal overflow on a small phone', mobile.docW <= mobile.winW + 1, JSON.stringify(mobile));
check('The capability grid collapses to one column on a phone', mobile.capsCols === 1, JSON.stringify(mobile));

// ---------------------------------------------------------------- 10. the gate
// An account the server does not allow must not see the new surface. The
// check here is the hard one: the access answer is blocked, so the studio has
// to stay away and the old role picker has to come back.
{
  const denied = await ctx.newPage();
  await denied.addInitScript(([k, s]) => {
    try {
      localStorage.setItem(k, JSON.stringify(s));
      localStorage.setItem('tour_completed', '1');
      localStorage.setItem('tour_dismissed', '1');
    } catch (e) { /* ignore */ }
  }, [STORAGE_KEY, SESSION]);
  await denied.route('**/rest/v1/rpc/agent_upgrade_access*', (r) => r.abort());
  await denied.goto(URL_, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await denied.waitForTimeout(6000);
  const gate = await denied.evaluate(() => ({
    asx: document.querySelectorAll('.asx').length,
    roleCards: document.querySelectorAll('.ar-card').length,
    enabled: !!(window.AgentStudio && window.AgentStudio.enabled),
  }));
  check('Without the server\'s permission the new surface does not appear', gate.asx === 0 && !gate.enabled, JSON.stringify(gate));
  check('The old role picker comes back when the new surface is not allowed', gate.roleCards > 0, JSON.stringify(gate));
  await denied.close();
}

// ---------------------------------------------------------------- 11. no console noise
check('No console errors during the whole run', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));

console.log('\n########## PASS (' + ok.length + ') ##########');
ok.forEach((o) => console.log('  OK  ' + o));
console.log('\n########## FAIL (' + bad.length + ') ##########');
bad.forEach((b) => console.log('  XX  ' + b));

await browser.close();
process.exit(bad.length ? 1 : 0);
