import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";
function crc(buf){let c,t=[];for(let n=0;n<256;n++){c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;t[n]=c>>>0}let r=0xffffffff;for(const b of buf)r=t[(r^b)&255]^(r>>>8);return(r^0xffffffff)>>>0}
function chunk(type,data){const len=Buffer.alloc(4);len.writeUInt32BE(data.length);const td=Buffer.concat([Buffer.from(type),data]);const c=Buffer.alloc(4);c.writeUInt32BE(crc(td));return Buffer.concat([len,td,c])}
function png(n){const bg=[11,18,20],fg=[63,184,178];const raw=Buffer.alloc(n*(n*3+1));
  const inRR=(x,y,x0,y0,x1,y1,r)=>{if(x<x0||x>x1||y<y0||y>y1)return false;const cx=Math.min(Math.max(x,x0+r),x1-r),cy=Math.min(Math.max(y,y0+r),y1-r);return(x-cx)**2+(y-cy)**2<=r*r};
  for(let y=0;y<n;y++){raw[y*(n*3+1)]=0;for(let x=0;x<n;x++){const u=x/n,v=y/n;let c=bg;
    if(inRR(u,v,0.2,0.2,0.8,0.8,0.07))c=fg;
    for(const [yy,w] of [[0.36,0.66],[0.5,0.58],[0.64,0.5]]){if(inRR(u,v,0.3,yy-0.035,w+0.04,yy+0.035,0.03))c=bg}
    const o=y*(n*3+1)+1+x*3;raw[o]=c[0];raw[o+1]=c[1];raw[o+2]=c[2]}}
  const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(n,0);ihdr.writeUInt32BE(n,4);ihdr[8]=8;ihdr[9]=2;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk("IHDR",ihdr),chunk("IDAT",deflateSync(raw)),chunk("IEND",Buffer.alloc(0))])}
writeFileSync("public/icon-192.png",png(192));writeFileSync("public/icon-512.png",png(512));writeFileSync("public/apple-touch-icon.png",png(180));
