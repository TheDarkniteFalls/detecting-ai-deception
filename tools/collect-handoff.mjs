#!/usr/bin/env node
import path from 'node:path';
import { collectSelectionBytes,readBytes,canonicalJson } from '../src/handoff-v1.mjs';
try {if(process.argv.length!==3)throw Error('one selection path required');const selection=readBytes(path.resolve(process.argv[2]),8*1024*1024);const result=collectSelectionBytes(selection);process.stdout.write(canonicalJson(result));}
catch(e){process.stdout.write(canonicalJson({schema_version:'daid_handoff_error_v1',packet_sha256:null,errors:[{code:e.code==='input_limit'?'input_limit':'selection_rejected',source_id:null,path:e.path??'',message:e.message}],downstream_action_authorized:false}));process.exitCode=2;}
