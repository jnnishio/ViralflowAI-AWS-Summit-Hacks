/**
 * App-wide translation strings. Traditional Chinese (`zh-Hant`) is the default
 * language; English (`en`) is the switchable alternative. Every user-facing
 * string from the launch screen up through the highlights & compilation pages
 * lives here so screens/components stay free of hardcoded copy.
 *
 * Interpolation: use `{name}` placeholders and pass values as the second
 * argument to `t`, e.g. `t('upload.progressAria', { name })`.
 */

export type Language = 'zh-Hant' | 'en'

export const LANGUAGES: Language[] = ['zh-Hant', 'en']

export const DEFAULT_LANGUAGE: Language = 'zh-Hant'

/** Short label shown on the language toggle for each language. */
export const LANGUAGE_LABELS: Record<Language, string> = {
  'zh-Hant': '繁體中文',
  en: 'English',
}

/** The flat key set. `en` and `zh-Hant` must both define every key. */
export interface TranslationSchema {
  // Language toggle
  'lang.toggleAria': string
  'lang.switchTo': string

  // Upload screen
  'upload.title': string
  'upload.subtitle': string
  'upload.selectFilesAria': string
  'upload.dropzoneAria': string
  'upload.dropPromptStrong': string
  'upload.dropPromptRest': string
  'upload.browse': string
  'upload.hint': string
  'upload.rejectedExtensions': string
  'upload.batchLimit': string
  'upload.statusFailed': string
  'upload.statusDone': string
  'upload.retry': string
  'upload.retryAria': string
  'upload.cancel': string
  'upload.remove': string
  'upload.itemActionAria': string
  'upload.progressAria': string
  'upload.continue': string

  // Platform select screen
  'platforms.title': string
  'platforms.subtitle': string
  'platforms.legend': string
  'platforms.selectAtLeastOne': string
  'platforms.startError': string
  'platforms.start': string

  // Processing screen
  'processing.title': string
  'processing.subtitle': string
  'processing.failed': string
  'processing.starting': string
  'processing.reconnecting': string
  'processing.phase.prepare': string
  'processing.phase.transcribe': string
  'processing.phase.visual': string
  'processing.phase.audio': string
  'processing.phase.chat': string
  'processing.phase.score': string
  'processing.phase.render': string

  // Highlights screen
  'highlights.title': string
  'highlights.subtitle': string
  'highlights.refreshError': string
  'highlights.failed': string
  'highlights.inProgress': string
  'highlights.empty': string

  // Sort control
  'sort.label': string
  'sort.groupAria': string
  'sort.highToLow': string
  'sort.lowToHigh': string
  'sort.highToLowAria': string
  'sort.lowToHighAria': string

  // Compilation mode toggle
  'compToggle.label': string

  // Stories carousel
  'carousel.default': string
  'carousel.suggested': string
  'carousel.prev': string
  'carousel.next': string
  'carousel.positionAria': string
  'carousel.countAria': string
  'carousel.viewAria': string
  'carousel.goToAria': string

  // Gallery view
  'gallery.noReels': string

  // Score details
  'score.title': string
  'score.close': string
  'score.dialogAria': string
  'score.viralityAria': string
  'factor.chat': string
  'factor.audio': string
  'factor.visual': string
  'factor.speech': string

  // Clip card
  'clip.removeAria': string
  'clip.removeTitle': string
  'clip.copyTitle': string
  'clip.copied': string
  'clip.copy': string
  'clip.scoreDetails': string
  'clip.openEditor': string

  // Compilation section
  'comp.reelAria': string
  'comp.clipOne': string
  'comp.clipMany': string
  'comp.addClipAria': string
  'comp.addClip': string

  // Compile reel button
  'compile.openTitle': string
  'compile.open': string
  'compile.compiling': string
  'compile.compileTitle': string
  'compile.compile': string
  'compile.retry': string
  'compile.failed': string
}

const en: TranslationSchema = {
  'lang.toggleAria': 'Change language',
  'lang.switchTo': 'Switch to {lang}',

  'upload.title': 'Upload',
  'upload.subtitle': 'Upload one or more VOD files to generate highlights.',
  'upload.selectFilesAria': 'Select VOD and Chat Log files',
  'upload.dropzoneAria': 'Drag and drop files here, or browse to select files',
  'upload.dropPromptStrong': 'Drag & drop',
  'upload.dropPromptRest': ' your files here',
  'upload.browse': 'Browse files',
  'upload.hint': 'Accepted: {extensions} · up to {max} files',
  'upload.rejectedExtensions':
    'Some files were rejected. Accepted file extensions: {extensions}.',
  'upload.batchLimit':
    'You can upload at most {max} files per batch. Extra files were not added.',
  'upload.statusFailed': 'Failed',
  'upload.statusDone': 'Done',
  'upload.retry': 'Retry',
  'upload.retryAria': 'Retry upload of {name}',
  'upload.cancel': 'Cancel',
  'upload.remove': 'Remove',
  'upload.itemActionAria': '{action} {name}',
  'upload.progressAria': 'Upload progress for {name}',
  'upload.continue': 'Continue',

  'platforms.title': 'Select Platforms',
  'platforms.subtitle': 'Choose which platforms your highlights are intended for.',
  'platforms.legend': 'Target platforms',
  'platforms.selectAtLeastOne': 'Select at least one target platform to continue.',
  'platforms.startError': 'Could not start the job. Please try again.',
  'platforms.start': 'Start processing',

  'processing.title': 'Processing',
  'processing.subtitle': 'Your VOD is being analyzed.',
  'processing.failed': 'Processing failed. Please try again.',
  'processing.starting': 'Starting pipeline…',
  'processing.reconnecting': 'Reconnecting… checking status every 5 seconds.',
  'processing.phase.prepare': 'Preparing video',
  'processing.phase.transcribe': 'Transcribing speech',
  'processing.phase.visual': 'Analyzing video',
  'processing.phase.audio': 'Analyzing audio',
  'processing.phase.chat': 'Analyzing chat',
  'processing.phase.score': 'Scoring & selecting highlights',
  'processing.phase.render': 'Rendering & finalizing',

  'highlights.title': 'Highlights',
  'highlights.subtitle': 'Your top viral moments, ranked and ready to share.',
  'highlights.refreshError':
    'Could not refresh job status. Showing last known data.',
  'highlights.failed': 'Processing failed.',
  'highlights.inProgress': 'Processing is still in progress…',
  'highlights.empty': 'No highlights were found for this job.',

  'sort.label': 'Sort by Score',
  'sort.groupAria': 'Sort by score',
  'sort.highToLow': 'High to low',
  'sort.lowToHigh': 'Low to high',
  'sort.highToLowAria': 'Sort by score, high to low',
  'sort.lowToHighAria': 'Sort by score, low to high',

  'compToggle.label': 'Compilation reels',

  'carousel.default': 'Highlights',
  'carousel.suggested': 'Suggested highlights',
  'carousel.prev': 'Previous highlight',
  'carousel.next': 'Next highlight',
  'carousel.positionAria': 'Highlight position',
  'carousel.countAria': 'Highlight {current} of {total}',
  'carousel.viewAria': 'View highlight {index}',
  'carousel.goToAria': 'Go to highlight {index}',

  'gallery.noReels': 'No compilation reels were suggested for these clips.',

  'score.title': 'Score details',
  'score.close': 'Close',
  'score.dialogAria': 'Score details for {title}',
  'score.viralityAria': 'Virality score {score} out of 100',
  'factor.chat': 'chat',
  'factor.audio': 'audio',
  'factor.visual': 'visual',
  'factor.speech': 'speech',

  'clip.removeAria': 'Remove from compilation',
  'clip.removeTitle': 'Remove from this reel',
  'clip.copyTitle': 'Copy title + description + hashtags',
  'clip.copied': 'Copied ✓',
  'clip.copy': 'Copy',
  'clip.scoreDetails': 'Score details',
  'clip.openEditor': 'Open in Editor →',

  'comp.reelAria': 'Compilation reel: {title}',
  'comp.clipOne': 'clip',
  'comp.clipMany': 'clips',
  'comp.addClipAria': 'Add clip to this reel',
  'comp.addClip': 'Add clip',

  'compile.openTitle': 'Open the compiled reel in the editor',
  'compile.open': 'Open compilation in editor',
  'compile.compiling': 'Compiling…',
  'compile.compileTitle': 'Auto-edit this reel into one compilation video',
  'compile.compile': 'Compile this reel',
  'compile.retry': 'Retry compile',
  'compile.failed': 'Compilation failed',
}

const zhHant: TranslationSchema = {
  'lang.toggleAria': '切換語言',
  'lang.switchTo': '切換至{lang}',

  'upload.title': '上傳',
  'upload.subtitle': '上傳一個或多個 VOD 檔案以產生精華片段。',
  'upload.selectFilesAria': '選擇 VOD 與聊天紀錄檔案',
  'upload.dropzoneAria': '將檔案拖放到此處，或瀏覽以選擇檔案',
  'upload.dropPromptStrong': '拖放',
  'upload.dropPromptRest': '您的檔案到此處',
  'upload.browse': '瀏覽檔案',
  'upload.hint': '可接受格式：{extensions} · 最多 {max} 個檔案',
  'upload.rejectedExtensions': '部分檔案已被拒絕。可接受的副檔名：{extensions}。',
  'upload.batchLimit': '每批次最多可上傳 {max} 個檔案，多餘的檔案未加入。',
  'upload.statusFailed': '失敗',
  'upload.statusDone': '完成',
  'upload.retry': '重試',
  'upload.retryAria': '重試上傳 {name}',
  'upload.cancel': '取消',
  'upload.remove': '移除',
  'upload.itemActionAria': '{action} {name}',
  'upload.progressAria': '{name} 的上傳進度',
  'upload.continue': '繼續',

  'platforms.title': '選擇平台',
  'platforms.subtitle': '選擇您的精華片段預計要發佈的平台。',
  'platforms.legend': '目標平台',
  'platforms.selectAtLeastOne': '請至少選擇一個目標平台以繼續。',
  'platforms.startError': '無法啟動工作，請再試一次。',
  'platforms.start': '開始處理',

  'processing.title': '處理中',
  'processing.subtitle': '正在分析您的 VOD。',
  'processing.failed': '處理失敗，請再試一次。',
  'processing.starting': '正在啟動處理流程…',
  'processing.reconnecting': '重新連線中…每 5 秒檢查一次狀態。',
  'processing.phase.prepare': '準備影片中',
  'processing.phase.transcribe': '轉錄語音中',
  'processing.phase.visual': '分析影像中',
  'processing.phase.audio': '分析音訊中',
  'processing.phase.chat': '分析聊天中',
  'processing.phase.score': '評分並挑選精華片段',
  'processing.phase.render': '算圖與完稿中',

  'highlights.title': '精華片段',
  'highlights.subtitle': '您最具傳播潛力的精彩時刻，已排序並可立即分享。',
  'highlights.refreshError': '無法重新整理工作狀態，顯示最後已知資料。',
  'highlights.failed': '處理失敗。',
  'highlights.inProgress': '仍在處理中…',
  'highlights.empty': '此工作找不到任何精華片段。',

  'sort.label': '依分數排序',
  'sort.groupAria': '依分數排序',
  'sort.highToLow': '由高到低',
  'sort.lowToHigh': '由低到高',
  'sort.highToLowAria': '依分數排序，由高到低',
  'sort.lowToHighAria': '依分數排序，由低到高',

  'compToggle.label': '精華合輯',

  'carousel.default': '精華片段',
  'carousel.suggested': '推薦精華片段',
  'carousel.prev': '上一個精華片段',
  'carousel.next': '下一個精華片段',
  'carousel.positionAria': '精華片段位置',
  'carousel.countAria': '第 {current} 個，共 {total} 個精華片段',
  'carousel.viewAria': '檢視第 {index} 個精華片段',
  'carousel.goToAria': '前往第 {index} 個精華片段',

  'gallery.noReels': '沒有為這些片段建議任何精華合輯。',

  'score.title': '分數詳情',
  'score.close': '關閉',
  'score.dialogAria': '{title} 的分數詳情',
  'score.viralityAria': '傳播分數 {score}，滿分 100',
  'factor.chat': '聊天',
  'factor.audio': '音訊',
  'factor.visual': '影像',
  'factor.speech': '語音',

  'clip.removeAria': '從合輯中移除',
  'clip.removeTitle': '從此合輯中移除',
  'clip.copyTitle': '複製標題、說明與主題標籤',
  'clip.copied': '已複製 ✓',
  'clip.copy': '複製',
  'clip.scoreDetails': '分數詳情',
  'clip.openEditor': '在編輯器中開啟 →',

  'comp.reelAria': '精華合輯：{title}',
  'comp.clipOne': '個片段',
  'comp.clipMany': '個片段',
  'comp.addClipAria': '將片段加入此合輯',
  'comp.addClip': '加入片段',

  'compile.openTitle': '在編輯器中開啟已合成的合輯',
  'compile.open': '在編輯器中開啟合輯',
  'compile.compiling': '合成中…',
  'compile.compileTitle': '將此合輯自動剪輯成一部合輯影片',
  'compile.compile': '合成此合輯',
  'compile.retry': '重試合成',
  'compile.failed': '合成失敗',
}

export const TRANSLATIONS: Record<Language, TranslationSchema> = {
  'zh-Hant': zhHant,
  en,
}

export type TranslationKey = keyof TranslationSchema
