import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

/**
 * GitHub-flavored Markdown for READMEs and release notes. Raw HTML is ignored
 * (react-markdown's default), so pasted content can't inject markup.
 */
export function Markdown({ children }: { children: string }) {
  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ node: _, ...props }) => <a {...props} target="_blank" rel="noreferrer" />,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  )
}
