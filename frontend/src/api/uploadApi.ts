import { http } from './http'

export interface PresignResponse {
  uploadUrl: string
  key: string
  jobDraftId: string
  expiresIn: number
}

export interface ConfirmResponse {
  confirmed: true
}

/** POST /uploads/presign (Req 1.1, 1.2, 1.3). */
export function requestPresignedUpload(
  filename: string,
  jobDraftId?: string,
): Promise<PresignResponse> {
  return http.post<PresignResponse>('/uploads/presign', {
    filename,
    jobDraftId,
  })
}

/**
 * PUT the file bytes directly to Raw_Bucket via the presigned URL
 * (Req 1.4) with progress reporting for Req 1.5, via XHR since fetch has
 * no upload-progress event.
 */
export function uploadFileToPresignedUrl(
  uploadUrl: string,
  file: File,
  onProgress: (percent: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', uploadUrl)
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        onProgress(Math.round((event.loaded / event.total) * 100))
      }
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve()
      } else {
        reject(new Error(`upload failed with status ${xhr.status}`))
      }
    }
    xhr.onerror = () => reject(new Error('upload failed (network error)'))
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream')
    xhr.send(file)
  })
}

/** POST /uploads/confirm (Req 4.7 support). */
export function confirmUpload(key: string): Promise<ConfirmResponse> {
  return http.post<ConfirmResponse>('/uploads/confirm', { key })
}
