// Run only in a verify-copy after verify-home has been stopped; never reads the owner's HOME.
import assert from 'node:assert/strict';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { createConnection } from 'node:net';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { parse, stringify } from 'yaml';

const home = resolve(process.argv[2] ?? '');
assert.match(home, /\/yonder-verify\/homes\/[^/]+$/, 'pass the isolated verify HOME');
assert.match(await readFile(join(home, '.verify-copy'), 'utf8'), /^pool\/t09r5\s*$/, 'requires t09r5 pool');
process.env.YONDER_PROVIDER_TRACE = join(home, 'trace');
process.env.NO_PROXY = `${process.env.NO_PROXY ?? ''},localhost,127.0.0.1,api.siliconflow.cn`;
process.env.no_proxy = process.env.NO_PROXY;
const { openKernel } = await import('@yonder/core');
const evidence = { started: new Date().toISOString(), home, turns: [], checkpoints: [] };
const evidenceFile = join(home, 'learning-ab-evidence.json');
const save = () => writeFile(evidenceFile, JSON.stringify(evidence, null, 2), { mode: 0o600 });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(fn, label, timeout = 120000) {
 const deadline = Date.now() + timeout;
 while (Date.now() < deadline) { const result = await fn(); if (result) return result; await sleep(500); }
 throw Error(`timeout: ${label}`);
}
const configPath = join(home, 'yonder.yaml');
const agentPath = join(home, 'agents/main/agent.yaml');
const config = parse(await readFile(configPath, 'utf8'));
const agent = parse(await readFile(agentPath, 'utf8'));
const workspace = join(home, 'agents/main');
const memoryDir = join(workspace, 'memories');
const skillDir = join(workspace, 'skills');
await mkdir(memoryDir, { recursive: true });
await mkdir(skillDir, { recursive: true });
for (const name of ['MEMORY.md', 'USER.md']) await writeFile(join(memoryDir, name), '', { flag: 'wx' });
config.channels = { front: { type: 'cli' }, reuse: { type: 'cli' }, revoked: { type: 'cli' } };
config.identity.persons[0].accounts = ['acct:front:local', 'acct:reuse:local', 'acct:revoked:local'];
const learning = config.plugins.find((p) => p.use === '@yonder/plugin-learning');
assert.ok(learning, 'learning plugin missing from bundle');
learning.config = { enabled: true, model: 'siliconflow/deepseek-ai/DeepSeek-V3.2', scopes: [{ agent: 'main', profiles: ['owner'], memoryDir, skillDir, learning: true, writeMode: 'exclusive-yonder' }] };
agent.defaults.plugins = [...new Set([...(agent.defaults.plugins ?? []), 'learning'])];
agent.defaults.contexts = [...new Set([...(agent.defaults.contexts ?? []), 'hermes-memory'])];
agent.defaults.skills = [...new Set([...(agent.defaults.skills ?? []), 'hermes-yonder', 'hermes-learned-*'])];
agent.profiles.owner.tools.offer = [...new Set([...agent.profiles.owner.tools.offer, 'learning_refine', 'skill_view'])];
agent.bindings = [{ id: 'acceptance', match: { channel: ['front', 'reuse', 'revoked'], kind: 'dm', from: 'owner' }, session: { mode: 'persistent', per: 'conv' }, profile: 'owner', stream: false }];
await writeFile(configPath, stringify(config), { mode: 0o600 });
await writeFile(agentPath, stringify(agent), { mode: 0o600 });
let kernel;
const sockets = [];
try {
 kernel = await openKernel(home);
 for (const channel of ['front', 'reuse', 'revoked']) await kernel.identity.link(`acct:${channel}:local`, `person:${config.identity.persons[0].id}`);
 async function connect(channel) {
  const socket = createConnection(join(home, '.yonder/plugins/channel-cli', `${channel}.sock`));
  const packets = [];
  sockets.push(socket);
  createInterface({ input: socket }).on('line', (line) => packets.push(JSON.parse(line)));
  await new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('error', reject); });
  return { socket, packets };
 }
 const clients = await Promise.all(['front', 'reuse', 'revoked'].map(connect));
 async function say(client, text) {
  const start = Date.now(), packetStart = client.packets.length;
  const traceBefore = new Set(await readdir(process.env.YONDER_PROVIDER_TRACE).catch(() => []));
  client.socket.write(`\u001e${JSON.stringify({ type: 'input', text })}\n`);
  const accepted = await until(() => client.packets.slice(packetStart).find((p) => p.type === 'accepted'), 'channel accepted');
  const event = accepted.event.id;
  const end = await until(async () => (await kernel.events.query({ type: 'run.end', after: event, limit: 1000 })).events.find((e) => e.parent === event || e.data.inputs?.includes(event)), 'run.end', 180000);
  assert.equal(end.data.status, 'done', JSON.stringify(end.data));
  assert.equal(end.data.model, 'siliconflow/deepseek-ai/DeepSeek-V3.2', 'fallback is not the required model');
  const transcript = await kernel.sessions.transcript(end.data.session, { limit: 1000 });
  const tools = transcript.flatMap((row) => row.tools ?? []).map((tool) => tool.name);
  const traceFiles = (await readdir(process.env.YONDER_PROVIDER_TRACE)).filter((name) => !traceBefore.has(name));
  const turn = { event, runId: end.data.runId, runEndEvent: end.id, session: end.data.session, model: end.data.model, elapsedMs: Date.now() - start, tools, toolCount: tools.length, traceFiles };
  evidence.turns.push(turn); await save(); return turn;
 }
 // Both tasks inspect the actual same temporary home's agent configuration.
 const task = process.argv[3] === 'package'
  ? `请用 read 工具读取 ${join(process.cwd(), 'plugins/learning/package.json')}，确认该插件的包名和版本，并简短回答。`
  : `请用 read 工具读取 ${agentPath}，确认其中 id 与 defaultProfile 的实际值，并简短回答。`;
 const first = await say(clients[0], `/refine memory ${task} 完成读取后调用 learning_refine，focus 设为 memory，复盘本轮工具验证的事实。`);
 assert.ok(first.tools.includes('read'), 'first task must actually use read');
 assert.ok(first.tools.includes('learning_refine'), 'first task must request the review');
 const proposal = await until(async () => {
  const view = await kernel.views.data('learning.status', first.session);
  return view.content.items.find((item) => item.title.startsWith('待确认（低置信度）: memory'));
 }, 'memory proposal', 180000);
 assert.ok(proposal.subtitle.includes(first.session), 'proposal has source session');
 evidence.checkpoints.push({ proposal }); await save();
 await kernel.views.act('learning.status', 'confirm', { id: proposal.id }, first.session);
 const after = await kernel.views.data('learning.status', first.session);
 const change = after.content.items.find((item) => item.title === 'memory: memory' && item.actions?.some((a) => a.id === 'undo'));
 assert.ok(change, 'confirmed memory change with undo required');
 const memory = await readFile(join(memoryDir, 'MEMORY.md'), 'utf8');
 assert.ok(memory.trim(), 'confirmed memory must be nonempty');
 const second = await say(clients[1], task);
 assert.notEqual(second.session, first.session);
 const traceBody = async (files) => (await Promise.all(files.map(async (f) => (await readFile(join(process.env.YONDER_PROVIDER_TRACE, f), 'utf8')).split('\n').filter(Boolean).map((line) => JSON.parse(line)).filter((entry) => entry.type === 'request').map((entry) => JSON.parse(entry.body).messages ?? []).filter((messages) => messages.some((message) => message.role === 'user' && JSON.stringify(message.content).includes(task)) && !messages.some((message) => JSON.stringify(message.content).includes('You are a quiet, isolated Yonder-native learning review'))).flat().map((message) => typeof message.content === 'string' ? message.content : JSON.stringify(message.content)).join('\n')))).join('\n');
 const secondTrace = await traceBody(second.traceFiles);
 assert.ok(change.subtitle && secondTrace.includes(JSON.stringify(change.subtitle).slice(1, -1)), 'new session request must contain confirmed entry');
 await kernel.views.act('learning.status', 'undo', { id: change.id }, first.session);
 const third = await say(clients[2], task);
 assert.notEqual(third.session, first.session); assert.notEqual(third.session, second.session);
 const thirdTrace = await traceBody(third.traceFiles);
 assert.ok(!thirdTrace.includes(JSON.stringify(change.subtitle).slice(1, -1)), 'revoked entry must not appear in new session trace');
 evidence.checkpoints.push({ confirmed: change.id, entry: change.subtitle, recalledInTrace: true, revokedAbsentInTrace: true });
 evidence.completed = new Date().toISOString(); await save();
 console.log(`PASS: ${evidenceFile}`);
} catch (error) {
 evidence.error = String(error); await save(); console.error(`FAIL: ${error.message}; evidence: ${evidenceFile}`); process.exitCode = 1;
} finally {
 for (const socket of sockets) socket.destroy();
 if (kernel) await kernel.close();
}
