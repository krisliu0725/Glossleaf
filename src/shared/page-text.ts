import type { TextRun } from './m4'
interface Fragment { str:string; hasEOL:boolean; transform:number[]; width:number }
/** Join PDF fragments using actual spacing; never insert gaps between adjacent CJK glyphs. */
export function pageText(items: Fragment[]): {text:string;runs:TextRun[]} {
 let text='',previous:Fragment|null=null;const runs:TextRun[]=[]
 for(const item of items) {
  if(previous && text && item.str) {
   const m=previous.transform,angle=Math.atan2(m[1],m[0]),endX=m[4]+Math.cos(angle)*previous.width,endY=m[5]+Math.sin(angle)*previous.width
   const distance=Math.hypot(item.transform[4]-endX,item.transform[5]-endY),font=Math.hypot(m[2],m[3])
   const cjk=/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]$/u.test(previous.str)&&/^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(item.str)
   if(previous.hasEOL)text+='\n'
   else if(!/\s$/.test(text)&&!/^\s/.test(item.str)&&!cjk&&distance>font*.18)text+=' '
  }
  const start=text.length;text+=item.str
  const m=item.transform,fs=Math.hypot(m[2],m[3]),angle=Math.atan2(m[1],m[0]),dx=Math.cos(angle)*item.width,dy=Math.sin(angle)*item.width,hx=-Math.sin(angle)*fs,hy=Math.cos(angle)*fs
  const xs=[m[4],m[4]+dx,m[4]+hx,m[4]+dx+hx],ys=[m[5],m[5]+dy,m[5]+hy,m[5]+dy+hy]
  if(item.str)runs.push({start,end:text.length,rect:[Math.min(...xs),Math.min(...ys),Math.max(...xs),Math.max(...ys)]})
  previous=item
 }
 return {text,runs}
}
