import { SettingValueDialog } from "@thinkrail/plugin-ui";
import type { ClaudeEdit } from "../contracts";

export function ClaudeValueDialog({
	open,
	settingKey,
	currentValue,
	knownKeys,
	onClose,
	onCompose,
}: {
	open: boolean;
	settingKey: string;
	currentValue: unknown;
	knownKeys: readonly string[];
	onClose: () => void;
	onCompose: (pending: { edit: ClaudeEdit; title: string }) => void;
}) {
	return (
		<SettingValueDialog
			testIdPrefix="claude"
			open={open}
			settingKey={settingKey}
			currentValue={currentValue}
			knownKeys={knownKeys}
			keyPlaceholder="permissions.defaultMode"
			submitLabel="Review the change"
			onClose={onClose}
			onSubmit={(key, value) =>
				onCompose({
					edit: { kind: "setting", key, value },
					title: settingKey === "" ? `Add "${key}"` : `Change "${key}"`,
				})
			}
		/>
	);
}
