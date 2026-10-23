import { normalize } from './home-normalize.util';
export interface SearchPart {text:string;match:boolean;}
/** Map normalized matches back to the original text, including accents and ligatures. */
export function searchPresentation(text:string,query:string,snippet=false):SearchPart[] {
  const terms=normalize(query).split(' ').filter(Boolean).slice(0,24);
  if(!terms.length)return [{text:snippet?text.slice(0,180):text,match:false}];
  let normalized='';const positions:number[]=[];let offset=0;
  for(const char of Array.from(text)) {
    const value=/\s/.test(char)?' ':normalize(char);
    for(const ch of value){normalized+=ch;positions.push(offset);}
    offset+=char.length;
  }
  const ranges:Array<[number,number]>=[];
  for(const term of terms)for(let i=normalized.indexOf(term);i>=0;i=normalized.indexOf(term,i+term.length)) {
    const last=positions[i+term.length-1];ranges.push([positions[i],last+(text.codePointAt(last)!>65535?2:1)]);
  }
  ranges.sort((a,b)=>a[0]-b[0]);
  const start=snippet?Math.max(0,(ranges[0]?.[0] ?? 0)-15):0;
  const end=snippet?Math.min(text.length,start+180):text.length;
  const parts:SearchPart[]=[];let cursor=start;
  if(start)parts.push({text:'…',match:false});
  for(const [a,b] of ranges) {
    if(a>=end)break;if(b<=cursor)continue;
    const left=Math.max(cursor,a),right=Math.min(end,b);
    if(left>cursor)parts.push({text:text.slice(cursor,left),match:false});
    parts.push({text:text.slice(left,right),match:true});cursor=right;
  }
  if(cursor<end)parts.push({text:text.slice(cursor,end),match:false});
  if(end<text.length)parts.push({text:'…',match:false});
  return parts;
}
