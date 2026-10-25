import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const evidence = await mkdtemp("/tmp/yonder-collect-race-");
console.log(`Collect race evidence: ${evidence}`);
const source = join(evidence, "Main.swift");
await writeFile(
	source,
	`import Darwin
@main struct Main {
 static func main() {
  typealias H = HelperServiceHost
  let mode = CommandLine.arguments[1]
  let root = H.Member(pid: 100, seconds: 1, micros: 0)
  let child = H.Member(pid: 101, seconds: 2, micros: 0)
  let leaf = H.Member(pid: 102, seconds: 3, micros: 0)
  let replacement = H.Member(pid: 101, seconds: 9, micros: 0)
  var values = [100: H.Snapshot(member: root, parent: 50), 101: H.Snapshot(member: child, parent: 100), 102: H.Snapshot(member: leaf, parent: 101)] as [Int32: H.Snapshot]
  var reads: [Int32: Int] = [:]
  var members: [Int32: H.Member] = [:]
  func read(_ pid: Int32) -> H.Snapshot? {
   reads[pid, default: 0] += 1
   if pid == 101 && reads[pid] == 2 {
    if mode == "identity-before-admit" { values[101] = H.Snapshot(member: replacement, parent: 100) }
    if mode == "ppid-before-admit" { values[101] = H.Snapshot(member: child, parent: 999) }
   }
   if pid == 102 && mode == "ancestor-before-leaf" { values[100] = H.Snapshot(member: H.Member(pid: 100, seconds: 9, micros: 0), parent: 50) }
   return values[pid]
  }
  func list(_ pid: Int32) -> [Int32] {
   if pid == 100 {
    if mode == "reused-after-enumeration" { values[101] = H.Snapshot(member: replacement, parent: 999) }
    if mode == "reparented-after-enumeration" { values[101] = H.Snapshot(member: child, parent: 999) }
    if mode == "parent-reused-after-enumeration" { values[100] = H.Snapshot(member: H.Member(pid: 100, seconds: 9, micros: 0), parent: 50) }
    return [101]
   }
   return pid == 101 ? [102] : []
  }
  H.collect(root, roots: mode == "untrusted-root" ? [] : [root], &members, read: read, list: list)
  let admitted: Set<Int32> = mode == "stable" ? [101,102] : mode == "ancestor-before-leaf" ? [101] : []
  precondition(Set(members.keys) == admitted, "incorrect admission: \\(members)")
  var signalled: [Int32] = []
  for sig in [SIGTERM, SIGKILL] {
   H.signalMembers(Array(members.values), excluding: root, signal: sig, read: { values[$0] }, send: { pid, _ in signalled.append(pid); return 0 })
  }
  precondition(Set(signalled) == admitted, "unowned signal")
  if mode == "stable" {
   values[101] = H.Snapshot(member: replacement, parent: 999)
   signalled = []
   H.signalMembers([child], excluding: root, signal: SIGKILL, read: { values[$0] }, send: { pid, _ in signalled.append(pid); return 0 })
   precondition(signalled.isEmpty, "stale identity signalled")
  }
  print("passed " + mode)
 }
}
`,
);
const executable = join(evidence, "collect");
execFileSync("/usr/bin/swiftc", [
	join(root, "packages/macos-helper/Sources/YonderHelper/ServiceHost.swift"),
	source,
	"-o",
	executable,
]);
for (const mode of [
	"stable",
	"reused-after-enumeration",
	"reparented-after-enumeration",
	"parent-reused-after-enumeration",
	"identity-before-admit",
	"ppid-before-admit",
	"ancestor-before-leaf",
	"untrusted-root",
]) {
	test(`collect ownership race: ${mode}`, () => {
		assert.match(execFileSync(executable, [mode], { encoding: "utf8" }), /^passed /u);
	});
}
