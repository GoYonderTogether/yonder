"""Actual macOS TTY+Keychain integration; only generated throwaway values. No secret output."""
import os,sys,pty,subprocess,secrets,tempfile,pathlib,json,uuid,datetime,select,time,shutil,hashlib
root=pathlib.Path(tempfile.mkdtemp(prefix='yonder-clip-pty-')).resolve()
cli=sys.argv[1]; node=shutil.which('node'); item=str(uuid.uuid4()); secret=secrets.token_hex(32).encode(); service='org.goyonder.clipboard.'+hashlib.sha256(str(root).encode()).hexdigest()
report={};master=None;proc=None;created=False
try:
 subprocess.run([node,cli,'prepare','--data',str(root)],check=True,capture_output=True)
 (root/'tickets').mkdir(mode=0o700,exist_ok=True)
 ticket={'id':item,'agent':'main','profile':'owner','session':'1','maxBytes':65536,'expiresAt':(datetime.datetime.now(datetime.timezone.utc)+datetime.timedelta(minutes=2)).isoformat()}
 (root/'tickets'/f'{item}.json').write_text(json.dumps(ticket));os.chmod(root/'tickets'/f'{item}.json',0o600)
 master,slave=pty.openpty();proc=subprocess.Popen([node,cli,'capture','--data',str(root),'--ticket',item],stdin=slave,stdout=slave,stderr=slave,close_fds=True);os.close(slave)
 output=b'';sent=False;deadline=time.monotonic()+30
 while time.monotonic()<deadline:
  ready,_,_=select.select([master],[],[],0.1)
  if ready:
   try: data=os.read(master,8192)
   except OSError: break
   if not data: break
   output+=data
   if b'Secret (hidden;' in output and not sent: os.write(master,secret+b'\r');sent=True
  if proc.poll() is not None: break
 code=proc.wait(timeout=5);created=code==0;report['capture']=created;report['hidden']=sent and secret not in output
 value=subprocess.run([str(root/'keychain-helper'),'get',service,item],capture_output=True,check=True).stdout
 report['exact']=value==secret
finally:
 if proc and proc.poll() is None:proc.kill();proc.wait()
 if master is not None:os.close(master)
 helper=root/'keychain-helper'
 if helper.exists():report['cleanup']=subprocess.run([str(helper),'drop',service,item],capture_output=True).returncode==0
 shutil.rmtree(root)
if not all(report.values()) or len(report)!=4:raise SystemExit('capture PTY check failed (no secret diagnostics)')
print(json.dumps(report))
