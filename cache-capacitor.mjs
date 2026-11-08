// Warm SwiftPM's binary-artifact cache from the official release API when the
// browser download endpoint is unavailable. Preserve Package.swift's checksum.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, renameSync, openSync, closeSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';
const source = process.env.PRIVATE_BUILD_ROOT;
if (!source) throw Error('Private build root required');
const version = JSON.parse(readFileSync(join(source,'source/package-lock.json'))).packages['node_modules/@capacitor/ios'].version;
if (!/^\d+\.\d+\.\d+$/.test(version)) throw Error('Unsupported Capacitor version');
function api(path, output) {
  const fd = output ? openSync(output,'w',0o600) : null;
  try {
    const r=spawnSync('gh',['api',...(output?['-H','Accept: application/octet-stream']:[]),path],{encoding:output?undefined:'utf8',stdio:output?['ignore',fd,'pipe']:'pipe'});
    if(r.status!==0)throw Error('Official artifact API unavailable');
    return output?undefined:JSON.parse(r.stdout);
  } finally {if(fd!==null)closeSync(fd);}
}
const release=api(`repos/ionic-team/capacitor-swift-pm/releases/tags/${version}`);
if(release.tag_name!==version||release.draft)throw Error('Release identity mismatch');
const manifest=Buffer.from(api(`repos/ionic-team/capacitor-swift-pm/contents/Package.swift?ref=${version}`).content,'base64').toString();
const cache=process.env.VZ_ARTIFACT_CACHE_DIR || join(homedir(),'Library/Caches/org.swift.swiftpm/artifacts');
mkdirSync(cache,{recursive:true,mode:0o700});
for(const name of ['Capacitor','Cordova']){
 const url=`https://github.com/ionic-team/capacitor-swift-pm/releases/download/${version}/${name}.xcframework.zip`;
 const declared=manifest.match(new RegExp(`url:\\s*"${url.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}"\\s*,\\s*checksum:\\s*"([a-f0-9]{64})"`))?.[1];
 const asset=release.assets.find(a=>a.name===`${name}.xcframework.zip`);
 if(!declared||asset?.digest!==`sha256:${declared}`||!Number.isSafeInteger(asset.id))throw Error('Artifact checksum declaration mismatch');
 // SwiftPM/TSCUtility's spm_mangledToC99ExtendedIdentifier, for ASCII URLs.
 const destination=join(cache,url.replace(/[^A-Za-z0-9_]/g,'_'));
 const temporary=destination+'.pending';api(`repos/ionic-team/capacitor-swift-pm/releases/assets/${asset.id}`,temporary);
 const bytes=readFileSync(temporary);
 if(bytes.length!==asset.size||createHash('sha256').update(bytes).digest('hex')!==declared)throw Error('Artifact bytes mismatch');
 renameSync(temporary,destination);
 console.log(`Verified official ${name} ${version} artifact cache (${declared})`);
}
