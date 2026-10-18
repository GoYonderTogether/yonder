const commands =
	"init login doctor start stop chat sessions events identity skills version changelog docs update service completion";
const options =
	"--home --help --json --preset --session --channel --plain --keep-open --text --agent --profile --mode --open --owner --type --from --conv --since --until --after --limit --to --repo --list";

/** Shell-native completion. Dynamic requests are read-only and never launch a model. */
export function completion(shell: string): string {
	if (shell === "zsh")
		return `#compdef yonder
# Load with: source <(yonder completion zsh)
_yonder() {
  local -a commands
  commands=(
    'init:初始化 · Initialize' 'login:登录 · Sign in' 'doctor:诊断 · Diagnose'
    'start:启动 · Start' 'stop:停止 · Stop' 'chat:聊天 · Chat'
    'sessions:会话 · Sessions' 'events:事件 · Events' 'identity:身份 · Identity'
    'skills:技能 · Skills' 'version:版本 · Version' 'changelog:变更 · Changelog'
    'docs:文档 · Docs' 'update:更新 · Update' 'service:服务 · Service'
    'completion:补全 · Completion'
  )
  if (( CURRENT == 2 )); then _describe '命令 · Command' commands; return; fi
  case "$words[CURRENT-1]" in
    --session) local -a ids; ids=($(_yonder_values sessions)); _describe '会话 · Session' ids; return;;
    --preset) local -a presets; presets=($(_yonder_values presets)); _describe '预设 · Preset' presets; return;;
    --channel) local -a channels; channels=($(_yonder_values channels)); _describe '渠道 · Channel' channels; return;;
    --home) _files -/; return;;
    --mode) compadd main persistent ephemeral task; return;;
  esac
  case "$words[2]" in
    sessions) (( CURRENT == 3 )) && { compadd list show abort close open submit; return; };;
    service) (( CURRENT == 3 )) && { compadd install uninstall start stop restart status; return; };;
    identity) (( CURRENT == 3 )) && { compadd lookup link unlink person; return; };;
    completion) compadd zsh bash fish; return;;
  esac
  compadd -- ${options}
  _files
}
_yonder_values() {
  local -a globals; local i
  for ((i=2; i<$#words; i++)); do
    [[ $words[i] == --home ]] && globals=(--home "$words[i+1]")
  done
  command yonder completion zsh "$globals[@]" --json 2>/dev/null | node -e 'let s="";process.stdin.on("data",b=>s+=b).on("end",()=>{try{console.log((JSON.parse(s).candidates[process.argv[1]]||[]).join("\\n"))}catch{}})' "$1"
}
compdef _yonder yonder
`;
	if (shell === "bash")
		return `# Load with: source <(yonder completion bash)
_yonder() {
  local cur prev choices i
  cur="$\{COMP_WORDS[COMP_CWORD]}"; prev="$\{COMP_WORDS[COMP_CWORD-1]}"
  choices='${commands} ${options}'
  local -a globals=()
  for ((i=1;i<COMP_CWORD;i++)); do
    [[ $\{COMP_WORDS[i]} == --home ]] && globals=(--home "$\{COMP_WORDS[i+1]}")
  done
  case "$prev" in
    --home) COMPREPLY=($(compgen -d -- "$cur")); return;;
    --session) choices="$(command yonder completion bash "$\{globals[@]}" --json 2>/dev/null | node -e 'let s="";process.stdin.on("data",b=>s+=b).on("end",()=>{try{console.log(JSON.parse(s).candidates.sessions.join(" "))}catch{}})')";;
    --preset) choices="$(command yonder completion bash "$\{globals[@]}" --json 2>/dev/null | node -e 'let s="";process.stdin.on("data",b=>s+=b).on("end",()=>{try{console.log(JSON.parse(s).candidates.presets.join(" "))}catch{}})')";;
    --channel) choices="$(command yonder completion bash "$\{globals[@]}" --json 2>/dev/null | node -e 'let s="";process.stdin.on("data",b=>s+=b).on("end",()=>{try{console.log(JSON.parse(s).candidates.channels.join(" "))}catch{}})')";;
    --mode) choices='main persistent ephemeral task';;
  esac
  if (( COMP_CWORD == 2 )); then
    case "$\{COMP_WORDS[1]}" in
      sessions) choices='list show abort close open submit';;
      service) choices='install uninstall start stop restart status';;
      identity) choices='lookup link unlink person';;
      completion) choices='zsh bash fish';;
    esac
  fi
  COMPREPLY=($(compgen -W "$choices" -- "$cur"))
  if [[ $cur != -* && $\{#COMPREPLY[@]} == 0 ]]; then COMPREPLY=($(compgen -f -- "$cur")); fi
}
complete -F _yonder yonder
`;
	if (shell === "fish")
		return `# Load with: yonder completion fish | source
function __yonder_values
  set -l globals
  set -l tokens (commandline -opc)
  for i in (seq (count $tokens))
    if test "$tokens[$i]" = --home
      set globals --home $tokens[(math $i + 1)]
    end
  end
  yonder completion fish $globals --json 2>/dev/null | node -e 'let s="";process.stdin.on("data",b=>s+=b).on("end",()=>{try{console.log((JSON.parse(s).candidates[process.argv[1]]||[]).join("\\n"))}catch{}})' $argv[1]
end
complete -c yonder -f
complete -c yonder -n '__fish_use_subcommand' -a '${commands}' -d '命令 · Command'
complete -c yonder -n '__fish_seen_subcommand_from sessions' -a 'list show abort close open submit' -d '会话操作 · Session action'
complete -c yonder -n '__fish_seen_subcommand_from service' -a 'install uninstall start stop restart status' -d '服务操作 · Service action'
complete -c yonder -n '__fish_seen_subcommand_from completion' -a 'zsh bash fish'
complete -c yonder -l home -r -a '(__fish_complete_directories)' -d '数据目录 · Home'
complete -c yonder -l session -r -a '(__yonder_values sessions)' -d '会话 · Session'
complete -c yonder -l preset -r -a '(__yonder_values presets)' -d '预设 · Preset'
complete -c yonder -l channel -r -a '(__yonder_values channels)' -d '渠道 · Channel'
complete -c yonder -l help -d '帮助 · Help'
complete -c yonder -l json -d 'JSON 输出 · JSON output'
complete -c yonder -l plain -d '逐行输出 · Plain output'
`;
	throw new Error("Usage: yonder completion zsh|bash|fish");
}
