export function reservePoints(state,address,amount,record){
  const agent=state.agents.find(a=>a.address===address);
  if(!Number.isSafeInteger(amount)||amount<1||agent.points<amount)throw new Error(`You need ${amount} verified points.`);
  const lots=agent.pointLots||[];
  if(lots.reduce((sum,l)=>sum+l.available,0)<amount)throw new Error('The balance is missing verified source records.');
  let remaining=amount;record.pointSources=[];
  for(const lot of lots){
    const taken=Math.min(remaining,lot.available);
    if(taken>0){lot.available-=taken;remaining-=taken;record.pointSources.push({...(lot.sessionId?{sessionId:lot.sessionId}:{sourceId:lot.sourceId,sourceType:lot.sourceType}),points:taken});}
    if(!remaining)break;
  }
  agent.points-=amount;record.points=amount;record.pointsStatus='held';
}
export function refundPoints(state,address,record){
  if(!record.points||record.pointsStatus==='refunded'||record.pointsStatus==='moved'||record.pointsStatus==='burned')return;
  const agent=state.agents.find(a=>a.address===address);
  for(const source of record.pointSources||[]){
    const lot=agent.pointLots?.find(l=>source.sessionId?l.sessionId===source.sessionId:l.sourceId===source.sourceId);
    if(!lot)throw new Error('Missing point reservation source.');lot.available+=source.points;
  }
  agent.points+=record.points;record.pointsStatus='refunded';
}
export function movePoints(from,to){
  if(from.pointsStatus!=='held')throw new Error('Offer points are not reserved.');
  to.points=from.points;to.pointSources=from.pointSources;to.pointsStatus='held';from.pointsStatus='moved';
}
