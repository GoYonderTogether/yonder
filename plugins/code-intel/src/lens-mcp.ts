import { executionContext, type ToolContext } from "@yonder/sdk";

// Run the stdio MCP protocol in the selected execution environment; exec itself has no stdin API.
const client = `
const {spawn} = require('node:child_process');
if (process.argv[1] === 'pilens_effective_config') {
 const fs = require('node:fs'), path = require('node:path');
 if (process.env.HOME) process.env.HOME = fs.realpathSync(process.env.HOME);
 const args = JSON.parse(process.argv[2]);
 if (args.file !== undefined) {
  const root = fs.realpathSync(args.cwd);
  let target = path.resolve(args.cwd, args.file);
  const relativeInput = path.relative(args.cwd, target);
  if (relativeInput === '..' || relativeInput.startsWith('..' + path.sep) || path.isAbsolute(relativeInput)) {
   console.error('file is outside cwd'); process.exit(1);
  }
  args.file = relativeInput;
  while (!fs.existsSync(target)) {
   const parent = path.dirname(target);
   if (parent === target) break;
   target = parent;
  }
  const real = fs.realpathSync(target), relative = path.relative(root, real);
  if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) {
   console.error('file is outside cwd'); process.exit(1);
  }
 }
 args.cwd = fs.realpathSync(args.cwd);
 process.argv[2] = JSON.stringify(args);
}
const child = spawn('pi-lens-mcp', [], {stdio: ['pipe', 'pipe', 'pipe']});
let buffer = '', errors = '';
const send = value => child.stdin.write(JSON.stringify(value) + '\\n');
const fail = message => { console.error(message); child.kill(); process.exitCode = 1; };
child.on('error', error => fail('pi-lens-mcp unavailable: ' + error.message));
child.stderr.on('data', chunk => errors = (errors + chunk).slice(-2000));
child.on('exit', code => { if (!done) fail('pi-lens-mcp exited ' + code + ': ' + errors); });
let done = false;
child.stdout.on('data', chunk => {
 buffer += chunk;
 for (let end; (end = buffer.indexOf('\\n')) >= 0;) {
  const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
  let message; try { message = JSON.parse(line); } catch { continue; }
  if (message.id === 1 && message.result) {
   send({jsonrpc:'2.0', method:'notifications/initialized'});
   send({jsonrpc:'2.0', id:2, method:'tools/call', params:{name:process.argv[1], arguments:JSON.parse(process.argv[2])}});
  } else if (message.id === 1 || message.id === 2) {
   done = true;
   if (message.error) { console.error(JSON.stringify(message.error)); process.exitCode = 1; }
   else console.log(JSON.stringify(message.result));
   child.kill();
  }
 }
});
send({jsonrpc:'2.0', id:1, method:'initialize', params:{protocolVersion:'2025-03-26', capabilities:{}, clientInfo:{name:'yonder-code-intel', version:'1'}}});
`;

export async function callLens(
	name: string,
	args: object,
	ctx: ToolContext,
): Promise<{ text: string; isError?: boolean }> {
	let stdout = "",
		stderr = "";
	const result = await ctx.env.exec(
		["node", "-e", client, name, JSON.stringify({ ...args, cwd: ctx.env.cwd })],
		{
			cwd: ctx.env.cwd,
			timeout: 120,
			onOutput: (chunk, _context, info) => {
				if (info.stream === "stdout") stdout += chunk;
				else stderr += chunk;
			},
		},
		executionContext(ctx.signal),
	);
	ctx.signal.throwIfAborted();
	if (!result.ok) throw new Error(result.error.message);
	if (result.value.exitCode !== 0) throw new Error(`pi-lens MCP failed: ${stderr.slice(-2000)}`);
	const response = JSON.parse(stdout) as { content?: Array<{ type: string; text?: string }>; isError?: boolean };
	return {
		text:
			response.content
				?.filter((item) => item.type === "text")
				.map((item) => item.text ?? "")
				.join("\n") ?? stdout,
		...(response.isError === undefined ? {} : { isError: response.isError }),
	};
}
