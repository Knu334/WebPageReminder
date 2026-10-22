import React from "react";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { ConnectionType, ServerConfig, SettingsType, Theme } from "@/types/types";
import { RadioGroup, RadioGroupItem } from "./ui/radio-group";
import { ServerSettings } from "./ServerSettings";

export const Settings: React.FC<{
  settings: SettingsType;
  onSettingsChange: (patch: Partial<Pick<SettingsType, "autoOpen" | "webPush" | "theme">>) => void;
  onModeChange: (t: ConnectionType) => void;
  onSaved: (c: ServerConfig) => void;
  markDisconnected: () => void;
  ensureFresh: () => Promise<void>;
}> = ({ settings, onSettingsChange, onModeChange, onSaved, markDisconnected, ensureFresh }) => {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Label htmlFor="auto-open">Auto-open webpage</Label>
        <div className="flex w-20">
          <Switch
            id="auto-open"
            checked={settings.autoOpen}
            onCheckedChange={(checked) => onSettingsChange({ autoOpen: checked })}
          />
        </div>
      </div>
      <div className="flex items-center justify-between">
        <Label htmlFor="web-push">Web Push notifications</Label>
        <div className="flex w-20">
          <Switch
            id="web-push"
            checked={settings.webPush}
            onCheckedChange={(checked) => onSettingsChange({ webPush: checked })}
          />
        </div>
      </div>
      <div className="flex items-center justify-between">
        <Label>Connection Type</Label>
        <RadioGroup
          className="w-20"
          value={settings.connectionType}
          onValueChange={(value) => onModeChange(value === "server" ? "server" : "local")}
        >
          <div className="flex items-center space-x-2">
            <RadioGroupItem
              value="local"
              id="r1"
            />
            <Label htmlFor="r1">Local</Label>
          </div>
          <div className="flex items-center space-x-2">
            <RadioGroupItem
              value="server"
              id="r2"
            />
            <Label htmlFor="r2">Server</Label>
          </div>
        </RadioGroup>
      </div>
      <div className="flex items-center justify-between">
        <Label>Theme</Label>
        <RadioGroup className="w-20" value={settings.theme} onValueChange={(value) => onSettingsChange({ theme: value as Theme })}>
          {([["system", "System"], ["light", "Light"], ["dark", "Dark"]] as const).map(([t, label]) => (
            <div key={t} className="flex items-center space-x-2">
              <RadioGroupItem value={t} id={`theme-${t}`} />
              <Label htmlFor={`theme-${t}`}>{label}</Label>
            </div>
          ))}
        </RadioGroup>
      </div>
      {settings.connectionType === "server" && (
        <ServerSettings
          settings={settings}
          onSaved={onSaved}
          markDisconnected={markDisconnected}
          ensureFresh={ensureFresh}
        />
      )}
    </div>
  );
};
