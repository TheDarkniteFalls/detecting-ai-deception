#!/usr/bin/env node
import path from 'node:path';
import { checkPacket,canonicalJson,markdown } from '../src/handoff-v1.mjs';
const args=process.argv.slice(2),packet=args.shift();let lock,digest,format='json',bad=false;
while(args.length){const k=args.shift(),v=args.shift();if(k==='--execution-lock'&&lock===undefined)lock=v;else if(k==='--execution-lock-sha256'&&digest===undefined)digest=v;else if(k==='--format'&&['json','markdown'].includes(v))format=v;else bad=true;}
const result=checkPacket(packet,bad||lock===undefined?undefined:path.resolve(process.cwd(),lock),bad?undefined:digest);
process.stdout.write(format==='markdown'?markdown(result):canonicalJson(result));
process.exitCode=result.errors.length?2:0;
