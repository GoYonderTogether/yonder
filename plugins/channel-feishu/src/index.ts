import { definePlugin, parseRef, type Attachment, type PluginAPI, type ToolContext, type TSchema } from "@yonder/sdk";
import { FeishuChannel } from "./channel.js";
import { configSchema, object, required, string, type Config } from "./protocol.js";

const str={type:"string",minLength:1};
export default definePlugin({
  setup(api:PluginAPI){
    const instances=new Map<string,FeishuChannel>();
    api.channels.register({type:"feishu",configSchema,create(id,value){
      if(instances.has(id))throw new Error(`Duplicate Feishu instance ${id}`);
      const channel=new FeishuChannel(id,value as Config,api);instances.set(id,channel);return channel;
    }});
    const resolve=(input:unknown)=>{
      const args=object(input),id=required(args.instance,"instance"),channel=instances.get(id);
      if(!channel)throw new Error(`Unknown Feishu instance ${id}`);
      return {args,channel};
    };
    const targetOf=(args:Record<string,unknown>,channel:FeishuChannel)=>{
      const target=required(args.to,"to"),ref=parseRef(target);
      if((ref.kind!=="acct" && ref.kind!=="conv") || ref.channel!==channel.id)throw new Error("Target must be an acct/conv reference in the selected Feishu instance");
      return target;
    };
    const record=async(type:string,channel:FeishuChannel,target:string,id:string,ctx:ToolContext)=>{
      await api.events.emit({type, ...(ctx.event?{parent:ctx.event.id}:{}),...(ctx.event?.from?{from:ctx.event.from}:{}),
        ...(target.startsWith("conv:")?{conv:target}:{}),data:{instance:channel.id,to:target,messageId:id,session:ctx.session}});
    };
    api.tools.register({name:"channel-feishu_status",description:"Read actual Feishu instance transport state and required permission guidance; does not connect or send. Connected is not full capability acceptance.",
      parameters:{type:"object",additionalProperties:false,properties:{instance:str}} as TSchema,capabilities:["read"],
      async execute(input){try{const args=object(input);const selected=string(args.instance);const channel=selected?instances.get(selected):undefined;if(selected&&!channel)throw new Error("Unknown Feishu instance");return {text:JSON.stringify(channel?channel.status():[...instances.values()].map(value=>value.status()))};}catch(error){return {text:error instanceof Error?error.message:"Feishu status failed",isError:true};}}
    });
    api.tools.register({name:"channel-feishu_message",description:"Send ordinary text and local file: image/audio/video/file artifacts via Yonder message delivery. Uses selected instance render mode, chunk limits, replies and thread configuration. Audio requires Ogg/Opus, video MP4; no silent media downgrade.",
      parameters:{type:"object",additionalProperties:false,required:["instance","to","text"],properties:{instance:str,to:str,text:{type:"string"},attachments:{type:"array",items:{type:"object",additionalProperties:false,required:["kind","mime","uri"],properties:{kind:{enum:["image","audio","video","file"]},mime:str,uri:str,name:str,bytes:{type:"integer",minimum:0}}}}} as TSchema,
      capabilities:["message","network","read"],
      async execute(input,ctx){try{ctx.signal.throwIfAborted();const {args,channel}=resolve(input);const to=targetOf(args,channel);
        const delivery=await api.messages.send({to,via:channel.id,signal:ctx.signal,text:string(args.text),...(args.attachments?{attachments:args.attachments as Attachment[]}: {})});
        return {text:JSON.stringify(delivery),...(!delivery.ok?{isError:true}:{})};
      }catch(error){return {text:error instanceof Error?error.message:"Feishu send failed",isError:true};}}
    });
    api.tools.register({name:"channel-feishu_card",description:"Send a native Feishu custom JSON card or a template card through a configured instance. Supply exactly card or templateId (or use instance template default). Records a plugin event and tool transcript; button callbacks are authenticated channel-feishu.card-action events, never automatic authorization.",
      parameters:{type:"object",additionalProperties:false,required:["instance","to"],properties:{instance:str,to:str,replyTo:str,card:{type:"object",additionalProperties:true},templateId:str,templateVersion:str,variables:{type:"object",additionalProperties:true}}} as TSchema,
      capabilities:["message","network"],
      async execute(input,ctx){let channel:FeishuChannel|undefined;try{ctx.signal.throwIfAborted();const resolved=resolve(input);channel=resolved.channel;const args=resolved.args;const target=targetOf(args,channel);
        if(args.card && args.templateId)throw new Error("Choose custom card or templateId");
        const template=string(args.templateId)||channel.config.templateId;
        if(!args.card&&!template)throw new Error("A custom card or template ID is required");
        const version=string(args.templateVersion)||channel.config.templateVersion;
        const card=args.card?object(args.card):{type:"template",data:{template_id:template,...(version?{template_version_name:version}:{}),template_variable:object(args.variables)}};
        if(Buffer.byteLength(JSON.stringify(card))>30000)throw new Error("Feishu custom/template card exceeds 30000 bytes");
        const id=await channel.rawSend(target,"interactive",card,string(args.replyTo)||undefined,ctx.signal);
        try{await record("channel-feishu.card-sent",channel,target,id,ctx);}catch(error){return {text:JSON.stringify({ok:false,id,error:"Card sent, but plugin event recording failed; do not resend"}),isError:true};}
        return {text:JSON.stringify({ok:true,id,source:"Feishu"})};
      }catch(error){return {text:channel?channel.client.safe(error):error instanceof Error?error.message:"Feishu card failed",isError:true};}}
    });
  },
});
