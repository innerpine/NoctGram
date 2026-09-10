'use client';
/* eslint-disable next/no-img-element */
import { useState, type ReactNode } from 'react';
import { Download, File as FileIcon } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { chatFileSize, type ChatAttachment } from '@/lib/chat-files';

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
                {/* Personal video attachments can have no speech or supplied captions. */}
                {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                <video
                  src={url}
                  controls
                  playsInline
                  preload="metadata"
                  aria-label={file.name}
                />
                <a
                  href={url + '?download=1'}
                  download={file.name}
                  className={flush ? 'chat-video-download' : undefined}
                  aria-label={'Скачать видео ' + file.name}
                  title="Скачать видео"
                >
                  {!flush && 'Скачать видео '}
                  <Download size={flush ? 16 : 13} />
                </a>
                {stamp}
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
      <Dialog
        open={open}
        onOpenChange={setOpen}
        onOpenChangeComplete={(isOpen) => {
          if (!isOpen) setPhoto(null);
        }}
      >
        <DialogContent className="noct-dialog chat-photo-dialog">
          <DialogTitle className="sr-only">{photo?.name || 'Фото'}</DialogTitle>
          {photo && (
            <>
              <img
                src={'/api/media/' + encodeURIComponent(photo.id)}
                alt={photo.name}
              />
              <a
                href={
                  '/api/media/' + encodeURIComponent(photo.id) + '?download=1'
                }
                download={photo.name}
              >
                <Download size={16} /> Скачать фото
              </a>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
