import { DatabaseSync, backup } from 'node:sqlite';
import { mkdir, readFile, writeFile, chmod } from 'node:fs/promises';
import { join } from 'node:path';
const root=process.env.TOWER_DATA_DIR||new URL('../data/',import.meta.url).pathname;
const destination=join(root,'backups',new Date().toISOString().replace(/[:.]/g,'-'));
await mkdir(destination,{recursive:true,mode:0o700});
const db=new DatabaseSync(join(root,'tower.sqlite'),{readOnly:true});
try{await backup(db,join(destination,'tower.sqlite'));}finally{db.close();}
await chmod(join(destination,'tower.sqlite'),0o600);
await writeFile(join(destination,'credential-key'),await readFile(join(root,'credential-key')),{mode:0o600,flag:'wx'});
console.log(JSON.stringify({backup:destination,consistentSQLiteBackup:true,includesPrivateCredentialKey:true}));
