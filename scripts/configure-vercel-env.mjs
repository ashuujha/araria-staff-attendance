// Send environment values via stdin, never command arguments or console output.
import {readFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
const cli=process.env.VERCEL_CLI_PATH||'/home/ashu/.npm/_npx/69f9afb961c37556/node_modules/vercel/dist/index.js';
const content=await readFile('.env.local','utf8');
for(const key of ['SUPABASE_URL','SUPABASE_PUBLISHABLE_KEY','APP_URL']){const line=content.split('\n').find(s=>s.startsWith(key+'='));const value=line?.slice(key.length+1);if(!value)continue;await new Promise((resolve,reject)=>{const child=spawn(process.execPath,[cli,'env','add',key,'production'],{stdio:['pipe','pipe','pipe']});let output='';child.stdout.on('data',d=>output+=d);child.stderr.on('data',d=>output+=d);child.stdin.end(value);child.on('close',code=>{if(code!==0)reject(Error('Failed to set '+key+'; use Vercel settings.'));else{console.log('Configured production '+key);resolve();}});});}
