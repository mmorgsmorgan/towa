import { GENESIS, RESIDENTS } from './config.mjs';
import { integratedAt } from './presence.mjs';

export const REWARD_POLICY={
  version:'devnet-v2',dailyPoints:100,
  inference:{points:10,requires:'Completed request, credential-bound receipt, finalized paid settlement'},
  computeSettlement:{points:10,requires:'Paid compute channel owned by the linked wallet; once per channel'},
  transfer:{points:0,requires:'Recorded only; repeatable token movements are not a reward source'},
  agentRegistration:{points:5,requires:'Successful native agentIdentity registration; once per wallet'},
  other:{points:0,requires:'Recorded for analytics; no reward rule yet'},
};

export function creditPoints(state,address,{id,source,sourceId,points,at,proof,reason}){
  state.rewards??=[];
  const existing=state.rewards.find(reward=>reward.id===id);
  if(existing)return existing;
  const agent=state.agents.find(a=>a.address===address);
  if(!agent)throw new Error('Reward recipient must be registered.');
  const daily=state.rewards.filter(r=>r.actor===address&&r.at.slice(0,10)===at.slice(0,10)).reduce((sum,r)=>sum+r.points,0);
  const granted=Math.min(points,Math.max(0,REWARD_POLICY.dailyPoints-daily));
  const reward={id,actor:address,source,sourceId,points:granted,at,proof,reason:granted<points?'Daily point limit reached':reason,policy:REWARD_POLICY.version};
  state.rewards.push(reward);
  agent.points+=granted;agent.pointLots??=[];
  if(granted>0)agent.pointLots.push({...(source==='inference'?{sessionId:sourceId}:{sourceId,sourceType:source}),total:granted,available:granted});
  return reward;
}

function sameOperator(state,left,right){
  const founding=address=>RESIDENTS.some(a=>a.address===address);
  if(founding(left)&&founding(right))return true;
  const a=state.agents.find(a=>a.address===left),b=state.agents.find(a=>a.address===right);
  return !!a?.operatorGroup&&a.operatorGroup===b?.operatorGroup;
}

export function activityReward(state,activity){
  const actor=state.agents.find(a=>a.address===activity.actor);
  if(!activity.success)return {points:0,reason:'The transaction failed'};
  if(!actor?.onboardedAt||activity.proof.blockNumber<(actor.trackingFromBlock??Infinity))return {points:0,reason:'Activity predates signed onboarding'};
  if(!integratedAt(actor,activity.at))return {points:0,reason:'No active signed Towa connection at the time of activity'};
  if(activity.type==='transfer'){
    if(activity.actor===activity.recipient||sameOperator(state,activity.actor,activity.recipient))return {points:0,reason:'Transfer within the same known operator'};
    return {points:0,reason:'Token transfers are tracked but cannot generate spendable points'};
  }
  if(activity.type==='agent-registration'){
    if(state.activities.some(a=>a.actor===activity.actor&&a.type===activity.type&&a.points>0))return {points:0,reason:'Native registration was already rewarded'};
    return {points:5,reason:'First verified native agent registration'};
  }
  if(activity.type==='compute-settled'){
    if(state.sessions.some(s=>s.status==='verified'&&s.proof?.channelId===activity.channelId))return {points:0,reason:'This channel already backs rewarded gateway inference'};
    if(state.activities.some(a=>a.type===activity.type&&a.channelId===activity.channelId))return {points:0,reason:'This compute settlement was already recorded'};
    if(activity.amountRaw==='0'||activity.aggregateGn==='0')return {points:0,reason:'Settlement contains no paid verified compute'};
    return {points:10,reason:'Finalized paid compute for the linked wallet'};
  }
  return {points:0,reason:'Recorded activity; no reward rule for this action'};
}

export function recordActivity(state,activity){
  state.activities??=[];
  if(activity.proof?.genesis!==GENESIS||!Number.isSafeInteger(activity.proof.blockNumber)||activity.proof.blockNumber<1||!/^0x[0-9a-f]{64}$/.test(activity.proof.blockHash||'')||!/^0x[0-9a-f]{64}$/.test(activity.proof.txHash||'')||!Number.isFinite(Date.parse(activity.at)))throw new Error('Canonical finalized activity evidence is required.');
  const existing=state.activities.find(a=>a.id===activity.id);
  if(existing)return existing;
  const decision=activityReward(state,activity);
  const reward=creditPoints(state,activity.actor,{id:activity.id,source:activity.type,sourceId:activity.id,at:activity.at,proof:activity.proof,...decision});
  const saved={...activity,points:reward.points,rewardReason:reward.reason,policy:reward.policy};
  state.activities.push(saved);return saved;
}
