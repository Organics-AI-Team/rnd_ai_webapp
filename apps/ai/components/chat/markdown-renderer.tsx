'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Components } from 'react-markdown';

/**
 * MarkdownRenderer Component
 *
 * Renders markdown content with support for GitHub Flavored Markdown (GFM).
 * Provides custom styling for all markdown elements to ensure consistent
 * and professional appearance across all AI chat interfaces.
 *
 * @param {Object} props - Component props
 * @param {string} props.content - The markdown content to render
 * @returns {JSX.Element} Rendered markdown content
 */
interface MarkdownRendererProps {
  content: string;
}

export function MarkdownRenderer({ content }: MarkdownRendererProps) {
  // Custom components for markdown elements with Tailwind styling
  const components: Partial<Components> = {
    // Headings
    h1: ({ children }) => (
      <h1 className="text-2xl font-bold mt-6 mb-4 text-slate-900">{children}</h1>
    ),
    h2: ({ children }) => (
      <h2 className="text-xl font-bold mt-5 mb-3 text-slate-900">{children}</h2>
    ),
    h3: ({ children }) => (
      <h3 className="text-lg font-semibold mt-4 mb-2 text-slate-800">{children}</h3>
    ),
    h4: ({ children }) => (
      <h4 className="text-base font-semibold mt-3 mb-2 text-slate-800">{children}</h4>
    ),

    // Paragraphs
    p: ({ children }) => (
      <p className="mb-4 text-slate-800 leading-relaxed break-words overflow-wrap-anywhere">{children}</p>
    ),

    // Lists
    ul: ({ children }) => (
      <ul className="list-disc list-outside ml-6 mb-4 space-y-2 text-slate-800">{children}</ul>
    ),
    ol: ({ children }) => (
      <ol className="list-decimal list-outside ml-6 mb-4 space-y-2 text-slate-800">{children}</ol>
    ),
    li: ({ children }) => (
      <li className="text-slate-800 leading-relaxed">{children}</li>
    ),

    // Code blocks
    code: ({ className, children, ...props }) => {
      const isInline = !className;

      if (isInline) {
        return (
          <code
            className="bg-slate-100 text-pink-600 px-1.5 py-0.5 rounded text-sm font-mono"
            {...props}
          >
            {children}
          </code>
        );
      }

      return (
        <code
          className={`block bg-slate-900 text-slate-100 p-4 rounded-lg overflow-x-auto text-sm font-mono my-4 ${className || ''}`}
          {...props}
        >
          {children}
        </code>
      );
    },

    pre: ({ children }) => (
      <pre className="bg-slate-900 rounded-lg overflow-hidden my-4">{children}</pre>
    ),

    // Blockquotes
    blockquote: ({ children }) => (
      <blockquote className="border-l-4 border-indigo-500 pl-4 py-2 my-4 italic text-slate-700 bg-slate-50">
        {children}
      </blockquote>
    ),

    // Links
    a: ({ href, children }) => (
      <a
        href={href}
        className="text-indigo-600 hover:text-indigo-800 underline decoration-indigo-300 hover:decoration-indigo-500 transition-colors"
        target="_blank"
        rel="noopener noreferrer"
      >
        {children}
      </a>
    ),

    // Horizontal rules
    hr: () => <hr className="my-6 border-t-2 border-slate-200" />,

    // Tables
    table: ({ children }) => (
      <div className="overflow-x-auto my-4">
        <table className="min-w-full divide-y divide-slate-200 border border-slate-200">
          {children}
        </table>
      </div>
    ),
    thead: ({ children }) => (
      <thead className="bg-slate-50">{children}</thead>
    ),
    tbody: ({ children }) => (
      <tbody className="bg-white divide-y divide-slate-200">{children}</tbody>
    ),
    tr: ({ children }) => (
      <tr className="hover:bg-slate-50 transition-colors">{children}</tr>
    ),
    th: ({ children }) => (
      <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 uppercase tracking-wider">
        {children}
      </th>
    ),
    td: ({ children }) => (
      <td className="px-4 py-3 text-sm text-slate-800">{children}</td>
    ),

    // Strong and emphasis
    strong: ({ children }) => (
      <strong className="font-bold text-slate-900">{children}</strong>
    ),
    em: ({ children }) => (
      <em className="italic text-slate-800">{children}</em>
    ),

    // Strikethrough (GFM)
    del: ({ children }) => (
      <del className="line-through text-slate-600">{children}</del>
    ),
  };

  return (
    <div className="markdown-content text-slate-800 break-words overflow-x-auto">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={components}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
