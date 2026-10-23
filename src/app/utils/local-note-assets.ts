export const LOCAL_NOTES_ENVELOPE = 'stellarLocalNotes';
export const localAssets = new Map<string,{value:string;passwordProtected:boolean}>();
type Decrypt = (value:string,password:string)=>string;
export function expandLocalAssets(value:any,password:string,decrypt?:Decrypt):any {
  if(typeof value==='string')return value.replace(/stellar-local-asset:([a-f0-9]{64})/g,(_,id)=>{
    const asset=localAssets.get(id);if(!asset)throw Error('Missing local attachment');
    if(asset.passwordProtected && !decrypt)throw Error('Local attachment is locked');
    return asset.passwordProtected?decrypt!(asset.value,password):asset.value;
  });
  if(Array.isArray(value))return value.map(item=>expandLocalAssets(item,password,decrypt));
  if(value && typeof value==='object') {const result:any={};for(const [key,item] of Object.entries(value))result[key]=expandLocalAssets(item,password,decrypt);return result;}
  return value;
}
