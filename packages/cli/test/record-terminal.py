import os,pty,fcntl,termios,struct,select,time,json,socket,signal,sys
from pathlib import Path
import argparse,codecs
parser=argparse.ArgumentParser(description="Record actual Yonder/pi PTY interaction; use an isolated authorized home.")
parser.add_argument('--home',required=True)
parser.add_argument('--output',required=True)
parser.add_argument('--mode',choices=['yonder','pi','channel','menus','presentation'],default='yonder')
parser.add_argument('--appearance',choices=['dark','light'],default='dark')
parser.add_argument('--session',help='Restore actual session history without a model call in presentation mode')
args=parser.parse_args()
if args.mode=='presentation' and not args.session:parser.error('--session is required for presentation')
root=str(Path(__file__).resolve().parents[3])
out=Path(args.output).resolve();out.mkdir(parents=True,exist_ok=True)
home=str(Path(args.home).resolve())
mode=args.mode
cols,rows=100,30
def rpc(method,params={}):
 s=socket.socket(socket.AF_UNIX);s.settimeout(5);s.connect(home+'/.yonder/control.sock');s.sendall((json.dumps({'method':method,'params':params})+'\n').encode());data=b''
 while b'\n' not in data:data+=s.recv(65536)
 s.close();v=json.loads(data.split(b'\n')[0]);
 if not v['ok']:raise RuntimeError(v)
 return v.get('result')
master,slave=pty.openpty();fcntl.ioctl(slave,termios.TIOCSWINSZ,struct.pack('HHHH',rows,cols,0,0))
pid=os.fork()
if pid==0:
 os.close(master);os.setsid();fcntl.ioctl(slave,termios.TIOCSCTTY,0)
 for fd in (0,1,2):os.dup2(slave,fd)
 os.close(slave);os.chdir(root if mode=='yonder' else home)
 env=dict(os.environ,TERM='xterm-256color',COLORTERM='truecolor',LC_ALL='en_US.UTF-8')
 if mode=='pi':
  env['PI_CODING_AGENT_DIR']='/tmp/yonder-pi-baseline';os.makedirs(env['PI_CODING_AGENT_DIR'],exist_ok=True)
  argv=['node',root+'/node_modules/@earendil-works/pi-coding-agent/dist/cli.js','--no-session','--no-extensions','--no-skills','--no-prompt-templates','--provider','openai','--model','gpt-6-luna']
 else: argv=['node',root+'/packages/cli/dist/index.js','chat','--home',home]+(['--channel','cli'] if mode=='channel' else ['--session',args.session] if mode=='presentation' else [])
 os.execvpe(argv[0],argv,env)
os.close(slave);events=[];snapshots=[];start=time.monotonic();allout=b'';color_replies=set();decoder=codecs.getincrementaldecoder('utf-8')('replace')
def pump(seconds):
 global allout
 end=time.monotonic()+seconds
 while time.monotonic()<end:
  r,_,_=select.select([master],[],[],min(.1,max(0,end-time.monotonic())))
  if r:
   try:b=os.read(master,131072)
   except OSError:return
   if not b:return
   allout+=b;events.append([round(time.monotonic()-start,4),'o',decoder.decode(b)])
   for code,value in [('10','2222/2222/2222' if args.appearance=='light' else 'd4d4/d4d4/d4d4'),('11','ffff/ffff/ffff' if args.appearance=='light' else '0000/0000/0000')]:
    if code not in color_replies and ('\x1b]'+code+';?').encode() in allout:
     os.write(master,('\x1b]'+code+';rgb:'+value+'\x1b\\').encode());color_replies.add(code)
def send(text):
 events.append([round(time.monotonic()-start,4),'i',text]);os.write(master,text.encode());pump(.35)
def snap(name):
 pump(.35);snapshots.append({'name':name,'event':len(events)})
def wait_end(before,limit=100):
 end=time.monotonic()+limit
 while time.monotonic()<end:
  pump(.25)
  ended=rpc('events.query',{'query':{'type':'run.end','limit':1000}})['events']
  if len(ended)>before:
   pump(.7);return ended[-1]
 raise RuntimeError('model did not settle before bounded acceptance deadline')
try:
 pump(12 if mode=='pi' else 3);snap('initial')
 send('/');snap('slash')
 if mode=='yonder':
  send('\x03');pump(.6)
  before=len(rpc('events.query',{'query':{'type':'run.end','limit':1000}})['events'])
  send('请调用 bash 执行 pwd，然后用中文说明实际目录，最后输出“原生终端第一轮完成”。\r')
  event=wait_end(before);snap('tools-and-reply')
  session=event['data']['session']
  before+=1
  send('继续上一轮，只用一行说明你刚才运行了什么命令，并输出“续聊完成”。\r')
  wait_end(before);snap('continued')
  send('\x0f');snap('details');send('\x0f');snap('collapsed')
  send('?');snap('shortcuts');send('\x1b');pump(.4)
  send('\x10');snap('history-key');send('\x03');pump(.6)
  before+=1
  send('请调用 bash 执行 sleep 15，然后回复“等待完成”。\r');pump(1)
  snap('working');send('\x03');result=wait_end(before);snap('interrupted')
  assert result['data']['status']=='aborted','Ctrl+C did not interrupt the active run'
  assert not rpc('terminal.info',{'id':session})['session'].get('closed'),'Interrupt closed a manual task'
  send('/resume\r');pump(1);snap('resume-picker');send('\x1b');pump(.4)
  send('\x04');pump(1)
 elif mode=='presentation':
  send('\x03');pump(.6)
  snap('continued');send('\x0f');snap('details');send('\x0f');snap('collapsed')
  send('?');snap('shortcuts');send('\x1b');pump(.4)
  send('/resume\r');pump(1);snap('resume-picker');send('\x1b');pump(.4);send('\x04');pump(1)
 elif mode=='menus':
  send('\x03');pump(.6);send('/继续');snap('localized-completion');send('\t');snap('tab-completion');send('\x03');pump(.6);send('/resume\r');pump(1);send('\x1b[B');snap('resume-picker');send('\r');pump(1);snap('resumed-history');send('\x04');pump(1)
 elif mode=='channel':
  send('\x03');pump(.6)
  before=len(rpc('events.query',{'query':{'type':'run.end','limit':1000}})['events'])
  inputs_before=len(rpc('events.query',{'query':{'type':'message.in','limit':1000}})['events'])
  send('\x1b[200~请只回复“主 Agent 多行消息通过”。\n这是同一条消息的第二行。\x1b[201~\r')
  result=wait_end(before);snap('agent-channel')
  received=rpc('events.query',{'query':{'type':'message.in','limit':1000}})['events']
  assert len(received)==inputs_before+1,'Multiline input split into more than one event'
  assert '\n' in received[-1]['data']['text'],'Multiline content was lost'
  assert result.get('from')=='agent:main','Unexpected channel target'
  send('\x04');pump(1)
 else:
  send('\x03');pump(.6);send('\x04');pump(1)
finally:
 try:os.kill(pid,signal.SIGTERM)
 except ProcessLookupError:pass
 try:os.waitpid(pid,0)
 except ChildProcessError:pass
 os.close(master)
 with (out/(mode+'.cast')).open('w') as f:
  f.write(json.dumps({'version':2,'width':cols,'height':rows,'title':mode+' real PTY','env':{'TERM':'xterm-256color'}})+'\n')
  for e in events:f.write(json.dumps(e,ensure_ascii=False)+'\n')
 (out/(mode+'-snapshots.json')).write_text(json.dumps(snapshots,ensure_ascii=False))
 (out/(mode+'-events.json')).write_text(json.dumps(events,ensure_ascii=False))
 print(json.dumps({'mode':mode,'events':len(events),'snapshots':snapshots,'path':str(out/(mode+'.cast'))},ensure_ascii=False))
