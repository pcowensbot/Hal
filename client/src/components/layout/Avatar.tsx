import { useState, type ImgHTMLAttributes } from 'react';
import { cn, getInitials } from '../../lib/utils';
import styles from './Avatar.module.css';

export type AvatarSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl' | 'xxl';
export type AvatarStatus = 'online' | 'offline' | 'busy' | 'away';

export interface AvatarProps extends Omit<ImgHTMLAttributes<HTMLImageElement>, 'size' | 'src'> {
  src?: string | null;
  name?: string;
  size?: AvatarSize;
  status?: AvatarStatus;
  onClick?: () => void;
  className?: string;
}

export function Avatar({
  src,
  name = '',
  size = 'md',
  status,
  onClick,
  className,
  alt,
  ...imgProps
}: AvatarProps) {
  const [imageError, setImageError] = useState(false);

  const showImage = src && !imageError;
  const initials = getInitials(name);

  const avatarContent = (
    <div
      className={cn(
        styles.avatar,
        styles[size],
        onClick && styles.clickable,
        className
      )}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
    >
      {showImage ? (
        <img
          src={src}
          alt={alt || name}
          className={styles.image}
          onError={() => setImageError(true)}
          {...imgProps}
        />
      ) : (
        <div className={styles.fallback}>{initials || '?'}</div>
      )}
    </div>
  );

  if (status) {
    return (
      <div className={styles.statusWrapper}>
        {avatarContent}
        <span className={cn(styles.status, styles[status])} />
      </div>
    );
  }

  return avatarContent;
}

// Avatar Group for showing multiple avatars
export interface AvatarGroupProps {
  avatars: Array<{ src?: string | null; name?: string }>;
  max?: number;
  size?: AvatarSize;
  className?: string;
}

export function AvatarGroup({ avatars, max = 3, size = 'sm', className }: AvatarGroupProps) {
  const visible = avatars.slice(0, max);
  const remaining = avatars.length - max;

  return (
    <div className={cn(styles.group, className)}>
      {visible.map((avatar, index) => (
        <Avatar key={index} src={avatar.src} name={avatar.name} size={size} />
      ))}
      {remaining > 0 && (
        <div className={cn(styles.avatar, styles[size], styles.groupMore)}>
          +{remaining}
        </div>
      )}
    </div>
  );
}
