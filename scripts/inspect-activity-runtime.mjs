import { Chain } from '../lib/chain.mjs';
const chain=new Chain();
try{
  const api=await chain.connect();
  const result={genesis:api.genesisHash.toHex(),types:{},events:{},storage:{}};
  for(const [section,name] of [['agentIdentity','agents'],['computeChannel','channels']])result.types[section]=api.registry.lookup.getTypeDef(api.query[section][name].meta.type.asMap.value).type;
  for(const section of ['agentIdentity','computeChannel','daRegistry','balances']){
    result.events[section]=Object.entries(api.events[section]||{}).filter(([name])=>/Registered|Settled|Transfer|Blob/i.test(name)).map(([name,event])=>({name,fields:event.meta.fields.toJSON()}));
    result.storage[section]=Object.keys(api.query[section]||{}).filter(name=>/agent|channel|blob/i.test(name));
  }
  console.log(JSON.stringify(result,null,2));
}finally{await chain.close();}
