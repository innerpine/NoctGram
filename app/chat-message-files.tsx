'use client';
/* eslint-disable next/no-img-element */
import { useState, type ReactNode } from 'react';
import { Download, File as FileIcon } from 'lucide-react';
import { chatFileSize, type ChatAttachment } from '@/lib/chat-files';
import { ChatVideoPlayer } from './chat-video-player';
import { PhotoViewer } from './photo-viewer';

export function ChatMessageFiles({
  files,
  flush = false,
  metadata,
}: {
  files: ChatAttachment[];
  flush?: boolean;
  metadata?: ReactNode;
}) {
  const [photo, setPhoto] = useState<ChatAttachment | null>(null);
  const [open, setOpen] = useState(false);
  return (
    <>
      <div
        className={'chat-message-files' + (files.length > 1 ? ' multiple' : '')}
      >
        {files.map((file, index) => {
          const url = '/api/media/' + encodeURIComponent(file.id);
          const stamp = index === files.length - 1 ? metadata : undefined;
          if (file.kind === 'image')
            return (
              <div key={file.id} className="chat-photo-tile">
                <button
                  type="button"
                  className="chat-photo"
                  aria-label={'Открыть фото ' + file.name}
                  onClick={() => {
                    setPhoto(file);
                    setOpen(true);
                  }}
                >
                  <img
                    src={url}
                    alt={file.name}
                    loading="lazy"
                    decoding="async"
                  />
                </button>
                {stamp}
              </div>
            );
          if (file.kind === 'video')
            return (
              <div key={file.id} className="chat-video">
                <ChatVideoPlayer
                  src={url}
                  name={file.name}
                  flush={flush}
                  metadata={stamp}
                />
              </div>
            );
          return (
            <a
              key={file.id}
              className="chat-document"
              href={url + '?download=1'}
              download={file.name}
            >
              <span className="chat-document-icon">
                <FileIcon size={22} />
              </span>
              <span>
                <strong>{file.name}</strong>
                <small>{chatFileSize(file.size)}</small>
              </span>
              <Download size={16} />
            </a>
          );
        })}
      </div>
      <PhotoViewer
        open={open}
        onOpenChange={setOpen}
        onOpenChangeComplete={(isOpen) => {
          if (!isOpen) setPhoto(null);
        }}
        className="noct-dialog chat-photo-dialog"
        title={photo?.name || 'Фото'}
        src={photo ? '/api/media/' + encodeURIComponent(photo.id) : ''}
        alt={photo?.name || ''}
      >
        {photo && (
          <a
            href={'/api/media/' + encodeURIComponent(photo.id) + '?download=1'}
            download={photo.name}
          >
            <Download size={16} /> Скачать фото
          </a>
        )}
      </PhotoViewer>
    </>
  );
}
