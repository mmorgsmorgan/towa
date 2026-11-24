export function pixelSvg(digest,edition){
  const pixels=[];
  for(let row=0;row<8;row++){
    const bits=row===0?edition:parseInt(digest.slice(row*2,row*2+2),16);
    for(let col=0;col<8;col++)if(bits&(1<<col))pixels.push(`M${col+1} ${row+1}h1v1h-1z`);
  }
  const color=['#9edccc','#ecc08b','#cab8e6','#84becb'][parseInt(digest[0],16)%4];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" shape-rendering="crispEdges"><path fill="#102a35" d="M0 0h10v10H0z"/><path fill="${color}" d="${pixels.join('')}"/></svg>`;
}
