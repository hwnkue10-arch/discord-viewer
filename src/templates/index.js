/**
 * Discord In-App Activity 다중 문서 뷰어 템플릿 허브
 * - PDF (./pdf.js)
 * - Markdown (./markdown.js)
 * - PowerPoint (./pptx.js)
 * - 한글 HWP / HWPX (./hwp.js)
 */

const { SUPPORTED_FORMATS, getFileFormat, escapeHtml, safeJsonForScript } = require('./utils');
const { renderPdfViewer } = require('./pdf');
const { renderMarkdownViewer } = require('./markdown');
const { renderPptxViewer } = require('./pptx');
const { renderHwpViewer } = require('./hwp');

module.exports = {
  SUPPORTED_FORMATS,
  getFileFormat,
  escapeHtml,
  safeJsonForScript,
  renderPdfViewer,
  renderMarkdownViewer,
  renderPptxViewer,
  renderHwpViewer
};
