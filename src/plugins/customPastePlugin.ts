import type { Uploader } from '@milkdown/kit/plugin/upload'
import type { Node, Schema } from '@milkdown/kit/prose/model'
import { uploadImage } from '@/api'

export const uploader: Uploader = async (files, schema) => {
  const images: File[] = []
  const pasteMethod = localStorage.getItem('pasteMethod') as 'local' | 'base64' | 'remote'
  for (let i = 0; i < files.length; i++) {
    const file = files.item(i)
    if (!file) {
      continue
    }

    // You can handle whatever the file type you want, we handle image here.
    if (!file.type.includes('image')) {
      continue
    }

    images.push(file)
  }
  const nodes: Node[] = []
  for (const image of images) {
    if (pasteMethod === 'base64') {
      const base64 = await turnToBase64(image)
      nodes.push(schema.nodes.image.createAndFill({ src: base64, alt: image.name }) as Node)
      continue
    }
    if (pasteMethod === 'remote') {
      try {
        await upload(image, nodes, schema)
      } catch (error) {
        console.error('Image upload failed:', error)
        continue
      }
    }
    if (pasteMethod === 'local') {
      try {
        await local(image, nodes, schema)
      } catch (error) {
        console.error('Local image handling failed:', error)
        continue
      }
    }
  }
  return nodes
}
function turnToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = error => reject(error)
    reader.readAsDataURL(file)
  })
}
async function upload(image: File, nodes: Node[], schema: Schema<any, any>) {
  const src = await uploadImage(image)
  nodes.push(schema.nodes.image.createAndFill({ src, alt: image.name }) as Node)
}
async function local(image: File, nodes: Node[], schema: Schema<any, any>) {
  const filePath = await window.electronAPI.getFilePathInClipboard()
  if (filePath) {
    nodes.push(schema.nodes.image.createAndFill({ src: filePath, alt: image.name }) as Node)
  } else {
    const arrayBuffer = await image.arrayBuffer()
    const buffer = new Uint8Array(arrayBuffer)
    // Convert Uint8Array to ArrayBuffer to satisfy the ArrayBufferLike parameter
    const tempPath = await window.electronAPI.writeTempImage(buffer, localStorage.getItem('localImagePath') || '/temp')
    nodes.push(schema.nodes.image.createAndFill({ src: tempPath, alt: image.name }) as Node)
  }
}
