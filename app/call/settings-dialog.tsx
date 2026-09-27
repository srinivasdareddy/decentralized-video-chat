import { ChevronDown, Mic, Video, Volume2, type LucideIcon } from "lucide-react";
import { useId } from "react";
import { Dialog } from "../components/dialog";
import type { DeviceChoice } from "../lib/device-preferences";
import { useMediaDevices } from "../lib/use-media-devices";
import { canChooseSpeaker } from "./use-speaker";

export function SettingsDialog({
  open,
  onClose,
  cameraId,
  microphoneId,
  speakerId,
  onSelectCamera,
  onSelectMicrophone,
  onSelectSpeaker,
}: {
  open: boolean;
  onClose: () => void;
  cameraId: string | null;
  microphoneId: string | null;
  speakerId: string | null;
  onSelectCamera: (device: DeviceChoice) => void;
  onSelectMicrophone: (device: DeviceChoice) => void;
  onSelectSpeaker: (device: DeviceChoice) => void;
}) {
  const devices = useMediaDevices(open);
  return (
    <Dialog open={open} title="Settings" onClose={onClose}>
      <div className="settings-fields">
        <DeviceSelect
          label="Camera"
          icon={Video}
          devices={devices.cameras}
          value={cameraId}
          onChange={onSelectCamera}
        />
        <DeviceSelect
          label="Microphone"
          icon={Mic}
          devices={devices.microphones}
          value={microphoneId}
          onChange={onSelectMicrophone}
        />
        {canChooseSpeaker() && (
          <DeviceSelect
            label="Speaker"
            icon={Volume2}
            devices={devices.speakers}
            value={speakerId}
            onChange={onSelectSpeaker}
          />
        )}
      </div>
    </Dialog>
  );
}

function DeviceSelect({
  label,
  icon: Icon,
  devices,
  value,
  onChange,
}: {
  label: string;
  icon: LucideIcon;
  devices: MediaDeviceInfo[];
  value: string | null;
  onChange: (device: DeviceChoice) => void;
}) {
  const id = useId();
  const known = devices.some((device) => device.deviceId === value);
  return (
    <div>
      <label className="field-label settings-label" htmlFor={id}>
        <Icon size={16} aria-hidden="true" />
        {label}
      </label>
      <div className="select">
        <select
          id={id}
          className="text-input select-input"
          value={known ? (value ?? "") : ""}
          onChange={(event) => {
            const device = devices.find((option) => option.deviceId === event.target.value);
            if (device !== undefined) onChange({ deviceId: device.deviceId, label: device.label });
          }}
          disabled={devices.length === 0}
        >
          {!known && <option value="">{devices.length === 0 ? "None found" : "Default"}</option>}
          {devices.map((device, index) => (
            <option key={device.deviceId} value={device.deviceId}>
              {device.label || `${label} ${index + 1}`}
            </option>
          ))}
        </select>
        <ChevronDown className="select-chevron" size={16} aria-hidden="true" />
      </div>
    </div>
  );
}
