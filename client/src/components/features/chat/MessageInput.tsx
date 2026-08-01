import { useState, useRef, useEffect, type KeyboardEvent, type ChangeEvent } from 'react';
import { cn } from '../../../lib/utils';
import { documentsApi } from '../../../lib/api';
import { toast } from '../../../stores';
import styles from './MessageInput.module.css';

export interface MessageInputProps {
  onSend: (message: string, images?: string[]) => void;
  disabled?: boolean;
  loading?: boolean;
  placeholder?: string;
  maintenanceMessage?: string;
  className?: string;
}

type ImageAttachment = {
  kind: 'image';
  id: string;
  filename: string;
  dataUri: string;
  size: number;
};

type DocAttachment = {
  kind: 'doc';
  id: string;
  filename: string;
  status: 'processing' | 'ready' | 'error';
  markdown?: string;
  error?: string;
  size: number;
};

type Attachment = ImageAttachment | DocAttachment;

const MAX_IMAGES = 4;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10MB raw, server bumped json limit to 15MB
const MAX_DOC_BYTES = 50 * 1024 * 1024; // matches server multer limit

const DOC_EXTENSIONS = ['.pdf', '.docx', '.pptx', '.xlsx', '.html', '.htm', '.txt', '.md'];
const IMAGE_MIMES_PREFIX = 'image/';

function isImage(file: File): boolean {
  return file.type.startsWith(IMAGE_MIMES_PREFIX);
}

function isDoc(file: File): boolean {
  if (file.type === 'application/pdf') return true;
  const name = file.name.toLowerCase();
  return DOC_EXTENSIONS.some(ext => name.endsWith(ext));
}

function readFileAsDataUri(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

let attachmentIdSeq = 0;
const nextAttachmentId = () => `att-${++attachmentIdSeq}`;

export function MessageInput({
  onSend,
  disabled = false,
  loading = false,
  placeholder = 'Type a message...',
  maintenanceMessage,
  className,
}: MessageInputProps) {
  const [message, setMessage] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
    }
  }, [message]);

  const imageCount = attachments.filter(a => a.kind === 'image').length;
  const anyProcessing = attachments.some(a => a.kind === 'doc' && a.status === 'processing');

  const removeAttachment = (id: string) => {
    setAttachments(prev => prev.filter(a => a.id !== id));
  };

  const processDoc = async (att: DocAttachment, file: File) => {
    try {
      const formData = new FormData();
      formData.append('document', file);
      formData.append('format', 'markdown');
      const res = await documentsApi.process(formData);
      setAttachments(prev => prev.map(a =>
        a.id === att.id && a.kind === 'doc'
          ? { ...a, status: 'ready' as const, markdown: res.content }
          : a
      ));
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to process document';
      setAttachments(prev => prev.map(a =>
        a.id === att.id && a.kind === 'doc'
          ? { ...a, status: 'error' as const, error: msg }
          : a
      ));
      toast.error(`Document processing failed: ${att.filename}`, { details: msg });
    }
  };

  const handleFilesSelected = async (files: FileList | null) => {
    if (!files || files.length === 0) return;

    for (const file of Array.from(files)) {
      if (isImage(file)) {
        if (imageCount >= MAX_IMAGES) {
          toast.warning(`Max ${MAX_IMAGES} images per message`);
          continue;
        }
        if (file.size > MAX_IMAGE_BYTES) {
          toast.error(`Image too large: ${file.name} (max 10MB)`);
          continue;
        }
        try {
          const dataUri = await readFileAsDataUri(file);
          const att: ImageAttachment = {
            kind: 'image',
            id: nextAttachmentId(),
            filename: file.name,
            dataUri,
            size: file.size,
          };
          setAttachments(prev => [...prev, att]);
        } catch (e) {
          toast.error(`Failed to read ${file.name}`);
        }
      } else if (isDoc(file)) {
        if (file.size > MAX_DOC_BYTES) {
          toast.error(`Document too large: ${file.name} (max 50MB)`);
          continue;
        }
        const att: DocAttachment = {
          kind: 'doc',
          id: nextAttachmentId(),
          filename: file.name,
          status: 'processing',
          size: file.size,
        };
        setAttachments(prev => [...prev, att]);
        processDoc(att, file);
      } else {
        toast.warning(`Unsupported file type: ${file.name}`);
      }
    }

    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleSubmit = () => {
    if (disabled || loading || anyProcessing) return;

    const trimmed = message.trim();
    const readyDocs = attachments.filter((a): a is DocAttachment => a.kind === 'doc' && a.status === 'ready');
    const images = attachments.filter((a): a is ImageAttachment => a.kind === 'image').map(a => a.dataUri);

    if (!trimmed && readyDocs.length === 0 && images.length === 0) return;

    const docBlocks = readyDocs.map(d => `**Attached document: ${d.filename}**\n\n${d.markdown ?? ''}`);
    const finalContent = [...docBlocks, trimmed].filter(Boolean).join('\n\n---\n\n');

    onSend(finalContent, images.length > 0 ? images : undefined);

    setMessage('');
    setAttachments([]);
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    setMessage(e.target.value);
  };

  const canSend =
    !disabled &&
    !loading &&
    !anyProcessing &&
    (message.trim().length > 0 ||
      attachments.some(a => a.kind === 'image') ||
      attachments.some(a => a.kind === 'doc' && a.status === 'ready'));

  if (maintenanceMessage) {
    return (
      <div className={cn(styles.container, className)}>
        <div className={styles.maintenance}>
          <span className={styles.maintenanceIcon}>{'\u{1F6A7}'}</span>
          <span>{maintenanceMessage}</span>
        </div>
      </div>
    );
  }

  return (
    <div className={cn(styles.container, className)}>
      {attachments.length > 0 && (
        <div className={styles.attachmentChips}>
          {attachments.map(att => (
            <div
              key={att.id}
              className={cn(
                styles.chip,
                att.kind === 'doc' && att.status === 'processing' && styles.chipProcessing,
                att.kind === 'doc' && att.status === 'error' && styles.chipError,
              )}
            >
              {att.kind === 'image' ? (
                <img src={att.dataUri} alt={att.filename} className={styles.chipThumb} />
              ) : (
                <span className={styles.chipIcon}>
                  {att.status === 'processing' ? '\u{1F504}' : att.status === 'error' ? '\u26A0\uFE0F' : '\u{1F4C4}'}
                </span>
              )}
              <span className={styles.chipLabel} title={att.filename}>
                {att.filename}
                {att.kind === 'doc' && att.status === 'processing' && ' — processing…'}
                {att.kind === 'doc' && att.status === 'error' && ' — failed'}
              </span>
              <button
                type="button"
                className={styles.chipRemove}
                onClick={() => removeAttachment(att.id)}
                aria-label={`Remove ${att.filename}`}
              >
                {'\u2715'}
              </button>
            </div>
          ))}
        </div>
      )}

      <div className={cn(styles.inputWrapper, disabled && styles.disabled)}>
        <textarea
          ref={textareaRef}
          className={styles.textarea}
          value={message}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled || loading}
          rows={1}
        />

        <div className={styles.actions}>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/*,.pdf,.docx,.pptx,.xlsx,.html,.htm,.txt,.md"
            style={{ display: 'none' }}
            onChange={(e) => handleFilesSelected(e.target.files)}
          />
          <button
            type="button"
            className={styles.actionButton}
            onClick={() => fileInputRef.current?.click()}
            disabled={disabled || loading}
            title="Attach image or document"
            aria-label="Attach file"
          >
            {'\u{1F4CE}'}
          </button>
          <button
            type="button"
            className={cn(styles.actionButton, styles.sendButton)}
            onClick={handleSubmit}
            disabled={!canSend}
            title={anyProcessing ? 'Waiting for document processing…' : 'Send message'}
          >
            {loading ? (
              <span className={styles.loadingDots}>
                <span className={styles.loadingDot} />
                <span className={styles.loadingDot} />
                <span className={styles.loadingDot} />
              </span>
            ) : (
              '\u{27A4}'
            )}
          </button>
        </div>
      </div>

      <div className={styles.hint}>
        Press Enter to send, Shift+Enter for new line
      </div>
    </div>
  );
}
