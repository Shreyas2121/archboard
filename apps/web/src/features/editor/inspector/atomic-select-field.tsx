import { useId } from 'react';

import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface AtomicSelectFieldProps<Value extends string> {
  readonly label: string;
  readonly value: Value;
  readonly options: readonly Value[];
  readonly disabled: boolean;
  readonly onValueChange: (value: Value) => void;
}

export function AtomicSelectField<Value extends string>({
  label,
  value,
  options,
  disabled,
  onValueChange,
}: AtomicSelectFieldProps<Value>) {
  const id = useId();
  return (
    <div className="grid gap-2" onKeyDown={(event) => event.stopPropagation()}>
      <Label htmlFor={id}>{label}</Label>
      <Select
        value={value}
        onValueChange={(next) => onValueChange(next as Value)}
        disabled={disabled}
      >
        <SelectTrigger className="w-full" id={id}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent position="popper">
          {options.map((option) => (
            <SelectItem value={option} key={option}>
              {option}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
