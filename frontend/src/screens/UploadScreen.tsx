import { useCallback, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useI18n } from '../i18n'
import {
  confirmUpload,
  requestPresignedUpload,
  uploadFileToPresignedUrl,
} from '../api/uploadApi'
import {
  addUploadItems,
  getUploadItems,
  nextUploadItemId,
  removeUploadItem,
  updateUploadItem,
  useUploadItems,
  type UploadItem,
} from '../state/uploadStore'
import './UploadScreen.css'

const ACCEPTED_EXTENSIONS = ['mp4', 'mov', 'mkv', 'csv']
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

/** In-flight XHRs keyed by upload item id, so a removed/cancelled item can
 * abort its underlying request instead of uploading bytes nobody wants. */
const abortControllers = new Map<string, AbortController>()

/** Property 3: every attempt (including retries) requests a fresh
 * presigned URL. */
function startUpload(item: UploadItem): void {
  updateUploadItem(item.id, { status: 'uploading', progress: 0, etaSeconds: null })
  const controller = new AbortController()
  abortControllers.set(item.id, controller)
  const startedAt = Date.now()

  requestPresignedUpload(item.file.name)
    .then(({ uploadUrl, key }) =>
      uploadFileToPresignedUrl(
        uploadUrl,
        item.file,
        (percent, loaded, total) => {
          const elapsedSeconds = (Date.now() - startedAt) / 1000
          const bytesPerSecond = elapsedSeconds > 0 ? loaded / elapsedSeconds : 0
          const etaSeconds =
            bytesPerSecond > 0 ? (total - loaded) / bytesPerSecond : null
          updateUploadItem(item.id, { progress: percent, etaSeconds })
        },
        controller.signal,
      ).then(() => confirmUpload(key).then(() => key)),
    )
    .then((key) => {
      updateUploadItem(item.id, {
        status: 'uploaded',
        progress: 100,
        etaSeconds: null,
        key,
      })
    })
    .catch(() => {
      // The item may have already been removed (cancelled) by the user;
      // don't resurrect it as an error in that case.
      if (getUploadItems().some((it) => it.id === item.id)) {
        updateUploadItem(item.id, { status: 'error', etaSeconds: null })
      }
    })
    .finally(() => {
      abortControllers.delete(item.id)
    })
}

function cancelUpload(id: string): void {
  abortControllers.get(id)?.abort()
  abortControllers.delete(id)
  removeUploadItem(id)
}

/** Upload glyph: an upward arrow with two stacked base bars. */
function UploadArrow() {
  return (
    <svg
      className="dropzone__arrow"
      viewBox="0 0 48 50"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M24 3 L44 26 L33 26 L33 33 L15 33 L15 26 L4 26 Z" />
      <rect x="15" y="36" width="18" height="5" rx="2.5" />
      <rect x="15" y="43.5" width="18" height="4.5" rx="2.25" />
    </svg>
  )
}

function RetryIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 12a9 9 0 1 1-2.64-6.36" />
      <path d="M21 3v6h-6" />
    </svg>
  )
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  )
}

export function UploadScreen() {
  const navigate = useNavigate()
  const { t } = useI18n()
  const items = useUploadItems()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [validationMessage, setValidationMessage] = useState<string | null>(
    null,
  )
  const [isDragOver, setIsDragOver] = useState(false)

  const handleAddFilesClick = useCallback(() => {
    fileInputRef.current?.click()
  }, [])

  const handleFilesSelected = useCallback((fileList: FileList | null) => {
    if (!fileList) return
    const files = Array.from(fileList)
    const { accepted, rejectedExtension, rejectedBatchLimit } =
      partitionSelection(files)

    if (rejectedExtension.length > 0) {
      setValidationMessage(
        t('upload.rejectedExtensions', {
          extensions: ACCEPTED_EXTENSIONS.join(', '),
        }),
      )
    } else if (rejectedBatchLimit.length > 0) {
      setValidationMessage(t('upload.batchLimit', { max: MAX_FILES }))
    } else {
      setValidationMessage(null)
    }

    const newItems: UploadItem[] = accepted.map((file) => ({
      id: nextUploadItemId(),
      file,
      key: null,
      status: 'pending',
      progress: 0,
      etaSeconds: null,
    }))
    addUploadItems(newItems)
    newItems.forEach(startUpload)
  }, [t])

  const handleDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault()
      setIsDragOver(false)
      handleFilesSelected(event.dataTransfer.files)
    },
    [handleFilesSelected],
  )

  const handleDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setIsDragOver(true)
  }, [])

  const handleDragLeave = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      // Only clear when the pointer actually leaves the dropzone, not when it
      // moves over a child element.
      if (!event.currentTarget.contains(event.relatedTarget as Node)) {
        setIsDragOver(false)
      }
    },
    [],
  )

  const retry = useCallback((id: string) => {
    const item = getUploadItems().find((it) => it.id === id)
    if (item) startUpload(item)
  }, [])

  const remove = useCallback((id: string) => {
    cancelUpload(id)
  }, [])

  const isUploading = items.some((it) => it.status === 'uploading')
  const canProceed =
    items.length > 0 && items.every((it) => it.status === 'uploaded')

  const dropzoneClass = [
    'dropzone',
    isDragOver ? 'is-dragover' : '',
    isUploading ? 'is-uploading' : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <section className="upload-screen">
      <h1 className="upload-screen__title">{t('upload.title')}</h1>
      <p className="upload-screen__subtitle">{t('upload.subtitle')}</p>

      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept=".mp4,.mov,.mkv,.csv"
        onChange={(event) => {
          handleFilesSelected(event.target.files)
          event.target.value = ''
        }}
        aria-label={t('upload.selectFilesAria')}
        hidden
      />

      <div
        className={dropzoneClass}
        role="button"
        tabIndex={0}
        aria-label={t('upload.dropzoneAria')}
        onClick={handleAddFilesClick}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            handleAddFilesClick()
          }
        }}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragEnter={handleDragOver}
        onDragLeave={handleDragLeave}
      >
        <div className="dropzone__icon-wrap">
          <div className="dropzone__lines" aria-hidden="true">
            <span />
            <span />
            <span />
            <span />
            <span />
          </div>
          <UploadArrow />
        </div>

        <p className="dropzone__prompt">
          <strong>{t('upload.dropPromptStrong')}</strong>
          {t('upload.dropPromptRest')}
        </p>

        <button
          type="button"
          className="browse-btn"
          onClick={(event) => {
            event.stopPropagation()
            handleAddFilesClick()
          }}
        >
          {t('upload.browse')}
        </button>

        <p className="dropzone__hint">
          {t('upload.hint', {
            extensions: ACCEPTED_EXTENSIONS.join(', '),
            max: MAX_FILES,
          })}
        </p>
      </div>

      {validationMessage && (
        <p className="upload-alert" role="alert">
          {validationMessage}
        </p>
      )}

      {items.length > 0 && (
        <ul className="file-list">
          {items.map((item) => {
            const isError = item.status === 'error'
            const isDone = item.status === 'uploaded'
            return (
              <li key={item.id} className="file-card">
                <span className="file-card__name" title={item.file.name}>
                  {item.file.name}
                </span>

                <div className="file-card__actions">
                  <span
                    className={`file-card__status${
                      isDone ? ' is-done' : ''
                    }${isError ? ' is-error' : ''}`}
                  >
                    {isError
                      ? t('upload.statusFailed')
                      : isDone
                        ? t('upload.statusDone')
                        : `${item.progress}%`}
                  </span>

                  {isError && (
                    <button
                      type="button"
                      className="icon-btn"
                      onClick={() => retry(item.id)}
                      aria-label={t('upload.retryAria', { name: item.file.name })}
                      title={t('upload.retry')}
                    >
                      <RetryIcon />
                    </button>
                  )}

                  <button
                    type="button"
                    className="icon-btn"
                    onClick={() => remove(item.id)}
                    aria-label={t('upload.itemActionAria', {
                      action:
                        item.status === 'uploading'
                          ? t('upload.cancel')
                          : t('upload.remove'),
                      name: item.file.name,
                    })}
                    title={
                      item.status === 'uploading'
                        ? t('upload.cancel')
                        : t('upload.remove')
                    }
                  >
                    <CloseIcon />
                  </button>
                </div>

                <div className="file-card__bar-wrap">
                  <div
                    className="progress-track"
                    role="progressbar"
                    aria-valuenow={item.progress}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={t('upload.progressAria', {
                      name: item.file.name,
                    })}
                  >
                    <div
                      className={`progress-fill${isError ? ' is-error' : ''}`}
                      style={{ width: `${isError ? 100 : item.progress}%` }}
                    />
                  </div>
                  <span className="progress-pct">
                    {isError ? '—' : `${item.progress}%`}
                  </span>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      <button
        type="button"
        className="continue-btn"
        disabled={!canProceed}
        onClick={() =>
          navigate('/platforms', {
            state: { sourceKeys: items.map((it) => it.key) },
          })
        }
      >
        {t('upload.continue')}
      </button>
    </section>
  )
}

export default UploadScreen
