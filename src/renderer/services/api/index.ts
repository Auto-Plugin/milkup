// 使用 fetch API 上传图片
// localStorage.setItem('uploadUrl', url.value)
// localStorage.setItem('uploadMethod', requestMethod.value)
// localStorage.setItem('uploadHeaders', headers.value)
// localStorage.setItem('uploadBodyType', bodyType.value)
// localStorage.setItem('uploadFileField', fileField.value)
// localStorage.setItem('uploadResponseUrlPath', responseUrlPath.value)

import autotoast from 'autotoast.js'

async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result
      if (typeof result === 'string') {
        const base64Content = result.includes(',') ? result.split(',')[1] : result
        resolve(base64Content)
      } else {
        reject(new Error('Failed to read file as base64'))
      }
    }
    reader.onerror = () => {
      reject(reader.error || new Error('Failed to read file as base64'))
    }
    reader.readAsDataURL(file)
  })
}

// localStorage.setItem('uploadExtraBody', extraBody.value)
export async function uploadImage(File: File): Promise<string> {
  const url = localStorage.getItem('uploadUrl')
  if (!url) {
    autotoast.show('Upload URL is not set', 'error')
    throw new Error('Upload URL is not set')
  }
  const bodyType = localStorage.getItem('uploadBodyType') || 'multipart/form-data'
  const fileField = localStorage.getItem('uploadFileField') || 'file'
  const extraBodyRaw = localStorage.getItem('uploadExtraBody')
  let parsedExtraBody: Record<string, unknown> = {}
  if (extraBodyRaw) {
    try {
      parsedExtraBody = JSON.parse(extraBodyRaw)
    } catch (e) {
      autotoast.show('Invalid extra body format', 'error')
    }
  }

  let body: BodyInit | null = null
  const method = localStorage.getItem('uploadMethod') || 'POST'
  let headers: Record<string, string> = {}
  const rawHeaders = localStorage.getItem('uploadHeaders')
  if (rawHeaders) {
    try {
      const parsedHeaders = JSON.parse(rawHeaders)
      if (parsedHeaders && typeof parsedHeaders === 'object') {
        headers = parsedHeaders as Record<string, string>
      }
    } catch (e) {
      autotoast.show('Invalid headers JSON format', 'error')
    }
  }

  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === 'content-type' && headers[key]?.toLowerCase().includes('multipart/form-data')) {
      delete headers[key]
    }
  }

  switch (bodyType) {
    case 'multipart/form-data': {
      const formData = new FormData()
      formData.append(fileField, File)
      for (const [key, value] of Object.entries(parsedExtraBody)) {
        formData.append(key, typeof value === 'string' ? value : JSON.stringify(value))
      }
      body = formData
      break
    }
    case 'application/json': {
      const jsonBody: Record<string, unknown> = { ...parsedExtraBody }
      jsonBody[fileField] = await fileToBase64(File)
      body = JSON.stringify(jsonBody)
      const hasContentTypeHeader = Object.keys(headers).some(key => key.toLowerCase() === 'content-type')
      if (!hasContentTypeHeader) {
        headers['Content-Type'] = 'application/json'
      }
      break
    }
    case 'application/x-www-form-urlencoded': {
      const searchParams = new URLSearchParams()
      searchParams.append(fileField, File.name)
      for (const [key, value] of Object.entries(parsedExtraBody)) {
        searchParams.append(key, typeof value === 'string' ? value : JSON.stringify(value))
      }
      autotoast.show('x-www-form-urlencoded does not support file upload. Only file name will be sent.', 'warn')
      body = searchParams
      break
    }
    default:
      body = null
  }
  try {
    const response = await fetch(url, {
      method,
      headers,
      body,
    })
    if (!response.ok) {
      throw new Error(`Upload failed: ${response.statusText}`)
    }
    const data = await response.json()
    const responseUrlPath = localStorage.getItem('uploadResponseUrlPath') || 'data.url'
    const pathParts = responseUrlPath.split('.')
    let result = data
    for (const part of pathParts) {
      if (result && typeof result === 'object' && part in result) {
        result = result[part]
      } else {
        autotoast.show(`Path ${responseUrlPath} not found in response`, 'error')
        return ''
      }
    }
    return result || ''
  } catch (error) {
    autotoast.show(error instanceof Error ? error.message : String(error), 'error')
    throw error
  }
}
