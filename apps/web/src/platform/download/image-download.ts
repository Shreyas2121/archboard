import {
  assertControlledSvg,
  imageDimensions,
  imageFileName,
  type ControlledSvg,
  type ImageScale,
} from '@archboard/export';

const IMAGE_OPERATION_TIMEOUT_MS = 30_000;
function check(signal: AbortSignal): void {
  signal.throwIfAborted();
}

function boundedOperation<T>(
  signal: AbortSignal,
  start: (resolve: (value: T) => void, reject: (error: Error) => void) => void,
): Promise<T> {
  check(signal);
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      callback();
    };
    const abort = () =>
      finish(() => reject(new DOMException('Image export cancelled.', 'AbortError')));
    const timer = setTimeout(
      () =>
        finish(() =>
          reject(new Error('Image decoding or encoding timed out. Retry or download SVG/JSON.')),
        ),
      IMAGE_OPERATION_TIMEOUT_MS,
    );
    signal.addEventListener('abort', abort, { once: true });
    try {
      start(
        (value) => finish(() => resolve(value)),
        (error) => finish(() => reject(error)),
      );
    } catch (cause) {
      finish(() => reject(cause));
    }
  });
}

function download(blob: Blob, filename: string, signal: AbortSignal): void {
  check(signal);
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.rel = 'noopener';
    check(signal);
    anchor.click();
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function downloadDiagramImage(
  image: ControlledSvg,
  title: string,
  format: 'svg' | 'png',
  scale: ImageScale,
  signal: AbortSignal,
  downloading: () => void,
): Promise<void> {
  assertControlledSvg(image);
  check(signal);
  const dimensions = imageDimensions(image.width, image.height, format === 'png' ? scale : 1);
  if (format !== 'svg' && format !== 'png') throw new Error('Choose SVG or PNG.');
  const filename = imageFileName(title, format);
  const svgBlob = new Blob([image.svg], { type: 'image/svg+xml;charset=utf-8' });
  if (format === 'svg') {
    downloading();
    download(svgBlob, filename, signal);
    return;
  }
  let url: string | null = null;
  let canvas: HTMLCanvasElement | null = null;
  const decoded = new Image();
  try {
    url = URL.createObjectURL(svgBlob);
    await boundedOperation<void>(signal, (resolve, reject) => {
      decoded.onload = () => resolve();
      decoded.onerror = () =>
        reject(new Error('SVG could not be decoded. Retry or download SVG/JSON.'));
      decoded.src = url ?? '';
    });
    check(signal);
    canvas = document.createElement('canvas');
    canvas.width = dimensions.width;
    canvas.height = dimensions.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('PNG canvas is unavailable. Download SVG/JSON instead.');
    // A new canvas is transparent; controlled SVG supplies background only when selected.
    context.drawImage(decoded, 0, 0, dimensions.width, dimensions.height);
    const target = canvas;
    const png = await boundedOperation<Blob>(signal, (resolve, reject) => {
      target.toBlob(
        (blob) =>
          blob?.type === 'image/png'
            ? resolve(blob)
            : reject(new Error('PNG encoding failed. Retry or download SVG/JSON.')),
        'image/png',
      );
    });
    check(signal);
    downloading();
    download(png, filename, signal);
  } finally {
    decoded.onload = null;
    decoded.onerror = null;
    decoded.removeAttribute('src');
    if (url !== null) URL.revokeObjectURL(url);
    if (canvas) {
      canvas.width = 0;
      canvas.height = 0;
    }
  }
}
