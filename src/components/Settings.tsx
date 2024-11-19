import React from "react";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { SettingsType } from "@/types/types";
import { RadioGroup, RadioGroupItem } from "./ui/radio-group";
import { Input } from "./ui/input";

export const Settings: React.FC<{
  settings: SettingsType;
  onSettingsChange: (settings: SettingsType) => void;
}> = ({ settings, onSettingsChange }) => {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Label htmlFor="auto-open">Auto-open webpage</Label>
        <Switch
          id="auto-open"
          checked={settings.autoOpen}
          onCheckedChange={(checked) =>
            onSettingsChange({ ...settings, autoOpen: checked })
          }
        />
      </div>
      <div className="flex items-center justify-between">
        <Label htmlFor="web-push">Web Push notifications</Label>
        <Switch
          id="web-push"
          checked={settings.webPush}
          onCheckedChange={(checked) =>
            onSettingsChange({ ...settings, webPush: checked })
          }
        />
      </div>
      <div className="flex items-center justify-between">
        <Label>Connection Type</Label>
        <RadioGroup
          onValueChange={(value) => {
            onSettingsChange({ ...settings, connectionType: value });
          }}
        >
          <div className="flex items-center space-x-2">
            <RadioGroupItem
              value="local"
              id="r1"
              checked={settings.connectionType === "local"}
            />
            <Label htmlFor="r1">Local</Label>
          </div>
          <div className="flex items-center space-x-2">
            <RadioGroupItem
              value="server"
              id="r2"
              checked={settings.connectionType === "server"}
            />
            <Label htmlFor="r2">Server</Label>
          </div>
        </RadioGroup>
      </div>
      <div className="flex w-full max-w-sm items-center space-x-2">
        <Input
          type="url"
          value={settings.url}
          disabled={settings.connectionType === "local"}
          onChange={(e) => {
            onSettingsChange({ ...settings, url: e.target.value });
          }}
        />
      </div>
    </div>
  );
};
