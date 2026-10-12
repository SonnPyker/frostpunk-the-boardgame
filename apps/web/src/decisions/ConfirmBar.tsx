// The footer of a multi-choice decision: a status line and the Confirm button. The button's reason is its tooltip.
import { Button } from '../components/ui';

export function countText(min: number, max: number): string {
  return min === max ? String(max) : `${min} to ${max}`;
}

export interface ConfirmBarProps {
  text: string;
  label: string;
  /** why Confirm is off; undefined when it can be pressed */
  reason?: string;
  onConfirm: () => void;
}

export function ConfirmBar({ text, label, reason, onConfirm }: ConfirmBarProps) {
  return (
    <div className="dec-foot">
      <span className="dec-status">{text}</span>
      <Button variant="primary" disabledReason={reason} onClick={onConfirm}>
        {label}
      </Button>
    </div>
  );
}
