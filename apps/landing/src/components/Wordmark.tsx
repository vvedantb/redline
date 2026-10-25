import { Mark } from './icons';

export function Wordmark() {
  return (
    <span className="wordmark">
      <Mark size={14} />
      <span className="wordmark-text">Redline</span>
    </span>
  );
}
