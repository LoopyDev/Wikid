import { Marked } from 'marked';
import DOMPurify from 'dompurify';

const parser = new Marked({ breaks: true, gfm: true });

/**
 * Markdown to HTML that's safe to show with v-html: anything that could run (scripts, event handlers,
 * javascript: links) is removed. For text Wikid doesn't control, such as an AI answer, which can echo
 * whatever was written on the pages it read.
 */
export const renderMarkdownSafely = (text) => DOMPurify.sanitize(parser.parse(String(text ?? '')));
