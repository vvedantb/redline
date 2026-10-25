import { useEffect, useRef, type CSSProperties, type ElementType, type ReactNode } from 'react';

type RevealProps = {
  children: ReactNode;
  className?: string;
  /** Milliseconds before the first child starts. */
  delay?: number;
  as?: ElementType;
};

/** Adds `is-visible` once the block scrolls into view. Children marked `reveal-item` stagger in. */
export function Reveal({ children, className, delay = 0, as: Tag = 'div' }: RevealProps) {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (!('IntersectionObserver' in window)) {
      node.classList.add('is-visible');
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          node.classList.add('is-visible');
          observer.disconnect();
        }
      },
      { rootMargin: '0px 0px -8% 0px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const style = { '--reveal-delay': `${delay}ms` } as CSSProperties;
  return (
    <Tag ref={ref} className={className ? `reveal ${className}` : 'reveal'} style={style}>
      {children}
    </Tag>
  );
}

type RevealItemProps = {
  children: ReactNode;
  className?: string;
  /** Position in the stagger sequence. */
  index?: number;
  as?: ElementType;
};

export function RevealItem({ children, className, index = 0, as: Tag = 'div' }: RevealItemProps) {
  const style = { '--i': index } as CSSProperties;
  return (
    <Tag className={className ? `reveal-item ${className}` : 'reveal-item'} style={style}>
      {children}
    </Tag>
  );
}
