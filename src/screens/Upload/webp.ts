import { MAX_IMAGE_RENDER_DIMENSION } from './limits'

export function replaceExtension(filename: string, extension: string): string {
  const dot = filename.lastIndexOf('.')
  if (dot <= 0) {
    return `${filename}${extension}`
  }
  return `${filename.slice(0, dot)}${extension}`
}

export function canvasToBlob(
  canvas: HTMLCanvasElement | OffscreenCanvas,
  type: string,
  quality: number,
): Promise<Blob> {
  if ('convertToBlob' in canvas) {
    return canvas.convertToBlob({ type, quality })
  }

  return new Promise((resolve, reject) => {
    ;(canvas as HTMLCanvasElement).toBlob((blob) => {
      if (!blob) {
        reject(new Error('Failed to convert image to WebP'))
        return
      }
      resolve(blob)
    }, type, quality)
  })
}

export async function convertImageFileToWebp(file: File, quality = 0.9): Promise<File> {
  if (file.type === 'image/webp' || file.name.toLowerCase().endsWith('.webp')) {
    return file
  }

  if (typeof createImageBitmap !== 'function') {
    throw new Error('WebP conversion is not supported in this browser')
  }

  const bitmap = await createImageBitmap(file)
  try {
    const scale = Math.min(
      MAX_IMAGE_RENDER_DIMENSION / bitmap.width,
      MAX_IMAGE_RENDER_DIMENSION / bitmap.height,
      1,
    )
    const width = Math.max(1, Math.round(bitmap.width * scale))
    const height = Math.max(1, Math.round(bitmap.height * scale))
    const canvas: HTMLCanvasElement | OffscreenCanvas =
      typeof OffscreenCanvas !== 'undefined'
        ? new OffscreenCanvas(width, height)
        : Object.assign(document.createElement('canvas'), {
            width,
            height,
          })

    if ('width' in canvas) {
      canvas.width = width
    }
    if ('height' in canvas) {
      canvas.height = height
    }

    const context = canvas.getContext('2d') as
      | CanvasRenderingContext2D
      | OffscreenCanvasRenderingContext2D
      | null
    if (!context) {
      throw new Error('Canvas 2D context unavailable')
    }

    context.drawImage(bitmap, 0, 0, width, height)
    const blob = await canvasToBlob(canvas, 'image/webp', quality)
    const webpName = replaceExtension(file.name, '.webp')
    return new File([blob], webpName, { type: 'image/webp' })
  } finally {
    bitmap.close()
  }
}
