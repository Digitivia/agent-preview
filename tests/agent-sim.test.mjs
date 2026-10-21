// Unit tests for the Simulation engine (modules/agent-sim.js).
//
//   node --test tests/agent-sim.test.mjs
//
// No dependencies: the engine is a pure function library, so it can be checked
// without a browser and without a backend.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const src = fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'modules', 'agent-sim.js'), 'utf8');
const sandbox = { window: {}, localStorage: { getItem: () => null } };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(src, sandbox);
const Sim = sandbox.window.AgentSim;

const SALES = { role: 'sales', tone: 'Friendly & Casual', capabilities: ['sales'], style: { preset: 'friendly', length: 'short', initiative: 'balanced', followup: 'balanced' }, knowledge: { policies: '' } };

test('the engine is a pure library with no window side effects', () => {
  assert.ok(Sim, 'AgentSim is exposed');
  assert.equal(typeof Sim.reply, 'function');
  assert.equal(typeof Sim.followupPreview, 'function');
});

test('it answers in the language the customer wrote in', () => {
  const en = Sim.reply(SALES, 'do you have salmon?');
  const ar = Sim.reply(SALES, 'عندكم سلمون؟');
  assert.equal(en.lang, 'en');
  assert.equal(ar.lang, 'ar');
  assert.ok(/salmon|tilapia/i.test(en.text), en.text);
  assert.ok(/سلمون|بلطي/.test(ar.text), ar.text);
});

test('a simulation never claims a real action happened', () => {
  const r = Sim.reply(SALES, 'I want to order');
  assert.ok(r.text.length > 0);
  assert.match(r.text, /demo|simulation|no real order|محاكاة|حقيقي/i);
  assert.equal(r.simulated_actions.length, 0);   // nothing was really done
});

test('capabilities change the behaviour', () => {
  const sales = Sim.reply(SALES, 'I want a refund');
  const support = Sim.reply(Object.assign({}, SALES, { role: 'support', capabilities: ['sales', 'support'] }), 'I want a refund');
  assert.notEqual(sales.text, support.text);
  assert.equal(sales.capability, 'sales');
  assert.equal(support.capability, 'support');
});

test('the lead capability asks for contact details only when it is on', () => {
  const without = Sim.reply(SALES, 'I am interested in the large pack');
  const with_ = Sim.reply(Object.assign({}, SALES, { capabilities: ['sales', 'lead'] }), 'I am interested in the large pack');
  assert.equal(without.capability, 'sales');
  assert.equal(with_.capability, 'lead');
  assert.match(with_.text, /name|phone|اسم|تليفون/i);
});

test('the faq capability answers from the business policies', () => {
  const cfg = Object.assign({}, SALES, { capabilities: ['sales', 'faq'], knowledge: { policies: 'We deliver only inside Cairo.' } });
  const r = Sim.reply(cfg, 'what are your delivery hours?');
  assert.equal(r.capability, 'faq');
  assert.match(r.text, /Cairo/);
});

test('without policies the faq answer asks for them instead of inventing them', () => {
  const cfg = Object.assign({}, SALES, { capabilities: ['sales', 'faq'], knowledge: { policies: '' } });
  const r = Sim.reply(cfg, 'what are your delivery hours?');
  assert.match(r.text, /policies|سياسات/i);
});

test('the booking capability needs a calendar and says so', () => {
  const cfg = Object.assign({}, SALES, { capabilities: ['sales', 'booking'] });
  const r = Sim.reply(cfg, 'can I book an appointment?');
  assert.equal(r.capability, 'booking');
  assert.match(r.text, /calendar|تقويم/i);
});

test('a hand-off to a human is always simulated, never real', () => {
  const r = Sim.reply(SALES, 'let me talk to a real person');
  assert.equal(r.intent, 'handoff');
  assert.match(r.text, /simulation|محاكاة/i);
});

test('the style preset changes the opening', () => {
  const consultative = Sim.reply(Object.assign({}, SALES, { style: { preset: 'consultative' } }), 'hello');
  const luxury = Sim.reply(Object.assign({}, SALES, { style: { preset: 'luxury' } }), 'hello');
  assert.notEqual(consultative.text, luxury.text);
});

test('the reply length is respected', () => {
  const short = Sim.reply(Object.assign({}, SALES, { style: { length: 'short' } }), 'hello');
  const detailed = Sim.reply(Object.assign({}, SALES, { style: { length: 'detailed' } }), 'hello');
  assert.ok(detailed.text.length >= short.text.length, `${detailed.text.length} vs ${short.text.length}`);
});

test('the follow-up preview is prepared text, never generated', () => {
  const a = Sim.followupPreview(SALES, 'remind about the salmon', 'en');
  const b = Sim.followupPreview(SALES, 'remind about the salmon', 'en');
  assert.equal(a, b);
  assert.ok(a.length > 10);
  assert.equal(typeof Sim.CATALOG.shrimp.price, 'number');
});
