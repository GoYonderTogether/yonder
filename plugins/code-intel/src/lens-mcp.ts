import { executionContext, type ToolContext } from "@yonder/sdk";

// The bridge and its socket live inside the selected execution environment.
const server = String.raw`
const {spawn} = require('node:child_process');
const net = require('node:net'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yonder-lens-'));
const socket = path.join(dir, 'mcp.sock');
const child = spawn('pi-lens-mcp', [], {stdio:['pipe','pipe','pipe']});
let buffer = '', errors = '', ready = false, id = 1, active, idle;
const send = m => child.stdin.write(JSON.stringify(m) + '\n');
const cleanup = () => { clearTimeout(idle); child.kill(); fs.rmSync(dir, {recursive:true,force:true}); };
const stop = () => { cleanup(); process.exit(); };
process.on('SIGTERM', stop); process.on('SIGINT', stop); process.on('exit', cleanup);
child.stderr.on('data', c => errors = (errors + c).slice(-2000));
child.on('error', e => { console.error(e.message); process.exit(1); });
child.on('exit', code => { console.error('pi-lens exited ' + code + ': ' + errors); process.exit(1); });
function arm() { clearTimeout(idle); idle = setTimeout(stop, 600000); }
child.stdout.on('data', c => {
 buffer += c;
 for (let end; (end = buffer.indexOf('\n')) >= 0;) {
  const line = buffer.slice(0,end); buffer = buffer.slice(end+1);
  let m; try { m = JSON.parse(line); } catch { continue; }
  if (m.id === 1) {
   if (m.error) { console.error(JSON.stringify(m.error)); process.exit(1); }
   send({jsonrpc:'2.0',method:'notifications/initialized'});
   ready = true; listener.listen(socket, () => { fs.chmodSync(socket, 0o600); console.log(socket); arm(); });
  } else if (active && m.id === active.id) {
   const current = active; active = undefined;
   current.socket.end(JSON.stringify(m) + '\n'); arm();
  }
 }
});
const listener = net.createServer(s => {
 clearTimeout(idle);
 let input = '', requestId;
 s.on('data', chunk => {
  input += chunk;
  if (!input.includes('\n')) return;
  try {
   if (active) throw new Error('MCP bridge busy');
   const {name,args} = JSON.parse(input);
   if (name === 'pilens_effective_config') {
    if (process.env.HOME) process.env.HOME = fs.realpathSync(process.env.HOME);
    if (args.file !== undefined) {
     const root = fs.realpathSync(args.cwd); let target = path.resolve(args.cwd,args.file);
     const relative = path.relative(args.cwd,target);
     if (relative === '..' || relative.startsWith('..'+path.sep) || path.isAbsolute(relative)) throw new Error('file is outside cwd');
     args.file = relative;
     while (!fs.existsSync(target)) { const parent = path.dirname(target); if (parent === target) break; target = parent; }
     const realRelative = path.relative(root,fs.realpathSync(target));
     if (realRelative === '..' || realRelative.startsWith('..'+path.sep) || path.isAbsolute(realRelative)) throw new Error('file is outside cwd');
    }
    args.cwd = fs.realpathSync(args.cwd);
   }
   requestId = ++id; active = {id:requestId,socket:s};
   send({jsonrpc:'2.0',id:requestId,method:'tools/call',params:{name,arguments:args}});
  } catch (e) { s.end(JSON.stringify({error:{message:e.message}})+'\n'); arm(); }
 });
 s.on('error', () => {});
 s.on('close', () => {
  if (active && active.id === requestId) {
   send({jsonrpc:'2.0',method:'notifications/cancelled',params:{requestId,reason:'aborted'}});
   active = undefined; arm();
  }
 });
});
send({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-03-26',capabilities:{},clientInfo:{name:'yonder-code-intel',version:'1'}}});
`;

const client = String.raw`
const net = require('node:net');
const s = net.connect(process.argv[1]);
s.on('connect', () => s.write(process.argv[2]+'\n'));
s.on('data', c => process.stdout.write(c));
s.on('error', e => { console.error(e.message); process.exitCode = 1; });
`;

type Connection = { socket: Promise<string>; controller: AbortController; tail: Promise<void> };
const connections = new Map<string, Connection>();
let stopping = false;

export function startLens(): void {
	stopping = false;
}

function connect(ctx: ToolContext, key: string): Connection {
	const controller = new AbortController();
	let resolve!: (socket: string) => void;
	let reject!: (error: Error) => void;
	const socket = new Promise<string>((yes, no) => {
		resolve = yes;
		reject = no;
	});
	const connection = { socket, controller, tail: Promise.resolve() };
	connections.set(key, connection);
	let stdout = "",
		stderr = "";
	void ctx.env
		.exec(
			["node", "-e", server],
			{
				cwd: ctx.env.cwd,
				onOutput(chunk, _context, info) {
					if (info.stream === "stderr") stderr += chunk;
					else {
						stdout += chunk;
						if (stdout.includes("\n")) resolve(stdout.slice(0, stdout.indexOf("\n")));
					}
				},
			},
			executionContext(controller.signal),
		)
		.then(
			(result) => {
				if (connections.get(key) === connection) connections.delete(key);
				reject(new Error(`pi-lens MCP stopped: ${result.ok ? stderr : result.error.message}`));
			},
			(error: unknown) => {
				if (connections.get(key) === connection) connections.delete(key);
				reject(error instanceof Error ? error : new Error(String(error)));
			},
		);
	return connection;
}

export function stopLens(): void {
	for (const connection of connections.values()) connection.controller.abort();
	connections.clear();
}

export async function callLens(
	name: string,
	args: object,
	ctx: ToolContext,
): Promise<{ text: string; isError?: boolean }> {
	ctx.signal.throwIfAborted();
	if (stopping) throw new Error("code-intel is stopping");
	const key = JSON.stringify([ctx.env.id, ctx.env.cwd]);
	const connection = connections.get(key) ?? connect(ctx, key);
	const request = connection.tail.then(async () => {
		ctx.signal.throwIfAborted();
		if (stopping) throw new Error("code-intel is stopping");
		if (connections.get(key) !== connection) return callLens(name, args, ctx);
		const socket = await connection.socket;
		ctx.signal.throwIfAborted();
		let stdout = "",
			stderr = "";
		const result = await ctx.env.exec(
			["node", "-e", client, socket, JSON.stringify({ name, args: { ...args, cwd: ctx.env.cwd } })],
			{
				cwd: ctx.env.cwd,
				timeout: 120,
				onOutput(chunk, _context, info) {
					if (info.stream === "stdout") stdout += chunk;
					else stderr += chunk;
				},
			},
			executionContext(ctx.signal),
		);
		ctx.signal.throwIfAborted();
		if (!result.ok) throw new Error(result.error.message);
		if (result.value.exitCode !== 0) throw new Error(`pi-lens MCP failed: ${stderr.slice(-2000)}`);
		const response = JSON.parse(stdout) as {
			result?: { content?: Array<{ type: string; text?: string }>; isError?: boolean };
			error?: { message: string };
		};
		if (response.error) throw new Error(response.error.message);
		const value = response.result;
		return {
			text:
				value?.content
					?.filter((item) => item.type === "text")
					.map((item) => item.text ?? "")
					.join("\n") ?? stdout,
			...(value?.isError === undefined ? {} : { isError: value.isError }),
		};
	});
	connection.tail = request.then(
		() => {},
		() => {},
	);
	return new Promise((resolve, reject) => {
		const abort = () => reject(ctx.signal.reason);
		ctx.signal.addEventListener("abort", abort, { once: true });
		if (ctx.signal.aborted) abort();
		request.then(resolve, reject).finally(() => ctx.signal.removeEventListener("abort", abort));
	});
}
