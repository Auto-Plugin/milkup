// 使用 fetch API 上传图片
// localStorage.setItem('uploadUrl', url.value)
// localStorage.setItem('uploadMethod', requestMethod.value)
// localStorage.setItem('uploadHeaders', headers.value)
// localStorage.setItem('uploadBodyType', bodyType.value)
// localStorage.setItem('uploadFileField', fileField.value)
// localStorage.setItem('uploadResponseUrlPath', responseUrlPath.value)

import autotoast from 'autotoast.js'

// localStorage.setItem('uploadExtraBody', extraBody.value)
export async function uploadImage(File: File): Promise<string> {
  const url = localStorage.getItem('uploadUrl')
  if (!url) {
    autotoast.show('Upload URL is not set', 'error')
    throw new Error('Upload URL is not set')
  }
  let body: any = {}
  switch (localStorage.getItem('uploadBodyType')) {
    case 'multipart/form-data':
      body = new FormData()
      body.append(localStorage.getItem('uploadFileField') || 'file', File)
      break
    case 'application/json':
      body = JSON.parse(localStorage.getItem('uploadExtraBody') || '{}')
      body[localStorage.getItem('uploadFileField') || 'file'] = File
      break
    case 'application/x-www-form-urlencoded':
      body = new URLSearchParams()
      body.append(localStorage.getItem('uploadFileField') || 'file', File)
      break
  }
  const extraBody = localStorage.getItem('uploadExtraBody')
  if (extraBody) {
    try {
      const extraFields = JSON.parse(extraBody)
      for (const key in extraFields) {
        body[key] = extraFields[key]
      }
    } catch (e) {
      autotoast.show('Invalid extra body format', 'error')
    }
  }
  try {
    const response = await fetch(url, {
      method: localStorage.getItem('uploadMethod') || 'POST',
      headers: JSON.parse(localStorage.getItem('uploadHeaders') || '{}'),
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
    autotoast.show(`${error}`, 'error')
    throw error
  }
}
