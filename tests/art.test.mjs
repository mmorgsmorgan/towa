import test from 'node:test';
import assert from 'node:assert/strict';
import {pieceMetadata,pieceSvg} from '../lib/art.mjs';
test('all 100 collection images are distinct, deterministic and smaller than one KiB',()=>{
  const images=Array.from({length:100},(_,i)=>pieceSvg({id:'fixture-'+i,edition:i+1,artSeed:'0123456789abcdef'.repeat(2)}));
  assert.equal(new Set(images).size,100);
  assert.ok(images.every(svg=>Buffer.byteLength(svg)<1024));
  assert.ok(images.every(svg=>!/<script|http(?!:\/\/www.w3.org)/.test(svg)));
});
test('ownership changes do not change a piece’s image, creator or collection provenance',()=>{
  const item={id:'piece-fixture-1',edition:1,artSeed:'0123456789abcdef'.repeat(2),owner:'first',creator:'first',createdAt:'2026-11-07T00:00:00Z',history:[]};
  const collection={name:'Traces',pointsBurned:1000,pointsShareBps:9000,pointSources:[{sessionId:'a',points:1000}]};
  const image=pieceSvg(item);item.owner='second';item.history.push({type:'buy'});
  assert.equal(pieceSvg(item),image);const metadata=pieceMetadata(item,'https://tower.example',collection);
  assert.equal(metadata.owner,'second');assert.equal(metadata.creator,'first');assert.equal(metadata.attributes.find(a=>a.trait_type==='Collection points burned').value,1000);assert.equal(metadata.attributes.find(a=>a.trait_type==='Transfers').value,1);assert.match(metadata.description,/not an ERC-721/);
});
