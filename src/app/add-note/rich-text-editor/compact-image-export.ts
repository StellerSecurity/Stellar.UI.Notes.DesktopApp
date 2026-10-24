/** Keep unchanged embedded raster bytes out of repeated HTML parsing. Only the
 * detached export is shortened; the editor and saved wire format retain images.
 * All markup still passes through the normal HTML sanitizer. Restored values
 * contain only a validated raster data URL, never HTML/attributes or SVG.
 */
export class CompactImageExport {
  private sources = new WeakMap<HTMLImageElement, {source:string; valid:boolean}>();

  prepare(root: HTMLElement): {root:HTMLElement; restore:(html:string)=>string} {
    const images = Array.from(root.querySelectorAll('img'));
    if (!images.length) return {root,restore:html=>html};
    const copy = root.cloneNode(true) as HTMLElement;
    const copies = Array.from(copy.querySelectorAll('img'));
    const prefix = 'data:image/png;base64,STELLAR' + crypto.randomUUID().replace(/-/g,'');
    const replacements = new Map<string,string>();
    images.forEach((image,index)=>{
      const source=image.getAttribute('src') || '';
      let cached=this.sources.get(image);
      if (!cached || cached.source!==source) {
        cached={source,valid:/^data:image\/(?:png|jpe?g|gif|webp);base64,[a-z0-9+/\r\n]+=*$/i.test(source)};
        this.sources.set(image,cached);
      }
      if (!cached.valid) return;
      const token=prefix+index;
      copies[index].setAttribute('src',token);
      replacements.set(token,source);
    });
    return {root:copy,restore:html=>html.replace(/src="([^"]*)"/g,(attribute,source)=>
      replacements.has(source) ? `src="${replacements.get(source)}"` : attribute)};
  }
}
