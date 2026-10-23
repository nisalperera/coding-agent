import { spawn, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, mkdirSync, cpSync, readdirSync, lstatSync, readlinkSync } from "node:fs";
import { resolve, dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, randomUUID } from "node:crypto";
import { createServer } from "node:net";

const front=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const git=(...args)=>{
 const r=spawnSync("git",args,{cwd:front,encoding:"utf8"});
 if(r.status!==0)throw Error(r.stderr||"Git command failed");return r.stdout.trim();
};
const root=git("rev-parse","--show-toplevel");
const args=process.argv.slice(2);
let container=false, output=join(root,"output","frontend-acceptance",new Date().toISOString().replace(/[:.]/g,"-"));
for(let i=0;i<args.length;i++){
 if(args[i]==="--container")container=true;
 else if(args[i]==="--output"&&args[i+1])output=resolve(args[++i]);
 else throw Error(`Unknown argument: ${args[i]}`);
}
if(existsSync(output))throw Error("Evidence directory already exists; use a new path");
mkdirSync(output,{recursive:true});
const summary={started:new Date().toISOString(),head:git("rev-parse","HEAD"),branch:git("branch","--show-current"),node:process.version,steps:[],checks:[],hosted:{github:process.env.GITHUB_RUN_ID??null,gitlab:process.env.CI_PIPELINE_ID??null},formalSignoff:false,dependencyDisposition:"pending_review"};
const hash=content=>createHash("sha256").update(content).digest("hex");
function fingerprint(){
 const r=spawnSync("git",["ls-files","-z","--cached","--others","--exclude-standard","--","front-end/next-js",".github/workflows",".gitlab-ci.yml","README.md","config_guide.md"],{cwd:root,encoding:"utf8"});
 if(r.status!==0)throw Error("Cannot enumerate source fingerprint");
 const files=[...new Set(r.stdout.split("\0").filter(Boolean))].sort().filter(p=>
 !/(^|\/)(node_modules|\.next|output|\.git)(\/|$)/.test(p)&&
 !/(^|\/)\.env/.test(p)&&!/(client_secret|credentials|private[-_]key)/i.test(p));
 const entries=files.map(path=>{
 const full=join(root,path);
 if(!existsSync(full))return {path,deleted:true};
 const stat=lstatSync(full);
 return {path,sha256:hash(stat.isSymbolicLink()?readlinkSync(full):readFileSync(full)),mode:stat.mode&0o777};
 });
 return {entries,sha256:hash(JSON.stringify(entries))};
}
const initial=fingerprint();
writeFileSync(join(output,"source-before.json"),JSON.stringify(initial,null,2));
let sequence=0;
function command(name,exe,argv,{audit=false}={}){
 const number=String(++sequence).padStart(2,"0");
 console.log(`\n[${number}] ${name}`);
 const r=spawnSync(exe,argv,{cwd:front,encoding:"utf8",maxBuffer:64*1024*1024,timeout:25*60*1000,env:process.env});
 writeFileSync(join(output,`${number}-${name}.stdout.txt`),r.stdout??"");
 writeFileSync(join(output,`${number}-${name}.stderr.txt`),r.stderr??"");
 if(!audit){process.stdout.write(r.stdout??"");process.stderr.write(r.stderr??"");}
 const item={name,command:[exe,...argv],exit:r.status,signal:r.signal,error:r.error?.message??null};summary.steps.push(item);
 if(r.error||r.signal)throw Error(`${name} did not complete`);
 if(audit){
  let report;try{report=JSON.parse(r.stdout);}catch{throw Error(`${name}: invalid audit JSON`);}
  writeFileSync(join(output,`${name}.json`),JSON.stringify(report,null,2));
  if(report.error||!report.metadata?.vulnerabilities)throw Error(`${name}: audit service error`);
  const known=new Set(["GHSA-vfj7-8cjw-p6xm","GHSA-rj75-hqrm-r3gf"]), advisories=new Set();
  for(const entry of Object.values(report.vulnerabilities??{}))for(const via of entry.via??[]){
   if(typeof via==="object")advisories.add(via.url?.match(/GHSA-[a-z0-9-]+/i)?.[0]??`unidentified:${via.name??via.source}`);
  }
  item.vulnerabilities=report.metadata.vulnerabilities;item.advisories=[...advisories];
  const total=Number(report.metadata.vulnerabilities.total??0);
  if(name==="production-audit"&&(r.status!==0||total!==0))throw Error("Production dependency audit is not clean");
  if(name==="full-audit"){
   if(![0,1].includes(r.status)||[...advisories].some(id=>!known.has(id))||(total>0&&!advisories.size))throw Error("New or unexplained full-audit findings require review");
   summary.registryAuditClean=total===0;
   console.log(`Full audit: ${total} reported entries; ${[...advisories].join(", ")||"none"}. Release disposition remains pending.`);
  }
 }else if(r.status!==0)throw Error(`${name} failed with exit ${r.status}`);
 return r.stdout??"";
}
async function freePort(){const server=createServer();await new Promise((ok,no)=>server.once("error",no).listen(0,"127.0.0.1",ok));const port=server.address().port;await new Promise(ok=>server.close(ok));return port;}
async function response(url){return fetch(url,{redirect:"manual",signal:AbortSignal.timeout(5000)});}
async function waitReady(base,failed){
 for(let i=0;i<120;i++){
  if(failed?.())throw Error("Standalone process exited before readiness");
  try{const r=await response(base+"/login");if(r.status===200)return;}catch{/* Wait for readiness only. */}
  await new Promise(ok=>setTimeout(ok,500));
 }
 throw Error("HTTP readiness timeout");
}
async function smoke(base,label){
 const assets=new Set(), checks=[];let css=0,js=0;
 for(const route of ["/login","/register","/projects","/settings"]){
  const r=await response(base+route),body=await r.text();
  if(r.status!==200||!r.headers.get("content-type")?.includes("text/html"))throw Error(`${label}: route ${route} failed`);
  checks.push({label,route,status:r.status});
  for(const m of body.matchAll(/(?:href|src)=["']([^"']+)["']/g)){
   const path=m[1].replaceAll("&amp;","&");if(path.startsWith("/_next/static/")&&/\.(css|js)(\?|$)/.test(path))assets.add(path);
  }
 }
 for(const path of assets){
  const r=await response(new URL(path,base)),bytes=await r.arrayBuffer(),type=r.headers.get("content-type")??"";
  const isCss=/\.css(\?|$)/.test(path);
  if(r.status!==200||!bytes.byteLength||(isCss?!type.includes("text/css"):!/(javascript|ecmascript)/.test(type)))throw Error(`${label}: asset ${path} failed`);
  if(isCss)css++;else js++;
  checks.push({label,asset:path,status:r.status,bytes:bytes.byteLength,sha256:hash(Buffer.from(bytes))});
 }
 if(!css||!js)throw Error(`${label}: expected both CSS and JS assets`);
 console.log(`${label}: four HTML routes and ${assets.size} static assets passed`);
 return checks;
}
async function standalone(){
 const dir=join(front,".next/standalone"),server=join(dir,"server.js");
 if(!existsSync(server))throw Error("Expected root .next/standalone/server.js is absent; review tracing layout");
 cpSync(join(front,".next/static"),join(dir,".next/static"),{recursive:true});
 if(existsSync(join(front,"public")))cpSync(join(front,"public"),join(dir,"public"),{recursive:true});
 const port=await freePort();const child=spawn(process.execPath,[server],{cwd:dir,env:{...process.env,PORT:String(port),HOSTNAME:"127.0.0.1"},stdio:["ignore","pipe","pipe"]});
 let logs="",spawnError=null;child.stdout.on("data",chunk=>{logs+=chunk;});child.stderr.on("data",chunk=>{logs+=chunk;});child.on("error",error=>{spawnError=error;});
 try{const base=`http://127.0.0.1:${port}`;await waitReady(base,()=>Boolean(spawnError)||child.exitCode!==null);summary.checks.push(...await smoke(base,"standalone"));}
 finally{
  if(child.exitCode===null){child.kill("SIGTERM");await Promise.race([new Promise(ok=>child.once("exit",ok)),new Promise(ok=>setTimeout(ok,5000))]);if(child.exitCode===null)child.kill("SIGKILL");}
  writeFileSync(join(output,"standalone-server.log"),logs);
 }
}
async function docker(){
 const id=randomUUID().replaceAll("-","").slice(0,12),image=`coding-agent-frontend:acceptance-${id}`,name=`coding-agent-frontend-${id}`;
 command("docker-version","docker",["version"]);
 const backend=process.env.NEXT_PUBLIC_BACKEND_URL;
 const buildArgs=["build","--pull","--label",`org.opencontainers.image.revision=${summary.head}`,"--label",`coding-agent.source-fingerprint=${initial.sha256}`,"-t",image];
 if(backend)buildArgs.push("--build-arg",`NEXT_PUBLIC_BACKEND_URL=${backend}`);
 buildArgs.push(".");command("docker-build","docker",buildArgs);
 command("docker-image-inspect","docker",["image","inspect",image]);
 command("docker-run","docker",["run","-d","--name",name,"--label","coding-agent.acceptance=true",image]);
 try{
  const code=`import {createHash} from 'node:crypto';
    const hash=content=>createHash('sha256').update(content).digest('hex');
    ${response.toString()}
    ${waitReady.toString()}
    ${smoke.toString()}
    await waitReady('http://127.0.0.1:3000');
    const checks=await smoke('http://127.0.0.1:3000','container');
    console.log('PROBE_RESULT='+JSON.stringify(checks));`;
  const result=command("docker-smoke","docker",["exec",name,"node","--input-type=module","-e",code]);
  const line=result.split("\n").find(value=>value.startsWith("PROBE_RESULT="));
  if(!line)throw Error("Container did not return probe evidence");
  summary.checks.push(...JSON.parse(line.slice("PROBE_RESULT=".length)));
 }finally{
  const logs=spawnSync("docker",["logs",name],{encoding:"utf8"});writeFileSync(join(output,"container.log"),(logs.stdout??"")+(logs.stderr??""));
  const stop=spawnSync("docker",["rm","-f",name],{encoding:"utf8"});
  if(stop.status!==0)throw Error(`Could not remove owned acceptance container: ${name}`);
 }
 summary.containerImage=image; // Keep the image for review; never prune unrelated resources.
}
try{
 command("npm-ci","npm",["ci","--include=dev","--ignore-scripts=false"]);
 command("hardening-verify","npm",["run","deps:verify"]);
 const tests=readdirSync(join(front,"tests")).filter(name=>name.endsWith(".test.mjs")).sort().map(name=>`tests/${name}`);
 command("node-tests",process.execPath,["--test",...tests]);
 command("rendered-tests","npm",["run","test:lifecycle"]);
 command("lint","npm",["run","lint"]);
 command("build","npm",["run","build"]);
 command("production-audit","npm",["audit","--omit=dev","--json"],{audit:true});
 command("full-audit","npm",["audit","--json"],{audit:true});
 await standalone();
 if(container)await docker();
 summary.automatedEvidence="passed";
}catch(error){summary.automatedEvidence="failed";summary.failure=error.message;console.error(error.message);process.exitCode=1;}
finally{
 const final=fingerprint();writeFileSync(join(output,"source-after.json"),JSON.stringify(final,null,2));
 summary.sourceFingerprint=initial.sha256;summary.sourceUnchanged=initial.sha256===final.sha256;
 if(!summary.sourceUnchanged){summary.automatedEvidence="failed";summary.failure="Source changed while acceptance was running";process.exitCode=1;}
 summary.finished=new Date().toISOString();summary.visualAcceptance="pending_manual_review";
 writeFileSync(join(output,"summary.json"),JSON.stringify(summary,null,2));
 console.log(`Evidence: ${output}\nAutomated status: ${summary.automatedEvidence}; formal sign-off: NOT GRANTED`);
}
