import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import type { Components } from 'react-markdown';

interface MarkdownRendererProps {
  content: string;
  className?: string;
}

export function MarkdownRenderer({
  content,
  className,
}: MarkdownRendererProps) {
  const components: Components = {
    code({ className, children, ...props }) {
      const match = /language-(\w+)/.exec(className || '');
      const isInline = !match && !String(children).includes('\n');

      return !isInline && match ? (
        <SyntaxHighlighter
          style={oneDark}
          language={match[1]}
          PreTag="div"
          customStyle={{
            margin: '0.5em 0',
            borderRadius: '0.375rem',
            fontSize: '0.875em',
          }}
        >
          {String(children).replace(/\n$/, '')}
        </SyntaxHighlighter>
      ) : (
        <code
          className={className}
          style={{
            backgroundColor: 'rgba(0, 0, 0, 0.3)',
            padding: '0.125em 0.25em',
            borderRadius: '0.25rem',
            fontSize: '0.875em',
          }}
          {...props}
        >
          {children}
        </code>
      );
    },
    pre({ children }) {
      return <>{children}</>;
    },
    p({ children }) {
      return <p style={{ margin: '0.5em 0' }}>{children}</p>;
    },
    ul({ children }) {
      return (
        <ul style={{ margin: '0.5em 0', paddingLeft: '1.5em' }}>{children}</ul>
      );
    },
    ol({ children }) {
      return (
        <ol style={{ margin: '0.5em 0', paddingLeft: '1.5em' }}>{children}</ol>
      );
    },
    li({ children }) {
      return <li style={{ margin: '0.25em 0' }}>{children}</li>;
    },
    blockquote({ children }) {
      return (
        <blockquote
          style={{
            borderLeft: '3px solid #61dafb',
            paddingLeft: '1em',
            margin: '0.5em 0',
            color: '#aaa',
          }}
        >
          {children}
        </blockquote>
      );
    },
    a({ href, children }) {
      return (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: '#61dafb' }}
        >
          {children}
        </a>
      );
    },
    table({ children }) {
      return (
        <table
          style={{
            borderCollapse: 'collapse',
            margin: '0.5em 0',
            width: '100%',
          }}
        >
          {children}
        </table>
      );
    },
    th({ children }) {
      return (
        <th
          style={{
            border: '1px solid #444',
            padding: '0.5em',
            backgroundColor: 'rgba(0, 0, 0, 0.3)',
          }}
        >
          {children}
        </th>
      );
    },
    td({ children }) {
      return (
        <td style={{ border: '1px solid #444', padding: '0.5em' }}>
          {children}
        </td>
      );
    },
  };

  return (
    <div className={className}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
