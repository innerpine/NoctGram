'use client';

import { useId } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

type Option = { value: string; label: string; icon?: LucideIcon };

/** Shared field styling stays local to the administration and moderation tools. */
export function StaffSelect({
  label,
  value,
  options,
  onChange,
  disabled = false,
}: {
  label: string;
  value: string;
  options: Option[];
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const id = useId();
  const current = options.find((option) => option.value === value);
  const Icon = current?.icon;
  return (
    <div className="staff-select-field">
      <label htmlFor={id}>{label}</label>
      <Select
        value={value}
        items={options.map(({ value, label }) => ({ value, label }))}
        disabled={disabled}
        onValueChange={(next) => {
          if (next !== null) onChange(String(next));
        }}
      >
        <SelectTrigger id={id} className="staff-select-trigger">
          {Icon && <Icon size={17} aria-hidden="true" />}
          <SelectValue>{current?.label}</SelectValue>
        </SelectTrigger>
        <SelectContent
          className="staff-select-menu"
          align="start"
          sideOffset={6}
          alignItemWithTrigger={false}
        >
          {options.map(({ value, label, icon: OptionIcon }) => (
            <SelectItem
              key={value}
              value={value}
              className="staff-select-option"
            >
              {OptionIcon && <OptionIcon size={17} aria-hidden="true" />}
              <span>{label}</span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
