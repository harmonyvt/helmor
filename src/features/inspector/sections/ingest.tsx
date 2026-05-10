import { Channel } from "@tauri-apps/api/core";
import { Check, Copy, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import type {
	DebugIngestEntry,
	DebugIngestEvent,
	DebugIngestStatus,
} from "@/lib/api";
import {
	clearDebugIngestEntries,
	readDebugIngestEntries,
	subscribeDebugIngest,
} from "@/lib/api";
import { cn } from "@/lib/utils";

type DebugIngestViewState = {
	active: boolean;
	starting: boolean;
	status: DebugIngestStatus | null;
	error: string | null;
};

type IngestTabProps = {
	workspaceId: string | null;
	state: DebugIngestViewState | null;
	isActive: boolean;
};

export function IngestTab({ workspaceId, state, isActive }: IngestTabProps) {
	const [entries, setEntries] = useState<DebugIngestEntry[]>([]);
	const [copied, setCopied] = useState<string | null>(null);
	const ingestUrl = state?.status?.ingestUrl ?? null;

	useEffect(() => {
		if (!workspaceId || !isActive || !state?.status) return;
		let cancelled = false;
		const channel = new Channel<DebugIngestEvent>();
		channel.onmessage = (event) => {
			if (event.type === "entry") {
				setEntries((current) => [...current, event.entry]);
			} else if (event.type === "cleared") {
				setEntries([]);
			}
		};
		void readDebugIngestEntries(workspaceId)
			.then((next) => {
				if (!cancelled) setEntries(next);
			})
			.catch((error) => console.warn("[debug-ingest] read failed", error));
		void subscribeDebugIngest(workspaceId, channel).catch((error) => {
			console.warn("[debug-ingest] subscribe failed", error);
		});
		return () => {
			cancelled = true;
		};
	}, [workspaceId, isActive, state?.status]);

	const curlExamples = useMemo(() => {
		if (!ingestUrl) return [];
		return [
			`curl -s ${shellQuote(ingestUrl)}`,
			`curl -s -X POST ${shellQuote(ingestUrl)} -H 'Content-Type: application/json' -d '{"level":"info","source":"agent","message":"captured evidence"}'`,
			`curl -s -X DELETE ${shellQuote(ingestUrl)}`,
		];
	}, [ingestUrl]);

	const copyText = useCallback(async (key: string, text: string) => {
		await navigator.clipboard.writeText(text);
		setCopied(key);
		window.setTimeout(() => setCopied(null), 1200);
	}, []);

	const clearEntries = useCallback(async () => {
		if (!workspaceId) return;
		await clearDebugIngestEntries(workspaceId);
		setEntries([]);
	}, [workspaceId]);

	return (
		<section
			role="tabpanel"
			id="inspector-panel-ingest"
			aria-labelledby="inspector-tab-ingest"
			className={cn(
				"flex min-h-0 flex-1 flex-col overflow-hidden",
				!isActive && "hidden",
			)}
		>
			<div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3 text-[12px]">
				<div className="rounded-lg border border-border/70 bg-muted/20 p-3">
					<div className="flex items-center justify-between gap-2">
						<div>
							<div className="font-medium text-foreground">Debug ingest</div>
							<p className="mt-1 text-muted-foreground">
								{state?.starting
									? "Starting workspace ingest server…"
									: state?.error
										? "Startup failed"
										: ingestUrl
											? "Running on localhost"
											: "Enable Debug mode to start ingest."}
							</p>
						</div>
						{ingestUrl ? (
							<Button
								type="button"
								variant="outline"
								size="xs"
								onClick={clearEntries}
							>
								<Trash2 className="size-3" />
								Clear
							</Button>
						) : null}
					</div>
					{state?.error ? (
						<p className="mt-3 rounded-md border border-destructive/30 bg-destructive/10 p-2 text-destructive">
							{state.error}
						</p>
					) : null}
					{ingestUrl ? (
						<div className="mt-3 space-y-2">
							<CopyableLine
								label="POST / GET / DELETE"
								value={ingestUrl}
								copied={copied === "url"}
								onCopy={() => copyText("url", ingestUrl)}
							/>
							{curlExamples.map((example, index) => (
								<CopyableLine
									key={example}
									label={index === 0 ? "Read" : index === 1 ? "Write" : "Clear"}
									value={example}
									copied={copied === `curl-${index}`}
									onCopy={() => copyText(`curl-${index}`, example)}
								/>
							))}
						</div>
					) : null}
				</div>

				<div className="flex items-center justify-between">
					<div className="font-medium text-foreground">Entries</div>
					<div className="text-muted-foreground">{entries.length}</div>
				</div>
				{entries.length === 0 ? (
					<div className="rounded-lg border border-dashed border-border/70 p-4 text-center text-muted-foreground">
						No debug evidence ingested yet.
					</div>
				) : (
					<div className="space-y-2">
						{entries.map((entry) => (
							<EntryCard key={entry.id} entry={entry} />
						))}
					</div>
				)}
			</div>
		</section>
	);
}

function CopyableLine({
	label,
	value,
	copied,
	onCopy,
}: {
	label: string;
	value: string;
	copied: boolean;
	onCopy: () => void;
}) {
	return (
		<div className="flex min-w-0 items-center gap-2 rounded-md bg-background/70 px-2 py-1.5">
			<span className="w-16 shrink-0 text-muted-foreground">{label}</span>
			<code className="min-w-0 flex-1 truncate font-mono text-[11px] text-foreground">
				{value}
			</code>
			<Button type="button" variant="ghost" size="icon-xs" onClick={onCopy}>
				{copied ? <Check className="size-3" /> : <Copy className="size-3" />}
			</Button>
		</div>
	);
}

function EntryCard({ entry }: { entry: DebugIngestEntry }) {
	const payload = entry.payload;
	const timestamp = pickString(payload, ["timestamp", "time", "ts"]);
	const level = pickString(payload, ["level"]);
	const source = pickString(payload, ["source", "logger", "service"]);
	const message = pickString(payload, ["message", "msg"]);
	return (
		<article className="rounded-lg border border-border/70 bg-background/60 p-3">
			<div className="flex min-w-0 items-center gap-2 text-[11px] text-muted-foreground">
				<span>{timestamp ?? entry.receivedAt}</span>
				{level ? <span className="uppercase">{level}</span> : null}
				{source ? <span className="truncate">{source}</span> : null}
			</div>
			{message ? (
				<div className="mt-1 text-[13px] text-foreground">{message}</div>
			) : null}
			<pre className="mt-2 max-h-60 overflow-auto rounded-md bg-muted/40 p-2 font-mono text-[11px] text-muted-foreground">
				{JSON.stringify(payload, null, 2)}
			</pre>
		</article>
	);
}

function pickString(
	payload: Record<string, unknown>,
	keys: string[],
): string | null {
	for (const key of keys) {
		const value = payload[key];
		if (typeof value === "string" && value.trim()) return value;
		if (typeof value === "number") return String(value);
	}
	return null;
}

function shellQuote(value: string): string {
	return `'${value.replaceAll("'", "'\\''")}'`;
}
