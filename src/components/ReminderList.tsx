import React from "react";
import { Trash2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Reminder } from "@/types/types";

export const ReminderList: React.FC<{
  reminders: Reminder[];
  onDelete: (id: string) => void;
  onOpen: (url: string) => void;
}> = ({ reminders, onDelete, onOpen }) => {
  return (
    <div className="space-y-4">
      {reminders
        .sort((a, b) => {
          if (a.reminderTime === b.reminderTime) {
            return 0;
          } else if (a.reminderTime > b.reminderTime) {
            return 1;
          } else {
            return -1;
          }
        })
        .map((reminder) => (
          <Card key={reminder.id} className="hover:bg-gray-50 cursor-pointer">
            <CardContent className="p-4 relative">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => onDelete(reminder.id)}
                className="text-red-500 hover:text-red-700 absolute top-1 right-1"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
              <div onClick={() => onOpen(reminder.url)}>
                <div>
                  <h3 className="font-medium text-lg">{reminder.title}</h3>
                </div>
                <p className="text-sm text-gray-500 truncate">{reminder.url}</p>
                <p className="text-sm mt-1">
                  Reminder at:{" "}
                  {new Date(reminder.reminderTime).toLocaleString()}
                </p>
                <div className="text-sm mt-1">
                  <span className="mr-4">
                    Auto-open: {reminder.autoOpen ? "✓" : "✗"}
                  </span>
                  <span>Web Push: {reminder.webPush ? "✓" : "✗"}</span>
                </div>
                <img
                  src={reminder.thumbnail}
                  alt={reminder.title}
                  className="w-full h-full object-cover rounded"
                />
              </div>
            </CardContent>
          </Card>
        ))}
    </div>
  );
};
