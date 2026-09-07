'use client';
import { useState } from 'react';
import { Copy, Check, Code2 } from 'lucide-react';
export function CodeBlock({
  code,
  language = 'text',
}: {
  code: string;
  language?: string;
}) {
  const [copied, setCopied] = useState(false),
    [error, setError] = useState(false);
  return (
    <div className="post-code">
      <div>
        <span>
          <Code2 size={14} />
          {language}
        </span>
        <button
          onClick={() => {
            void navigator.clipboard
              .writeText(code)
              .then(() => {
                setCopied(true);
                setError(false);
              })
              .catch(() => setError(true));
          }}
          aria-label="Скопировать код"
        >
          {copied ? <Check size={13} /> : <Copy size={13} />}
          {error ? 'Не скопировано' : copied ? 'Скопировано' : 'Копировать'}
        </button>
      </div>
      <pre>
        <code>{code}</code>
      </pre>
    </div>
  );
}
