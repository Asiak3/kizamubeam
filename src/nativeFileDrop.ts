// Bridge native OS file drops back into the existing DOM import handlers.
// Only explicit native file paths are read; text/URL drags never trigger a read.
export interface NativeFileDrop { type: string; paths?: string[]; position?: { x: number; y: number } }
export interface NativeDropServices {
  subscribe: (receive: (event: NativeFileDrop) => void) => Promise<() => void>;
  read: (path: string) => Promise<ArrayBuffer>;
  scaleFactor: () => Promise<number>;
  captureContext: () => () => boolean;
  deliver: (files: { name: string; bytes: ArrayBuffer }[], x: number, y: number) => void;
  error: (error: unknown) => void;
}

export function dispatchNativeFiles(files: { name: string; bytes: ArrayBuffer }[], x: number, y: number, doc: Document = document): void {
  const target = doc.elementFromPoint(x, y);
  if (!target) return;
  const dataTransfer = new DataTransfer();
  files.forEach(file => dataTransfer.items.add(new File([file.bytes], file.name)));
  target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer, clientX: x, clientY: y }));
}

export function installDomFileDrop(stage: HTMLElement, receive: (files: File[]) => Promise<void>, error: (error: unknown) => void): () => void {
  const over = (event: DragEvent) => {
    if (!event.dataTransfer?.types.includes('Files')) return;
    event.preventDefault(); event.dataTransfer.dropEffect = 'copy';
  };
  const drop = (event: DragEvent) => {
    const files = [...(event.dataTransfer?.files ?? [])];
    if (!files.length) return;
    event.preventDefault(); void receive(files).catch(error);
  };
  stage.addEventListener('dragover', over); stage.addEventListener('drop', drop);
  return () => { stage.removeEventListener('dragover', over); stage.removeEventListener('drop', drop); };
}

export function installNativeFileDrop(services: NativeDropServices): () => void {
  let disposed = false, unlisten: (() => void) | undefined;
  let queue = Promise.resolve();
  const receive = (event: NativeFileDrop) => {
    if (disposed || event.type !== 'drop' || !event.paths?.length || !event.position) return;
    const paths = [...new Set(event.paths)], position = { ...event.position }, current = services.captureContext();
    queue = queue.then(async () => {
      if (disposed || !current()) return;
      if (paths.length > 100 || paths.some(p => !p || p.includes('\0'))) throw new Error('file-drop-limit');
      const scale = await services.scaleFactor();
      if (!Number.isFinite(scale) || scale <= 0 || !Number.isFinite(position.x) || !Number.isFinite(position.y)) throw new Error('file-drop-position');
      const files: { name: string; bytes: ArrayBuffer }[] = [];
      let size = 0;
      for (const path of paths) {
        const bytes = await services.read(path); size += bytes.byteLength;
        if (size > 256 * 1024 * 1024) throw new Error('file-drop-limit');
        if (disposed || !current()) return;
        files.push({ name: path.split(/[\\/]/).pop() || path, bytes });
      }
      if (!disposed && current()) services.deliver(files, position.x / scale, position.y / scale);
    }).catch(error => { if (!disposed) services.error(error); });
  };
  services.subscribe(receive).then(dispose => { if (disposed) dispose(); else unlisten = dispose; }).catch(error => { if (!disposed) services.error(error); });
  return () => { disposed = true; unlisten?.(); };
}
