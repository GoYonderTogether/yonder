import { type ChildProcess, spawn } from "node:child_process";
export const children = new Map<ChildProcess, string>();
/** Cleanup deadline only: ordinary native calls have no forced duration limit. */
export async function stopChildren(owner?: string): Promise<void> {
	await Promise.all(
		[...children]
			.filter(([, session]) => owner === undefined || session === owner)
			.map(
				([child]) =>
					new Promise<void>((resolve) => {
						if (!children.has(child)) {
							resolve();
							return;
						}
						const force = setTimeout(() => child.kill("SIGKILL"), 1000);
						force.unref();
						child.once("close", () => {
							clearTimeout(force);
							resolve();
						});
						child.kill("SIGTERM");
					}),
			),
	);
}
export function native(command: string, args: string[], signal: AbortSignal, owner: string): Promise<string> {
	signal.throwIfAborted();
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, { signal, stdio: ["ignore", "pipe", "pipe"] });
		children.set(child, owner);
		let stdout = "",
			stderr = "",
			overflow = false;
		child.stdout.on("data", (data) => {
			stdout += String(data);
			if (stdout.length > 1000000) {
				overflow = true;
				child.kill();
			}
		});
		child.stderr.on("data", (data) => {
			stderr = (stderr + String(data)).slice(-10000);
		});
		child.on("error", reject);
		child.on("close", (code) => {
			children.delete(child);
			if (code !== 0 || overflow)
				reject(new Error(`${command} failed (${code}): ${overflow ? "output exceeded 1MB" : stderr}`));
			else resolve(stdout.trim());
		});
	});
}
const script = `ObjC.import('CoreGraphics'); ObjC.import('ApplicationServices'); ObjC.bindFunction('CGPreflightScreenCaptureAccess',['bool',[]]);
function run(argv) {
 var a=JSON.parse(argv[0]);
 var permissions={screenCapture:!!$.CGPreflightScreenCaptureAccess(),accessibility:!!$.AXIsProcessTrusted()};
 if(a.action==='status')return JSON.stringify(permissions);
 if(!permissions.accessibility)throw new Error('Accessibility permission required for osascript/Yonder host; enable in System Settings > Privacy & Security > Accessibility.');
 if(a.action==='snapshot') {
  var se=Application('System Events'),p=se.applicationProcesses.whose({frontmost:true})[0];
  return JSON.stringify({application:p.name(),windows:p.windows.name()});
 }
 function event(t,x,y,b){var e=$.CGEventCreateMouseEvent(null,t,$.CGPointMake(x,y),b);$.CGEventPost(0,e);}
 if(a.action==='move'){event(5,a.x,a.y,0);}
 if(a.action==='click'){var b=a.button==='right'?1:0;event(b?3:1,a.x,a.y,b);event(b?4:2,a.x,a.y,b);}
 if(a.action==='drag'){event(1,a.x,a.y,0);event(6,a.toX,a.toY,0);event(2,a.toX,a.toY,0);}
 if(a.action==='type')Application('System Events').keystroke(a.text);
 if(a.action==='key'){
  var modifiers=a.modifiers||[];Application('System Events').keyCode(a.keyCode,{using:modifiers});
 }
 return JSON.stringify({action:a.action,performed:true});
}`;
export async function desktop(args: Record<string, unknown>, signal: AbortSignal, owner: string): Promise<unknown> {
	if (process.platform !== "darwin")
		throw new Error("Native desktop requires macOS; no Linux/Windows driver installed");
	return JSON.parse(
		await native("/usr/bin/osascript", ["-l", "JavaScript", "-e", script, JSON.stringify(args)], signal, owner),
	);
}
