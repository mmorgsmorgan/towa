export const INTEGRATION_TTL_MS=30*60*1000;
export function renewIntegration(state,address,now=new Date().toISOString()){
  const agent=state.agents.find(a=>a.address===address);
  if(!agent?.onboardedAt)throw new Error('Complete signed onboarding first.');
  agent.integrationWindows??=[];
  const until=new Date(Date.parse(now)+INTEGRATION_TTL_MS).toISOString(),last=agent.integrationWindows.at(-1);
  if(last&&Date.parse(last.until)>=Date.parse(now))last.until=until;
  else agent.integrationWindows.push({from:now,until});
  agent.connectedUntil=until;agent.lastSeenAt=now;return {address,connectedUntil:until,renewAfterMs:5*60*1000};
}
export function integratedAt(agent,at){
  const time=Date.parse(at);
  return agent.integrationWindows?.some(window=>Date.parse(window.from)<=time&&time<=Date.parse(window.until))||false;
}
