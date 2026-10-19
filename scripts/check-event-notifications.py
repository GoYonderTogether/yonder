import os, json, subprocess, tempfile, pathlib, time, pty, select, fcntl, termios, struct, re
root=pathlib.Path(__file__).resolve().parents[1]
cli=root/'packages/cli/dist/index.js'
node=subprocess.check_output(['which','node'],text=True).strip()
home=pathlib.Path(tempfile.mkdtemp(prefix='ye-',dir='/tmp'))
def call(*args):
 return json.loads(subprocess.check_output([node,str(cli),*args,'--home',str(home),'--json'],text=True,stderr=subprocess.PIPE))
call('init',str(home))
plugin=home/'event-check';plugin.mkdir()
(plugin/'package.json').write_text(json.dumps({'type':'module','version':'0.1.0','yonder':{'apiVersion':1,'id':'event-check','entry':'./index.mjs','contributes':{}}}))
# This is an isolated verification plugin, not a product feature or model substitute.
(plugin/'script.mjs').write_text('let data="";for await(const chunk of process.stdin)data+=chunk;const e=JSON.parse(data);process.stdout.write(JSON.stringify({event:e.id,text:"程序已处理配置变更："+e.data.file+"；未调用模型。"}));')
(plugin/'index.mjs').write_text('''import {spawn} from 'node:child_process';
export default {setup(api){api.events.on('config.reload',async event=>{
 if(!event.data.ok)return;
 const target=(await api.sessions.list({mode:'task',open:true}))[0];if(!target)return;
 const result=await new Promise((resolve,reject)=>{const child=spawn(process.execPath,[new URL('./script.mjs',import.meta.url).pathname],{stdio:['pipe','pipe','pipe']});let text='';child.stdout.on('data',b=>text+=b);child.once('error',reject);child.once('close',code=>code===0?resolve(JSON.parse(text)):reject(new Error('program exit '+code)));child.stdin.end(JSON.stringify(event));});
 await api.sessions.notify(target.id,result);
});}};''')
config=home/'yonder.yaml'
# Existing init writes its plugin array before channels.
s=config.read_text();s=s.replace('channels:','  - use: ./event-check\nchannels:',1);config.write_text(s)
log=open(home/'service.log','w')
server=subprocess.Popen([node,str(cli),'start','--home',str(home),'--json'],stdout=log,stderr=log,cwd=root)
try:
 for _ in range(100):
  try:
   call('service','info');break
  except subprocess.CalledProcessError:
   if server.poll() is not None:raise RuntimeError((home/'service.log').read_text())
   time.sleep(.1)
 else:raise RuntimeError('isolated service did not start')
 session=call('sessions','open','default','--keep-open')['id']
 preset=home/'presets/default.yaml';preset.write_text(preset.read_text().replace('Standalone task','Program notification integration'))
 for _ in range(100):
  transcript=call('sessions','show',session)
  if any(x['kind']=='yonder.notification' for x in transcript['transcript']):break
  time.sleep(.1)
 else:raise RuntimeError('script subscription did not record notification')
 notice=next(x for x in transcript['transcript'] if x['kind']=='yonder.notification')
 assert notice['from']=='plugin:event-check'
 assert not call('events','--type','run.end')['events']
 # Exercise the actual public CLI notify path against the same real source event.
 result=call('sessions','notify',session,'--event',notice['event'],'--text','CLI 程序通知已记录，无模型运行。')
 assert result['recorded'] is True
 assert not call('events','--type','run.end')['events']
 master,slave=pty.openpty()
 fcntl.ioctl(slave,termios.TIOCSWINSZ,struct.pack('HHHH',30,110,0,0))
 terminal=subprocess.Popen([node,str(cli),'chat','--session',session,'--home',str(home)],stdin=slave,stdout=slave,stderr=slave,cwd=root,env={**os.environ,'TERM':'xterm-256color'})
 os.close(slave);raw=b'';end=time.time()+4
 while time.time()<end:
  if select.select([master],[],[],.1)[0]:
   try:raw+=os.read(master,65536)
   except OSError:break
 terminal.terminate()
 try:terminal.wait(timeout=5)
 except subprocess.TimeoutExpired:terminal.kill();terminal.wait()
 os.close(master)
 (home/'tui-preview.ansi').write_bytes(raw)
 decoded=raw.decode(errors='replace')
 # Strip terminal controls only for a readable excerpt; preserve the raw PTY evidence separately.
 text=re.sub(r'\x1b\][^\x07]*(?:\x07|\x1b\\)','',decoded)
 text=re.sub(r'\x1b\[[0-?]*[ -/]*[@-~]','',text)
 (home/'tui-preview.txt').write_text(text)
 assert '程序已处理配置变更' in text, text[-3000:]
 assert 'CLI 程序通知已记录' in text, text[-3000:]
 summary={'home':str(home),'session':session,'pluginSource':notice['from'],'sourceEvent':notice['event'],'cliReceipt':result,'runEnds':0,'tuiShowsBothNotifications':True,'evidence':str(home/'tui-preview.ansi')}
 (home/'result.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2))
 print(json.dumps(summary,ensure_ascii=False))
finally:
 server.terminate()
 try:server.wait(timeout=10)
 except subprocess.TimeoutExpired:server.kill();server.wait()
 log.close()
