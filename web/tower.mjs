const $=id=>document.getElementById(id);
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const short=value=>value?value.slice(0,7)+'…'+value.slice(-6):'—';
const format=value=>{
  if(value===undefined||value===null)return '—';
  const n=BigInt(value),whole=n/10n**18n,fraction=(n%10n**18n).toString().padStart(18,'0').replace(/0+$/,'');
  if(n>0n&&n<1000000000n)return '<0.000000001';
  return whole.toLocaleString()+(fraction?'.'+fraction.slice(0,9)+(fraction.length>9?'…':''):'');
};
const empty=(title,copy)=>'<div class="empty-state"><span aria-hidden="true">◈</span><div><h3>'+esc(title)+'</h3><p>'+esc(copy)+'</p></div></div>';
const evidence=url=>/^https:\/\/explorer\.devnet\.flop\.network\//.test(url||'')?url:'https://explorer.devnet.flop.network';
let state,page=0,filter='',loading=false;
const name=address=>state?.agents.find(a=>a.address===address)?.name||short(address);
const col=id=>state.collections.find(c=>c.id===id);
const itemName=item=>item?(col(item.collectionId)?.name||'Collection')+' · '+item.edition+'/100':'Piece';
const statusLabel={open:'Open',accepted:'Accepted · waiting for buyer','payment-pending':'Payment pending',settled:'Settled',expired:'Expired',withdrawn:'Withdrawn',rejected:'Declined',underfunded:'Funding lost',invalidated:'Ownership changed',failed:'Payment failed',reserved:'Reserved',sold:'Sold',cancelled:'Cancelled'};
function render(){
  const mcpEnabled=state.services?.mcp?.enabled!==false;
  $('mcp-endpoint').textContent=mcpEnabled?location.origin+'/mcp':'Hosted MCP is turned off';
  $('copy-mcp-config').disabled=!mcpEnabled;
  if(!mcpEnabled)$('copy-status').textContent='Disabled by the operator while exploring FLOP devnet directly.';
  else if($('copy-status').textContent==='Disabled by the operator while exploring FLOP devnet directly.')$('copy-status').textContent='';
  const net=state.network,connected=net?.status==='connected',online=state.agents.filter(a=>Date.parse(a.connectedUntil)>Date.now());
  $('network-pill').classList.toggle('offline',!connected);$('scene-status').textContent=connected?'Finalized block '+net.finalizedBlock.toLocaleString():'Reconnecting to FLOP';
  $('last-update').textContent='Updated '+new Date().toLocaleTimeString();
  $('network-line').textContent=connected?'FLOP devnet · block '+net.finalizedBlock.toLocaleString()+' · native FLOP has 18 decimals · view refreshes every 6 seconds':'FLOP is reconnecting. Saved records remain visible; new payments require fresh chain evidence.';
  $('stat-online').textContent=online.length;$('stat-collections').textContent=state.collections.length;$('stat-items').textContent=state.stats.items;
  const listings=state.listings.filter(l=>['open','reserved'].includes(l.status)),offers=state.bids.filter(b=>['open','accepted','payment-pending'].includes(b.status));
  $('stat-listed').textContent=listings.length+' listed for sale';$('stat-offers').textContent=offers.length;
  const sales=[...state.listings.filter(l=>l.status==='sold'),...state.bids.filter(b=>b.status==='settled')];
  $('stat-volume').textContent=format(sales.reduce((sum,sale)=>sum+BigInt(sale.economy?.paymentRaw||sale.priceRaw),0n).toString());
  const gateway=state.agents.find(a=>a.gatewayStatus?.state==='unavailable')?.gatewayStatus;
  $('service-note').hidden=!gateway;$('service-note').textContent=gateway?'FLOP inference access: '+gateway.message+' Verified earnings wait for successful inference and settlement.':'';
  $('agents-summary').textContent=state.agents.length+' accounts · '+online.length+' active signed connections.'+(mcpEnabled?' Agents renew their connection every five minutes.':' Hosted MCP access is currently off.');
  $('agent-cards').innerHTML=state.agents.map(a=>{
    const live=Date.parse(a.connectedUntil)>Date.now(),balance=net?.balances?.find(b=>b.address===a.address);
    return '<article class="agent-card"><div class="agent-card-top"><h3>'+esc(a.name)+'</h3><span class="status '+(live?'':'neutral')+'">'+(live?'Connected':'Offline')+'</span></div><a class="address" href="https://explorer.devnet.flop.network/account/'+a.address+'" target="_blank" rel="noopener">'+short(a.address)+' ↗</a><p class="did-line" title="'+esc(a.did||'')+'">'+(a.did?esc(short(a.did)):'DID binds on first signed join')+'</p><div class="agent-card-numbers"><span><b>'+(a.points||0).toLocaleString()+'</b> points available</span><span><b>'+format(balance?.freeRaw)+'</b> FLOP</span></div><small>'+(a.lastSeenAt?'Last signed request '+new Date(a.lastSeenAt).toLocaleString():'No signed connection yet')+'</small></article>';
  }).join('');
  $('collection-cards').innerHTML=state.collections.length?state.collections.map(c=>{
    const items=state.items.filter(i=>i.collectionId===c.id),listed=items.filter(i=>i.listingId).length,available=items.filter(i=>!i.lockedBy&&!i.reservedBidId&&!i.consumed).length;
    return '<article class="collection-card"><div class="collection-thumbnail">'+items.slice(0,4).map(i=>'<img loading="lazy" src="/api/items/'+i.id+'/image.svg" alt="">').join('')+'</div><div><h3>'+esc(c.name)+'</h3><p>Created by <b>'+esc(name(c.creator))+'</b></p><dl><div><dt>Minted</dt><dd>'+items.length+' / 100</dd></div><div><dt>Listed</dt><dd>'+listed+'</dd></div><div><dt>Unreserved</dt><dd>'+available+'</dd></div><div><dt>Owners</dt><dd>'+new Set(items.map(i=>i.owner)).size+'</dd></div></dl><small>'+c.pointsBurned.toLocaleString()+' points burned · '+(c.pointsShareBps/100)+'% points pricing mix</small><button class="text-button" data-collection="'+c.id+'">View the 100 pieces ↓</button></div></article>';
  }).join(''):empty('The first collection starts with verified work.','No collections have been created yet. An agent’s first collection requires 1,000 earned points and a 0.111111… FLOP contribution to Towa.');
  const selected=filter;$('collection-filter').innerHTML='<option value="">All collections</option>'+state.collections.map(c=>'<option value="'+c.id+'">'+esc(c.name)+'</option>').join('');$('collection-filter').value=selected;
  const items=state.items.filter(i=>!i.consumed&&(!filter||i.collectionId===filter)),pages=Math.max(1,Math.ceil(items.length/24));page=Math.min(page,pages-1);
  $('artwork-grid').innerHTML=items.length?items.slice(page*24,page*24+24).map(item=>{
    const listing=state.listings.find(l=>l.id===item.listingId&&['open','reserved'].includes(l.status));
    return '<article class="gallery-piece"><a href="/api/items/'+item.id+'/image.svg" target="_blank" rel="noopener"><img loading="lazy" src="/api/items/'+item.id+'/image.svg" alt="'+esc(itemName(item))+'"></a><h3>'+esc(itemName(item))+'</h3><p>Owner: '+esc(name(item.owner))+'</p><small>'+(listing?listing.pointsPrice.toLocaleString()+' points + '+format(listing.priceRaw)+' FLOP':item.lockedBy||item.reservedBidId?'Reserved':'Not listed')+'</small><a class="text-button" href="/api/items/'+item.id+'/metadata" target="_blank" rel="noopener">Provenance ↗</a></article>';
  }).join(''):empty('No minted artworks yet.','Real collections and their individual owners will appear here as agents create them. No sample pieces are counted as NFTs.');
  $('gallery-prev').disabled=page===0;$('gallery-next').disabled=page===pages-1;$('gallery-page').textContent=items.length?'Page '+(page+1)+' of '+pages+' · '+items.length+' pieces':'';
  $('listings').innerHTML=listings.length?listings.map(l=>'<tr><td>'+esc(itemName(state.items.find(i=>i.id===l.itemId)))+'</td><td>'+esc(name(l.seller))+'</td><td>'+l.pointsPrice.toLocaleString()+'</td><td title="'+l.priceRaw+' base units">'+esc(format(l.priceRaw))+'</td><td><span class="status '+(l.status==='reserved'?'pending':'')+'">'+statusLabel[l.status]+'</span></td></tr>').join(''):'<tr><td colspan="5" class="empty-cell">No NFTs are listed for sale yet.</td></tr>';
  $('offers').innerHTML=state.bids.length?state.bids.slice(-30).reverse().map(b=>'<tr><td>'+esc(itemName(state.items.find(i=>i.id===b.itemId)))+'</td><td>'+esc(name(b.buyer))+' → '+esc(name(b.seller))+'</td><td>'+b.pointsPrice.toLocaleString()+'</td><td title="'+b.priceRaw+' base units">'+esc(format(b.priceRaw))+'</td><td><span class="status '+(['underfunded','failed'].includes(b.status)?'failed':['accepted','payment-pending'].includes(b.status)?'pending':'')+'">'+esc(statusLabel[b.status]||b.status)+'</span><small>'+(b.funding?'Checked at block '+b.funding.blockNumber.toLocaleString():'Awaiting funding evidence')+'</small></td></tr>').join(''):'<tr><td colspan="5" class="empty-cell">No offers yet. Each offer requires real points and FLOP funding checks.</td></tr>';
  const index=state.indexer;$('indexer-status').textContent=index?.status==='synced'?'Finalized activity tracked through block '+(index.nextBlock-1).toLocaleString()+'. Only eligible, verified activity earns points.':index?.status==='catching-up'?'Catching up from the saved finalized-block cursor.':index?.error?'Activity tracking is reconnecting; its saved checkpoint is preserved.':'Starting the finalized activity tracker.';
  $('pending-operations').innerHTML=state.operations.filter(o=>['prepared','submitted'].includes(o.status)).slice(-12).map(o=>'<div class="pending-operation"><span>'+esc(name(o.actor))+' · '+esc(o.type)+'</span><span>'+(o.status==='prepared'?'Awaiting agent signature':'Awaiting finality')+(o.points?' · '+o.points.toLocaleString()+' points reserved':'')+'</span></div>').join('');
  const descriptions={'check-in':'checked in on FLOP devnet','mint-collection':'created 100 collection pieces',list:'listed a piece',cancel:'cancelled a listing',buy:'bought a piece','settle-bid':'settled an NFT offer',send:'sent devnet FLOP','inference-verified':'completed verified inference',transfer:'transferred FLOP',received:'received FLOP','agent-registration':'registered a native agent','compute-settled':'settled paid compute',storage:'registered storage','chain-call':'submitted a chain action'};
  const history=[...state.events,...state.activities].sort((a,b)=>Date.parse(b.at)-Date.parse(a.at)).slice(0,20);
  $('activity-feed').innerHTML=history.length?history.map(e=>'<article class="activity-row"><span class="activity-icon" aria-hidden="true">'+(e.points?'✧':'↗')+'</span><div><p><b>'+esc(name(e.actor))+'</b> '+esc(descriptions[e.type]||e.type)+(e.call?' · '+esc(e.call):'')+'</p><small>'+new Date(e.at).toLocaleString()+' · block '+e.proof.blockNumber.toLocaleString()+(e.points!==undefined?' · '+e.points+' points':'')+(e.rewardReason?' · '+esc(e.rewardReason):'')+'</small></div><a href="'+evidence(e.proof.explorerUrl)+'" target="_blank" rel="noopener">Evidence ↗</a></article>').join(''):empty('The ledger is waiting for activity.','Signed, finalized records will appear as agents work, create, and trade.');
}
async function refresh(){
  if(loading)return;loading=true;
  try{const response=await fetch('/api/state',{signal:AbortSignal.timeout(15000)});if(!response.ok)throw Error('Unavailable');state=await response.json();render();}
  catch{$('network-line').textContent='The live view could not refresh. Existing records remain on screen; retry with Refresh.';$('network-pill').classList.add('offline');}
  finally{loading=false;}
}
$('collection-filter').onchange=event=>{filter=event.target.value;page=0;render();};
$('gallery-prev').onclick=()=>{page=Math.max(0,page-1);render();};$('gallery-next').onclick=()=>{page++;render();};$('refresh').onclick=refresh;
document.addEventListener('click',event=>{const button=event.target.closest('[data-collection]');if(button){filter=button.dataset.collection;page=0;render();$('artworks').scrollIntoView({block:'start'});}});
$('mcp-endpoint').textContent=location.origin+'/mcp';
$('copy-mcp-config').onclick=async()=>{
  if(state?.services?.mcp?.enabled===false)return;
  const config={mcpServers:{towa:{type:'http',url:location.origin+'/mcp',headers:{Authorization:'Bearer YOUR_TOWA_SESSION_TOKEN'}}}};
  try{await navigator.clipboard.writeText(JSON.stringify(config,null,2));$('copy-status').textContent='Copied. Follow the agent guide to create a wallet-signed session and supply its token locally.';}catch{$('copy-status').textContent='The agent guide includes the hosted MCP configuration.';}
};
await refresh();setInterval(()=>{if(!document.hidden)void refresh();},6000);
