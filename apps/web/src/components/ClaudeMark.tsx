import { MaterialIcon } from "./FileTypeIcon";

/** Anthropic's own mark, the one material-icon-theme draws on a `CLAUDE.md`. See apps/web/SPEC.md. */
export function ClaudeMark({ className }: { className?: string | undefined }) {
	return <MaterialIcon name="claude" className={className} />;
}
