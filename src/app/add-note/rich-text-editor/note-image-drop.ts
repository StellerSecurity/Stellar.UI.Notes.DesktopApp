import { translateText as t } from '../../i18n';
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_BATCH_BYTES = 25 * 1024 * 1024;

export function noteImageFilesError(files: File[]): string {
  if (files.some(file => !IMAGE_TYPES.includes(file.type))) return t('uiChooseAPNGJPEGGIFOrWebPImage');
  if (files.some(file => file.size > MAX_IMAGE_BYTES) || files.reduce((total, file) => total + file.size, 0) > MAX_BATCH_BYTES) return t('uiImagesCanBeUpTo10MBEach');
  return '';
}

export async function readNoteImageHtml(files: File[]): Promise<string> {
  const error = noteImageFilesError(files);
  if (error) throw new Error(error);
  const images = await Promise.all(files.map(file => new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reader.onabort = () => reject(new Error(t('uiTheImageCouldNotBeReadPleaseTry')));
    reader.readAsDataURL(file);
  })));
  return images.map(src => `<p><img src="${src}"></p>`).join('');
}

interface ImageDropContext {
  generation: () => number | null;
  reportError: (message: string) => void;
}

/** Import local raster images into the note HTML; no upload or filesystem URL. */
export function bindNoteImageDrop(quill: any, surface: HTMLElement, context: ImageDropContext): () => void {
  const root: HTMLElement = quill.root;
  let disposed = false;
  let movingImage: {node: HTMLImageElement; generation: number} | null = null;
  const readers = new Set<FileReader>();
  const uploader = quill.getModule('uploader');
  const previousHandler = uploader.options.handler;
  const previousTypes = uploader.options.mimetypes;

  const readImage = (file: File): Promise<string> => new Promise((resolve, reject) => {
    const reader = new FileReader();
    readers.add(reader);
    reader.onload = () => { readers.delete(reader); resolve(String(reader.result)); };
    reader.onerror = reader.onabort = () => { readers.delete(reader); reject(new Error('Image read failed')); };
    reader.readAsDataURL(file);
  });

  const insertFiles = async (range: {index: number; length: number}, files: File[]) => {
    const generation = context.generation();
    if (disposed || generation === null || !quill.isEnabled() || !files.length) return;
    const isCurrent = () => !disposed && context.generation() === generation && quill.isEnabled();
    context.reportError('');
    const error = noteImageFilesError(files);
    if (error) { context.reportError(error); return; }
    try {
      const images = await Promise.all(files.map(readImage));
      if (!isCurrent()) return;
      const index = Math.min(range.index, Math.max(0, quill.getLength() - 1));
      const length = Math.min(range.length, Math.max(0, quill.getLength() - 1 - index));
      quill.history.cutoff();
      quill.updateContents({ops: [
        ...(index ? [{retain: index}] : []),
        ...(length ? [{delete: length}] : []),
        ...images.map(image => ({insert: {image}})),
      ]}, 'user');
      quill.history.cutoff();
      quill.setSelection(index + images.length, 0, 'silent');
    } catch {
      if (isCurrent()) context.reportError(t('uiTheImageCouldNotBeReadPleaseTry'));
    }
  };

  // The existing image picker and image paste use the same guarded insertion.
  uploader.options.mimetypes = [...IMAGE_TYPES];
  uploader.options.handler = (range: {index: number; length: number}, files: File[]) => { void insertFiles(range, files); };

  const isFileDrag = (event: DragEvent) => Array.from(event.dataTransfer?.types || []).includes('Files');
  const isImageMove = () => movingImage !== null && !disposed && quill.isEnabled()
    && movingImage.generation === context.generation() && root.contains(movingImage.node);
  const onDragStart = (event: DragEvent) => {
    movingImage = null;
    const generation = context.generation();
    if (!(event.target instanceof HTMLImageElement) || !root.contains(event.target)) return;
    if (!quill.isEnabled() || generation === null || !event.dataTransfer) { event.preventDefault(); return; }
    movingImage = {node: event.target, generation};
    // Keep the source node locally: never trust an index or HTML from a drag payload.
    event.dataTransfer.setData('application/x-stellar-editor-image', 'move');
    event.dataTransfer.effectAllowed = 'move';
    // Quill's Scroll.handleDragStart cancels every native drag. Keep this
    // validated image drag away from it while allowing the browser to start it.
    event.stopImmediatePropagation();
  };
  const onDragEnd = () => { movingImage = null; surface.classList.remove('image-drop-target'); };
  const onDragOver = (event: DragEvent) => {
    if (movingImage) {
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = isImageMove() ? 'move' : 'none';
      return;
    }
    if (!isFileDrag(event)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = quill.isEnabled() ? 'copy' : 'none';
    if (quill.isEnabled()) surface.classList.add('image-drop-target');
  };
  const onDragLeave = (event: DragEvent) => {
    if (!(event.relatedTarget instanceof Node) || !surface.contains(event.relatedTarget)) surface.classList.remove('image-drop-target');
  };
  const onDrop = (event: DragEvent) => {
    surface.classList.remove('image-drop-target');
    if (!movingImage && !isFileDrag(event)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    // Capture on the whole body surface, including blank space below Quill's
    // current text, and suppress Quill's second drop handler / browser navigation.
    const native = document.caretRangeFromPoint?.(event.clientX, event.clientY);
    let index = Math.max(0, quill.getLength() - 1);
    if (native && root.contains(native.startContainer)) {
      const normalized = quill.selection.normalizeNative(native);
      if (normalized) index = quill.selection.normalizedToRange(normalized).index;
    }
    if (movingImage) {
      const source = movingImage.node;
      const valid = isImageMove();
      movingImage = null;
      if (!valid) return;
      const blot = quill.constructor.find(source);
      if (!blot) return;
      const from = quill.getIndex(blot);
      const image = quill.getContents(from, 1).ops?.[0];
      if (!image?.insert?.image || index === from || index === from + 1) return;
      // One user delta preserves image attributes and makes the move one undo step.
      const ops = index < from
        ? [{retain:index}, image, {retain:from-index}, {delete:1}]
        : [{retain:from}, {delete:1}, {retain:index-from-1}, image];
      quill.history.cutoff();
      quill.updateContents({ops}, 'user');
      quill.history.cutoff();
      quill.setSelection(index < from ? index + 1 : index, 0, 'silent');
      return;
    }
    void insertFiles({index, length: 0}, Array.from(event.dataTransfer?.files || []));
  };

  // Use pointer capture for mouse repositioning. This avoids Chromium's native
  // image/file drag path inside contenteditable while leaving clicks as previews.
  let pointer: {id:number; x:number; y:number; moved:boolean; node:HTMLImageElement} | null = null;
  let suppressClick = false;
  const cancelPointer = () => {
    if (pointer?.node.hasPointerCapture(pointer.id)) pointer.node.releasePointerCapture(pointer.id);
    pointer = null; movingImage = null;
    surface.classList.remove('image-repositioning');
  };
  const onPointerDown = (event: PointerEvent) => {
    suppressClick = false;
    if (event.pointerType !== 'mouse' || event.button !== 0 || !(event.target instanceof HTMLImageElement)
      || !root.contains(event.target) || !quill.isEnabled()) return;
    const generation = context.generation();
    if (generation === null) return;
    movingImage = {node:event.target, generation};
    pointer = {id:event.pointerId, x:event.clientX, y:event.clientY, moved:false, node:event.target};
    event.preventDefault();
    event.target.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: PointerEvent) => {
    if (!pointer || pointer.id !== event.pointerId) return;
    if (!isImageMove()) { cancelPointer(); return; }
    if (Math.hypot(event.clientX-pointer.x,event.clientY-pointer.y) >= 5) {
      pointer.moved = true;
      surface.classList.add('image-repositioning');
    }
  };
  const onPointerUp = (event: PointerEvent) => {
    if (!pointer || pointer.id !== event.pointerId) return;
    suppressClick = pointer.moved;
    const bounds=surface.getBoundingClientRect();
    if (pointer.moved && event.clientX>=bounds.left && event.clientX<=bounds.right
      && event.clientY>=bounds.top && event.clientY<=bounds.bottom) {
      onDrop(new DragEvent('drop',{clientX:event.clientX,clientY:event.clientY}));
    }
    cancelPointer();
  };
  const onClick = (event: MouseEvent) => {
    if (suppressClick) { suppressClick=false; event.preventDefault(); event.stopImmediatePropagation(); }
  };
  const onKeyDown = (event: KeyboardEvent) => { if (event.key==='Escape') cancelPointer(); };

  surface.addEventListener('pointerdown',onPointerDown,true);
  surface.addEventListener('pointermove',onPointerMove,true);
  surface.addEventListener('pointerup',onPointerUp,true);
  surface.addEventListener('pointercancel',cancelPointer,true);
  surface.addEventListener('lostpointercapture',cancelPointer,true);
  surface.addEventListener('click',onClick,true);
  window.addEventListener('keydown',onKeyDown,true);
  window.addEventListener('blur',cancelPointer);
  surface.addEventListener('dragstart', onDragStart, true);
  surface.addEventListener('dragend', onDragEnd, true);
  surface.addEventListener('dragenter', onDragOver, true);
  surface.addEventListener('dragover', onDragOver, true);
  surface.addEventListener('dragleave', onDragLeave, true);
  surface.addEventListener('drop', onDrop, true);
  return () => {
    disposed = true;
    cancelPointer();
    movingImage = null;
    surface.classList.remove('image-drop-target');
    surface.removeEventListener('dragenter', onDragOver, true);
    surface.removeEventListener('dragover', onDragOver, true);
    surface.removeEventListener('dragleave', onDragLeave, true);
    surface.removeEventListener('drop', onDrop, true);
    surface.removeEventListener('dragstart', onDragStart, true);
    surface.removeEventListener('dragend', onDragEnd, true);
    surface.removeEventListener('pointerdown',onPointerDown,true);
    surface.removeEventListener('pointermove',onPointerMove,true);
    surface.removeEventListener('pointerup',onPointerUp,true);
    surface.removeEventListener('pointercancel',cancelPointer,true);
    surface.removeEventListener('lostpointercapture',cancelPointer,true);
    surface.removeEventListener('click',onClick,true);
    window.removeEventListener('keydown',onKeyDown,true);
    window.removeEventListener('blur',cancelPointer);
    uploader.options.handler = previousHandler;
    uploader.options.mimetypes = previousTypes;
    for (const reader of readers) reader.abort();
    readers.clear();
  };
}
