/**
 * 다중 문서 뷰어 공통 유틸리티 및 포맷 감지
 */

const SUPPORTED_FORMATS = {
  html: ['.html', '.htm'],
  pdf:  ['.pdf'],
  md:   ['.md', '.markdown'],
  pptx: ['.pptx']
};

function getFileFormat(filename) {
  if (!filename) return null;
  const clean = String(filename).toLowerCase().split('?')[0];
  for (const [format, exts] of Object.entries(SUPPORTED_FORMATS)) {
    if (exts.some((ext) => clean.endsWith(ext))) return format;
  }
  return null;
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function safeJsonForScript(val) {
  return JSON.stringify(val)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

module.exports = {
  SUPPORTED_FORMATS,
  getFileFormat,
  escapeHtml,
  safeJsonForScript
};
