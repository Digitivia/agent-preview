# The integrated AI Agent upgrade (preview)

This is the review build of the Digitivia AI Agent upgrade. It lives **only** in
the `agent-preview` repository and it is visible **only** to the accounts the
server allows. The production repository and the production UI are untouched.

The live preview: **https://digitivia.github.io/agent-preview/**

---

## 1. What is where

| Piece | File | What it does |
|---|---|---|
| The configuration surface | `modules/agent-studio.js` | The capabilities multi-select, the main job, how it talks, the business knowledge, the effective prompt with its layers, version history, and the save states. Mounted into the real agent tabs as its own **Agent setup** section, above the prompt editors. |
| The simulation engine | `modules/agent-sim.js` | Safe, prepared answers for the Simulation test mode. Pure functions, no network, no storage. |
| The rebuilt Test Chat | `modules/test-chat-v2.js` | Adds the **Simulation / Real AI** switch, and stops the "Compare models" control from appearing twice. |
| The follow-up AI control | `modules/followup-ai.js` | The Fixed / AI-written switch on every follow-up step, with the objective, the language, the preview, the stopping rules, and a plain statement that sending is switched off. |
| The old role picker | `modules/agent-role.js` | Stands down when the studio is allowed to render (the studio offers the same choice inside a larger set). |
| The comparison | `modules/prompt-builder.js` | The "Compare models" control is no longer shown in the Test Chat. The comparison itself is unchanged and reachable at `window.DigitiviaCompareModels.run(agentId, message)`. |
| The reference demo | `demo/` | The original isolated prototype. It stays as an internal reference; it is not the product surface any more. |

## 2. The backend it uses (all of it already exists, none of it was changed)

| RPC | Used for |
|---|---|
| `agent_upgrade_access()` | The gate. The server reads the caller's authenticated identity and answers `{"enabled": true}` only for the accounts on the allowlist (`agent_upgrade_preview_access`). The page never checks an email itself. |
| `get_agent_studio(org, agent)` | The stored configuration and the version. |
| `save_agent_studio(org, agent, changes, expected_version, note)` | The save. It is atomic, it records a version with who/when/what changed, and it refuses a stale browser with `stale_version` instead of overwriting a newer version. |
| `resolve_agent_prompt(org, agent, include_guards)` | **The one prompt pipeline.** It composes the layers and returns them with their number and their origin. The effective-prompt panel reads this; it never composes a prompt in the browser. |
| `list_agent_versions` / `get_agent_version` / `restore_agent_version` | Version history, compare and restore. A restore writes a new version and points at the one it came from, so nothing is ever lost. |
| `followup_ai_status(org)` | Whether AI follow-ups may be **sent**. |
| `agent_capability_catalog(org)` | The platform-staff catalogue. Not callable from the browser, so the page derives availability from what the workspace can actually do, and the server strips anything it does not allow. |

The layered persona is `agent_configs.persona.layers` (schema v2):

```jsonc
{
  "v": 2,
  "enabled": true,            // the layered composer is on for this agent
  "primary": "sales",         // sales | support
  "capabilities": ["sales"],  // sales is always kept by the server
  "knowledge": { "policies": "" },
  "style": { "preset": null, "length": "short", "initiative": "balanced", "followup": "balanced" },
  "inherit_base": true,       // false drops the platform base persona
  "ack": []                   // conflict resolutions the owner has chosen
}
```

The six conceptual layers, and where each one lives:

| Layer | Where it is stored | Who owns it |
|---|---|---|
| 1 Base agent persona | the platform default (plus `persona.role`) | Digitivia |
| 2 Selected capabilities | `persona.layers.capabilities` | the owner |
| 3 Business knowledge and policies | `persona.layers.knowledge.policies` | the owner |
| 4 Personality and communication style | `persona.layers.style.*` | the owner |
| 5 Customer custom instructions | `agent_configs.system_prompt` | the owner |
| 6 Effective final prompt | composed by `resolve_agent_prompt` | the server |

Layer 5 is the same column the Advanced (free text), AI Chat builder and AI Chat
editor already write to, and the Simple builder writes its result into. That is
why editing in one place never erases another: the guided setup writes layers
2-4, the text editors write layer 5, and the server composes them.

**A conflict is never resolved silently.** When the owner's own instructions
contradict the base persona, the studio says so and offers three choices (keep
the base and add mine, use only mine, keep both for now). The answer is stored
in `layers.ack`, so the question is asked once.

## 3. What is active and what is off

| Thing | State |
|---|---|
| The new configuration UI | **Active** for the accounts `agent_upgrade_access` allows. Nobody else sees it, and the old role picker comes back for them. |
| Real saves | **Active.** They write to the production backend through the same RLS-protected path the dashboard always used, scoped to the signed-in account's workspace and the agent being edited. |
| Version history, compare, restore | **Active.** |
| Simulation test mode | **Active.** No AI provider is called, nothing is sent, nothing is charged, nothing is written. |
| Real AI test mode | **Active.** Uses the real model, the real effective configuration, the real knowledge and products, through `agent-test-chat`, which never creates an order, a lead, a booking or a message. |
| AI follow-up **configuration** | **Active.** The steps can be designed and saved. |
| AI follow-up **delivery** | **OFF.** `app_settings.ai_followups_mode = off` and `followup_ai_status` answers `enabled: false`. The UI says so on the step itself. The dispatcher was not touched. |
| New customers start as a Sales Agent | **Ready, not switched on.** `app_settings.ai_new_org_default_mode = off`. The server already resolves a fresh agent to the sales role default, and the studio shows a new agent starting as a Sales Agent. Turning the global switch on needs the owner's approval. |
| The whole fleet | Unchanged. No other customer, agent or workspace was modified. |

## 4. The checks

```bash
# pure logic, no dependencies
node --test tests/agent-sim.test.mjs

# the whole thing against the live backend with a real session
node tests/agent-upgrade.browser.mjs --url http://127.0.0.1:8899/
```

The browser check needs a session for the reviewer account. It is read from
`~/.digitivia-review-session.json` (override with `--session`), and it drives
the real app against the real backend — nothing is mocked. It covers:

* the surface (no duplicate screens, no duplicated Compare models control);
* a real save, the version it writes, the timestamp, and the version history;
* a restore, and that the restored version is recorded;
* a stale browser being refused instead of overwriting a newer version;
* free text (layer 5) not erasing the capabilities (layer 2);
* the effective prompt panel showing the layers with their origin;
* Simulation calling no provider, and Real AI calling the real one;
* the follow-up controls on the real Follow-ups page, and the server still
  reporting AI follow-ups as off;
* Arabic with a right-to-left page;
* a small phone (no horizontal overflow, one column);
* the gate: with the access answer blocked, the new surface does not appear and
  the old role picker comes back.

## 5. Known limits, and what the owner has to decide

* **The catalogue RPC is platform-staff only.** The page cannot ask the server
  which capabilities this workspace may use, so it derives it (appointments need
  a connected calendar) and the server strips whatever it does not allow. If a
  capability ever has to be decided by a rule the page cannot see, the RPC has
  to be exposed to the account.
* **The merchant path of `resolve_agent_prompt` returns no `text`.** For an
  agent that runs on its owner's own instructions the server returns the safety
  rules and the source, but not the composed text. The panel therefore shows
  the owner's instructions and the rules as the two layers that are actually
  used. The layered path returns the full breakdown and is used as soon as the
  agent is configured through the studio.
* **The supervisor's language is the one the customer used.** The AI follow-up
  step can fix it, and the new `ai_lang` key is stored with the step.
* **The new-customer default is prepared but off.** See the table above.
* The review session file holds a live access token. It is outside the
  repository and it should be deleted when the review is over.
