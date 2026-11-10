import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, chmod, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

function run(binary,args,input) {
  return new Promise((resolve,reject)=>{
    const child=spawn(binary,args,{stdio:['pipe','pipe','pipe']});
    let output='',failed=false;
    child.stdout.on('data',chunk=>{output+=chunk;if(output.length>262144){failed=true;child.kill();}});
    child.stderr.resume(); // Never forward arbitrary subprocess output or credentials.
    child.on('error',()=>reject(Error('Mac Keychain helper could not start.')));
    child.on('close',code=>code===0&&!failed?resolve(output):reject(Error('Mac Keychain is unavailable. Unlock it and retry.')));
    child.stdin.on('error',()=>{});
    child.stdin.end(input);
  });
}
export async function prepareKeychain(directory) {
  if(process.platform!=='darwin')throw Error('Saved sign-in currently requires macOS Keychain.');
  await mkdir(directory,{recursive:true,mode:0o700});
  const source=fileURLToPath(new URL('./keychain-helper.swift',import.meta.url));
  const digest=createHash('sha256').update(await readFile(source)).digest('hex');
  const binary=fileURLToPath(new URL('keychain-helper',directory));
  const stamp=new URL('keychain-helper.sha256',directory);
  let previous;try{previous=await readFile(stamp,'utf8');}catch{}
  if(previous!==digest) {
    await run('/usr/bin/swiftc',['-module-cache-path',fileURLToPath(new URL('swift-cache/',directory)),source,'-o',binary],'');
    await chmod(binary,0o700);
    await writeFile(stamp,digest,{mode:0o600});
  }
  return {
    forAccount(account) {
      async function call(operation,secret) {
        const output=await run(binary,[],JSON.stringify({operation,account,...(secret===undefined?{}:{secret})}));
        try{return JSON.parse(output).value;}catch{throw Error('Mac Keychain returned an invalid result.');}
      }
      return {load:async()=>{const value=await call('read');if(value===null)return null;try{return JSON.parse(value);}catch{throw Error('Saved credentials are unreadable.');}},save:record=>call('write',JSON.stringify(record)),clear:()=>call('delete')};
    },
    async lock(account) {
      const name=createHash('sha256').update(account).digest('hex');
      const lockDirectory = `/private/tmp/cheapo-auth-locks-${process.getuid()}`;
      await mkdir(lockDirectory,{mode:0o700,recursive:true});
      const details=await stat(lockDirectory);
      if(details.uid!==process.getuid() || (details.mode&0o777)!==0o700)throw Error('Saved-session lock directory is not private.');
      const child=spawn(binary,['lock',`${lockDirectory}/${name}.lock`],{stdio:['pipe','pipe','pipe']});
      child.stderr.resume();
      await new Promise((resolve,reject)=>{
        child.stdout.once('data',chunk=>chunk.toString()==='locked\n'?resolve():reject(Error('Could not lock saved session.')));
        child.once('error',()=>reject(Error('Could not lock saved session.')));
        child.once('exit',()=>reject(Error('Another companion is using this saved registration. Stop it first.')));
      });
      // Kernel lock automatically releases on companion exit; child sees pipe EOF.
      const release=()=>child.stdin.end();
      process.once('exit',release);
      return release;
    },
  };
}
