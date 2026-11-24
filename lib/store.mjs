import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { RESIDENTS } from './config.mjs';
export function initialState() {
  return { version:4, revision:0, agents:RESIDENTS.map(r=>({...r,points:0,createdAt:new Date().toISOString()})), sessions:[], collections:[], items:[], listings:[], bids:[], activities:[], rewards:[], indexer:null, operations:[], events:[], network:null };
}
export class Store {
  constructor(filename, options={}) {
    if(filename!==':memory:')mkdirSync(dirname(filename),{recursive:true,mode:0o700});
    this.db=new DatabaseSync(filename);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;');
    this.db.exec(`CREATE TABLE IF NOT EXISTS state (id INTEGER PRIMARY KEY CHECK(id=1), json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS nonces (address TEXT NOT NULL, nonce TEXT NOT NULL, used_at INTEGER NOT NULL, PRIMARY KEY(address,nonce));
      CREATE TABLE IF NOT EXISTS credentials (address TEXT PRIMARY KEY, sealed TEXT NOT NULL);`);
    this.db.prepare('INSERT OR IGNORE INTO state VALUES (1,?)').run(JSON.stringify(initialState()));
    if(this.read().version<4)this.change(state=>{
      state.bids??=[];state.collections??=[];state.activities??=[];state.rewards??=[];state.indexer??=null;state.version=4;
    });
    if(filename!==':memory:')chmodSync(filename,0o600);
    if(options.encryptionKey)this.key=Buffer.from(options.encryptionKey,'hex');
    else if(filename===':memory:')this.key=randomBytes(32);
    else {
      const keyFile=join(dirname(filename),'credential-key');
      try { this.key=readFileSync(keyFile); }
      catch(error) { if(error.code!=='ENOENT')throw error; this.key=randomBytes(32);writeFileSync(keyFile,this.key,{mode:0o600,flag:'wx'}); }
    }
    if(this.key.length!==32)throw new Error('Credential encryption key must be 32 bytes.');
  }
  read(){return JSON.parse(this.db.prepare('SELECT json FROM state WHERE id=1').get().json);}
  change(fn){
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const state=this.read();
      const value=fn(state);
      if(value?.then)throw new Error('Store changes must be synchronous.');
      state.revision++;
      this.db.prepare('UPDATE state SET json=? WHERE id=1').run(JSON.stringify(state));
      this.db.exec('COMMIT');
      return value;
    } catch(error){this.db.exec('ROLLBACK');throw error;}
  }
  useNonce(address,nonce,now=Date.now()) {
    this.db.prepare('DELETE FROM nonces WHERE used_at < ?').run(now-24*60*60*1000);
    try {this.db.prepare('INSERT INTO nonces VALUES(?,?,?)').run(address,nonce,now);}
    catch(error){if(error.code==='ERR_SQLITE_ERROR'&&/UNIQUE/.test(error.message))throw new Error('This signed request was already used.');throw error;}
  }
  setCredential(address,value) {
    const iv=randomBytes(12), cipher=createCipheriv('aes-256-gcm',this.key,iv);
    cipher.setAAD(Buffer.from(address));
    const ciphertext=Buffer.concat([cipher.update(JSON.stringify(value),'utf8'),cipher.final()]);
    const sealed=Buffer.concat([iv,cipher.getAuthTag(),ciphertext]).toString('base64');
    this.db.prepare('INSERT INTO credentials VALUES(?,?) ON CONFLICT(address) DO UPDATE SET sealed=excluded.sealed').run(address,sealed);
  }
  credential(address){
    const row=this.db.prepare('SELECT sealed FROM credentials WHERE address=?').get(address);
    if(!row)return null;
    const bytes=Buffer.from(row.sealed,'base64'),decipher=createDecipheriv('aes-256-gcm',this.key,bytes.subarray(0,12));
    decipher.setAAD(Buffer.from(address));decipher.setAuthTag(bytes.subarray(12,28));
    return JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)),decipher.final()]).toString('utf8'));
  }
  close(){this.db.close();}
}
