import React from 'react';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { SettingsType } from '@/types/types';

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
    </div>
  );
};