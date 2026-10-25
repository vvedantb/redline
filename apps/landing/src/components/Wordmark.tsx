import { Mark } from './icons';

export function Wordmark() {
  return (
    <span className="inline-flex items-center gap-2 text-foreground">
      <Mark size={14} />
      <span className="landing-wordmark-text text-xl leading-none tracking-[-0.01em]">Redline</span>
    </span>
  );
}
