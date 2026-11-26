import ReactMarkdown from "react-markdown";

/** Markdown básico de reviews (spec §16): sin HTML crudo ni imágenes. */
const ALLOWED = ["p", "br", "strong", "em", "a", "ul", "ol", "li", "blockquote", "code", "pre", "hr"];

export function ReviewMarkdown({ text }: { text: string }) {
  return (
    <div className="space-y-2 text-sm leading-relaxed [&_a]:underline [&_blockquote]:border-l-2 [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:list-disc [&_ul]:pl-5">
      <ReactMarkdown
        skipHtml
        allowedElements={ALLOWED}
        unwrapDisallowed
        components={{
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noreferrer nofollow">
              {children}
            </a>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
