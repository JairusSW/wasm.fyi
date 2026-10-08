export const localDate=(date=new Date())=>`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
export function followingDate(value:string){const date=new Date(value+'T12:00:00');date.setDate(date.getDate()+1);return localDate(date)}
export function selectableDate(date:string,today:string,min='',max='',captures?:readonly string[]){
 return /^\d{4}-\d{2}-\d{2}$/.test(date)&&localDate(new Date(date+'T12:00:00'))===date&&date<=today&&(!min||date>=min)&&(!max||date<=max)&&(captures===undefined||captures.includes(date));
}
