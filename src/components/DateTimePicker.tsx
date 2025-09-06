import React from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const DateTimePicker: React.FC<{
  value: Date;
  onChange: (date: Date) => void;
}> = ({ value, onChange }) => {
  const years = Array.from(
    { length: 5 },
    (_, i) => new Date().getFullYear() + i
  );
  const months = Array.from({ length: 12 }, (_, i) => i + 1);
  const days = Array.from({ length: 31 }, (_, i) => i + 1);
  const hours = Array.from({ length: 24 }, (_, i) => i);
  const minutes = Array.from({ length: 60 }, (_, i) => i);

  const handleChange = (field: string, val: number) => {
    const newDate = new Date(value);
    switch (field) {
      case "year":
        newDate.setFullYear(val);
        break;
      case "month":
        newDate.setMonth(val - 1);
        break;
      case "day":
        newDate.setDate(val);
        break;
      case "hour":
        newDate.setHours(val);
        break;
      case "minute":
        newDate.setMinutes(val);
        break;
    }
    onChange(newDate);
  };

  return (
    <div className="flex justify-center gap-2">
      <Select
        value={value.getFullYear().toString()}
        onValueChange={(val) => handleChange("year", Number(val))}
      >
        <SelectTrigger>
          <SelectValue placeholder={value.getFullYear().toString()} />
        </SelectTrigger>
        <SelectContent>
          {years.map((year) => (
            <SelectItem key={year} value={year.toString()}>
              {year}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        value={(value.getMonth() + 1).toString()}
        onValueChange={(val) => handleChange("month", Number(val))}
      >
        <SelectTrigger>
          <SelectValue placeholder={(value.getMonth() + 1).toString()} />
        </SelectTrigger>
        <SelectContent>
          {months.map((month) => (
            <SelectItem key={month} value={month.toString()}>
              {month}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        value={value.getDate().toString()}
        onValueChange={(val) => handleChange("day", Number(val))}
      >
        <SelectTrigger>
          <SelectValue placeholder={value.getDate().toString()} />
        </SelectTrigger>
        <SelectContent>
          {days.map((day) => (
            <SelectItem key={day} value={day.toString()}>
              {day}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        value={value.getHours().toString()}
        onValueChange={(val) => handleChange("hour", Number(val))}
      >
        <SelectTrigger>
          <SelectValue placeholder={value.getHours().toString()} />
        </SelectTrigger>
        <SelectContent>
          {hours.map((hour) => (
            <SelectItem key={hour} value={hour.toString()}>
              {hour.toString().padStart(2, "0")}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        value={value.getMinutes().toString()}
        onValueChange={(val) => handleChange("minute", Number(val))}
      >
        <SelectTrigger>
          <SelectValue placeholder={value.getMinutes().toString()} />
        </SelectTrigger>
        <SelectContent>
          {minutes.map((minute) => (
            <SelectItem key={minute} value={minute.toString()}>
              {minute.toString().padStart(2, "0")}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
};
