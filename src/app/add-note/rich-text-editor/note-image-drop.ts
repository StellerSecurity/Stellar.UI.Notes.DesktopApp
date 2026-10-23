import { translateText as t } from '../../i18n';
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_BATCH_BYTES = 25 * 1024 * 1024;

interface ImageDropContext {
  generation: () => number | null;
  reportError: (message: string) => void;
}

/** Import local raster images into the note HTML; no upload or filesystem URL. */
export function bindNoteImageDrop(quill: any, surface: HTMLElement, context: ImageDropContext): () => void {
  const root: HTMLElement = quill.root;
  let disposed = false;
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
    if (files.some(file => !IMAGE_TYPES.includes(file.type))) {
      context.reportError(t('uiChooseAPNGJPEGGIFOrWebPImage'));
      return;
    }
    if (files.some(file => file.size > MAX_IMAGE_BYTES) || files.reduce((total, file) => total + file.size, 0) > MAX_BATCH_BYTES) {
      context.reportError(t('uiImagesCanBeUpTo10MBEach'));
      return;
    }
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
  const onDragOver = (event: DragEvent) => {
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
    if (!isFileDrag(event)) return;
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
    void insertFiles({index, length: 0}, Array.from(event.dataTransfer?.files || []));
  };

  surface.addEventListener('dragenter', onDragOver, true);
  surface.addEventListener('dragover', onDragOver, true);
  surface.addEventListener('dragleave', onDragLeave, true);
  surface.addEventListener('drop', onDrop, true);
  return () => {
    disposed = true;
    surface.classList.remove('image-drop-target');
    surface.removeEventListener('dragenter', onDragOver, true);
    surface.removeEventListener('dragover', onDragOver, true);
    surface.removeEventListener('dragleave', onDragLeave, true);
    surface.removeEventListener('drop', onDrop, true);
    uploader.options.handler = previousHandler;
    uploader.options.mimetypes = previousTypes;
    for (const reader of readers) reader.abort();
    readers.clear();
  };
}
