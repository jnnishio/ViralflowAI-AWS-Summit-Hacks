import { useCallback, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  confirmUpload,
  requestPresignedUpload,
  uploadFileToPresignedUrl,
} from '../api/uploadApi'
import {
  addUploadItems,
  getUploadItems,
  nextUploadItemId,
  updateUploadItem,
  useUploadItems,
  type UploadItem,
} from '../state/uploadStore'

const ACCEPTED_EXTENSIONS = ['mp4', 'mov', 'mkv']
const MAX_FILES = 10

function extensionOf(filename: string): string {
  const idx = filename.lastIndexOf('.')
  return idx === -1 ? '' : filename.slice(idx + 1).toLowerCase()
}

/** Property 4: extension validation is case-insensitive and total. */
function hasAcceptedExtension(filename: string): boolean {
  return ACCEPTED_EXTENSIONS.includes(extensionOf(filename))
}

/** Property 5: accepted subset is exactly min(N, 10), in selection order. */
function partitionSelection(files: File[]): {
  accepted: File[]
  rejectedExtension: File[]
  rejectedBatchLimit: File[]
} {
  const extensionOk: File[] = []
  const rejectedExtension: File[] = []
  for (const file of files) {
    if (hasAcceptedExtension(file.name)) {
      extensionOk.push(file)
    } else {
      rejectedExtension.push(file)
    }
  }
  return {
    accepted: extensionOk.slice(0, MAX_FILES),
    rejectedExtension,
    rejectedBatchLimit: extensionOk.slice(MAX_FILES),
  }
}

/** Property 3: every attempt (including retries) requests a fresh
 * presigned URL. */
function startUpload(item: UploadItem): void {
  updateUploadItem(item.id, { status: 'uploading', progress: 0 })
  requestPresignedUpload(item.file.name)
    .then(({ uploadUrl, key }) =>
      uploadFileToPresignedUrl(uploadUrl, item.file, (percent) => {
        updateUploadItem(item.id, { progress: percent })
      }).then(() => confirmUpload(key).then(() => key)),
    )
    .then((key) => {
      updateUploadItem(item.id, { status: 'uploaded', progress: 100, key })
    })
    .catch(() => {
      updateUploadItem(item.id, { status: 'error' })
    })
}

export function UploadScreen() {
  const navigate = useNavigate()
  const items = useUploadItems()
  const [validationMessage, setValidationMessage] = useState<string | null>(
    null,
  )

  const handleFilesSelected = useCallback((fileList: FileList | null) => {
    if (!fileList) return
    const files = Array.from(fileList)
    const { accepted, rejectedExtension, rejectedBatchLimit } =
      partitionSelection(files)

    if (rejectedExtension.length > 0) {
      setValidationMessage(
        `Some files were rejected. Accepted file extensions: ${ACCEPTED_EXTENSIONS.join(', ')}.`,
      )
    } else if (rejectedBatchLimit.length > 0) {
      setValidationMessage(
        `You can upload at most ${MAX_FILES} files per batch. Extra files were not added.`,
      )
    } else {
      setValidationMessage(null)
    }

    const newItems: UploadItem[] = accepted.map((file) => ({
      id: nextUploadItemId(),
      file,
      key: null,
      status: 'pending',
      progress: 0,
    }))
    addUploadItems(newItems)
    newItems.forEach(startUpload)
  }, [])

  const retry = useCallback((id: string) => {
    const item = getUploadItems().find((it) => it.id === id)
    if (item) startUpload(item)
  }, [])

  const canProceed =
    items.length > 0 && items.every((it) => it.status === 'uploaded')

  return (
    <section>
      <h1>Upload</h1>
      <p>Upload one or more VOD files to generate highlights.</p>

      <input
        type="file"
        multiple
        accept=".mp4,.mov,.mkv"
        onChange={(event) => handleFilesSelected(event.target.files)}
        aria-label="Select VOD files"
      />

      {validationMessage && <p role="alert">{validationMessage}</p>}

      <ul>
        {items.map((item) => (
          <li key={item.id}>
            <span>{item.file.name}</span>{' '}
            {item.status === 'error' ? (
              <>
                <span role="alert">Upload failed</span>{' '}
                <button type="button" onClick={() => retry(item.id)}>
                  Retry
                </button>
              </>
            ) : (
              <span>
                {item.status === 'uploaded' ? 'Uploaded' : `${item.progress}%`}
              </span>
            )}
          </li>
        ))}
      </ul>

      <button
        type="button"
        disabled={!canProceed}
        onClick={() =>
          navigate('/platforms', {
            state: { sourceKeys: items.map((it) => it.key) },
          })
        }
      >
        Continue
      </button>
    </section>
  )
}

export default UploadScreen
