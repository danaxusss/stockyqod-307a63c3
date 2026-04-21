import React from 'react';
import { Calendar } from 'lucide-react';

interface DatePickerProps {
  value: string; // ISO date string yyyy-mm-dd
  onChange: (value: string) => void;
  label?: string;
  className?: string;
  min?: string;
  max?: string;
}

export function DatePicker({ value, onChange, label, className = '', min, max }: DatePickerProps) {
  return (
    <div className={className}>
      {label && <label className="block text-xs font-medium text-foreground mb-1">{label}</label>}
      <div className="relative">
        <Calendar className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
        <input
          type="date"
          value={value}
          onChange={e => onChange(e.target.value)}
          min={min}
          max={max}
          className="w-full pl-8 pr-3 py-1.5 text-sm border border-input rounded-lg bg-background text-foreground focus:ring-2 focus:ring-ring [color-scheme:dark]"
        />
      </div>
    </div>
  );
}
