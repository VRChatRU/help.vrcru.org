import { describe, it, expect } from 'vitest';
import {
  escapeHtml,
  truncateText,
  stripMarkdown,
  sanitizeFilename,
  looksLikeImageFile,
  isDefaultColor
} from '../../../src/utils/text';

describe('Text Utils', () => {
  describe('escapeHtml', () => {
    it('should escape HTML special characters', () => {
      expect(escapeHtml('<script>alert("xss")</script>'))
        .toBe('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
      expect(escapeHtml('A & B')).toBe('A &amp; B');
      expect(escapeHtml("it's")).toBe("it&#39;s");
    });
  });

  describe('truncateText', () => {
    it('should truncate long text', () => {
      expect(truncateText('Hello World', 8)).toBe('Hello W...');
    });

    it('should not truncate short text', () => {
      expect(truncateText('Hello', 10)).toBe('Hello');
    });
  });

  describe('stripMarkdown', () => {
    it('should remove markdown formatting', () => {
      expect(stripMarkdown('**bold** *italic*')).toBe('bold italic');
      expect(stripMarkdown('[link](url)')).toBe('');
      expect(stripMarkdown('`code`')).toBe('');
    });
  });

  describe('sanitizeFilename', () => {
    it('should remove invalid filename characters', () => {
      expect(sanitizeFilename('file:name?.txt')).toBe('file-name-.txt');
      expect(sanitizeFilename('test/path\\file')).toBe('test-path-file');
    });

    it('should return "file" for empty input', () => {
      expect(sanitizeFilename('')).toBe('file');
      expect(sanitizeFilename('   ')).toBe('file');
    });
  });

  describe('looksLikeImageFile', () => {
    it('should detect image files', () => {
      expect(looksLikeImageFile('photo.png')).toBe(true);
      expect(looksLikeImageFile('image.jpg')).toBe(true);
      expect(looksLikeImageFile('pic.gif')).toBe(true);
    });

    it('should reject non-image files', () => {
      expect(looksLikeImageFile('video.mp4')).toBe(false);
      expect(looksLikeImageFile('doc.pdf')).toBe(false);
    });
  });

  describe('isDefaultColor', () => {
    it('should detect default colors', () => {
      expect(isDefaultColor(null)).toBe(true);
      expect(isDefaultColor(undefined)).toBe(true);
      expect(isDefaultColor('#000000')).toBe(true);
    });

    it('should reject non-default colors', () => {
      expect(isDefaultColor('#FF0000')).toBe(false);
      expect(isDefaultColor('#8b949e')).toBe(false);
    });
  });
});
