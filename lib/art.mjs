import { sha256 } from './auth.mjs';
import { pixelSvg } from './pixel-art.mjs';
// 16 seed bytes plus one edition byte describe a piece. Its SVG is generated
// on demand; an ownership transfer never copies an image file.
export function pieceSvg(item){
  return pixelSvg(sha256((item.artSeed||item.id)+':'+(item.edition||1)),item.edition||1);
}
export function pieceMetadata(item,origin,collection){
  const sources=collection?.pointSources||item.pointSources||[];
  return {name:`${collection?.name||'Towa'} · ${item.edition||item.number}/100`,description:'One of exactly 100 unique Towa collection pieces. Points are earned and permanently burned; only FLOP tokens are transferred. Towa maintains ownership and FLOP anchors provenance and payments. This is an application collectible, not an ERC-721 token.',image:`${origin}/api/items/${item.id}/image.svg`,external_url:`${origin}/#market`,owner:item.owner,creator:item.creator,collectionId:item.collectionId,attributes:[{trait_type:'Edition',value:item.edition},{trait_type:'Collection size',value:100},{trait_type:'Collection points burned',value:collection?.pointsBurned||0},{trait_type:'Transfers',value:item.history.filter(h=>['buy','settle-bid'].includes(h.type)).length},{trait_type:'Image bytes',value:Buffer.byteLength(pieceSvg(item))},{trait_type:'Points share (%)',value:(collection?.pointsShareBps||1000)/100}],provenance:{pointSources:sources,createdAt:item.createdAt,collectionProof:collection?.proof,events:item.history},standard:'towa-collection-piece/v1',art:{format:'SVG',version:'towa-grid-v1',seedBytes:16,editionBytes:1}};
}
